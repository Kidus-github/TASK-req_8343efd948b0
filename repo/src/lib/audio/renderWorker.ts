// Render worker: receives a ready-to-encode PcmBuffer + format spec and emits
// a real Blob. Imported into the main bundle via `new Worker(new URL(...))`.

import { encodeMp3Bytes, encodeWavBytes } from '../util/audio';

export interface RenderWorkerRequest {
  kind: 'render';
  jobId: string;
  format: 'mp3' | 'wav';
  bitrate?: 128 | 192 | 320;
  sampleRate: number;
  channels: Float32Array[];
}

export interface RenderWorkerProgress {
  kind: 'progress';
  jobId: string;
  pct: number;
}

export interface RenderWorkerResult {
  kind: 'done';
  jobId: string;
  blob: Blob;
  filename: string;
  byteSize: number;
}

export interface RenderWorkerError {
  kind: 'error';
  jobId: string;
  message: string;
}

export type RenderWorkerMessage = RenderWorkerProgress | RenderWorkerResult | RenderWorkerError;

// Only register the message handler when running inside a real Worker. When
// this module is imported by tests on the main thread, we skip registration
// and expose `renderJob()` for direct invocation.
declare const self: DedicatedWorkerGlobalScope | undefined;

export async function renderJob(req: RenderWorkerRequest): Promise<{ blob: Blob; byteSize: number }> {
  const { format, bitrate, sampleRate, channels } = req;
  if (format === 'wav') {
    const bytes = encodeWavBytes(channels, sampleRate);
    return { blob: new Blob([bytes], { type: 'audio/wav' }), byteSize: bytes.length };
  }
  if (format === 'mp3') {
    const rate = (bitrate ?? 192) as 128 | 192 | 320;
    const bytes = await encodeMp3Bytes(channels, sampleRate, rate);
    return { blob: new Blob([bytes], { type: 'audio/mpeg' }), byteSize: bytes.length };
  }
  throw new Error(`unsupported format: ${format}`);
}

if (typeof self !== 'undefined' && typeof (self as unknown as DedicatedWorkerGlobalScope).postMessage === 'function' && typeof window === 'undefined') {
  const w = self as unknown as DedicatedWorkerGlobalScope;
  w.addEventListener('message', async (e: MessageEvent<RenderWorkerRequest>) => {
    const req = e.data;
    if (!req || req.kind !== 'render') return;
    try {
      w.postMessage({ kind: 'progress', jobId: req.jobId, pct: 0 } satisfies RenderWorkerProgress);
      const { blob, byteSize } = await renderJob(req);
      w.postMessage({ kind: 'progress', jobId: req.jobId, pct: 100 } satisfies RenderWorkerProgress);
      w.postMessage(
        { kind: 'done', jobId: req.jobId, blob, byteSize, filename: `job-${req.jobId}.${req.format}` } satisfies RenderWorkerResult
      );
    } catch (err) {
      w.postMessage(
        { kind: 'error', jobId: req.jobId, message: (err as Error).message } satisfies RenderWorkerError
      );
    }
  });
}
