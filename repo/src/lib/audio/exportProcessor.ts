// Export processor: renders a single export cart item. The scheduled loop
// that drives it lives in workerPool.ts.

import type { ExportCartItem, ImportedAudioFile, Job, Mp3Bitrate } from '../types';
import { all, get, put } from '../db/indexeddb';
import { listOperationsForFile } from '../services/edits';
import { applyOperationsAsync, pcmForFile } from './engine';
import { renderJob, type RenderWorkerRequest } from './renderWorker';
import { defaultFilename, applyCollisionSuffix } from '../services/exports';
import { getProject } from '../services/projects';
import { fail } from '../util/errors';

interface RenderOutput {
  blob: Blob;
  filename: string;
  byteSize: number;
}

/** Render a single export cart item. Uses worker if available, falls back to inline. */
export async function processExportJob(
  job: Job,
  useWorker: Worker | null = null
): Promise<{ ok: true; output: RenderOutput; item: ExportCartItem } | { ok: false; code: string; message: string }> {
  // The job's inputRef points at an ExportCartItem.
  const item = await get<ExportCartItem>('exportCartItems', job.inputRef);
  if (!item) return fail('EXPORT_ITEM_MISSING', 'Export cart item not found.');
  const file = await get<ImportedAudioFile>('importedAudio', item.sourceRef);
  if (!file) {
    await put('exportCartItems', { ...item, status: 'failed' });
    return fail('EXPORT_SOURCE_MISSING', 'Source file not found.');
  }

  // Mark rendering.
  await put('exportCartItems', { ...item, status: 'rendering' });

  try {
    const base = await pcmForFile(file);
    // Only apply operations that belong to THIS file. Preview operations are
    // excluded from exports — exports always render the committed state.
    const ops = file.projectId ? await listOperationsForFile(file.projectId, file.id) : [];
    const committed = ops.filter((o) => !o.previewEnabled);
    const rendered = await applyOperationsAsync(base, committed);

    const req: RenderWorkerRequest = {
      kind: 'render',
      jobId: job.id,
      format: item.format,
      bitrate: item.bitrate as Mp3Bitrate | undefined,
      sampleRate: rendered.sampleRate,
      channels: rendered.channels
    };

    let output: { blob: Blob; byteSize: number };
    if (useWorker) {
      output = await runInWorker(useWorker, req);
    } else {
      output = await renderJob(req);
    }

    // Build filename using defaults + collision suffix.
    const project = file.projectId ? await getProject(file.projectId) : undefined;
    const desired = defaultFilename({
      projectName: project?.name ?? 'project',
      sourceFilename: file.originalFilename,
      format: item.format,
      bitrate: item.bitrate,
      sampleRate: item.sampleRate,
      timestamp: new Date()
    });
    const existing = (await all<ExportCartItem & { outputName?: string }>('exportCartItems'))
      .map((i) => i.outputName)
      .filter((n): n is string => Boolean(n));
    const filename = applyCollisionSuffix(existing, desired);

    // Persist the rendered blob in IndexedDB under a new blob id. We also
    // store the raw bytes + mime so downloads and reports work regardless of
    // the structured-clone quirks in some test environments.
    const outId = `blob-out-${job.id}`;
    const outBytes = new Uint8Array(await output.blob.arrayBuffer());
    await put('blobs', {
      id: outId,
      blob: output.blob,
      bytes: outBytes,
      mimeType: output.blob.type,
      filename
    });

    const completed: ExportCartItem & { outputBlobRef?: string; outputName?: string; outputBytes?: number } = {
      ...item,
      status: 'completed',
      outputBlobRef: outId,
      outputName: filename,
      outputBytes: output.byteSize
    };
    await put('exportCartItems', completed);

    return {
      ok: true,
      output: { blob: output.blob, filename, byteSize: output.byteSize },
      item: completed
    };
  } catch (err) {
    await put('exportCartItems', { ...item, status: 'failed' });
    return fail('EXPORT_RENDER_ERROR', (err as Error).message);
  }
}

function runInWorker(worker: Worker, req: RenderWorkerRequest): Promise<{ blob: Blob; byteSize: number }> {
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as { kind: string; jobId?: string; blob?: Blob; byteSize?: number; message?: string };
      if (!msg || msg.jobId !== req.jobId) return;
      if (msg.kind === 'done') {
        worker.removeEventListener('message', handler);
        resolve({ blob: msg.blob as Blob, byteSize: msg.byteSize as number });
      } else if (msg.kind === 'error') {
        worker.removeEventListener('message', handler);
        reject(new Error(msg.message ?? 'worker error'));
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage(req);
  });
}

// NOTE: The scheduled export loop now lives in `workerPool.ts`, which owns
// the dedicated render slot and the queue pump. This module exports
// `processExportJob` for direct invocation (tests and the pool alike).
