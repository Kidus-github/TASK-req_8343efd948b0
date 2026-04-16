// End-to-end export pipeline: import → commit edits → cart confirm → process
// the queued job with the real render path → assert a real blob exists in
// IndexedDB, is the claimed format, and can be downloaded.

import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import {
  addCartItem,
  confirmCart,
  downloadCompletedItem,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { appendOperation } from '../../src/lib/services/edits';
import { enqueueJob, listJobs } from '../../src/lib/services/queue';
import { processExportJob } from '../../src/lib/audio/exportProcessor';
import { encodeWavBytes } from '../../src/lib/util/audio';
import { put, get } from '../../src/lib/db/indexeddb';
import type { ExportCartItem } from '../../src/lib/types';

function makeWavBlob(): Blob {
  const sr = 44100;
  const n = sr * 2; // 2 seconds
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
    left[i] = v;
    right[i] = v;
  }
  const bytes = encodeWavBytes([left, right], sr);
  return new Blob([bytes], { type: 'audio/wav' });
}

async function primeProject(): Promise<{
  projectId: string;
  fileId: string;
  cartId: string;
}> {
  const p = await createProject('Pipeline');
  if (!p.ok) throw new Error('project');
  const blob = makeWavBlob();
  const imp = await importBatch(p.data.id, [
    { name: 'tone.wav', size: blob.size, mimeType: 'audio/wav', data: blob }
  ]);
  if (!imp.ok) throw new Error('import');
  const cart = await getOrCreateCart(p.data.id);
  return { projectId: p.data.id, fileId: imp.data.accepted[0].id, cartId: cart.id };
}

describe('real export pipeline', () => {
  it('renders a WAV item to a downloadable blob', async () => {
    const { projectId, fileId, cartId } = await primeProject();
    await appendOperation(projectId, fileId, 'fade_in', { seconds: 0.5 });
    const add = await addCartItem(cartId, fileId, 'wav');
    expect(add.ok).toBe(true);
    const confirmed = await confirmCart(cartId);
    expect(confirmed.ok).toBe(true);

    const items = await listCartItems(cartId);
    const item = items.find((i) => i.status === 'queued');
    expect(item).toBeDefined();
    if (!item) return;

    const job = await enqueueJob({
      type: 'export',
      inputRef: item.id,
      projectId,
      initialEstimateMs: 500
    });
    const res = await processExportJob(job, null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Cart item now has output blob reference and is completed.
    const after = await get<ExportCartItem>('exportCartItems', item.id);
    expect(after?.status).toBe('completed');
    expect(after?.outputBlobRef).toBeTruthy();
    expect(after?.outputName).toMatch(/\.wav$/);
    expect((after?.outputBytes ?? 0)).toBeGreaterThan(44);

    // Blob exists in IndexedDB (either native Blob or byte-backed).
    const blobRec = await get<{ id: string; blob?: Blob; bytes?: Uint8Array; mimeType?: string }>(
      'blobs',
      after!.outputBlobRef!
    );
    expect(blobRec).toBeDefined();
    const mime = blobRec?.mimeType ?? blobRec?.blob?.type ?? '';
    expect(mime).toContain('wav');
    expect(blobRec?.bytes?.length ?? 0).toBeGreaterThan(44);
  });

  it('renders an MP3 item to a real MP3 byte stream', async () => {
    const { projectId, fileId, cartId } = await primeProject();
    const add = await addCartItem(cartId, fileId, 'mp3', 192);
    expect(add.ok).toBe(true);
    await confirmCart(cartId);
    const items = await listCartItems(cartId);
    const item = items.find((i) => i.status === 'queued');
    if (!item) throw new Error('no item');

    const job = await enqueueJob({
      type: 'export',
      inputRef: item.id,
      projectId,
      initialEstimateMs: 500
    });
    const res = await processExportJob(job, null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = await get<ExportCartItem>('exportCartItems', item.id);
    const blobRec = await get<{ id: string; blob?: Blob; bytes?: Uint8Array; mimeType?: string }>(
      'blobs',
      after!.outputBlobRef!
    );
    const mime = blobRec?.mimeType ?? blobRec?.blob?.type ?? '';
    expect(mime).toContain('mpeg');
    const bytes = blobRec?.bytes as Uint8Array;
    expect(bytes?.length ?? 0).toBeGreaterThan(0);
    let foundSync = false;
    for (let i = 0; i + 1 < bytes.length; i++) {
      if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
        foundSync = true;
        break;
      }
    }
    expect(foundSync).toBe(true);
  });

  it('downloadCompletedItem triggers a real anchor download', async () => {
    const { projectId, fileId, cartId } = await primeProject();
    await addCartItem(cartId, fileId, 'wav');
    await confirmCart(cartId);
    const items = await listCartItems(cartId);
    const item = items.find((i) => i.status === 'queued');
    if (!item) throw new Error('no item');
    const job = await enqueueJob({
      type: 'export',
      inputRef: item.id,
      projectId,
      initialEstimateMs: 500
    });
    const res = await processExportJob(job, null);
    expect(res.ok).toBe(true);

    // Install URL.createObjectURL/revoke stubs + anchor spy.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    const origCreateEl = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateEl(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    try {
      const d = await downloadCompletedItem(item.id);
      expect(d.ok).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      vi.restoreAllMocks();
    }
  });

  it('a failed render marks the item failed and leaves no output blob', async () => {
    const { projectId, cartId } = await primeProject();
    // Add an item pointing at a non-existent source to force failure.
    const item: ExportCartItem = {
      id: 'bad-item',
      cartId,
      sourceRef: 'no-such-file',
      format: 'wav',
      estimatedSizeBytes: 0,
      estimatedRuntimeMs: 100,
      status: 'queued',
      sampleRate: 44100
    };
    await put('exportCartItems', item);
    const job = await enqueueJob({
      type: 'export',
      inputRef: item.id,
      projectId,
      initialEstimateMs: 100
    });
    const res = await processExportJob(job, null);
    expect(res.ok).toBe(false);
    const after = await get<ExportCartItem>('exportCartItems', item.id);
    expect(after?.status).toBe('failed');
    expect(after?.outputBlobRef).toBeUndefined();
  });

  it('report counts only completed exports, not queued', async () => {
    const { projectId, fileId, cartId } = await primeProject();
    await addCartItem(cartId, fileId, 'wav');
    await confirmCart(cartId);
    const items = await listCartItems(cartId);
    const item = items.find((i) => i.status === 'queued');
    if (!item) throw new Error('no item');

    // Import reports AFTER queueing but BEFORE processing.
    const { computeReport } = await import('../../src/lib/services/reports');
    const beforeProcess = await computeReport();
    expect(beforeProcess.exportedCount).toBe(0);

    const job = await enqueueJob({
      type: 'export',
      inputRef: item.id,
      projectId,
      initialEstimateMs: 500
    });
    await processExportJob(job, null);

    const after = await computeReport();
    expect(after.exportedCount).toBe(1);
  });
});
