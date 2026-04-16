// Worker pool: heavy tasks (waveform, silence_scan, normalize) go through
// the pool. Export rendering still goes through its dedicated render slot.

import { describe, expect, it } from 'vitest';
import { executePoolJob, type PoolRequest } from '../../src/lib/audio/poolWorker';
import { describePool, startWorkerPool, stopWorkerPool } from '../../src/lib/audio/workerPool';
import {
  describeDispatcher,
  dispatchPool,
  initPoolDispatcher,
  shutdownPoolDispatcher
} from '../../src/lib/audio/poolDispatch';

describe('poolWorker.executePoolJob', () => {
  it('produces peak buckets for waveform jobs', () => {
    const ch = new Float32Array(1000);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i / 10);
    const req: PoolRequest = { kind: 'waveform', jobId: 'w1', channel: ch, buckets: 50 };
    const res = executePoolJob(req);
    expect(res.kind).toBe('waveform-done');
    if (res.kind !== 'waveform-done') return;
    expect(res.peaks.length).toBe(50);
    expect(res.peaks[0].max).toBeGreaterThanOrEqual(res.peaks[0].min);
  });

  it('detects silence regions', () => {
    const sr = 1000;
    const ch = new Float32Array(sr * 2);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.5;
    for (let i = 500; i < 1500; i++) ch[i] = 0.0;
    const req: PoolRequest = {
      kind: 'silence_scan',
      jobId: 's1',
      channel: ch,
      sampleRate: sr
    };
    const res = executePoolJob(req);
    expect(res.kind).toBe('silence-done');
    if (res.kind !== 'silence-done') return;
    expect(res.regions.length).toBe(1);
  });

  it('applies normalization gain', () => {
    const sr = 44100;
    const ch = new Float32Array(sr);
    ch.fill(0.05);
    const req: PoolRequest = {
      kind: 'normalize',
      jobId: 'n1',
      channels: [ch, new Float32Array(ch)],
      sampleRate: sr,
      targetLufs: -14
    };
    const res = executePoolJob(req);
    expect(res.kind).toBe('normalize-done');
    if (res.kind !== 'normalize-done') return;
    expect(res.gainApplied).toBeGreaterThan(1); // quiet input -> positive gain
    expect(res.channels[0][0]).not.toBeCloseTo(0.05);
  });
});

describe('workerPool bring-up', () => {
  it('starts a render slot and the dispatcher, then tears them down', async () => {
    await startWorkerPool(2);
    const slots = describePool();
    expect(slots.length).toBe(1);
    expect(slots[0].kind).toBe('render');
    const info = describeDispatcher();
    expect(info.slots).toBe(2);
    stopWorkerPool();
    expect(describePool().length).toBe(0);
    expect(describeDispatcher().slots).toBe(0);
  });
});

describe('poolDispatch (UI-demand)', () => {
  it('dispatchPool returns waveform peaks via the dispatcher', async () => {
    initPoolDispatcher(2);
    try {
      const ch = new Float32Array(500);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i / 8);
      const res = await dispatchPool({ kind: 'waveform', channel: ch, buckets: 25 });
      expect(res.kind).toBe('waveform-done');
      if (res.kind !== 'waveform-done') return;
      expect(res.peaks.length).toBe(25);
    } finally {
      shutdownPoolDispatcher();
    }
  });

  it('dispatchPool returns silence regions via the dispatcher', async () => {
    initPoolDispatcher(1);
    try {
      const sr = 1000;
      const ch = new Float32Array(sr * 2);
      ch.fill(0.5);
      for (let i = 400; i < 1400; i++) ch[i] = 0;
      const res = await dispatchPool({ kind: 'silence_scan', channel: ch, sampleRate: sr });
      expect(res.kind).toBe('silence-done');
      if (res.kind !== 'silence-done') return;
      expect(res.regions.length).toBe(1);
    } finally {
      shutdownPoolDispatcher();
    }
  });

  it('dispatchPool normalizes channels via the dispatcher', async () => {
    initPoolDispatcher(1);
    try {
      const ch = new Float32Array(1000);
      ch.fill(0.1);
      const res = await dispatchPool({
        kind: 'normalize',
        channels: [ch, new Float32Array(ch)],
        sampleRate: 44100,
        targetLufs: -14
      });
      expect(res.kind).toBe('normalize-done');
      if (res.kind !== 'normalize-done') return;
      expect(res.gainApplied).toBeGreaterThan(1);
    } finally {
      shutdownPoolDispatcher();
    }
  });
});
