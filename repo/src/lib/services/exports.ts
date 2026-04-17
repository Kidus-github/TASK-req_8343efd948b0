import type {
  ExportCart,
  ExportCartItem,
  ExportFormat,
  ImportedAudioFile,
  Mp3Bitrate,
  Result
} from '../types';
import { all, allByIndex, get, put } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { LIMITS } from '../util/constants';
import { ErrorCodes, fail, ok } from '../util/errors';
import { estimateMp3Bytes, estimateRenderMs, estimateWavBytes } from '../util/estimates';
import { validateExportFormat } from '../util/validators';
import { logAudit } from './audit';
import { pcmForFile } from '../audio/engine';

async function tryBackfillDuration(
  file: ImportedAudioFile
): Promise<ImportedAudioFile | null> {
  try {
    const pcm = await pcmForFile(file);
    const updated: ImportedAudioFile = {
      ...file,
      durationMs: pcm.durationMs,
      sampleRate: file.sampleRate ?? pcm.sampleRate,
      channels: file.channels ?? pcm.channels.length
    };
    await put('importedAudio', updated);
    return updated;
  } catch {
    return null;
  }
}

export async function getOrCreateCart(projectId: string): Promise<ExportCart> {
  const existing = await allByIndex<ExportCart>('exportCarts', 'by_project', projectId);
  const draft = existing.find((c) => c.status === 'draft' || c.status === 'estimated');
  if (draft) return draft;
  const cart: ExportCart = {
    id: newId('cart'),
    projectId,
    status: 'draft',
    createdAt: nowIso()
  };
  await put('exportCarts', cart);
  return cart;
}

export async function listCartItems(cartId: string): Promise<ExportCartItem[]> {
  return allByIndex<ExportCartItem>('exportCartItems', 'by_cart', cartId);
}

/**
 * Items across every cart of a project. Useful for the Export panel, which
 * needs to keep showing queued/rendering/completed items after the cart that
 * owned them has been confirmed and replaced by a new draft.
 */
export async function listProjectExportItems(projectId: string): Promise<ExportCartItem[]> {
  const carts = await allByIndex<ExportCart>('exportCarts', 'by_project', projectId);
  const lists = await Promise.all(carts.map((c) => listCartItems(c.id)));
  return lists.flat();
}

export async function addCartItem(
  cartId: string,
  sourceFileId: string,
  format: ExportFormat,
  bitrate?: Mp3Bitrate
): Promise<Result<ExportCartItem>> {
  const valid = validateExportFormat(format, bitrate);
  if (valid) return fail(valid.code, valid.message);
  const items = await listCartItems(cartId);
  if (items.length >= LIMITS.MAX_EXPORT_CART_ITEMS) {
    return fail(
      ErrorCodes.EXPORT_CART_LIMIT_EXCEEDED,
      `Max ${LIMITS.MAX_EXPORT_CART_ITEMS} items per export.`
    );
  }
  let file = await get<ImportedAudioFile>('importedAudio', sourceFileId);
  if (!file) return fail('EXPORT_SOURCE_MISSING', 'Source file not found.');

  // Backfill duration metadata if missing.
  if (!file.durationMs || file.durationMs <= 0) {
    const backfilled = await tryBackfillDuration(file);
    if (backfilled) file = backfilled;
  }

  const durationMs = file.durationMs ?? 0;
  const durationKnown = durationMs > 0;
  const estimatedSizeBytes = durationKnown
    ? format === 'mp3'
      ? estimateMp3Bytes(durationMs, (bitrate ?? 192) as Mp3Bitrate)
      : estimateWavBytes(durationMs)
    : 0;
  const estimatedRuntimeMs = durationKnown ? estimateRenderMs(format, durationMs, bitrate) : 0;

  const item: ExportCartItem = {
    id: newId('ci'),
    cartId,
    sourceRef: sourceFileId,
    format,
    bitrate,
    sampleRate: format === 'wav' ? LIMITS.WAV_SAMPLE_RATE : undefined,
    estimatedSizeBytes,
    estimatedRuntimeMs,
    status: 'draft',
    durationKnown
  };
  await put('exportCartItems', item);

  // Move cart into "estimated" state.
  const cart = await get<ExportCart>('exportCarts', cartId);
  if (cart && cart.status === 'draft') {
    await put('exportCarts', { ...cart, status: 'estimated' });
  }
  return ok(item);
}

export async function removeCartItem(itemId: string): Promise<void> {
  const store = 'exportCartItems';
  const item = await get<ExportCartItem>(store, itemId);
  if (!item) return;
  await put(store, { ...item, status: 'cancelled' });
}

/** Download the rendered blob for a completed cart item. */
export async function downloadCompletedItem(itemId: string): Promise<Result<true>> {
  const item = await get<ExportCartItem>('exportCartItems', itemId);
  if (!item || item.status !== 'completed' || !item.outputBlobRef) {
    return fail('EXPORT_NOT_READY', 'Export is not ready to download.');
  }
  const blobRec = await get<{
    id: string;
    blob?: Blob;
    bytes?: Uint8Array | ArrayBuffer;
    mimeType?: string;
    filename?: string;
  }>('blobs', item.outputBlobRef);
  if (!blobRec) return fail('EXPORT_BLOB_MISSING', 'Rendered output is missing.');
  const mime = blobRec.mimeType ?? blobRec.blob?.type ?? (item.format === 'mp3' ? 'audio/mpeg' : 'audio/wav');
  const blob =
    blobRec.blob && blobRec.blob.size > 0
      ? blobRec.blob
      : new Blob([blobRec.bytes ?? new Uint8Array(0)], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = item.outputName ?? blobRec.filename ?? `export-${item.id}.${item.format}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  return ok(true);
}

export async function confirmCart(cartId: string): Promise<Result<ExportCart>> {
  const cart = await get<ExportCart>('exportCarts', cartId);
  if (!cart) return fail('CART_NOT_FOUND', 'Cart not found.');
  if (cart.status !== 'estimated' && cart.status !== 'draft') {
    return fail(ErrorCodes.PROJECT_INVALID_STATE, `Cart in ${cart.status} cannot be confirmed.`);
  }
  const items = (await listCartItems(cartId)).filter((i) => i.status === 'draft');
  if (items.length === 0) return fail('CART_EMPTY', 'Cart is empty.');
  const confirmed: ExportCart = {
    ...cart,
    status: 'confirmed',
    confirmedAt: nowIso()
  };
  await put('exportCarts', confirmed);
  for (const i of items) {
    await put('exportCartItems', { ...i, status: 'queued' });
  }
  await logAudit('exportCart', cart.id, 'confirm');
  return ok(confirmed);
}

export interface CartEstimate {
  totalBytes: number;
  totalRuntimeMs: number;
  /** True when at least one item is missing a persisted duration. */
  hasUnknownDuration: boolean;
  perItem: Array<{
    id: string;
    sizeBytes: number;
    runtimeMs: number;
    label: string;
    durationKnown: boolean;
  }>;
}

export async function estimateCart(cartId: string): Promise<CartEstimate> {
  const items = (await listCartItems(cartId)).filter((i) => i.status !== 'cancelled');
  const perItem = items.map((i) => ({
    id: i.id,
    sizeBytes: i.estimatedSizeBytes,
    runtimeMs: i.estimatedRuntimeMs,
    label: i.format === 'mp3' ? `mp3 ${i.bitrate}kbps` : `wav ${i.sampleRate ?? 44100}Hz`,
    durationKnown: i.durationKnown ?? (i.estimatedSizeBytes > 0)
  }));
  return {
    totalBytes: perItem.reduce((n, x) => n + x.sizeBytes, 0),
    totalRuntimeMs: perItem.reduce((n, x) => n + x.runtimeMs, 0),
    hasUnknownDuration: perItem.some((p) => !p.durationKnown),
    perItem
  };
}

/**
 * Default export filename: {projectName}_{sourceBase}_{formatSpec}_{timestamp}.
 * Collision policy: append _1, _2, ... appended by caller if needed.
 */
export function defaultFilename(params: {
  projectName: string;
  sourceFilename: string;
  format: ExportFormat;
  bitrate?: Mp3Bitrate;
  sampleRate?: number;
  timestamp?: Date;
}): string {
  const base = params.sourceFilename.replace(/\.[^.]+$/, '');
  const spec =
    params.format === 'mp3' ? `mp3-${params.bitrate ?? 192}kbps` : `wav-${params.sampleRate ?? 44100}hz`;
  const t = params.timestamp ?? new Date();
  const stamp = t.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const safeProject = safeSegment(params.projectName);
  const safeBase = safeSegment(base);
  return `${safeProject}_${safeBase}_${spec}_${stamp}.${params.format}`;
}

export function applyCollisionSuffix(existing: string[], desired: string): string {
  if (!existing.includes(desired)) return desired;
  const dot = desired.lastIndexOf('.');
  const stem = dot >= 0 ? desired.slice(0, dot) : desired;
  const ext = dot >= 0 ? desired.slice(dot) : '';
  let i = 1;
  while (existing.includes(`${stem}_${i}${ext}`)) i++;
  return `${stem}_${i}${ext}`;
}

function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}
