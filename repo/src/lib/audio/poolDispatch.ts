// Pool dispatch: owns a pool of Web Workers for UI-demand heavy jobs
// (waveform peaks, silence scanning, normalization). Returns a Promise per
// dispatched job so callers can await results inline without interacting
// with the IndexedDB job queue (which is reserved for user-visible
// background work like exports).
//
// Keeping this in its own module avoids circular imports between the engine
// (which needs normalize dispatch) and workerPool/exportProcessor.

import { executePoolJob, type PoolRequest, type PoolResult } from './poolWorker';
import { newId } from '../util/ids';

interface Slot {
  worker: Worker | null;
  busy: boolean;
}

interface Pending {
  req: PoolRequest;
  resolve: (r: PoolResult) => void;
  reject: (err: Error) => void;
}

let slots: Slot[] = [];
let waiting: Pending[] = [];
let initialized = false;

function makeWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./poolWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/** Initialize the dispatcher with N worker slots. Safe to call multiple times. */
export function initPoolDispatcher(poolSize: number = 2): void {
  if (initialized) return;
  slots = [];
  for (let i = 0; i < poolSize; i++) {
    slots.push({ worker: makeWorker(), busy: false });
  }
  initialized = true;
}

/** Tear down the dispatcher and terminate all workers. */
export function shutdownPoolDispatcher(): void {
  for (const s of slots) {
    if (s.worker) s.worker.terminate();
  }
  slots = [];
  for (const p of waiting) p.reject(new Error('pool dispatcher shut down'));
  waiting = [];
  initialized = false;
}

/**
 * Dispatch a pool job and return a promise resolving to the worker result.
 *
 * Execution policy:
 *  1. If an idle worker slot exists, post the job to it.
 *  2. Otherwise queue the job and run it as soon as a slot frees.
 *  3. If no slots were ever created (Worker unavailable, e.g. tests), fall
 *     back to synchronous inline execution. Inline fallback is documented
 *     and intentionally NOT used when real workers exist.
 */
export function dispatchPool(req: Omit<PoolRequest, 'jobId'>): Promise<PoolResult> {
  if (!initialized) initPoolDispatcher();
  const withId = { ...req, jobId: newId('pd') } as PoolRequest;

  // No real workers at all — explicit inline fallback for headless tests.
  const anyWorker = slots.some((s) => s.worker);
  if (!anyWorker) {
    return Promise.resolve(executePoolJob(withId));
  }

  return new Promise<PoolResult>((resolve, reject) => {
    waiting.push({ req: withId, resolve, reject });
    pump();
  });
}

function pump(): void {
  while (waiting.length > 0) {
    const slot = slots.find((s) => !s.busy && s.worker);
    if (!slot) break;
    const task = waiting.shift()!;
    slot.busy = true;
    dispatchOnSlot(slot, task);
  }
}

function dispatchOnSlot(slot: Slot, task: Pending): void {
  const worker = slot.worker!;
  const handler = (e: MessageEvent<PoolResult>): void => {
    const msg = e.data;
    if (!msg || msg.jobId !== task.req.jobId) return;
    worker.removeEventListener('message', handler);
    slot.busy = false;
    pump();
    task.resolve(msg);
  };
  const errHandler = (ev: ErrorEvent): void => {
    worker.removeEventListener('message', handler);
    worker.removeEventListener('error', errHandler);
    slot.busy = false;
    pump();
    task.reject(new Error(ev.message ?? 'worker error'));
  };
  worker.addEventListener('message', handler);
  worker.addEventListener('error', errHandler, { once: true });
  worker.postMessage(task.req);
}

/** Inspection helper for tests. */
export function describeDispatcher(): { slots: number; withWorker: number; waiting: number } {
  return {
    slots: slots.length,
    withWorker: slots.filter((s) => s.worker != null).length,
    waiting: waiting.length
  };
}

// ---------- Convenience wrappers ----------

export async function computeWaveformPeaks(
  channel: Float32Array,
  buckets: number
): Promise<Array<{ min: number; max: number }>> {
  const result = await dispatchPool({ kind: 'waveform', channel, buckets });
  if (result.kind !== 'waveform-done') throw new Error('waveform dispatch failed');
  return result.peaks;
}

export async function scanSilence(
  channel: Float32Array,
  sampleRate: number,
  thresholdDb?: number,
  minDurationSec?: number
): Promise<Array<{ startMs: number; endMs: number }>> {
  const result = await dispatchPool({
    kind: 'silence_scan',
    channel,
    sampleRate,
    thresholdDb,
    minDurationSec
  });
  if (result.kind !== 'silence-done') throw new Error('silence dispatch failed');
  return result.regions;
}

export async function normalizeChannels(
  channels: Float32Array[],
  sampleRate: number,
  targetLufs?: number
): Promise<{ channels: Float32Array[]; gainApplied: number }> {
  const result = await dispatchPool({ kind: 'normalize', channels, sampleRate, targetLufs });
  if (result.kind !== 'normalize-done') throw new Error('normalize dispatch failed');
  return { channels: result.channels, gainApplied: result.gainApplied };
}
