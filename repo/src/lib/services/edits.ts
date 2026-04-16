import type { EditOperation, EditOpType, Result } from '../types';
import { allByIndex, del, get, put } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { ok, fail, ErrorCodes } from '../util/errors';
import { validateBalance, validateFadeSec } from '../util/validators';
import { LIMITS } from '../util/constants';
import { logAudit } from './audit';

export async function listOperations(projectId: string): Promise<EditOperation[]> {
  const list = await allByIndex<EditOperation>('editOperations', 'by_project', projectId);
  return list.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
}

export async function listOperationsForFile(
  projectId: string,
  fileId: string
): Promise<EditOperation[]> {
  const all = await listOperations(projectId);
  return all.filter((o) => o.fileId === fileId);
}

export async function appendOperation(
  projectId: string,
  fileId: string,
  type: EditOpType,
  params: Record<string, unknown>,
  previewEnabled: boolean = false
): Promise<Result<EditOperation>> {
  const validation = validateOperation(type, params);
  if (validation) return fail(validation.code, validation.message);
  const existing = await listOperations(projectId);
  const op: EditOperation = {
    id: newId('eo'),
    projectId,
    fileId,
    type,
    params,
    createdAt: nowIso(),
    sequenceIndex: existing.length,
    previewEnabled
  };
  await put('editOperations', op);
  await logAudit('editOperation', op.id, previewEnabled ? 'preview' : 'commit');
  return ok(op);
}

/** Promote preview-only ops for a given file to committed status. */
export async function applyPreviews(
  projectId: string,
  fileId: string
): Promise<Result<number>> {
  const all = await listOperations(projectId);
  const preview = all.filter((o) => o.fileId === fileId && o.previewEnabled === true);
  for (const op of preview) {
    const promoted: EditOperation = { ...op, previewEnabled: false };
    await put('editOperations', promoted);
    await logAudit('editOperation', op.id, 'apply-preview');
  }
  return ok(preview.length);
}

/** Discard preview-only ops for a given file. */
export async function discardPreviews(
  projectId: string,
  fileId: string
): Promise<Result<number>> {
  const all = await listOperations(projectId);
  const preview = all.filter((o) => o.fileId === fileId && o.previewEnabled === true);
  for (const op of preview) {
    await del('editOperations', op.id);
    await logAudit('editOperation', op.id, 'discard-preview');
  }
  return ok(preview.length);
}

export async function deleteOperation(id: string): Promise<void> {
  const op = await get<EditOperation>('editOperations', id);
  if (!op) return;
  await del('editOperations', id);
  await logAudit('editOperation', id, 'delete');
}

function validateOperation(
  type: EditOpType,
  params: Record<string, unknown>
): { code: string; message: string } | null {
  switch (type) {
    case 'fade_in':
    case 'fade_out': {
      const seconds = Number(params.seconds);
      return validateFadeSec(seconds);
    }
    case 'balance_adjust': {
      const value = Number(params.value);
      return validateBalance(value);
    }
    case 'silence_flag': {
      const threshold = Number(params.thresholdDb ?? LIMITS.SILENCE_THRESHOLD_DB);
      const minDur = Number(params.minDurationSec ?? LIMITS.SILENCE_MIN_DURATION_SEC);
      if (!Number.isFinite(threshold)) {
        return { code: 'SILENCE_INVALID', message: 'Invalid silence threshold.' };
      }
      if (!Number.isFinite(minDur) || minDur < LIMITS.SILENCE_MIN_DURATION_SEC) {
        return {
          code: 'SILENCE_INVALID',
          message: `Silence duration must be >= ${LIMITS.SILENCE_MIN_DURATION_SEC}s.`
        };
      }
      return null;
    }
    case 'normalize_lufs':
      return null;
    case 'cut':
    case 'split':
      return null;
    case 'merge': {
      const partner = params.partnerFileId;
      if (!partner || typeof partner !== 'string') {
        return { code: 'MERGE_INVALID', message: 'Merge requires a partner file id.' };
      }
      return null;
    }
  }
  return { code: ErrorCodes.PROJECT_INVALID_STATE, message: `Unknown operation: ${type}` };
}
