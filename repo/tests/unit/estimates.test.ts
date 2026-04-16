import { describe, expect, it } from 'vitest';
import {
  estimateMp3Bytes,
  estimateRenderMs,
  estimateWavBytes,
  updateWorkerRating,
  workerRating
} from '../../src/lib/util/estimates';

describe('estimateMp3Bytes', () => {
  it('scales with duration and bitrate', () => {
    const s128 = estimateMp3Bytes(60_000, 128);
    const s192 = estimateMp3Bytes(60_000, 192);
    const s320 = estimateMp3Bytes(60_000, 320);
    expect(s192).toBeGreaterThan(s128);
    expect(s320).toBeGreaterThan(s192);
    expect(s128).toBe(Math.round((128 * 1000) / 8 * 60));
  });
});

describe('estimateWavBytes', () => {
  it('includes 44-byte header and uses 16-bit stereo by default', () => {
    const bytes = estimateWavBytes(1000);
    expect(bytes).toBe(44 + Math.round((44100 * 2 * 16) / 8));
  });
});

describe('estimateRenderMs', () => {
  it('wav is typically faster than mp3 of the same duration', () => {
    const wav = estimateRenderMs('wav', 10_000);
    const mp3 = estimateRenderMs('mp3', 10_000, 320);
    expect(wav).toBeLessThan(mp3);
  });
  it('never returns below a floor', () => {
    expect(estimateRenderMs('wav', 1)).toBeGreaterThanOrEqual(50);
    expect(estimateRenderMs('mp3', 1, 128)).toBeGreaterThanOrEqual(100);
  });
});

describe('workerRating', () => {
  it('defaults to 0 on no data', () => {
    expect(workerRating(0, 0)).toBe(0);
  });
  it('tracks ratio', () => {
    const { successCount, failureCount, rating } = updateWorkerRating(5, 2, 'success');
    expect(successCount).toBe(6);
    expect(failureCount).toBe(2);
    expect(rating).toBeCloseTo(6 / 8);
  });
  it('decays on failure', () => {
    const { rating } = updateWorkerRating(3, 1, 'failure');
    expect(rating).toBeCloseTo(3 / 5);
  });
});
