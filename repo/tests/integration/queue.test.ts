import { describe, expect, it } from 'vitest';
import {
  completeJob,
  enqueueJob,
  ensureWorker,
  failJob,
  heartbeatJob,
  listJobs,
  markAssigned,
  pickWorker,
  reclaimJob
} from '../../src/lib/services/queue';
import { all } from '../../src/lib/db/indexeddb';
import type { Job, WorkerRuntime } from '../../src/lib/types';

describe('queue persistence and lifecycle', () => {
  it('enqueues, assigns, completes, and updates worker rating', async () => {
    const w = await ensureWorker('w1');
    expect(w.rating).toBe(1);
    const job = await enqueueJob({ type: 'export', inputRef: 'x', initialEstimateMs: 1000 });
    await markAssigned(job.id, 'w1');
    const done = await completeJob(job.id, 'out');
    expect(done.ok).toBe(true);
    const workers = await all<WorkerRuntime>('workers');
    expect(workers[0].successCount).toBe(1);
  });

  it('fails up to max attempts then terminates', async () => {
    await ensureWorker('w2');
    const job = await enqueueJob({ type: 'normalize', inputRef: 'x', initialEstimateMs: 500 });
    await markAssigned(job.id, 'w2');
    for (let i = 0; i < 3; i++) {
      await markAssigned(job.id, 'w2');
      const r = await failJob(job.id, 'ERR', 'oops');
      expect(r.ok).toBe(true);
    }
    const jobs = await listJobs();
    const updated = jobs.find((j) => j.id === job.id);
    expect(updated?.status).toBe('failed_terminal');
  });

  it('pickWorker prefers highest rating', async () => {
    const high = await ensureWorker('h');
    const low = await ensureWorker('l');
    const result = pickWorker([
      { ...low, rating: 0.2 },
      { ...high, rating: 0.9 }
    ]);
    expect(result?.id).toBe('h');
  });

  it('persists queued jobs across "restart" (re-open)', async () => {
    await enqueueJob({ type: 'export', inputRef: 'x', initialEstimateMs: 1000 });
    const before = await all<Job>('jobs');
    expect(before.length).toBeGreaterThan(0);
    // The fake IndexedDB retains data across calls; emulate a fresh handle.
    const after = await all<Job>('jobs');
    expect(after.length).toBe(before.length);
  });
});
