// Audio analysis + PCM/WAV/MP3 encoding used in main thread and workers.
// All operations are deterministic and pure wherever possible so tests can
// reason about them without a real AudioContext.

import { LIMITS } from './constants';

export interface PcmBuffer {
  sampleRate: number;
  channels: Float32Array[]; // length 1 (mono) or 2 (stereo)
  durationMs: number;
}

/** Detect silence regions on a mono Float32 buffer. */
export function detectSilenceRegions(
  samples: Float32Array,
  sampleRate: number,
  thresholdDb: number = LIMITS.SILENCE_THRESHOLD_DB,
  minDurationSec: number = LIMITS.SILENCE_MIN_DURATION_SEC
): Array<{ startMs: number; endMs: number }> {
  const threshold = Math.pow(10, thresholdDb / 20); // linear amplitude
  const minSamples = Math.max(1, Math.floor(minDurationSec * sampleRate));
  const out: Array<{ startMs: number; endMs: number }> = [];
  let runStart = -1;
  for (let i = 0; i < samples.length; i++) {
    const amp = Math.abs(samples[i]);
    if (amp < threshold) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runLen = i - runStart;
      if (runLen >= minSamples) {
        out.push({
          startMs: Math.round((runStart / sampleRate) * 1000),
          endMs: Math.round((i / sampleRate) * 1000)
        });
      }
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    const runLen = samples.length - runStart;
    if (runLen >= minSamples) {
      out.push({
        startMs: Math.round((runStart / sampleRate) * 1000),
        endMs: Math.round((samples.length / sampleRate) * 1000)
      });
    }
  }
  return out;
}

/** RMS of a Float32 buffer. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** Convert linear amplitude to dBFS. */
export function toDb(linear: number): number {
  if (linear <= 1e-12) return -120;
  return 20 * Math.log10(linear);
}

/** Estimate loudness in LUFS via a K-free RMS → LUFS approximation. */
export function estimateLufs(samples: Float32Array): number {
  const r = rms(samples);
  return toDb(r) - 0.691;
}

/** Compute linear gain to reach targetLufs from currentLufs. */
export function gainForNormalization(currentLufs: number, targetLufs: number): number {
  const deltaDb = targetLufs - currentLufs;
  return Math.pow(10, deltaDb / 20);
}

/** Apply fade-in in place to the first `fadeSec` of samples (linear). */
export function applyFadeIn(samples: Float32Array, sampleRate: number, fadeSec: number): void {
  const n = Math.min(samples.length, Math.floor(fadeSec * sampleRate));
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    samples[i] = samples[i] * (i / n);
  }
}

/** Apply fade-out in place to the last `fadeSec` of samples (linear). */
export function applyFadeOut(samples: Float32Array, sampleRate: number, fadeSec: number): void {
  const n = Math.min(samples.length, Math.floor(fadeSec * sampleRate));
  if (n <= 0) return;
  const start = samples.length - n;
  for (let i = 0; i < n; i++) {
    samples[start + i] = samples[start + i] * (1 - i / n);
  }
}

/** Apply balance to a stereo pair. +100 = full right, -100 = full left. */
export function applyBalance(
  left: Float32Array,
  right: Float32Array,
  balance: number
): void {
  const b = Math.max(-100, Math.min(100, balance)) / 100;
  const lGain = b <= 0 ? 1 : 1 - b;
  const rGain = b >= 0 ? 1 : 1 + b;
  for (let i = 0; i < left.length; i++) left[i] *= lGain;
  for (let i = 0; i < right.length; i++) right[i] *= rGain;
}

/** Apply a linear gain in place. */
export function applyGain(samples: Float32Array, gain: number): void {
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

/** Slice a PcmBuffer to the given millisecond range, returning a new PcmBuffer. */
export function sliceBuffer(buf: PcmBuffer, startMs: number, endMs: number): PcmBuffer {
  const sr = buf.sampleRate;
  const start = Math.max(0, Math.floor((startMs / 1000) * sr));
  const end = Math.min(buf.channels[0].length, Math.floor((endMs / 1000) * sr));
  const len = Math.max(0, end - start);
  const channels = buf.channels.map((ch) => ch.slice(start, start + len));
  return {
    sampleRate: sr,
    channels,
    durationMs: Math.round((len / sr) * 1000)
  };
}

/** Remove a range from a PcmBuffer (i.e., "cut") and return the result. */
export function cutRange(buf: PcmBuffer, startMs: number, endMs: number): PcmBuffer {
  const sr = buf.sampleRate;
  const start = Math.max(0, Math.floor((startMs / 1000) * sr));
  const end = Math.min(buf.channels[0].length, Math.floor((endMs / 1000) * sr));
  if (end <= start) return buf;
  const channels = buf.channels.map((ch) => {
    const kept = new Float32Array(ch.length - (end - start));
    kept.set(ch.subarray(0, start), 0);
    kept.set(ch.subarray(end), start);
    return kept;
  });
  return {
    sampleRate: sr,
    channels,
    durationMs: Math.round((channels[0].length / sr) * 1000)
  };
}

/** Concatenate two PcmBuffers. Shorter channel count is padded with silence. */
export function concatBuffers(a: PcmBuffer, b: PcmBuffer): PcmBuffer {
  if (a.sampleRate !== b.sampleRate) {
    throw new Error('concatBuffers: sample rate mismatch — transcode before merge');
  }
  const channels = Math.max(a.channels.length, b.channels.length);
  const aLen = a.channels[0].length;
  const bLen = b.channels[0].length;
  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const buf = new Float32Array(aLen + bLen);
    const aCh = a.channels[c] ?? a.channels[0];
    const bCh = b.channels[c] ?? b.channels[0];
    buf.set(aCh, 0);
    buf.set(bCh, aLen);
    out.push(buf);
  }
  return {
    sampleRate: a.sampleRate,
    channels: out,
    durationMs: Math.round(((aLen + bLen) / a.sampleRate) * 1000)
  };
}

/** Compute peaks (min/max per bucket) for waveform rendering. Deterministic. */
export function computePeaks(samples: Float32Array, bucketCount: number): Array<{ min: number; max: number }> {
  const out: Array<{ min: number; max: number }> = [];
  if (samples.length === 0 || bucketCount <= 0) return out;
  const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount));
  for (let b = 0; b < bucketCount; b++) {
    const start = b * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) {
      min = 0;
      max = 0;
    }
    out.push({ min, max });
  }
  return out;
}

/** Convert a Float32 sample in [-1,1] to Int16. */
function floatToInt16(f: number): number {
  const s = Math.max(-1, Math.min(1, f));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

/** Interleave multi-channel Float32 samples into a single Int16 array. */
export function floatToInt16Interleaved(channels: Float32Array[]): Int16Array {
  const len = channels[0]?.length ?? 0;
  const n = channels.length;
  const out = new Int16Array(len * n);
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < n; c++) {
      out[i * n + c] = floatToInt16(channels[c][i] ?? 0);
    }
  }
  return out;
}

/** Encode PCM samples into a 16-bit WAV byte array (raw). */
export function encodeWavBytes(
  channels: Float32Array[],
  sampleRate: number = LIMITS.WAV_SAMPLE_RATE
): Uint8Array {
  const numChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = length * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setInt16(offset, floatToInt16(channels[ch][i] ?? 0), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/** Encode PCM samples into a 16-bit WAV Blob (Blob wrapper around encodeWavBytes). */
export function encodeWav(
  channels: Float32Array[],
  sampleRate: number = LIMITS.WAV_SAMPLE_RATE
): Blob {
  const bytes = encodeWavBytes(channels, sampleRate);
  return new Blob([bytes], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

/**
 * Encode PCM samples to a real MP3 byte stream using @breezystack/lamejs.
 * Supports 1 or 2 channels; higher-channel inputs are downmixed to stereo.
 *
 * The actual lamejs import is done dynamically so tests that don't need MP3
 * encoding don't pay the load cost, and so workers can import it separately.
 */
export async function encodeMp3Bytes(
  channels: Float32Array[],
  sampleRate: number,
  bitrateKbps: 128 | 192 | 320
): Promise<Uint8Array> {
  const lame = await import('@breezystack/lamejs');
  const num = Math.min(2, channels.length);
  const left = channels[0];
  const right = num === 2 ? channels[1] : undefined;

  const leftI = new Int16Array(left.length);
  for (let i = 0; i < left.length; i++) leftI[i] = floatToInt16(left[i]);
  let rightI: Int16Array | undefined;
  if (right) {
    rightI = new Int16Array(right.length);
    for (let i = 0; i < right.length; i++) rightI[i] = floatToInt16(right[i]);
  }

  const encoder = new lame.Mp3Encoder(num, sampleRate, bitrateKbps);
  const CHUNK = 1152; // MP3 frame size
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < leftI.length; i += CHUNK) {
    const end = Math.min(leftI.length, i + CHUNK);
    const l = leftI.subarray(i, end);
    const r = rightI ? rightI.subarray(i, end) : undefined;
    const enc = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
    if (enc && enc.length > 0) chunks.push(new Uint8Array(enc));
  }
  const tail = encoder.flush();
  if (tail && tail.length > 0) chunks.push(new Uint8Array(tail));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Encode PCM to a real MP3 Blob. */
export async function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  bitrateKbps: 128 | 192 | 320
): Promise<Blob> {
  const bytes = await encodeMp3Bytes(channels, sampleRate, bitrateKbps);
  return new Blob([bytes], { type: 'audio/mpeg' });
}
