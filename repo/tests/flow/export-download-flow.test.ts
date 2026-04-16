// End-to-end: profile → project → import real WAV → edit → cart confirm →
// process export job → download link invoked → report counts the completed
// export. Asserts NO fake-success: the user-visible "complete" only fires
// after the render actually produces a blob.

import { describe, expect, it, vi } from 'vitest';
import { createProfile, resetDeviceProfile } from '../../src/lib/services/profile';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import { appendOperation } from '../../src/lib/services/edits';
import {
  addCartItem,
  confirmCart,
  downloadCompletedItem,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { enqueueJob } from '../../src/lib/services/queue';
import { processExportJob } from '../../src/lib/audio/exportProcessor';
import { encodeWavBytes } from '../../src/lib/util/audio';
import { computeReport } from '../../src/lib/services/reports';
import { get } from '../../src/lib/db/indexeddb';
import type { ExportCartItem } from '../../src/lib/types';

function makeSineBlob(durationSec: number, hz: number): Blob {
  const sr = 44100;
  const n = durationSec * sr;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * hz * i) / sr) * 0.5;
    l[i] = v;
    r[i] = v;
  }
  return new Blob([encodeWavBytes([l, r], sr)], { type: 'audio/wav' });
}

describe('export download flow e2e', () => {
  it('produces a real downloadable file and reports one completed export', async () => {
    const c = await createProfile('Ed', 'offline-pass-1');
    expect(c.ok).toBe(true);
    const p = await createProject('Studio');
    if (!p.ok) throw new Error('project');
    const blob = makeSineBlob(1, 440);
    const imp = await importBatch(p.data.id, [
      { name: 'clip.wav', size: blob.size, mimeType: 'audio/wav', data: blob }
    ]);
    if (!imp.ok) throw new Error('import');

    // Commit edits so the export pipeline applies real ops.
    await appendOperation(p.data.id, imp.data.accepted[0].id, 'fade_in', { seconds: 0.2 });
    await appendOperation(p.data.id, imp.data.accepted[0].id, 'balance_adjust', { value: -25 });

    // Cart: one MP3 192 kbps.
    const cart = await getOrCreateCart(p.data.id);
    await addCartItem(cart.id, imp.data.accepted[0].id, 'mp3', 192);
    const confirmed = await confirmCart(cart.id);
    expect(confirmed.ok).toBe(true);

    // Before processing, the report must not count queued items.
    const before = await computeReport();
    expect(before.exportedCount).toBe(0);

    // Process the queued job.
    const items = await listCartItems(cart.id);
    const target = items.find((i) => i.status === 'queued');
    if (!target) throw new Error('no queued item');
    const job = await enqueueJob({
      type: 'export',
      inputRef: target.id,
      projectId: p.data.id,
      initialEstimateMs: 500
    });
    const res = await processExportJob(job, null);
    expect(res.ok).toBe(true);

    // Cart item is completed with a real output blob.
    const done = await get<ExportCartItem>('exportCartItems', target.id);
    expect(done?.status).toBe('completed');
    expect(done?.outputBlobRef).toBeTruthy();
    expect(done?.outputName).toMatch(/\.mp3$/);
    expect((done?.outputBytes ?? 0)).toBeGreaterThan(100);

    // Report now reflects the completed export.
    const after = await computeReport();
    expect(after.exportedCount).toBe(1);
    expect(Object.keys(after.exportFormatBreakdown).some((k) => k.startsWith('mp3'))).toBe(true);

    // Download: click the anchor and assert it was invoked.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    const origCreateEl = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateEl(tag);
      if (tag === 'a') (el as HTMLAnchorElement).click = clickSpy;
      return el;
    });
    try {
      const d = await downloadCompletedItem(target.id);
      expect(d.ok).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      vi.restoreAllMocks();
    }

    // Reset should clear all data for a clean slate.
    const r = await resetDeviceProfile();
    expect(r.ok).toBe(true);
  });
});
