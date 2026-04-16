// Report filter correctness: dateFrom/dateTo/projectId/exportFormat filters
// apply consistently to completed exports.

import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import {
  addCartItem,
  confirmCart,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { enqueueJob } from '../../src/lib/services/queue';
import { processExportJob } from '../../src/lib/audio/exportProcessor';
import { computeReport } from '../../src/lib/services/reports';
import { encodeWavBytes } from '../../src/lib/util/audio';
import { all, put } from '../../src/lib/db/indexeddb';
import type { Job } from '../../src/lib/types';

function wav1Sec(): Blob {
  const sr = 44100;
  const n = sr;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
    l[i] = v;
    r[i] = v;
  }
  return new Blob([encodeWavBytes([l, r], sr)], { type: 'audio/wav' });
}

async function primeAndExport(
  projectName: string,
  format: 'wav' | 'mp3'
): Promise<{ projectId: string; jobId: string }> {
  const p = await createProject(projectName);
  if (!p.ok) throw new Error('project');
  const imp = await importBatch(p.data.id, [
    { name: 'a.wav', size: 0, mimeType: 'audio/wav', data: wav1Sec() }
  ]);
  if (!imp.ok) throw new Error('import');
  const cart = await getOrCreateCart(p.data.id);
  const add =
    format === 'mp3'
      ? await addCartItem(cart.id, imp.data.accepted[0].id, 'mp3', 192)
      : await addCartItem(cart.id, imp.data.accepted[0].id, 'wav');
  expect(add.ok).toBe(true);
  await confirmCart(cart.id);
  const item = (await listCartItems(cart.id)).find((i) => i.status === 'queued');
  if (!item) throw new Error('item');
  const job = await enqueueJob({
    type: 'export',
    inputRef: item.id,
    projectId: p.data.id,
    initialEstimateMs: 500
  });
  const res = await processExportJob(job, null);
  expect(res.ok).toBe(true);
  return { projectId: p.data.id, jobId: job.id };
}

describe('report filters', () => {
  it('projectId filter narrows counts and breakdown', async () => {
    const a = await primeAndExport('A', 'wav');
    await primeAndExport('B', 'mp3');

    const onlyA = await computeReport({ projectId: a.projectId });
    expect(onlyA.exportedCount).toBe(1);
    expect(Object.keys(onlyA.exportFormatBreakdown)[0].startsWith('wav')).toBe(true);

    const all = await computeReport({});
    expect(all.exportedCount).toBe(2);
    expect(Object.keys(all.exportFormatBreakdown).length).toBe(2);
  });

  it('exportFormat filter narrows counts and breakdown', async () => {
    await primeAndExport('A', 'wav');
    await primeAndExport('B', 'mp3');
    const mp3Only = await computeReport({ exportFormat: 'mp3' });
    expect(mp3Only.exportedCount).toBe(1);
    expect(Object.keys(mp3Only.exportFormatBreakdown).every((k) => k.startsWith('mp3'))).toBe(true);
  });

  it('dateFrom filter excludes earlier completed exports', async () => {
    const { jobId } = await primeAndExport('EarlyLate', 'wav');
    // Backdate this job's completedAt so a later dateFrom filter excludes it.
    const job = (await all<Job>('jobs')).find((j) => j.id === jobId);
    if (!job) throw new Error('job missing');
    const backdated: Job = { ...job, completedAt: '2026-01-01T00:00:00Z' };
    await put('jobs', backdated);

    const future = await computeReport({ dateFrom: '2027-01-01T00:00:00Z' });
    expect(future.exportedCount).toBe(0);

    const past = await computeReport({ dateFrom: '2025-01-01T00:00:00Z' });
    expect(past.exportedCount).toBe(1);
  });
});
