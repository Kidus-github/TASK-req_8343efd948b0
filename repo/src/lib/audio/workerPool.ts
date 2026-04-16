// Worker pool boot-up + scheduled-job pump.
//
// ALL heavy work — UI-demand (waveform, silence, normalize) AND background
// (export) — goes through the IndexedDB-backed job queue. The scheduler
// tick picks jobs up with rating-aware selection, quiet-hours deferral,
// stalled-task reclaim, and heartbeated running state.

import { initPoolDispatcher, shutdownPoolDispatcher, dispatchPool } from './poolDispatch';
import { renderJob, type RenderWorkerRequest } from './renderWorker';
import { executePoolJob, type PoolRequest, type PoolResult } from './poolWorker';
import { resolveSmartJob, rejectSmartJob } from './smartDispatch';
import {
  ensureWorker,
  completeJob,
  failJob,
  heartbeatJob,
  listJobs,
  markAssigned,
  isInQuietHours,
  shouldReclaim,
  reclaimJob,
  pickWorker
} from '../services/queue';
import type { Job, WorkerRuntime } from '../types';
import { all } from '../db/indexeddb';
import { loadPrefs } from '../db/prefs';
import { logAudit } from '../services/audit';
import { LIMITS } from '../util/constants';
import { pushToast } from '../stores/toast';
import { processExportJob } from './exportProcessor';

const DEFAULT_POOL_SIZE = 2;
const TICK_MS = 800;

interface RenderSlot {
  runtimeId: string;
  worker: Worker | null;
  busyJobId: string | null;
}

let renderSlot: RenderSlot | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** Set of pool worker runtime ids currently assigned to a scheduled job. */
const busyRuntimes = new Set<string>();
/** Known pool runtime ids created at bring-up. */
const poolRuntimeIds: string[] = [];

function createRenderWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/** Start the pool. Safe to call multiple times. */
export async function startWorkerPool(poolSize: number = DEFAULT_POOL_SIZE): Promise<void> {
  if (tickTimer) return;
  // UI-demand dispatcher shares the same worker implementation; its N slots
  // are drawn from this pool size.
  initPoolDispatcher(poolSize);
  // Register every pool worker with the queue service so worker rating,
  // stalled-candidate reclaim and retry caps all observe them.
  poolRuntimeIds.length = 0;
  for (let i = 0; i < poolSize; i++) {
    const id = `pool-${i + 1}`;
    await ensureWorker(id);
    poolRuntimeIds.push(id);
  }
  await ensureWorker('render-1');
  renderSlot = { runtimeId: 'render-1', worker: createRenderWorker(), busyJobId: null };
  tickTimer = setInterval(() => void tick(), TICK_MS);
}

export function stopWorkerPool(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (renderSlot?.worker) renderSlot.worker.terminate();
  renderSlot = null;
  poolRuntimeIds.length = 0;
  busyRuntimes.clear();
  shutdownPoolDispatcher();
}

/** Expose inspection for tests / UI status. */
export function describePool(): Array<{ kind: string; runtimeId: string; busy: boolean }> {
  const out: Array<{ kind: string; runtimeId: string; busy: boolean }> = [];
  if (renderSlot) {
    out.push({ kind: 'render', runtimeId: renderSlot.runtimeId, busy: renderSlot.busyJobId != null });
  }
  return out;
}

async function tick(): Promise<void> {
  await reclaimStalled();
  const jobs = await listJobs('queued');
  if (jobs.length === 0) return;

  const prefs = loadPrefs();
  const inQuiet =
    isInQuietHours(new Date(), prefs.quietHours.start, prefs.quietHours.end) &&
    !prefs.quietHours.allowHeavyJobs;

  // Route scheduled pool-type jobs through the shared UI dispatcher so the
  // same worker set handles both UI-demand work and any queued background
  // pool jobs that end up here (e.g. deferred normalize). Each job picks
  // the highest-rated idle pool worker at dispatch time so rating is real.
  const poolQueue = jobs
    .filter((j) => j.type === 'waveform' || j.type === 'silence_scan' || j.type === 'normalize' || j.type === 'transcode')
    .filter((j) => !inQuiet || j.type === 'waveform')
    .sort((a, b) => b.priority - a.priority || a.initialEstimateMs - b.initialEstimateMs);

  if (poolQueue.length > 0) {
    const workers = await all<WorkerRuntime>('workers');
    for (const job of poolQueue) {
      const candidateIds = poolRuntimeIds.filter((id) => !busyRuntimes.has(id));
      if (candidateIds.length === 0) break; // no free pool workers this tick
      const candidates = workers.filter((w) => candidateIds.includes(w.id));
      const picked = pickWorker(candidates)?.id ?? candidateIds[0];
      busyRuntimes.add(picked);
      void runScheduledPoolJob(job, picked).finally(() => {
        busyRuntimes.delete(picked);
      });
    }
  }

  const renderJobs = jobs
    .filter((j) => j.type === 'export')
    .filter(() => !inQuiet)
    .sort((a, b) => b.priority - a.priority || a.initialEstimateMs - b.initialEstimateMs);

  if (renderSlot && renderSlot.busyJobId == null) {
    const job = renderJobs[0];
    if (job) {
      renderSlot.busyJobId = job.id;
      void runRenderJob(renderSlot, job).finally(() => {
        if (renderSlot) renderSlot.busyJobId = null;
      });
    }
  }
}

async function reclaimStalled(): Promise<void> {
  const running = await listJobs('running');
  for (const job of running) {
    if (shouldReclaim(job)) {
      await reclaimJob(job.id);
    }
  }
}

async function runScheduledPoolJob(job: Job, workerRuntimeId: string): Promise<void> {
  await markAssigned(job.id, workerRuntimeId);
  await heartbeatJob(job.id);
  await logAudit('job', job.id, 'pool:start', 'system', { workerId: workerRuntimeId });
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  let req: Omit<PoolRequest, 'jobId'> | null = null;
  if (job.type === 'waveform') {
    req = {
      kind: 'waveform',
      channel: payload.channel as Float32Array,
      buckets: Number(payload.buckets ?? 600)
    };
  } else if (job.type === 'silence_scan') {
    req = {
      kind: 'silence_scan',
      channel: payload.channel as Float32Array,
      sampleRate: Number(payload.sampleRate ?? 44100),
      thresholdDb: payload.thresholdDb as number | undefined,
      minDurationSec: payload.minDurationSec as number | undefined
    };
  } else if (job.type === 'normalize' || job.type === 'transcode') {
    req = {
      kind: 'normalize',
      channels: (payload.channels as Float32Array[]) ?? [new Float32Array(0)],
      sampleRate: Number(payload.sampleRate ?? 44100),
      targetLufs: payload.targetLufs as number | undefined
    };
  }
  if (!req) {
    await failJob(job.id, 'POOL_UNSUPPORTED', `pool cannot handle job type ${job.type}`);
    return;
  }
  try {
    const result = await dispatchPool(req);
    if (result.kind === 'error') {
      await failJob(job.id, 'POOL_ERROR', result.message);
      rejectSmartJob(job.id, new Error(result.message));
      return;
    }
    await completeJob(job.id);
    // If this job was initiated by smartDispatch (UI-demand), resolve
    // the caller's promise with the pool result.
    resolveSmartJob(job.id, result);
  } catch (err) {
    await failJob(job.id, 'POOL_ERROR', (err as Error).message);
    rejectSmartJob(job.id, err as Error);
  }
}

async function runRenderJob(slot: RenderSlot, job: Job): Promise<void> {
  // Export jobs go through the same lifecycle as pool jobs: assigned to a
  // named worker, heartbeated while rendering, reclaimable if they stall,
  // and rated on completion / failure.
  await markAssigned(job.id, slot.runtimeId);
  await heartbeatJob(job.id);
  await logAudit('job', job.id, 'render:start', 'system', { workerId: slot.runtimeId });
  // Keep-alive heartbeat so `shouldReclaim` sees progress while the encoder
  // runs. The reclaim window (10s) is a floor; a heartbeat every ~2s keeps
  // the job firmly out of stalled_candidate territory during normal work.
  const hb = setInterval(() => {
    void heartbeatJob(job.id).catch(() => {});
  }, LIMITS.WORKER_HEARTBEAT_MS);
  try {
    const result = await processExportJob(job, slot.worker);
    if (result.ok) {
      await completeJob(job.id, result.output.filename);
      pushToast(
        'success',
        `Exported ${result.output.filename} — click Export Cart to download.`
      );
    } else {
      await failJob(job.id, result.code, result.message);
      pushToast('error', `Export failed: ${result.message}`);
    }
  } finally {
    clearInterval(hb);
  }
}

/**
 * Test-only helper: drive the scheduler once. Runs the rating-aware dispatch
 * for any queued pool-type jobs and waits for each to complete before
 * returning. Exposed so integration tests can deterministically observe
 * which runtime was assigned without relying on the real interval timer.
 */
export async function tickScheduledPoolOnce(): Promise<void> {
  const jobs = await listJobs('queued');
  const prefs = loadPrefs();
  const inQuiet =
    isInQuietHours(new Date(), prefs.quietHours.start, prefs.quietHours.end) &&
    !prefs.quietHours.allowHeavyJobs;
  const poolQueue = jobs
    .filter((j) => j.type === 'waveform' || j.type === 'silence_scan' || j.type === 'normalize' || j.type === 'transcode')
    .filter((j) => !inQuiet || j.type === 'waveform')
    .sort((a, b) => b.priority - a.priority || a.initialEstimateMs - b.initialEstimateMs);
  if (poolQueue.length === 0) return;
  const workers = await all<WorkerRuntime>('workers');
  const promises: Array<Promise<void>> = [];
  for (const job of poolQueue) {
    const candidateIds = poolRuntimeIds.filter((id) => !busyRuntimes.has(id));
    if (candidateIds.length === 0) break;
    const candidates = workers.filter((w) => candidateIds.includes(w.id));
    const picked = pickWorker(candidates)?.id ?? candidateIds[0];
    busyRuntimes.add(picked);
    promises.push(
      runScheduledPoolJob(job, picked).finally(() => {
        busyRuntimes.delete(picked);
      })
    );
  }
  await Promise.all(promises);
}

/**
 * Test-only helper: run one pass of the render slot. Drives a single export
 * job through the full lifecycle (assigned → running w/ heartbeat → completed
 * or failed) synchronously so tests can assert the intermediate states.
 */
export async function tickRenderSlotOnce(): Promise<void> {
  if (!renderSlot || renderSlot.busyJobId != null) return;
  const jobs = await listJobs('queued');
  const prefs = loadPrefs();
  const inQuiet =
    isInQuietHours(new Date(), prefs.quietHours.start, prefs.quietHours.end) &&
    !prefs.quietHours.allowHeavyJobs;
  if (inQuiet) return;
  const job = jobs
    .filter((j) => j.type === 'export')
    .sort((a, b) => b.priority - a.priority || a.initialEstimateMs - b.initialEstimateMs)[0];
  if (!job) return;
  renderSlot.busyJobId = job.id;
  try {
    await runRenderJob(renderSlot, job);
  } finally {
    if (renderSlot) renderSlot.busyJobId = null;
  }
}

// Inline helpers retained so tests can exercise the encoder directly without
// starting a full pool.
export async function runPoolJobInline(req: PoolRequest): Promise<PoolResult> {
  return executePoolJob(req);
}

export async function runRenderJobInline(req: RenderWorkerRequest): Promise<{ blob: Blob; byteSize: number }> {
  return renderJob(req);
}

export { LIMITS };
