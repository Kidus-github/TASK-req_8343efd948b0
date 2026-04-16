// Cart estimates: duration metadata is persisted at import, and used for
// credible pre-confirmation estimates. Unknown duration is surfaced
// explicitly instead of silently producing zero.

import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import { addCartItem, estimateCart, getOrCreateCart } from '../../src/lib/services/exports';
import { encodeWavBytes } from '../../src/lib/util/audio';
import { all, put } from '../../src/lib/db/indexeddb';
import type { ImportedAudioFile } from '../../src/lib/types';

async function makeCandidate(): Promise<import('../../src/lib/services/imports').RawImportCandidate> {
  const blob = wav1Sec();
  return { name: 'a.wav', size: blob.size, mimeType: 'audio/wav', data: blob };
}

function wav1Sec(): Blob {
  const sr = 44100;
  const n = sr;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
    r[i] = l[i];
  }
  return new Blob([encodeWavBytes([l, r], sr)], { type: 'audio/wav' });
}

describe('import persists duration metadata', () => {
  it('WAV header is parsed and durationMs persisted', async () => {
    const p = await createProject('DurationWav');
    if (!p.ok) throw new Error('project');
    const imp = await importBatch(p.data.id, [
      await makeCandidate()
    ]);
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;
    const files = await all<ImportedAudioFile>('importedAudio');
    const f = files.find((x) => x.id === imp.data.accepted[0].id);
    expect(f?.durationMs).toBeGreaterThan(900);
    expect(f?.durationMs).toBeLessThan(1100);
    expect(f?.sampleRate).toBe(44100);
    expect(f?.channels).toBe(2);
  });
});

describe('estimate credibility', () => {
  it('produces non-zero credible estimates when duration is known', async () => {
    const p = await createProject('EstOk');
    if (!p.ok) throw new Error('project');
    const imp = await importBatch(p.data.id, [
      await makeCandidate()
    ]);
    if (!imp.ok) throw new Error('import');
    const cart = await getOrCreateCart(p.data.id);
    const add = await addCartItem(cart.id, imp.data.accepted[0].id, 'mp3', 192);
    expect(add.ok).toBe(true);
    const est = await estimateCart(cart.id);
    expect(est.perItem[0].durationKnown).toBe(true);
    expect(est.perItem[0].sizeBytes).toBeGreaterThan(10_000); // 1s at 192kbps ≈ 24 KB
    expect(est.perItem[0].runtimeMs).toBeGreaterThan(0);
    expect(est.hasUnknownDuration).toBe(false);
  });

  it('surfaces unknown-duration state without showing misleading zeros', async () => {
    const p = await createProject('EstUnknown');
    if (!p.ok) throw new Error('project');
    const imp = await importBatch(p.data.id, [
      await makeCandidate()
    ]);
    if (!imp.ok) throw new Error('import');
    // Manually wipe durationMs to simulate a legacy record.
    const file = imp.data.accepted[0];
    await put('importedAudio', { ...file, durationMs: undefined });

    const cart = await getOrCreateCart(p.data.id);
    const add = await addCartItem(cart.id, file.id, 'wav');
    expect(add.ok).toBe(true);
    // addCartItem should attempt to backfill. If backfill succeeds, durationKnown = true.
    // If backfill is not possible in the test env, durationKnown should be false.
    const est = await estimateCart(cart.id);
    if (est.perItem[0].durationKnown) {
      // Backfilled successfully — good: estimates are credible.
      expect(est.perItem[0].sizeBytes).toBeGreaterThan(0);
    } else {
      // Not backfilled — the UI must surface unknown rather than zero.
      expect(est.hasUnknownDuration).toBe(true);
      expect(est.perItem[0].sizeBytes).toBe(0);
    }
  });
});
