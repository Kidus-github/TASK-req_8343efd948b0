import { describe, expect, it } from 'vitest';
import {
  applyBalance,
  applyFadeIn,
  applyFadeOut,
  applyGain,
  detectSilenceRegions,
  encodeWav,
  encodeWavBytes,
  estimateLufs,
  gainForNormalization,
  rms,
  toDb
} from '../../src/lib/util/audio';
import { LIMITS } from '../../src/lib/util/constants';

describe('silence detection', () => {
  it('finds regions below threshold longer than min duration', () => {
    const sr = 1000;
    const buf = new Float32Array(sr * 2);
    // Fill with loud signal then insert silence from 0.5s to 1.5s (1s long).
    for (let i = 0; i < buf.length; i++) buf[i] = 0.5;
    for (let i = Math.floor(sr * 0.5); i < Math.floor(sr * 1.5); i++) buf[i] = 0.0001;
    const regions = detectSilenceRegions(buf, sr, LIMITS.SILENCE_THRESHOLD_DB, 0.6);
    expect(regions.length).toBe(1);
    expect(regions[0].startMs).toBe(500);
    expect(regions[0].endMs).toBe(1500);
  });
  it('ignores silence shorter than min duration', () => {
    const sr = 1000;
    const buf = new Float32Array(sr);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.5;
    // 0.4s of silence, below 0.6s threshold → no region
    for (let i = 100; i < 500; i++) buf[i] = 0.0;
    const regions = detectSilenceRegions(buf, sr, LIMITS.SILENCE_THRESHOLD_DB, 0.6);
    expect(regions.length).toBe(0);
  });
});

describe('rms / dB / lufs proxies', () => {
  it('rms of constant signal', () => {
    const buf = new Float32Array(1000);
    buf.fill(0.5);
    expect(rms(buf)).toBeCloseTo(0.5);
  });
  it('toDb of silence is floored', () => {
    expect(toDb(0)).toBe(-120);
  });
  it('estimateLufs returns finite number', () => {
    const buf = new Float32Array(1000);
    buf.fill(0.1);
    const l = estimateLufs(buf);
    expect(Number.isFinite(l)).toBe(true);
  });
  it('gainForNormalization reaches target within dB', () => {
    // current -24 LUFS → target -14 LUFS → +10 dB → gain ≈ 3.162
    expect(gainForNormalization(-24, -14)).toBeCloseTo(3.162, 2);
  });
});

describe('fades and balance', () => {
  it('fadeIn produces monotonically increasing amplitude in ramp region', () => {
    const buf = new Float32Array(100);
    buf.fill(1);
    applyFadeIn(buf, 100, 1); // 1 second @ 100Hz = full ramp
    for (let i = 1; i < buf.length; i++) {
      expect(buf[i]).toBeGreaterThanOrEqual(buf[i - 1]);
    }
    expect(buf[0]).toBe(0);
  });
  it('fadeOut ends at 0', () => {
    const buf = new Float32Array(100);
    buf.fill(1);
    applyFadeOut(buf, 100, 1);
    expect(buf[buf.length - 1]).toBeLessThan(0.02);
  });
  it('applyBalance favors one channel', () => {
    const left = new Float32Array([1, 1]);
    const right = new Float32Array([1, 1]);
    applyBalance(left, right, -100); // full left
    expect(left[0]).toBe(1);
    expect(right[0]).toBe(0);
  });
  it('applyGain multiplies samples', () => {
    const buf = new Float32Array([0.5, 0.25]);
    applyGain(buf, 2);
    expect(buf[0]).toBeCloseTo(1);
    expect(buf[1]).toBeCloseTo(0.5);
  });
});

describe('WAV encoder', () => {
  it('encodes a valid RIFF/WAVE payload with expected size', () => {
    const samples = new Float32Array(100);
    samples.fill(0.1);
    const bytes = encodeWavBytes([samples], 1000);
    const header = new TextDecoder().decode(bytes.slice(0, 4));
    expect(header).toBe('RIFF');
    const fmt = new TextDecoder().decode(bytes.slice(8, 12));
    expect(fmt).toBe('WAVE');
    // 44 header bytes + 100 samples * 1 channel * 2 bytes
    expect(bytes.length).toBe(44 + 200);
    // And the Blob wrapper has the right mime.
    expect(encodeWav([samples], 1000).type).toContain('wav');
  });
});
