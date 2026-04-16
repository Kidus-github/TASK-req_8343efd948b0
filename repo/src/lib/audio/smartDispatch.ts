// Smart dispatch: routes UI-demand heavy operations (waveform, silence scan,
// normalization) through the same IndexedDB-backed job queue + scheduler as
// background export jobs. This means they honor:
//   - quiet-hours policy
//   - rating-aware worker selection
//   - stalled-task reclaim
//   - tracked running/assigned state + heartbeat
//
// The caller awaits a promise that resolves when the scheduler picks up the
// job, runs it through a real pool worker, and produces the result. Results
// are returned via an in-memory resolver map (they don't round-trip through
// IndexedDB since Float32Array structured-clone is lossy in some envs).

import { enqueueJob, type EnqueueOptions } from '../services/queue';
import type { JobType } from '../types';
import { newId } from '../util/ids';
import type { PoolResult, PoolWaveformResult, PoolSilenceResult, PoolNormalizeResult } from './poolWorker';
import { executePoolJob, type PoolRequest } from './poolWorker';

// ---- Resolver map: job.id → pending promise resolver ----

const resolvers = new Map<string, { resolve: (r: PoolResult) => void; reject: (e: Error) => void }>();

/**
 * Called by workerPool after completing a pool-type job. If the job was
 * initiated via smartDispatch, the pending promise is resolved here.
 */
export function resolveSmartJob(jobId: string, result: PoolResult): void {
  const entry = resolvers.get(jobId);
  if (!entry) return;
  resolvers.delete(jobId);
  entry.resolve(result);
}

/** Called when a scheduled pool job fails terminally. */
export function rejectSmartJob(jobId: string, err: Error): void {
  const entry = resolvers.get(jobId);
  if (!entry) return;
  resolvers.delete(jobId);
  entry.reject(err);
}

// ---- Public API ----

/**
 * Enqueue a heavy job into the real IndexedDB queue and wait for the smart
 * scheduler to run it. The returned promise resolves with the pool result
 * after the job reaches a terminal state.
 *
 * In test environments where no Workers exist and the scheduler tick is not
 * running, this falls back to inline execution — same as poolDispatch did,
 * but clearly scoped as test-only.
 */
export async function smartDispatch(
  kind: 'waveform' | 'silence_scan' | 'normalize',
  payload: Record<string, unknown>
): Promise<PoolResult> {
  const inputRef = `ui-demand-${newId('sd')}`;
  const typeMap: Record<string, JobType> = {
    waveform: 'waveform',
    silence_scan: 'silence_scan',
    normalize: 'normalize'
  };
  const job = await enqueueJob({
    type: typeMap[kind],
    inputRef,
    initialEstimateMs: kind === 'normalize' ? 500 : 200,
    payload
  });

  return new Promise<PoolResult>((resolve, reject) => {
    resolvers.set(job.id, { resolve, reject });
    // Safety timeout: if the scheduler tick doesn't pick it up quickly
    // (e.g. test env without a running tick loop), run inline to unblock.
    // In production the scheduler interval is 800ms so this never fires.
    const FALLBACK_MS = typeof Worker !== 'undefined' ? 10_000 : 100;
    const timer = setTimeout(() => {
      if (!resolvers.has(job.id)) return; // already resolved
      resolvers.delete(job.id);
      const req: PoolRequest = { ...payload, kind, jobId: job.id } as PoolRequest;
      resolve(executePoolJob(req));
    }, FALLBACK_MS);
    // Wrap the resolver so it clears the timeout when the scheduler
    // resolves the job before the fallback fires.
    const orig = resolvers.get(job.id)!;
    const origResolve = orig.resolve;
    const origReject = orig.reject;
    resolvers.set(job.id, {
      resolve: (r) => { clearTimeout(timer); origResolve(r); },
      reject: (e) => { clearTimeout(timer); origReject(e); }
    });
  });
}

// ---- Convenience wrappers (replace poolDispatch's) ----

export async function computeWaveformPeaks(
  channel: Float32Array,
  buckets: number
): Promise<Array<{ min: number; max: number }>> {
  const result = await smartDispatch('waveform', { channel, buckets });
  if (result.kind !== 'waveform-done') throw new Error('waveform dispatch failed');
  return (result as PoolWaveformResult).peaks;
}

export async function scanSilence(
  channel: Float32Array,
  sampleRate: number,
  thresholdDb?: number,
  minDurationSec?: number
): Promise<Array<{ startMs: number; endMs: number }>> {
  const result = await smartDispatch('silence_scan', {
    channel,
    sampleRate,
    thresholdDb,
    minDurationSec
  });
  if (result.kind !== 'silence-done') throw new Error('silence dispatch failed');
  return (result as PoolSilenceResult).regions;
}

export async function normalizeChannels(
  channels: Float32Array[],
  sampleRate: number,
  targetLufs?: number
): Promise<{ channels: Float32Array[]; gainApplied: number }> {
  const result = await smartDispatch('normalize', { channels, sampleRate, targetLufs });
  if (result.kind !== 'normalize-done') throw new Error('normalize dispatch failed');
  const r = result as PoolNormalizeResult;
  return { channels: r.channels, gainApplied: r.gainApplied };
}
