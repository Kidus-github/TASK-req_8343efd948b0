// Scheduled pool jobs must pick the highest-rated idle pool worker rather
// than hardcoding "pool-1". This regression test seeds differing ratings
// across `pool-1` and `pool-2` and asserts the scheduler actually honored
// them at dispatch time.

import { beforeEach, describe, expect, it } from 'vitest';
import { put, get } from '../../src/lib/db/indexeddb';
import { enqueueJob } from '../../src/lib/services/queue';
import { startWorkerPool, stopWorkerPool, tickScheduledPoolOnce } from '../../src/lib/audio/workerPool';
import type { AuditEvent, Job, WorkerRuntime } from '../../src/lib/types';
import { all } from '../../src/lib/db/indexeddb';
import { defaultPrefs, savePrefs } from '../../src/lib/db/prefs';

beforeEach(() => {
  // Disable quiet-hours deferral so the test is deterministic regardless of
  // when it runs on the wall clock.
  savePrefs({ ...defaultPrefs(), quietHours: { start: '00:00', end: '00:00', allowHeavyJobs: true } });
});

describe('rating-aware scheduled pool dispatch', () => {
  it('picks the highest-rated idle pool worker, not pool-1 by default', async () => {
    await startWorkerPool(2);
    try {
      // Seed pool-2 as clearly higher-rated than pool-1.
      const p1 = await get<WorkerRuntime>('workers', 'pool-1');
      const p2 = await get<WorkerRuntime>('workers', 'pool-2');
      if (!p1 || !p2) throw new Error('pool workers missing');
      await put('workers', { ...p1, rating: 0.2, successCount: 2, failureCount: 8 });
      await put('workers', { ...p2, rating: 0.95, successCount: 19, failureCount: 1 });

      // Enqueue a single pool-type job.
      const ch = new Float32Array(100);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i / 5);
      const job = await enqueueJob({
        type: 'waveform',
        inputRef: 'synthetic',
        initialEstimateMs: 50,
        payload: { channel: ch, buckets: 25 }
      });

      // Drive the scheduler deterministically.
      await tickScheduledPoolOnce();

      // The job should now be completed and have been assigned to pool-2.
      const after = await get<Job>('jobs', job.id);
      expect(after?.status).toBe('completed');
      expect(after?.workerId).toBe('pool-2');

      // Audit event should mention the chosen worker id.
      const audits = await all<AuditEvent>('auditEvents');
      const startAudit = audits.find(
        (a) => a.action === 'pool:start' && a.entityId === job.id
      );
      expect(startAudit).toBeDefined();
      expect(startAudit?.details?.workerId).toBe('pool-2');
    } finally {
      stopWorkerPool();
    }
  });

  it('flips to pool-1 when its rating is the highest', async () => {
    await startWorkerPool(2);
    try {
      const p1 = await get<WorkerRuntime>('workers', 'pool-1');
      const p2 = await get<WorkerRuntime>('workers', 'pool-2');
      if (!p1 || !p2) throw new Error('pool workers missing');
      await put('workers', { ...p1, rating: 0.9, successCount: 18, failureCount: 2 });
      await put('workers', { ...p2, rating: 0.3, successCount: 3, failureCount: 7 });

      const ch = new Float32Array(50);
      for (let i = 0; i < ch.length; i++) ch[i] = 0.1;
      const job = await enqueueJob({
        type: 'silence_scan',
        inputRef: 'synthetic',
        initialEstimateMs: 50,
        payload: { channel: ch, sampleRate: 1000 }
      });
      await tickScheduledPoolOnce();
      const after = await get<Job>('jobs', job.id);
      expect(after?.workerId).toBe('pool-1');
      expect(after?.status).toBe('completed');
    } finally {
      stopWorkerPool();
    }
  });
});
