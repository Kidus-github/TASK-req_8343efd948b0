// Main-thread audio engine: decode blobs, cache PcmBuffers by file id, and
// apply a committed operation log to produce a rendered PcmBuffer.
//
// Decoding uses AudioContext.decodeAudioData. Heavy encoding work is handed
// off to a Web Worker (renderWorker.ts) so the UI stays responsive.

import type { EditOperation, ImportedAudioFile } from '../types';
import { get } from '../db/indexeddb';
import {
  applyBalance,
  applyFadeIn,
  applyFadeOut,
  concatBuffers,
  cutRange,
  sliceBuffer,
  type PcmBuffer
} from '../util/audio';
import { LIMITS } from '../util/constants';
import { normalizeChannels } from './smartDispatch';

let sharedCtx: AudioContext | OfflineAudioContext | null = null;

function getDecodeContext(): AudioContext | OfflineAudioContext {
  if (sharedCtx) return sharedCtx;
  if (typeof AudioContext !== 'undefined') {
    sharedCtx = new AudioContext({ sampleRate: LIMITS.WAV_SAMPLE_RATE });
  } else {
    // Older Safari naming, and a conservative fallback for tests.
    const OfflineCtor = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!OfflineCtor) throw new Error('AudioContext not available in this environment');
    sharedCtx = new OfflineCtor(2, LIMITS.WAV_SAMPLE_RATE, LIMITS.WAV_SAMPLE_RATE);
  }
  return sharedCtx;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  const b = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  // Response-based fallback for jsdom Blob variants.
  return new Response(blob as unknown as BodyInit).arrayBuffer();
}

/** Decode an audio Blob to channel Float32 buffers. */
export async function decodeBlob(blob: Blob): Promise<PcmBuffer> {
  const ctx = getDecodeContext();
  const arr = await blobToArrayBuffer(blob);
  const audio = await new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(arr.slice(0), resolve, reject);
      if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
        (p as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (err) {
      reject(err as Error);
    }
  });
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) {
    // Copy out of the AudioBuffer so the underlying buffer can be GC'd.
    const src = audio.getChannelData(c);
    const dst = new Float32Array(src.length);
    dst.set(src);
    channels.push(dst);
  }
  if (channels.length === 1) channels.push(new Float32Array(channels[0])); // upmix to stereo
  return {
    sampleRate: audio.sampleRate,
    channels,
    durationMs: Math.round((audio.duration || channels[0].length / audio.sampleRate) * 1000)
  };
}

/** Cache of decoded buffers keyed by file id. */
const decodedCache = new Map<string, Promise<PcmBuffer>>();

export function invalidateDecoded(fileId: string): void {
  decodedCache.delete(fileId);
}

export function clearDecodedCache(): void {
  decodedCache.clear();
}

/** Get (or decode) the PcmBuffer for an ImportedAudioFile. */
export async function pcmForFile(file: ImportedAudioFile): Promise<PcmBuffer> {
  const existing = decodedCache.get(file.id);
  if (existing) return existing;
  const p = (async () => {
    const blobRec = await get<{ id: string; blob: Blob; bytes?: Uint8Array | ArrayBuffer; mimeType?: string }>(
      'blobs',
      file.blobRef
    );
    if (!blobRec) throw new Error(`blob missing for file ${file.originalFilename}`);
    // Prefer stored bytes (browser + test-env compatible). Fall back to Blob.
    if (blobRec.bytes) {
      const ab = coerceToArrayBuffer(blobRec.bytes);
      return decodeArrayBuffer(ab);
    }
    return decodeBlob(blobRec.blob);
  })();
  decodedCache.set(file.id, p);
  try {
    return await p;
  } catch (err) {
    decodedCache.delete(file.id);
    throw err;
  }
}

function coerceToArrayBuffer(input: unknown): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (input && typeof input === 'object' && typeof (input as { length?: unknown }).length === 'number') {
    // Structured clone may have degraded a Uint8Array into a plain indexed object.
    const indexed = input as Record<number, number> & { length: number };
    const u8 = new Uint8Array(indexed.length);
    for (let i = 0; i < indexed.length; i++) u8[i] = indexed[i] ?? 0;
    return u8.buffer;
  }
  throw new Error('coerceToArrayBuffer: unsupported input');
}

async function decodeArrayBuffer(arr: ArrayBuffer): Promise<PcmBuffer> {
  const ctx = getDecodeContext();
  const audio = await new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(arr.slice(0), resolve, reject);
      if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
        (p as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (err) {
      reject(err as Error);
    }
  });
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const src = audio.getChannelData(c);
    const dst = new Float32Array(src.length);
    dst.set(src);
    channels.push(dst);
  }
  if (channels.length === 1) channels.push(new Float32Array(channels[0]));
  return {
    sampleRate: audio.sampleRate,
    channels,
    durationMs: Math.round((audio.duration || channels[0].length / audio.sampleRate) * 1000)
  };
}

/**
 * Apply a committed operation log to a starting buffer. Preview operations
 * are skipped unless `includePreview` is true. This is the synchronous path
 * used when no merge is present; it does NOT resolve merge partners. For
 * merge support, use `applyOperationsAsync`.
 */
export function applyOperations(
  base: PcmBuffer,
  operations: EditOperation[],
  opts: { includePreview?: boolean } = {}
): PcmBuffer {
  let current: PcmBuffer = {
    sampleRate: base.sampleRate,
    channels: base.channels.map((c) => new Float32Array(c)),
    durationMs: base.durationMs
  };
  for (const op of operations) {
    if (op.previewEnabled && !opts.includePreview) continue;
    current = applyOneSync(current, op);
  }
  return current;
}

/**
 * Async variant that resolves merge partners by decoding the referenced file.
 * Preview operations are skipped unless `includePreview` is true.
 *
 * Required for any call site that must produce a faithful rendering — notably
 * the export pipeline and the editor's preview player.
 */
export async function applyOperationsAsync(
  base: PcmBuffer,
  operations: EditOperation[],
  opts: { includePreview?: boolean; partnerLoader?: (fileId: string) => Promise<PcmBuffer> } = {}
): Promise<PcmBuffer> {
  let current: PcmBuffer = {
    sampleRate: base.sampleRate,
    channels: base.channels.map((c) => new Float32Array(c)),
    durationMs: base.durationMs
  };
  for (const op of operations) {
    if (op.previewEnabled && !opts.includePreview) continue;
    if (op.type === 'merge') {
      const partnerId = String((op.params as { partnerFileId?: string }).partnerFileId ?? '');
      if (!partnerId) continue;
      let partnerBuf: PcmBuffer | null = null;
      if (opts.partnerLoader) {
        partnerBuf = await opts.partnerLoader(partnerId);
      } else {
        const partnerFile = await get<ImportedAudioFile>('importedAudio', partnerId);
        if (!partnerFile) {
          throw new Error(`merge: partner file ${partnerId} not found`);
        }
        partnerBuf = await pcmForFile(partnerFile);
      }
      if (partnerBuf.sampleRate !== current.sampleRate) {
        partnerBuf = resampleLinear(partnerBuf, current.sampleRate);
      }
      current = concatBuffers(current, partnerBuf);
      continue;
    }
    if (op.type === 'normalize_lufs') {
      // Route normalization through the pool dispatcher so loudness analysis
      // and gain application run off the main thread in real browsers.
      // In headless environments without Worker support, dispatchPool falls
      // back to an explicit inline execution of the same algorithm.
      const target = Number(
        (op.params as { targetLufs?: number }).targetLufs ?? LIMITS.NORMALIZATION_LUFS
      );
      const r = await normalizeChannels(current.channels, current.sampleRate, target);
      current = { ...current, channels: r.channels };
      continue;
    }
    current = applyOneSync(current, op);
  }
  return current;
}

function applyOneSync(current: PcmBuffer, op: EditOperation): PcmBuffer {
  switch (op.type) {
    case 'cut': {
      const startMs = Number((op.params as { startMs?: number }).startMs ?? 0);
      const endMs = Number((op.params as { endMs?: number }).endMs ?? 0);
      return cutRange(current, startMs, endMs);
    }
    case 'split': {
      // Split at atMs keeps only [0..atMs] in the current render. The
      // remainder [atMs..end] is persisted as a new file by the editor's
      // onSplit handler (a side effect outside the pure render path).
      const atMs = Number((op.params as { atMs?: number }).atMs ?? 0);
      if (atMs <= 0 || atMs >= current.durationMs) return current;
      return sliceBuffer(current, 0, atMs);
    }
    case 'merge':
      // Sync path skips merge so it doesn't produce silently-wrong output.
      // Callers that need merge must use applyOperationsAsync.
      return current;
    case 'fade_in': {
      const seconds = Number((op.params as { seconds?: number }).seconds ?? 1);
      for (const ch of current.channels) applyFadeIn(ch, current.sampleRate, seconds);
      return current;
    }
    case 'fade_out': {
      const seconds = Number((op.params as { seconds?: number }).seconds ?? 1);
      for (const ch of current.channels) applyFadeOut(ch, current.sampleRate, seconds);
      return current;
    }
    case 'balance_adjust': {
      const value = Number((op.params as { value?: number }).value ?? 0);
      if (current.channels.length >= 2) {
        applyBalance(current.channels[0], current.channels[1], value);
      }
      return current;
    }
    case 'normalize_lufs':
      // Normalization is only handled by the async pool-dispatch path
      // (applyOperationsAsync). The sync path intentionally passes through,
      // because the sync path is used by call sites that skip the worker
      // pool (e.g., a non-merge, non-normalize sanity render) — if you
      // encounter normalize here without the async path, your call site
      // should be using applyOperationsAsync instead.
      return current;
    case 'silence_flag':
      return current; // non-destructive
  }
  return current;
}

/** Linear-interpolation resample. Good enough for deterministic render tests. */
function resampleLinear(buf: PcmBuffer, targetSr: number): PcmBuffer {
  if (buf.sampleRate === targetSr) return buf;
  const ratio = targetSr / buf.sampleRate;
  const outChannels: Float32Array[] = [];
  for (const ch of buf.channels) {
    const outLen = Math.floor(ch.length * ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i / ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(ch.length - 1, i0 + 1);
      const t = src - i0;
      out[i] = ch[i0] * (1 - t) + ch[i1] * t;
    }
    outChannels.push(out);
  }
  return {
    sampleRate: targetSr,
    channels: outChannels,
    durationMs: Math.round((outChannels[0].length / targetSr) * 1000)
  };
}

// analyzeSilence used to run on the main thread; UI now uses the pool
// dispatcher directly (scanSilence in poolDispatch.ts) so this engine module
// no longer performs silence analysis. Kept removed intentionally.

/** Utility: merge a list of per-file PcmBuffers sequentially. */
export function mergeBuffers(buffers: PcmBuffer[]): PcmBuffer {
  if (buffers.length === 0) throw new Error('mergeBuffers: empty input');
  let out = buffers[0];
  for (let i = 1; i < buffers.length; i++) out = concatBuffers(out, buffers[i]);
  return out;
}
