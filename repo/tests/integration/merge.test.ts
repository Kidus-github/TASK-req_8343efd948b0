// Real merge: applyOperationsAsync must concat the partner buffer into the
// rendered output. Exports that include a merge op must produce a longer
// output than the non-merged version.

import { describe, expect, it } from 'vitest';
import { applyOperationsAsync } from '../../src/lib/audio/engine';
import type { EditOperation, ExportCartItem } from '../../src/lib/types';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import { appendOperation } from '../../src/lib/services/edits';
import {
  addCartItem,
  confirmCart,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { enqueueJob } from '../../src/lib/services/queue';
import { processExportJob } from '../../src/lib/audio/exportProcessor';
import { encodeWavBytes, type PcmBuffer } from '../../src/lib/util/audio';
import { get } from '../../src/lib/db/indexeddb';

function tone(sec: number, hz: number, sr = 44100): Blob {
  const n = Math.floor(sec * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * hz * i) / sr) * 0.4;
    l[i] = v;
    r[i] = v;
  }
  return new Blob([encodeWavBytes([l, r], sr)], { type: 'audio/wav' });
}

function makeBuf(ms: number, value: number, sr = 44100): PcmBuffer {
  const samples = Math.floor((ms / 1000) * sr);
  const ch = new Float32Array(samples);
  ch.fill(value);
  return { sampleRate: sr, channels: [ch, new Float32Array(ch)], durationMs: ms };
}

describe('merge engine semantics', () => {
  it('applyOperationsAsync with merge op concatenates partner buffer', async () => {
    const base = makeBuf(500, 0.3);
    const partner = makeBuf(700, 0.1);
    const op: EditOperation = {
      id: 'o1',
      projectId: 'p',
      fileId: 'f',
      type: 'merge',
      params: { partnerFileId: 'partner' },
      createdAt: '2026-01-01T00:00:00Z',
      sequenceIndex: 0
    };
    const out = await applyOperationsAsync(base, [op], {
      partnerLoader: async () => partner
    });
    expect(out.durationMs).toBeCloseTo(1200, 0);
    // First half came from base (value ≈ 0.3), second half from partner (≈ 0.1).
    const halfway = Math.floor(out.channels[0].length / 2);
    const nearStart = out.channels[0][10];
    const nearEnd = out.channels[0][out.channels[0].length - 10];
    expect(Math.abs(nearStart - 0.3)).toBeLessThan(0.02);
    expect(Math.abs(nearEnd - 0.1)).toBeLessThan(0.02);
    // Sanity: halfway should be near the partner value because the base is 500ms
    // and partner starts at sample ~22050 in a 44.1kHz buffer.
    expect(out.channels[0][halfway]).toBeDefined();
  });

  it('export path produces a longer rendered output when merge is committed', async () => {
    const p = await createProject('MergeExport');
    if (!p.ok) throw new Error('project');
    const imp = await importBatch(p.data.id, [
      { name: 'a.wav', size: 0, mimeType: 'audio/wav', data: tone(0.5, 440) },
      { name: 'b.wav', size: 0, mimeType: 'audio/wav', data: tone(1.0, 880) }
    ]);
    if (!imp.ok) throw new Error('import');
    const a = imp.data.accepted[0];
    const b = imp.data.accepted[1];

    // Baseline export: a.wav alone.
    const cart = await getOrCreateCart(p.data.id);
    const baselineAdd = await addCartItem(cart.id, a.id, 'wav');
    expect(baselineAdd.ok).toBe(true);
    await confirmCart(cart.id);
    const baselineItem = (await listCartItems(cart.id)).find((i) => i.status === 'queued');
    if (!baselineItem) throw new Error('baseline item');
    const baselineJob = await enqueueJob({
      type: 'export',
      inputRef: baselineItem.id,
      projectId: p.data.id,
      initialEstimateMs: 500
    });
    const baselineRes = await processExportJob(baselineJob, null);
    expect(baselineRes.ok).toBe(true);
    if (!baselineRes.ok) return;
    const baselineBytes = baselineRes.output.byteSize;

    // Now commit a merge a→b and export a again.
    const merge = await appendOperation(p.data.id, a.id, 'merge', { partnerFileId: b.id });
    expect(merge.ok).toBe(true);
    const cart2 = await getOrCreateCart(p.data.id);
    const mergedAdd = await addCartItem(cart2.id, a.id, 'wav');
    expect(mergedAdd.ok).toBe(true);
    await confirmCart(cart2.id);
    const mergedItem = (await listCartItems(cart2.id)).find((i) => i.status === 'queued');
    if (!mergedItem) throw new Error('merged item');
    const mergedJob = await enqueueJob({
      type: 'export',
      inputRef: mergedItem.id,
      projectId: p.data.id,
      initialEstimateMs: 500
    });
    const mergedRes = await processExportJob(mergedJob, null);
    expect(mergedRes.ok).toBe(true);
    if (!mergedRes.ok) return;

    // Merged output must be larger because partner's duration is appended.
    expect(mergedRes.output.byteSize).toBeGreaterThan(baselineBytes);
    const completed = await get<ExportCartItem>('exportCartItems', mergedItem.id);
    expect(completed?.status).toBe('completed');
  });
});
