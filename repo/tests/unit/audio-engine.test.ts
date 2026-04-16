// Applying committed edit operations to a PcmBuffer produces the right output.

import { describe, expect, it } from 'vitest';
import { applyOperations, applyOperationsAsync } from '../../src/lib/audio/engine';
import type { PcmBuffer } from '../../src/lib/util/audio';
import { computePeaks, concatBuffers, cutRange } from '../../src/lib/util/audio';
import type { EditOperation } from '../../src/lib/types';

function makeBuffer(ms: number, value: number = 0.5, sampleRate = 44100): PcmBuffer {
  const samples = Math.floor((ms / 1000) * sampleRate);
  const ch = new Float32Array(samples);
  for (let i = 0; i < samples; i++) ch[i] = value;
  return {
    sampleRate,
    channels: [ch, new Float32Array(ch)],
    durationMs: ms
  };
}

function op(partial: Partial<EditOperation>): EditOperation {
  return {
    id: partial.id ?? 'o',
    projectId: 'p',
    fileId: 'f',
    type: partial.type ?? 'fade_in',
    params: partial.params ?? {},
    createdAt: '2026-01-01T00:00:00Z',
    sequenceIndex: partial.sequenceIndex ?? 0,
    previewEnabled: partial.previewEnabled
  };
}

describe('applyOperations: cut', () => {
  it('shortens the buffer by the cut range', () => {
    const buf = makeBuffer(1000);
    const ops = [op({ type: 'cut', params: { startMs: 200, endMs: 500 } })];
    const out = applyOperations(buf, ops);
    expect(out.durationMs).toBeCloseTo(700, 0);
    expect(out.channels[0].length).toBeLessThan(buf.channels[0].length);
  });
});

describe('applyOperations: fade in/out', () => {
  it('fade_in ramps amplitude from 0 at the start', () => {
    const buf = makeBuffer(1000);
    const ops = [op({ type: 'fade_in', params: { seconds: 0.5 } })];
    const out = applyOperations(buf, ops);
    expect(out.channels[0][0]).toBe(0);
    expect(out.channels[0][out.channels[0].length - 1]).toBeCloseTo(0.5);
  });

  it('fade_out drops amplitude to 0 at the end', () => {
    const buf = makeBuffer(1000);
    const ops = [op({ type: 'fade_out', params: { seconds: 0.5 } })];
    const out = applyOperations(buf, ops);
    expect(out.channels[0][out.channels[0].length - 1]).toBeLessThan(0.05);
  });
});

describe('applyOperations: balance', () => {
  it('balance_adjust routes gain to one channel', () => {
    const buf = makeBuffer(100);
    const ops = [op({ type: 'balance_adjust', params: { value: -100 } })]; // full left
    const out = applyOperations(buf, ops);
    expect(out.channels[0][0]).toBeCloseTo(0.5);
    expect(out.channels[1][0]).toBeCloseTo(0);
  });
});

describe('applyOperationsAsync: normalization', () => {
  it('normalize_lufs applies a positive gain when current loudness is below target', async () => {
    // Normalization now runs through the worker pool dispatcher. The sync
    // applyOperations intentionally passes normalize through unchanged; the
    // async variant is the real render path.
    const buf = makeBuffer(500, 0.2); // quiet signal
    const before = buf.channels[0][0];
    const ops = [op({ type: 'normalize_lufs', params: { targetLufs: -14 } })];
    const out = await applyOperationsAsync(buf, ops);
    expect(out.channels[0][0]).not.toBeCloseTo(before, 3);
  });

  it('sync applyOperations leaves normalize as a pass-through', () => {
    const buf = makeBuffer(500, 0.2);
    const before = buf.channels[0][0];
    const ops = [op({ type: 'normalize_lufs', params: { targetLufs: -14 } })];
    const out = applyOperations(buf, ops);
    expect(out.channels[0][0]).toBe(before);
  });
});

describe('preview mode', () => {
  it('skips previewEnabled operations by default', () => {
    const buf = makeBuffer(1000);
    const ops = [op({ type: 'fade_in', params: { seconds: 1 }, previewEnabled: true })];
    const out = applyOperations(buf, ops);
    // No fade applied: first sample should equal input.
    expect(out.channels[0][0]).toBe(0.5);
  });

  it('includes preview ops when explicitly requested', () => {
    const buf = makeBuffer(1000);
    const ops = [op({ type: 'fade_in', params: { seconds: 1 }, previewEnabled: true })];
    const out = applyOperations(buf, ops, { includePreview: true });
    expect(out.channels[0][0]).toBe(0);
  });
});

describe('buffer helpers', () => {
  it('cutRange removes the requested window', () => {
    const buf = makeBuffer(1000);
    const cut = cutRange(buf, 300, 500);
    expect(cut.durationMs).toBeCloseTo(800, 0);
  });
  it('concatBuffers produces a longer buffer', () => {
    const a = makeBuffer(500);
    const b = makeBuffer(300);
    const merged = concatBuffers(a, b);
    expect(merged.durationMs).toBeCloseTo(800, 0);
  });
  it('computePeaks produces min/max pairs for each bucket', () => {
    const buf = makeBuffer(500);
    const peaks = computePeaks(buf.channels[0], 100);
    expect(peaks.length).toBe(100);
    for (const p of peaks) {
      expect(p.max).toBeGreaterThanOrEqual(p.min);
    }
  });
});
