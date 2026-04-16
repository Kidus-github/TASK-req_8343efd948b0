// Preview staging: preview-only operations must be inspectable without
// affecting committed state, then either applied or discarded.

import { describe, expect, it } from 'vitest';
import {
  applyPreviews,
  appendOperation,
  discardPreviews,
  listOperations,
  listOperationsForFile
} from '../../src/lib/services/edits';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import { applyOperations, applyOperationsAsync } from '../../src/lib/audio/engine';
import { encodeWavBytes, type PcmBuffer } from '../../src/lib/util/audio';
import {
  addCartItem,
  confirmCart,
  getOrCreateCart,
  listCartItems
} from '../../src/lib/services/exports';
import { enqueueJob } from '../../src/lib/services/queue';
import { processExportJob } from '../../src/lib/audio/exportProcessor';

function blobOf(ms: number): Blob {
  const sr = 44100;
  const n = Math.floor((ms / 1000) * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = 0.5;
    right[i] = 0.5;
  }
  return new Blob([encodeWavBytes([left, right], sr)], { type: 'audio/wav' });
}

function synthBuf(): PcmBuffer {
  const sr = 44100;
  const n = sr;
  const ch = new Float32Array(n);
  ch.fill(0.5);
  return { sampleRate: sr, channels: [ch, new Float32Array(ch)], durationMs: 1000 };
}

async function setup() {
  const p = await createProject('Preview');
  if (!p.ok) throw new Error('project');
  const imp = await importBatch(p.data.id, [
    { name: 'clip.wav', size: 0, mimeType: 'audio/wav', data: blobOf(1000) }
  ]);
  if (!imp.ok) throw new Error('import');
  return { projectId: p.data.id, fileId: imp.data.accepted[0].id };
}

describe('preview staging lifecycle', () => {
  it('stages a preview op without committing', async () => {
    const { projectId, fileId } = await setup();
    const staged = await appendOperation(projectId, fileId, 'fade_in', { seconds: 1 }, true);
    expect(staged.ok).toBe(true);
    const ops = await listOperations(projectId);
    expect(ops.length).toBe(1);
    expect(ops[0].previewEnabled).toBe(true);
  });

  it('previewMode renders include preview ops, committed render does not', async () => {
    const { projectId, fileId } = await setup();
    await appendOperation(projectId, fileId, 'fade_in', { seconds: 1 }, true);
    const ops = await listOperationsForFile(projectId, fileId);
    const base = synthBuf();
    const committed = await applyOperationsAsync(base, ops);
    const preview = await applyOperationsAsync(base, ops, { includePreview: true });
    expect(committed.channels[0][0]).toBe(0.5); // unmodified
    expect(preview.channels[0][0]).toBe(0); // fade-in ramps from 0
  });

  it('applyPreviews promotes preview ops to committed', async () => {
    const { projectId, fileId } = await setup();
    await appendOperation(projectId, fileId, 'fade_in', { seconds: 1 }, true);
    const r = await applyPreviews(projectId, fileId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBe(1);
    const ops = await listOperations(projectId);
    expect(ops[0].previewEnabled).toBe(false);
  });

  it('discardPreviews deletes preview ops only', async () => {
    const { projectId, fileId } = await setup();
    await appendOperation(projectId, fileId, 'fade_in', { seconds: 1 }, false); // committed
    await appendOperation(projectId, fileId, 'balance_adjust', { value: 10 }, true); // staged
    const r = await discardPreviews(projectId, fileId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBe(1);
    const remaining = await listOperations(projectId);
    expect(remaining.length).toBe(1);
    expect(remaining[0].type).toBe('fade_in');
  });

  it('exports never ship preview-only ops', async () => {
    const { projectId, fileId } = await setup();
    // Stage a cut that would make the export roughly half as large.
    await appendOperation(projectId, fileId, 'cut', { startMs: 0, endMs: 500 }, true);

    const cart = await getOrCreateCart(projectId);
    const add = await addCartItem(cart.id, fileId, 'wav');
    expect(add.ok).toBe(true);
    await confirmCart(cart.id);
    const items = await listCartItems(cart.id);
    const item = items.find((i) => i.status === 'queued');
    if (!item) throw new Error('item');
    const job = await enqueueJob({
      type: 'export',
      inputRef: item.id,
      projectId,
      initialEstimateMs: 500
    });
    const res = await processExportJob(job, null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Because the cut was only staged, the export should reflect the full
    // 1-second source file, not the cut-down 500ms version.
    // 1 s 44.1 kHz stereo 16-bit ≈ 176_444 bytes; 500 ms ≈ 88_244 bytes.
    // We only assert ordering: the output should be closer to the full size.
    expect(res.output.byteSize).toBeGreaterThan(150_000);
  });
});
