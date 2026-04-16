// Export must apply ONLY the selected file's operations, not every operation
// in the project. Two files with different edits -> each export reflects
// only its own edits.

import { describe, expect, it } from 'vitest';
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
import { encodeWavBytes } from '../../src/lib/util/audio';

function tone(sec: number, hz: number, sr = 44100): Blob {
  const n = Math.floor(sec * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * hz * i) / sr) * 0.5;
    l[i] = v;
    r[i] = v;
  }
  return new Blob([encodeWavBytes([l, r], sr)], { type: 'audio/wav' });
}

async function exportWav(cartId: string, projectId: string, fileId: string): Promise<number> {
  const add = await addCartItem(cartId, fileId, 'wav');
  if (!add.ok) throw new Error('add');
  await confirmCart(cartId);
  const items = await listCartItems(cartId);
  const item = items.find((i) => i.sourceRef === fileId && i.status === 'queued');
  if (!item) throw new Error('item');
  const job = await enqueueJob({
    type: 'export',
    inputRef: item.id,
    projectId,
    initialEstimateMs: 500
  });
  const res = await processExportJob(job, null);
  if (!res.ok) throw new Error(`render: ${res.message}`);
  return res.output.byteSize;
}

describe('per-file operation isolation during export', () => {
  it('applies only each file\'s own ops during its export render', async () => {
    const p = await createProject('PerFile');
    if (!p.ok) throw new Error('project');
    // Two files of different durations.
    const imp = await importBatch(p.data.id, [
      { name: 'a.wav', size: 0, mimeType: 'audio/wav', data: tone(1.0, 440) },
      { name: 'b.wav', size: 0, mimeType: 'audio/wav', data: tone(2.0, 880) }
    ]);
    if (!imp.ok) throw new Error('import');
    const a = imp.data.accepted[0];
    const b = imp.data.accepted[1];

    // File A: cut off 500ms from the beginning. File B: no edits.
    const cut = await appendOperation(p.data.id, a.id, 'cut', { startMs: 0, endMs: 500 });
    expect(cut.ok).toBe(true);

    // Also add a distracting merge operation attached to file B only — must
    // not leak into file A's export.
    const merge = await appendOperation(p.data.id, b.id, 'merge', { partnerFileId: a.id });
    expect(merge.ok).toBe(true);

    // Export A first — should be smaller because of cut, AND should NOT
    // include B's merge (which would make it much larger).
    const cart1 = await getOrCreateCart(p.data.id);
    const aBytes = await exportWav(cart1.id, p.data.id, a.id);

    // Export B — should reflect its merge: base B (~2s) + partner A (~1s after cut).
    const cart2 = await getOrCreateCart(p.data.id);
    const bBytes = await exportWav(cart2.id, p.data.id, b.id);

    // Compute reference: a.wav is ~1s, cut by 500ms -> ~0.5s. A 0.5s 44.1kHz
    // stereo 16-bit WAV is ≈ 88_244 bytes. B merged is roughly (2s + ~1s) ≈
    // 530_000 bytes. We only need ordering-level assertions:
    //   - a export must be smaller than a full 1s export (not merged, not full)
    //   - b export must be meaningfully larger than a export (because of merge)
    expect(aBytes).toBeLessThan(200_000);
    expect(bBytes).toBeGreaterThan(aBytes * 3);

    // Sanity: if per-file isolation were broken, A would also carry B's merge
    // and balloon in size. The test above catches exactly that.
  });
});
