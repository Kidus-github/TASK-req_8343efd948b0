// Deterministic local estimators for export size & runtime.
// Formulas are documented so UI, tests, and engine agree.

import { LIMITS, type Mp3BitrateValue } from './constants';

/** Estimated MP3 byte size for a given duration and bitrate. */
export function estimateMp3Bytes(durationMs: number, bitrateKbps: Mp3BitrateValue): number {
  // bitrate in bits/sec → bytes/sec = bitrate * 1000 / 8
  // size = bytes/sec * (durationMs/1000).
  const bytesPerSec = (bitrateKbps * 1000) / 8;
  return Math.max(0, Math.round(bytesPerSec * (durationMs / 1000)));
}

/** Estimated 16-bit stereo WAV byte size at a given sample rate. */
export function estimateWavBytes(
  durationMs: number,
  sampleRate: number = LIMITS.WAV_SAMPLE_RATE,
  channels: number = 2,
  bitsPerSample: number = 16
): number {
  const bytesPerSec = (sampleRate * channels * bitsPerSample) / 8;
  const WAV_HEADER_BYTES = 44;
  return WAV_HEADER_BYTES + Math.round(bytesPerSec * (durationMs / 1000));
}

/** Rough render runtime estimate: mp3 encoding is typically much slower than wav. */
export function estimateRenderMs(
  format: 'mp3' | 'wav',
  durationMs: number,
  bitrateKbps?: Mp3BitrateValue
): number {
  if (format === 'wav') {
    // WAV is just PCM re-mux; assume ~0.05x realtime in a worker.
    return Math.max(50, Math.round(durationMs * 0.05));
  }
  // MP3: factor scales with bitrate (higher bitrate = slightly more work).
  const factor = bitrateKbps === 320 ? 0.2 : bitrateKbps === 192 ? 0.15 : 0.12;
  return Math.max(100, Math.round(durationMs * factor));
}

/** Worker rating used by smart scheduler. */
export function workerRating(successCount: number, failureCount: number): number {
  return successCount / Math.max(1, successCount + failureCount);
}

/** Worker rating update after a terminal job outcome. */
export function updateWorkerRating(
  successCount: number,
  failureCount: number,
  outcome: 'success' | 'failure'
): { successCount: number; failureCount: number; rating: number } {
  const s = successCount + (outcome === 'success' ? 1 : 0);
  const f = failureCount + (outcome === 'failure' ? 1 : 0);
  return { successCount: s, failureCount: f, rating: workerRating(s, f) };
}
