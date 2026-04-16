// Timeline / editor heavy-op coverage.
//
// Waveform, silence scanning, and normalization must go through the smart
// scheduler (IndexedDB job queue). Under jsdom (no Worker), the smart
// dispatch falls back to inline executePoolJob after a short timeout. We
// spy on executePoolJob to confirm the pool algorithm ran and a real Job
// row was created in IndexedDB.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as poolWorker from '../../src/lib/audio/poolWorker';
import {
  computeWaveformPeaks,
  scanSilence,
  normalizeChannels
} from '../../src/lib/audio/smartDispatch';
import { applyOperationsAsync } from '../../src/lib/audio/engine';
import { all } from '../../src/lib/db/indexeddb';
import type { EditOperation, Job } from '../../src/lib/types';
import type { PcmBuffer } from '../../src/lib/util/audio';

let executeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  executeSpy = vi.spyOn(poolWorker, 'executePoolJob');
});

afterEach(() => {
  executeSpy.mockRestore();
});

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

function makeBuffer(seconds = 1, value = 0.2): PcmBuffer {
  const sr = 44100;
  const n = Math.floor(seconds * sr);
  const ch = new Float32Array(n);
  ch.fill(value);
  return { sampleRate: sr, channels: [ch, new Float32Array(ch)], durationMs: seconds * 1000 };
}

describe('smartDispatch creates real IndexedDB jobs', () => {
  it('computeWaveformPeaks enqueues a waveform job and runs executePoolJob', async () => {
    const ch = new Float32Array(512);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i / 5);
    const peaks = await computeWaveformPeaks(ch, 64);

    expect(executeSpy).toHaveBeenCalled();
    const calls = executeSpy.mock.calls;
    const waveformCall = calls.find((c) => (c[0] as { kind: string }).kind === 'waveform');
    expect(waveformCall).toBeTruthy();
    expect(peaks.length).toBe(64);

    // A real Job row was created in IndexedDB.
    const jobs = await all<Job>('jobs');
    const wfJob = jobs.find((j) => j.type === 'waveform');
    expect(wfJob).toBeTruthy();
  });

  it('scanSilence enqueues a silence_scan job', async () => {
    const sr = 1000;
    const ch = new Float32Array(sr * 2);
    ch.fill(0.5);
    for (let i = 500; i < 1500; i++) ch[i] = 0;
    const regions = await scanSilence(ch, sr, -35, 0.6);

    expect(executeSpy).toHaveBeenCalled();
    expect(regions.length).toBe(1);
    const jobs = await all<Job>('jobs');
    expect(jobs.some((j) => j.type === 'silence_scan')).toBe(true);
  });

  it('applyOperationsAsync normalize creates a normalize job', async () => {
    const buf = makeBuffer(1, 0.1);
    const ops = [op({ type: 'normalize_lufs', params: { targetLufs: -14 } })];
    const out = await applyOperationsAsync(buf, ops);

    expect(executeSpy).toHaveBeenCalled();
    const kinds = executeSpy.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).toContain('normalize');
    expect(out.channels[0][0]).not.toBeCloseTo(0.1, 3);

    const jobs = await all<Job>('jobs');
    expect(jobs.some((j) => j.type === 'normalize')).toBe(true);
  });

  it('normalizeChannels produces real gain', async () => {
    const { channels, gainApplied } = await normalizeChannels(
      [new Float32Array([0.05, 0.05]), new Float32Array([0.05, 0.05])],
      44100,
      -14
    );
    expect(gainApplied).toBeGreaterThan(1);
    expect(channels[0][0]).not.toBeCloseTo(0.05, 3);
  });
});
