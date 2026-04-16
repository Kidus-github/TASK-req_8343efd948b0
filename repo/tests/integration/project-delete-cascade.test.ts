// Project deletion must remove export cart items AND their rendered output
// blobs. Regression: previously the cascade dropped carts keyed by project
// but left every cart-item row (keyed by cart) and every output blob
// (keyed by a blob id referenced from the item) as orphans.

import { describe, expect, it } from 'vitest';
import { createProject, deleteProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import {
  addCartItem,
  confirmCart,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { enqueueJob } from '../../src/lib/services/queue';
import { processExportJob } from '../../src/lib/audio/exportProcessor';
import { encodeWavBytes } from '../../src/lib/util/audio';
import { all, get } from '../../src/lib/db/indexeddb';
import type { ExportCart, ExportCartItem } from '../../src/lib/types';

function wavBlob(seconds = 0.5): Blob {
  const sr = 44100;
  const n = Math.floor(seconds * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.4;
    l[i] = v;
    r[i] = v;
  }
  return new Blob([encodeWavBytes([l, r], sr)], { type: 'audio/wav' });
}

describe('deleteProject cascade', () => {
  it('removes export cart items and rendered output blobs', async () => {
    const p = await createProject('Del');
    if (!p.ok) throw new Error('project');

    // Import audio + render a real export so we have output blobs.
    const blob = wavBlob(0.5);
    const imp = await importBatch(p.data.id, [
      { name: 'a.wav', size: blob.size, mimeType: 'audio/wav', data: blob }
    ]);
    if (!imp.ok) throw new Error('import');
    const cart = await getOrCreateCart(p.data.id);
    const add = await addCartItem(cart.id, imp.data.accepted[0].id, 'wav');
    expect(add.ok).toBe(true);
    await confirmCart(cart.id);
    const items = await listCartItems(cart.id);
    const queued = items.find((i) => i.status === 'queued');
    if (!queued) throw new Error('queued');
    const job = await enqueueJob({
      type: 'export',
      inputRef: queued.id,
      projectId: p.data.id,
      initialEstimateMs: 500
    });
    const res = await processExportJob(job, null);
    expect(res.ok).toBe(true);

    // Preconditions: cart + item + output blob all exist.
    const beforeCarts = await all<ExportCart>('exportCarts');
    expect(beforeCarts.some((c) => c.projectId === p.data.id)).toBe(true);
    const completed = await get<ExportCartItem>('exportCartItems', queued.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.outputBlobRef).toBeTruthy();
    if (!completed?.outputBlobRef) return;
    const outputBlobBefore = await get('blobs', completed.outputBlobRef);
    expect(outputBlobBefore).toBeDefined();

    // Delete.
    const del = await deleteProject(p.data.id);
    expect(del.ok).toBe(true);

    // No cart rows for the project remain.
    const afterCarts = await all<ExportCart>('exportCarts');
    expect(afterCarts.some((c) => c.projectId === p.data.id)).toBe(false);

    // No cart items for that cart remain.
    const afterItems = await all<ExportCartItem>('exportCartItems');
    expect(afterItems.some((i) => i.cartId === cart.id)).toBe(false);
    expect(afterItems.some((i) => i.id === queued.id)).toBe(false);

    // The rendered output blob is gone.
    const outputBlobAfter = await get('blobs', completed.outputBlobRef);
    expect(outputBlobAfter).toBeUndefined();

    // And the source blob imported by the project is also gone.
    const sourceBlob = await get('blobs', imp.data.accepted[0].blobRef);
    expect(sourceBlob).toBeUndefined();
  });
});
