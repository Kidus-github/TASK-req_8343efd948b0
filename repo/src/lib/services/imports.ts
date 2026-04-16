import type {
  ImportBatch,
  ImportedAudioFile,
  Result,
  ValidationError
} from '../types';
import { all, allByIndex, put, tx } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { ErrorCodes, fail, ok } from '../util/errors';
import {
  extensionOf,
  isAllowedExtension,
  validateImportBatch,
  validateImportFile
} from '../util/validators';
import type { AllowedExtension } from '../util/constants';
import { logAudit } from './audit';

export interface RawImportCandidate {
  name: string;
  size: number;
  mimeType?: string;
  data: Blob | ArrayBuffer;
  /** Optional hint (e.g. from an `<audio>` element) so callers don't have to
   *  re-decode when they already know the duration. */
  durationMsHint?: number;
}

export interface ImportOutcome {
  batch: ImportBatch;
  accepted: ImportedAudioFile[];
  rejected: Array<{ filename: string; errors: ValidationError[] }>;
}

export async function importBatch(
  projectId: string,
  candidates: RawImportCandidate[]
): Promise<Result<ImportOutcome>> {
  if (!candidates.length) {
    return fail(ErrorCodes.IMPORT_BATCH_EMPTY, 'No files provided.');
  }
  const batchLevel = validateImportBatch(
    candidates.map((c) => ({
      name: c.name,
      size:
        c.size > 0
          ? c.size
          : c.data instanceof Blob
            ? c.data.size
            : (c.data as ArrayBuffer).byteLength
    }))
  );
  if (batchLevel) return fail(batchLevel.code, batchLevel.message);

  const accepted: ImportedAudioFile[] = [];
  const rejected: Array<{ filename: string; errors: ValidationError[] }> = [];

  // Validate per-file without blocking main thread too long: process synchronously
  // but rely on the caller to page batches larger than a comfortable chunk.
  for (const cand of candidates) {
    // Prefer the explicit size (standard File.size) but fall back to the
    // underlying Blob's size when the caller passed 0.
    const effectiveSize =
      cand.size > 0
        ? cand.size
        : cand.data instanceof Blob
          ? cand.data.size
          : (cand.data as ArrayBuffer).byteLength;
    const err = validateImportFile(cand.name, effectiveSize);
    if (err) {
      rejected.push({ filename: cand.name, errors: [err] });
      continue;
    }
    const extRaw = extensionOf(cand.name);
    if (!isAllowedExtension(extRaw)) {
      rejected.push({
        filename: cand.name,
        errors: [{ code: ErrorCodes.IMPORT_UNSUPPORTED_TYPE, message: 'Unsupported type.' }]
      });
      continue;
    }
    const ext: AllowedExtension = extRaw;
    const blobId = newId('blob');
    const blob =
      cand.data instanceof Blob
        ? cand.data
        : new Blob([cand.data], { type: cand.mimeType ?? defaultMime(ext) });
    const bytes = new Uint8Array(await blobToArrayBufferCompat(blob));
    await put('blobs', { id: blobId, blob, bytes, mimeType: blob.type });

    // Inspect bytes for duration + sample rate + channels without requiring
    // a full decode. WAV is parsed from its header; mp3/ogg fall back to a
    // decode-based probe. If duration cannot be determined here it remains
    // undefined and the UI shows an explicit "unknown" state.
    const meta = await probeAudioMeta(ext, bytes, cand.durationMsHint);

    const file: ImportedAudioFile = {
      id: newId('file'),
      projectId,
      originalFilename: cand.name,
      mimeType: cand.mimeType ?? blob.type ?? defaultMime(ext),
      extension: ext,
      sizeBytes: effectiveSize,
      durationMs: meta.durationMs,
      sampleRate: meta.sampleRate,
      channels: meta.channels,
      blobRef: blobId,
      importStatus: 'accepted',
      validationErrors: [],
      createdAt: nowIso()
    };
    await put('importedAudio', file);
    accepted.push(file);
  }

  if (accepted.length === 0) {
    return fail(ErrorCodes.IMPORT_BATCH_EMPTY, 'No valid files in batch.', { rejected });
  }

  const batch: ImportBatch = {
    id: newId('batch'),
    projectId,
    startedAt: nowIso(),
    completedAt: nowIso(),
    fileCount: candidates.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    totalSizeBytes: candidates.reduce((n, c) => n + c.size, 0),
    status: rejected.length === 0 ? 'accepted_full' : 'accepted_partial'
  };
  await put('importBatches', batch);
  await logAudit('importBatch', batch.id, 'complete', 'user', {
    accepted: accepted.length,
    rejected: rejected.length
  });
  return ok({ batch, accepted, rejected });
}

export async function listProjectFiles(projectId: string): Promise<ImportedAudioFile[]> {
  return allByIndex<ImportedAudioFile>('importedAudio', 'by_project', projectId);
}

export async function listBatches(projectId: string): Promise<ImportBatch[]> {
  return allByIndex<ImportBatch>('importBatches', 'by_project', projectId);
}

interface AudioMeta {
  durationMs?: number;
  sampleRate?: number;
  channels?: number;
}

/**
 * Probe audio metadata without doing a full decode when possible.
 * WAV can be read from the RIFF header. MP3/OGG fall back to
 * AudioContext.decodeAudioData; if that isn't available the duration is
 * left undefined and the UI shows an explicit "unknown" state.
 */
async function probeAudioMeta(
  ext: AllowedExtension,
  bytes: Uint8Array,
  hint?: number
): Promise<AudioMeta> {
  if (ext === 'wav') {
    const wav = probeWavHeader(bytes);
    if (wav) return wav;
  }

  // MP3: try to parse the first frame header for sample rate + frame count.
  if (ext === 'mp3') {
    const mp3 = probeMp3Header(bytes);
    if (mp3) return mp3;
  }

  // Fallback: AudioContext.decodeAudioData where available.
  if (typeof AudioContext !== 'undefined') {
    try {
      const ctx = new AudioContext();
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        const p = ctx.decodeAudioData(ab, resolve, reject);
        if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
          (p as Promise<AudioBuffer>).then(resolve, reject);
        }
      });
      try {
        await ctx.close?.();
      } catch {}
      return {
        durationMs: Math.round(buffer.duration * 1000),
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels
      };
    } catch {
      // decode failed — fall through
    }
  }

  if (typeof hint === 'number' && hint > 0) {
    return { durationMs: Math.round(hint) };
  }
  return {};
}

function probeWavHeader(bytes: Uint8Array): AudioMeta | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // "RIFF" and "WAVE"
  if (
    view.getUint8(0) !== 0x52 ||
    view.getUint8(1) !== 0x49 ||
    view.getUint8(2) !== 0x46 ||
    view.getUint8(3) !== 0x46
  )
    return null;
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataSize = view.getUint32(40, true);
  if (!byteRate || !sampleRate) return null;
  const durationSec =
    bitsPerSample > 0 && channels > 0
      ? dataSize / (sampleRate * channels * (bitsPerSample / 8))
      : 0;
  return {
    durationMs: Math.round(durationSec * 1000),
    sampleRate,
    channels
  };
}

function probeMp3Header(bytes: Uint8Array): AudioMeta | null {
  // Skip ID3v2 tag if present ("ID3" magic).
  let pos = 0;
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    pos = 10 + size;
  }
  // Find the first frame sync.
  for (; pos + 3 < bytes.length; pos++) {
    if (bytes[pos] === 0xff && (bytes[pos + 1] & 0xe0) === 0xe0) {
      const b1 = bytes[pos + 1];
      const b2 = bytes[pos + 2];
      const version = (b1 >> 3) & 0x03; // 11=MPEG1, 10=MPEG2, 00=MPEG2.5
      const sampleRateIndex = (b2 >> 2) & 0x03;
      if (sampleRateIndex === 0x03) continue;
      const sampleRates: Record<number, number[]> = {
        0x03: [44100, 48000, 32000], // MPEG1
        0x02: [22050, 24000, 16000], // MPEG2
        0x00: [11025, 12000, 8000] // MPEG2.5
      };
      const table = sampleRates[version];
      if (!table) continue;
      const sampleRate = table[sampleRateIndex];
      // Duration is hard to compute precisely without full parsing; estimate
      // from average bitrate by scanning bytes. For credible pre-confirmation
      // estimates we prefer a full decode path; return sample rate only here
      // so the UI can at least show it, and rely on AudioContext for duration.
      return { sampleRate };
    }
  }
  return null;
}

async function blobToArrayBufferCompat(blob: Blob): Promise<ArrayBuffer> {
  const b = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof b.arrayBuffer === 'function') {
    const buf = await b.arrayBuffer();
    // Sanity check: some jsdom Blob.arrayBuffer paths return text bytes
    // instead of raw content. Detect "[object Object]" and fall back.
    const view = new Uint8Array(buf);
    const looksLikeTextStub =
      buf.byteLength === 15 &&
      view[0] === 0x5b && view[1] === 0x6f && view[2] === 0x62; // "[ob"
    if (!looksLikeTextStub) return buf;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsArrayBuffer(blob);
  });
}

function defaultMime(ext: AllowedExtension): string {
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
  }
}
