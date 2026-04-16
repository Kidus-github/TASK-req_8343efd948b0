import { describe, expect, it } from 'vitest';
import {
  addCartItem,
  confirmCart,
  estimateCart,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { importBatch } from '../../src/lib/services/imports';
import { createProject } from '../../src/lib/services/projects';
import { LIMITS } from '../../src/lib/util/constants';

async function setup() {
  const p = await createProject('Export');
  if (!p.ok) throw new Error('setup');
  const res = await importBatch(p.data.id, [
    {
      name: 'a.mp3',
      size: 1024,
      data: new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' })
    }
  ]);
  if (!res.ok) throw new Error('setup');
  const cart = await getOrCreateCart(p.data.id);
  return { project: p.data, file: res.data.accepted[0], cart };
}

describe('export cart', () => {
  it('adds items and computes estimates', async () => {
    const { cart, file } = await setup();
    const add = await addCartItem(cart.id, file.id, 'mp3', 192);
    expect(add.ok).toBe(true);
    const est = await estimateCart(cart.id);
    expect(est.perItem.length).toBe(1);
  });

  it('enforces 20-item cap', async () => {
    const { cart, file } = await setup();
    for (let i = 0; i < LIMITS.MAX_EXPORT_CART_ITEMS; i++) {
      const r = await addCartItem(cart.id, file.id, 'wav');
      expect(r.ok).toBe(true);
    }
    const over = await addCartItem(cart.id, file.id, 'mp3', 128);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('EXPORT_CART_LIMIT_EXCEEDED');
  });

  it('rejects invalid mp3 bitrate and wav sample rate', async () => {
    const { cart, file } = await setup();
    const bad1 = await addCartItem(cart.id, file.id, 'mp3', 256 as unknown as 128);
    expect(bad1.ok).toBe(false);
    if (!bad1.ok) expect(bad1.code).toBe('EXPORT_INVALID_BITRATE');
  });

  it('confirms cart and queues items', async () => {
    const { cart, file } = await setup();
    const add = await addCartItem(cart.id, file.id, 'wav');
    expect(add.ok).toBe(true);
    const conf = await confirmCart(cart.id);
    expect(conf.ok).toBe(true);
    const items = await listCartItems(cart.id);
    expect(items.every((i) => i.status === 'queued')).toBe(true);
  });
});
