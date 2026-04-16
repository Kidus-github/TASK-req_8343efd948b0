import { describe, expect, it } from 'vitest';
import { computeReport, reportToCsv } from '../../src/lib/services/reports';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import { appendOperation } from '../../src/lib/services/edits';
import { addCartItem, confirmCart, getOrCreateCart } from '../../src/lib/services/exports';
import { put } from '../../src/lib/db/indexeddb';

describe('report computation', () => {
  it('reports from underlying records', async () => {
    const p = await createProject('Report');
    if (!p.ok) throw new Error('setup');
    const imp = await importBatch(p.data.id, [
      {
        name: 'a.mp3',
        size: 1024,
        data: new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' })
      }
    ]);
    if (!imp.ok) throw new Error('setup');
    await appendOperation(p.data.id, imp.data.accepted[0].id, 'fade_in', { seconds: 1 });

    const cart = await getOrCreateCart(p.data.id);
    await addCartItem(cart.id, imp.data.accepted[0].id, 'wav');
    await confirmCart(cart.id);
    // Mark the cart item as completed so the report counts it.
    await put('exportCartItems', {
      id: (await (await import('../../src/lib/db/indexeddb')).all('exportCartItems'))[0].id,
      cartId: cart.id,
      sourceRef: imp.data.accepted[0].id,
      format: 'wav',
      estimatedSizeBytes: 100,
      estimatedRuntimeMs: 100,
      status: 'completed',
      sampleRate: 44100
    });

    const m = await computeReport();
    expect(m.importedCount).toBe(1);
    expect(m.editedCount).toBe(1);
    expect(m.exportedCount).toBe(1);
    expect(m.conversionImportToEdit).toBe(1);
  });

  it('exports CSV with preamble', async () => {
    const p = await createProject('CsvReport');
    if (!p.ok) throw new Error('setup');
    const m = await computeReport();
    const csv = reportToCsv(m, { dateFrom: '2026-01-01T00:00:00Z' });
    expect(csv).toContain('# CleanWave operations report');
    expect(csv).toContain('metric,value');
  });
});
