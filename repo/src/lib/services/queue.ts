// In-process job queue with smart scheduling. Pure logic pieces (selection,
// reclaim rules) are easily unit-testable; side effects (put/get) happen
// through the DB wrappers.

import type { Job, JobStatus, JobType, WorkerRuntime, Result } from '../types';
import { all, allByIndex, get, put } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { LIMITS } from '../util/constants';
import { ErrorCodes, fail, ok } from '../util/errors';
import { updateWorkerRating } from '../util/estimates';
import { logAudit } from './audit';

/** Non-terminal job states: a job in one of these is considered "in flight". */
const IN_FLIGHT_STATUSES: JobStatus[] = [
  'queued',
  'deferred_quiet_hours',
  'assigned',
  'running',
  'stalled_candidate',
  'reclaimed',
  'failed_retryable'
];

export interface EnqueueOptions {
  /**
   * When true, reject the new job if another job already exists with the
   * same (type, inputRef) pair in an in-flight state. Used by the export
   * confirmation flow to reject duplicate clicks at the queue level, not
   * just in the UI.
   */
  dedupeOnInputRef?: boolean;
}

/**
 * Idempotent enqueue. If `dedupeOnInputRef` is set and another job with the
 * same (type, inputRef) is already in flight, this returns the existing job
 * unchanged — it does NOT create a duplicate. Callers that need to know
 * whether a new row was created can compare `job.createdAt` against their
 * own timestamp, or inspect `job.id` for change.
 */
export async function enqueueJob(
  params: {
    type: JobType;
    inputRef: string;
    projectId?: string;
    priority?: number;
    initialEstimateMs: number;
    payload?: Record<string, unknown>;
  },
  opts: EnqueueOptions = {}
): Promise<Job> {
  if (opts.dedupeOnInputRef) {
    const existing = await all<Job>('jobs');
    const duplicate = existing.find(
      (j) =>
        j.type === params.type &&
        j.inputRef === params.inputRef &&
        IN_FLIGHT_STATUSES.includes(j.status)
    );
    if (duplicate) return duplicate;
  }
  const job: Job = {
    id: newId('job'),
    type: params.type,
    inputRef: params.inputRef,
    projectId: params.projectId,
    priority: params.priority ?? 0,
    status: 'queued',
    createdAt: nowIso(),
    initialEstimateMs: params.initialEstimateMs,
    runtimeMs: 0,
    attemptCount: 0,
    stallReclaimed: false,
    payload: params.payload
  };
  await put('jobs', job);
  return job;
}

export async function listJobs(status?: JobStatus): Promise<Job[]> {
  if (!status) return all<Job>('jobs');
  return allByIndex<Job>('jobs', 'by_status', status);
}

/** Quiet-hours check for a given moment and policy. */
export function isInQuietHours(now: Date, start: string, end: string): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e;
  // wrap-around (e.g. 22:00 → 06:00)
  return minutes >= s || minutes < e;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isHeavy(type: JobType): boolean {
  return type === 'export' || type === 'normalize' || type === 'silence_scan' || type === 'transcode';
}

/**
 * Pick next job for a worker. Shortest estimated task first; heavy jobs
 * deferred during quiet hours unless the policy opts in; higher-rated workers
 * are preferred (that's a caller concern, applied by `pickWorker`).
 */
export function pickNextJob(
  jobs: Job[],
  opts: { now?: Date; allowHeavyInQuietHours?: boolean; quietStart: string; quietEnd: string }
): Job | null {
  const now = opts.now ?? new Date();
  const inQuiet = isInQuietHours(now, opts.quietStart, opts.quietEnd);
  const candidates = jobs.filter((j) => j.status === 'queued');
  const eligible = candidates.filter((j) => {
    if (inQuiet && isHeavy(j.type) && !opts.allowHeavyInQuietHours) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  // Highest priority wins; ties broken by shortest initialEstimateMs then oldest.
  return [...eligible].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.initialEstimateMs !== b.initialEstimateMs) return a.initialEstimateMs - b.initialEstimateMs;
    return a.createdAt.localeCompare(b.createdAt);
  })[0];
}

/** Detect whether a job should be reclaimed based on stall & heartbeat rules. */
export function shouldReclaim(job: Job, nowMs: number = Date.now()): boolean {
  if (job.status !== 'running' && job.status !== 'stalled_candidate') return false;
  if (!job.startedAt) return false;
  const elapsed = nowMs - Date.parse(job.startedAt);
  const stalledThreshold = job.initialEstimateMs * LIMITS.STALL_MULTIPLIER;
  if (elapsed < stalledThreshold) return false;
  if (!job.lastHeartbeatAt) return true;
  const sinceHeartbeat = nowMs - Date.parse(job.lastHeartbeatAt);
  return sinceHeartbeat >= LIMITS.RECLAIM_WINDOW_MS;
}

export async function reclaimJob(jobId: string): Promise<Result<Job>> {
  const j = await get<Job>('jobs', jobId);
  if (!j) return fail('JOB_NOT_FOUND', 'Job not found.');
  if (!shouldReclaim(j)) {
    return fail(ErrorCodes.JOB_STALLED_RECLAIMED, 'Job not eligible for reclaim.');
  }
  const updated: Job = {
    ...j,
    status: 'queued',
    stallReclaimed: true,
    startedAt: undefined,
    workerId: undefined,
    lastHeartbeatAt: undefined
  };
  await put('jobs', updated);
  await logAudit('job', j.id, 'reclaim', 'system');
  return ok(updated);
}

/** Mark completion and update worker rating. */
export async function completeJob(
  jobId: string,
  resultRef?: string
): Promise<Result<Job>> {
  const j = await get<Job>('jobs', jobId);
  if (!j) return fail('JOB_NOT_FOUND', 'Job not found.');
  const completed: Job = {
    ...j,
    status: 'completed',
    completedAt: nowIso(),
    runtimeMs: j.startedAt ? Date.now() - Date.parse(j.startedAt) : j.runtimeMs,
    resultRef
  };
  await put('jobs', completed);
  if (j.workerId) await bumpWorker(j.workerId, 'success');
  await logAudit('job', j.id, 'complete', 'system');
  return ok(completed);
}

export async function failJob(
  jobId: string,
  errorCode: string,
  errorMessage: string
): Promise<Result<Job>> {
  const j = await get<Job>('jobs', jobId);
  if (!j) return fail('JOB_NOT_FOUND', 'Job not found.');
  const attemptCount = j.attemptCount + 1;
  const terminal = attemptCount >= LIMITS.MAX_JOB_ATTEMPTS;
  const updated: Job = {
    ...j,
    status: terminal ? 'failed_terminal' : 'failed_retryable',
    attemptCount,
    errorCode,
    errorMessage
  };
  await put('jobs', updated);
  if (j.workerId) await bumpWorker(j.workerId, 'failure');
  await logAudit('job', j.id, terminal ? 'failed_terminal' : 'failed_retryable', 'system');
  if (!terminal) {
    // Move back to queued for retry.
    await put('jobs', { ...updated, status: 'queued' });
  }
  return ok(updated);
}

async function bumpWorker(workerId: string, outcome: 'success' | 'failure'): Promise<void> {
  const w = await get<WorkerRuntime>('workers', workerId);
  if (!w) return;
  const { successCount, failureCount, rating } = updateWorkerRating(
    w.successCount,
    w.failureCount,
    outcome
  );
  await put('workers', { ...w, successCount, failureCount, rating });
}

export async function ensureWorker(id: string): Promise<WorkerRuntime> {
  const existing = await get<WorkerRuntime>('workers', id);
  if (existing) return existing;
  const w: WorkerRuntime = {
    id,
    status: 'idle',
    successCount: 0,
    failureCount: 0,
    rating: 1.0,
    lastHeartbeatAt: nowIso()
  };
  await put('workers', w);
  return w;
}

export function pickWorker(workers: WorkerRuntime[]): WorkerRuntime | null {
  const idle = workers.filter((w) => w.status === 'idle');
  if (idle.length === 0) return null;
  return [...idle].sort((a, b) => b.rating - a.rating)[0];
}

export async function markAssigned(jobId: string, workerId: string): Promise<void> {
  const j = await get<Job>('jobs', jobId);
  if (!j) return;
  const now = nowIso();
  await put('jobs', {
    ...j,
    status: 'running',
    startedAt: now,
    lastHeartbeatAt: now,
    workerId
  });
}

export async function heartbeatJob(jobId: string): Promise<void> {
  const j = await get<Job>('jobs', jobId);
  if (!j) return;
  await put('jobs', { ...j, lastHeartbeatAt: nowIso() });
}
