// Export jobs must travel through the full worker lifecycle: assigned to a
// named worker, heartbeated while rendering, reclaimable if stalled, and
// rated on completion / failure — the same treatment as other pool jobs.

import { describe, expect, it, beforeEach } from 'vitest';
import { get, put } from '../../src/lib/db/indexeddb';
import { enqueueJob, shouldReclaim, reclaimJob } from '../../src/lib/services/queue';
import {
  startWorkerPool,
  stopWorkerPool,
  tickRenderSlotOnce
} from '../../src/lib/audio/workerPool';
import {
  addCartItem,
  confirmCart,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { importBatch } from '../../src/lib/services/imports';
import { createProject } from '../../src/lib/services/projects';
import { encodeWavBytes } from '../../src/lib/util/audio';
import { defaultPrefs, savePrefs } from '../../src/lib/db/prefs';
import type { AuditEvent, Job, WorkerRuntime } from '../../src/lib/types';
import { all } from '../../src/lib/db/indexeddb';

function wav(seconds = 0.3): Blob {
  const sr = 44100;
  const n = Math.floor(seconds * sr);
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
  return new Blob([encodeWavBytes([l, new Float32Array(l)], sr)], { type: 'audio/wav' });
}

beforeEach(() => {
  // Deterministic: disable quiet hours so tests run regardless of wall clock.
  savePrefs({ ...defaultPrefs(), quietHours: { start: '00:00', end: '00:00', allowHeavyJobs: true } });
});

async function primeQueuedExport(): Promise<{ jobId: string }> {
  const p = await createProject('Lifecycle');
  if (!p.ok) throw new Error('project');
  const blob = wav();
  const imp = await importBatch(p.data.id, [
    { name: 'a.wav', size: blob.size, mimeType: 'audio/wav', data: blob }
  ]);
  if (!imp.ok) throw new Error('import');
  const cart = await getOrCreateCart(p.data.id);
  await addCartItem(cart.id, imp.data.accepted[0].id, 'wav');
  await confirmCart(cart.id);
  const items = await listCartItems(cart.id);
  const q = items.find((i) => i.status === 'queued');
  if (!q) throw new Error('queued item missing');
  const job = await enqueueJob({
    type: 'export',
    inputRef: q.id,
    projectId: p.data.id,
    initialEstimateMs: 300
  });
  return { jobId: job.id };
}

describe('export job lifecycle tracking', () => {
  it('marks assigned + sets workerId + logs render:start audit', async () => {
    await startWorkerPool(1);
    try {
      const { jobId } = await primeQueuedExport();

      await tickRenderSlotOnce();

      // After the render, the job has moved through assigned/running to
      // completed, with workerId recorded.
      const job = await get<Job>('jobs', jobId);
      expect(job?.workerId).toBe('render-1');
      expect(job?.status).toBe('completed');
      expect(job?.startedAt).toBeTruthy();
      expect(job?.lastHeartbeatAt).toBeTruthy();

      // Audit trail records both start and complete.
      const audits = await all<AuditEvent>('auditEvents');
      const start = audits.find((a) => a.entityId === jobId && a.action === 'render:start');
      const done = audits.find((a) => a.entityId === jobId && a.action === 'complete');
      expect(start).toBeDefined();
      expect(start?.details?.workerId).toBe('render-1');
      expect(done).toBeDefined();

      // Worker rating includes the export — render-1's successCount bumped.
      const worker = await get<WorkerRuntime>('workers', 'render-1');
      expect(worker?.successCount).toBeGreaterThan(0);
    } finally {
      stopWorkerPool();
    }
  });

  it('reclaim logic applies to stalled export jobs the same way', async () => {
    await startWorkerPool(1);
    try {
      // Construct a synthetic "stalled" export job manually: running,
      // started long ago, no heartbeat.
      const job: Job = {
        id: 'stalled-export',
        type: 'export',
        inputRef: 'ignored',
        priority: 0,
        status: 'running',
        createdAt: '2026-01-01T00:00:00.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        workerId: 'render-1',
        initialEstimateMs: 100,
        runtimeMs: 0,
        attemptCount: 0,
        stallReclaimed: false,
        lastHeartbeatAt: '2026-01-01T00:00:00.000Z'
      };
      await put('jobs', job);

      // Far-future now — well past stall threshold and reclaim window.
      const now = Date.now();
      expect(shouldReclaim(job, now)).toBe(true);

      const res = await reclaimJob(job.id);
      expect(res.ok).toBe(true);
      const updated = await get<Job>('jobs', job.id);
      expect(updated?.status).toBe('queued');
      expect(updated?.stallReclaimed).toBe(true);
      expect(updated?.workerId).toBeUndefined();
    } finally {
      stopWorkerPool();
    }
  });
});
