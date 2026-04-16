// Split regression: prove split actually changes the rendered/exported output.
// Split at atMs keeps [0..atMs] in the current file and (in the editor)
// creates a new file for [atMs..end]. The engine's applyOneSync truncates
// the buffer.

import { describe, expect, it } from 'vitest';
import { applyOperations, applyOperationsAsync } from '../../src/lib/audio/engine';
import type { EditOperation } from '../../src/lib/types';
import type { PcmBuffer } from '../../src/lib/util/audio';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import { appendOperation, listOperationsForFile } from '../../src/lib/services/edits';
import {
  addCartItem,
  confirmCart,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { enqueueJob } from '../../src/lib/services/queue';
import { processExportJob } from '../../src/lib/audio/exportProcessor';
import { encodeWavBytes } from '../../src/lib/util/audio';
import { get } from '../../src/lib/db/indexeddb';
import type { ExportCartItem } from '../../src/lib/types';

function makeBuffer(ms: number, value = 0.5): PcmBuffer {
  const sr = 44100;
  const n = Math.floor((ms / 1000) * sr);
  const ch = new Float32Array(n);
  ch.fill(value);
  return { sampleRate: sr, channels: [ch, new Float32Array(ch)], durationMs: ms };
}

function op(partial: Partial<EditOperation>): EditOperation {
  return {
    id: partial.id ?? 'o',
    projectId: 'p',
    fileId: 'f',
    type: partial.type ?? 'split',
    params: partial.params ?? {},
    createdAt: '2026-01-01T00:00:00Z',
    sequenceIndex: partial.sequenceIndex ?? 0
  };
}

describe('split in the render engine', () => {
  it('truncates buffer to [0..atMs]', () => {
    const buf = makeBuffer(2000); // 2 seconds
    const ops = [op({ type: 'split', params: { atMs: 800 } })];
    const out = applyOperations(buf, ops);
    expect(out.durationMs).toBeCloseTo(800, -1);
    expect(out.channels[0].length).toBeLessThan(buf.channels[0].length);
  });

  it('async path also truncates', async () => {
    const buf = makeBuffer(1000);
    const ops = [op({ type: 'split', params: { atMs: 400 } })];
    const out = await applyOperationsAsync(buf, ops);
    expect(out.durationMs).toBeCloseTo(400, -1);
  });

  it('split at 0 or past end is a no-op', () => {
    const buf = makeBuffer(1000);
    expect(applyOperations(buf, [op({ params: { atMs: 0 } })]).durationMs).toBe(1000);
    expect(applyOperations(buf, [op({ params: { atMs: 1500 } })]).durationMs).toBe(1000);
  });
});

describe('split changes exported output', () => {
  it('exported WAV is shorter after a split operation', async () => {
    const p = await createProject('SplitExport');
    if (!p.ok) throw new Error('project');
    const sr = 44100;
    const n = sr * 2; // 2 seconds
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.4;
      r[i] = l[i];
    }
    const blob = new Blob([encodeWavBytes([l, r], sr)], { type: 'audio/wav' });
    const imp = await importBatch(p.data.id, [
      { name: 'full.wav', size: blob.size, mimeType: 'audio/wav', data: blob }
    ]);
    if (!imp.ok) throw new Error('import');
    const fileId = imp.data.accepted[0].id;

    // Baseline: export without split.
    const cart1 = await getOrCreateCart(p.data.id);
    await addCartItem(cart1.id, fileId, 'wav');
    await confirmCart(cart1.id);
    const items1 = await listCartItems(cart1.id);
    const q1 = items1.find((i) => i.status === 'queued');
    if (!q1) throw new Error('q1');
    const job1 = await enqueueJob({ type: 'export', inputRef: q1.id, projectId: p.data.id, initialEstimateMs: 500 });
    const res1 = await processExportJob(job1, null);
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    const fullSize = res1.output.byteSize;

    // Now commit a split at 800ms.
    const s = await appendOperation(p.data.id, fileId, 'split', { atMs: 800 });
    expect(s.ok).toBe(true);

    // Export again.
    const cart2 = await getOrCreateCart(p.data.id);
    await addCartItem(cart2.id, fileId, 'wav');
    await confirmCart(cart2.id);
    const items2 = await listCartItems(cart2.id);
    const q2 = items2.find((i) => i.status === 'queued');
    if (!q2) throw new Error('q2');
    const job2 = await enqueueJob({ type: 'export', inputRef: q2.id, projectId: p.data.id, initialEstimateMs: 500 });
    const res2 = await processExportJob(job2, null);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;

    // Split output must be meaningfully smaller (800ms vs 2000ms).
    expect(res2.output.byteSize).toBeLessThan(fullSize * 0.6);
    const completed = await get<ExportCartItem>('exportCartItems', q2.id);
    expect(completed?.status).toBe('completed');
  });
});
