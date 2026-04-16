// Pool worker: handles waveform peak generation, silence scanning, and
// normalization in the background. Export rendering is handled by the
// dedicated render worker in renderWorker.ts.
//
// All heavy math happens here so the main thread stays responsive.

import { computePeaks, detectSilenceRegions, estimateLufs, gainForNormalization } from '../util/audio';
import { LIMITS } from '../util/constants';

export type PoolJobKind = 'waveform' | 'silence_scan' | 'normalize';

export interface PoolWaveformRequest {
  kind: 'waveform';
  jobId: string;
  channel: Float32Array;
  buckets: number;
}

export interface PoolSilenceRequest {
  kind: 'silence_scan';
  jobId: string;
  channel: Float32Array;
  sampleRate: number;
  thresholdDb?: number;
  minDurationSec?: number;
}

export interface PoolNormalizeRequest {
  kind: 'normalize';
  jobId: string;
  channels: Float32Array[];
  sampleRate: number;
  targetLufs?: number;
}

export type PoolRequest = PoolWaveformRequest | PoolSilenceRequest | PoolNormalizeRequest;

export interface PoolWaveformResult {
  kind: 'waveform-done';
  jobId: string;
  peaks: Array<{ min: number; max: number }>;
}

export interface PoolSilenceResult {
  kind: 'silence-done';
  jobId: string;
  regions: Array<{ startMs: number; endMs: number }>;
}

export interface PoolNormalizeResult {
  kind: 'normalize-done';
  jobId: string;
  channels: Float32Array[];
  sampleRate: number;
  gainApplied: number;
}

export interface PoolError {
  kind: 'error';
  jobId: string;
  message: string;
}

export type PoolResult = PoolWaveformResult | PoolSilenceResult | PoolNormalizeResult | PoolError;

/** Shared synchronous executor — used both in-worker and inline in tests. */
export function executePoolJob(req: PoolRequest): PoolResult {
  try {
    if (req.kind === 'waveform') {
      const peaks = computePeaks(req.channel, req.buckets);
      return { kind: 'waveform-done', jobId: req.jobId, peaks };
    }
    if (req.kind === 'silence_scan') {
      const regions = detectSilenceRegions(
        req.channel,
        req.sampleRate,
        req.thresholdDb ?? LIMITS.SILENCE_THRESHOLD_DB,
        req.minDurationSec ?? LIMITS.SILENCE_MIN_DURATION_SEC
      );
      return { kind: 'silence-done', jobId: req.jobId, regions };
    }
    if (req.kind === 'normalize') {
      const target = req.targetLufs ?? LIMITS.NORMALIZATION_LUFS;
      const mono = req.channels[0];
      const currentLufs = estimateLufs(mono);
      const gain = gainForNormalization(currentLufs, target);
      const out = req.channels.map((ch) => {
        const copy = new Float32Array(ch.length);
        for (let i = 0; i < ch.length; i++) copy[i] = ch[i] * gain;
        return copy;
      });
      return {
        kind: 'normalize-done',
        jobId: req.jobId,
        channels: out,
        sampleRate: req.sampleRate,
        gainApplied: gain
      };
    }
    return { kind: 'error', jobId: (req as PoolRequest).jobId, message: 'unknown pool job kind' };
  } catch (err) {
    return { kind: 'error', jobId: req.jobId, message: (err as Error).message };
  }
}

declare const self: DedicatedWorkerGlobalScope | undefined;

if (
  typeof self !== 'undefined' &&
  typeof (self as unknown as DedicatedWorkerGlobalScope).postMessage === 'function' &&
  typeof window === 'undefined'
) {
  const w = self as unknown as DedicatedWorkerGlobalScope;
  w.addEventListener('message', (e: MessageEvent<PoolRequest>) => {
    const req = e.data;
    if (!req || !req.kind) return;
    const result = executePoolJob(req);
    w.postMessage(result);
  });
}
