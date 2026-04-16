import type { Marker, Result } from '../types';
import { allByIndex, del, get, put } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { ErrorCodes, fail, ok } from '../util/errors';
import { validateMarkerNote } from '../util/validators';
import { LIMITS } from '../util/constants';
import { logAudit } from './audit';

export async function listMarkers(projectId: string): Promise<Marker[]> {
  const list = await allByIndex<Marker>('markers', 'by_project', projectId);
  return list.sort((a, b) => a.timestampMs - b.timestampMs);
}

export async function createMarker(
  projectId: string,
  timestampMs: number,
  note: string,
  fileId?: string,
  mediaDurationMs?: number
): Promise<Result<Marker>> {
  const err = validateMarkerNote(note);
  if (err) return fail(err.code, err.message);
  if (timestampMs < 0 || (mediaDurationMs != null && timestampMs > mediaDurationMs)) {
    return fail(
      ErrorCodes.MARKER_TIMESTAMP_OUT_OF_RANGE,
      'Timestamp is outside the media duration.'
    );
  }
  const existing = await listMarkers(projectId);
  if (existing.length >= LIMITS.MAX_MARKERS_PER_PROJECT) {
    return fail(
      ErrorCodes.MARKER_LIMIT_EXCEEDED,
      `Max ${LIMITS.MAX_MARKERS_PER_PROJECT} markers per project.`
    );
  }
  const m: Marker = {
    id: newId('mk'),
    projectId,
    fileId,
    timestampMs,
    note: note.trim(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await put('markers', m);
  await logAudit('marker', m.id, 'create');
  return ok(m);
}

export async function updateMarker(
  id: string,
  patch: Partial<Pick<Marker, 'note' | 'timestampMs' | 'needsReview'>>
): Promise<Result<Marker>> {
  const m = await get<Marker>('markers', id);
  if (!m) return fail('MARKER_NOT_FOUND', 'Marker not found.');
  if (patch.note != null) {
    const err = validateMarkerNote(patch.note);
    if (err) return fail(err.code, err.message);
  }
  const updated: Marker = { ...m, ...patch, updatedAt: nowIso() };
  await put('markers', updated);
  return ok(updated);
}

export async function deleteMarker(id: string): Promise<void> {
  await del('markers', id);
  await logAudit('marker', id, 'delete');
}
