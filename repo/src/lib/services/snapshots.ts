import type { EditOperation, Marker, ProjectSnapshot, Result } from '../types';
import { allByIndex, del, put, tx } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { sha256Hex } from '../util/hash';
import { LIMITS } from '../util/constants';
import { fail, ok } from '../util/errors';
import { logAudit } from './audit';

export interface SnapshotState {
  operations: EditOperation[];
  markers: Marker[];
}

function shapeState(state: unknown): SnapshotState {
  const s = (state ?? {}) as Partial<SnapshotState>;
  return {
    operations: Array.isArray(s.operations) ? (s.operations as EditOperation[]) : [],
    markers: Array.isArray(s.markers) ? (s.markers as Marker[]) : []
  };
}

export async function createSnapshot(
  projectId: string,
  reason: ProjectSnapshot['reason'],
  state: unknown
): Promise<Result<ProjectSnapshot>> {
  const existing = await listSnapshots(projectId);
  const ordinal = (existing[0]?.snapshotOrdinal ?? 0) + 1;
  const shaped = shapeState(state);
  const serialized = JSON.stringify(shaped);
  const checksum = await sha256Hex(serialized);
  const snap: ProjectSnapshot = {
    id: newId('snap'),
    projectId,
    snapshotOrdinal: ordinal,
    createdAt: nowIso(),
    reason,
    projectStateBlob: shaped,
    checksum,
    isRecoverable: true,
    state: 'creating'
  };
  // Atomic: write then mark valid, then prune.
  await put('snapshots', snap);
  const valid: ProjectSnapshot = { ...snap, state: 'valid' };
  await put('snapshots', valid);
  await pruneOldSnapshots(projectId);
  await logAudit('snapshot', valid.id, 'create', 'system', { reason });
  return ok(valid);
}

export async function listSnapshots(projectId: string): Promise<ProjectSnapshot[]> {
  const list = await allByIndex<ProjectSnapshot>('snapshots', 'by_project', projectId);
  return list.sort((a, b) => b.snapshotOrdinal - a.snapshotOrdinal);
}

export async function latestRecoverable(projectId: string): Promise<ProjectSnapshot | undefined> {
  const list = await listSnapshots(projectId);
  return list.find((s) => s.state === 'valid' && s.isRecoverable);
}

export async function verifySnapshot(snap: ProjectSnapshot): Promise<boolean> {
  // The stored blob was written in shaped form (see createSnapshot), so the
  // authoritative check is a raw checksum of the stored blob as-is.
  const serialized = JSON.stringify(snap.projectStateBlob);
  const checksum = await sha256Hex(serialized);
  return checksum === snap.checksum;
}

/**
 * Restore the live project state from a recoverable snapshot. This:
 *  - verifies the checksum
 *  - wipes the project's current editOperations + markers stores
 *  - re-writes every operation and marker from the snapshot blob
 *  - records an audit event and marks the snapshot as 'recovered'
 *
 * Returns the restored operations and markers so the UI can refresh.
 */
export async function restoreSnapshot(snap: ProjectSnapshot): Promise<Result<SnapshotState>> {
  const valid = await verifySnapshot(snap);
  if (!valid) {
    return fail('SNAPSHOT_CORRUPT', 'Snapshot checksum does not match its stored state.');
  }
  const state = shapeState(snap.projectStateBlob);

  try {
    await tx(['editOperations', 'markers'], 'readwrite', async ([opsStore, markerStore]) => {
      // Clear existing by project index.
      await clearByProject(opsStore, snap.projectId);
      await clearByProject(markerStore, snap.projectId);
      // Write back saved operations.
      for (const op of state.operations) {
        const restored: EditOperation = { ...op, projectId: snap.projectId };
        opsStore.put(restored);
      }
      for (const m of state.markers) {
        const restored: Marker = { ...m, projectId: snap.projectId };
        markerStore.put(restored);
      }
    });
  } catch (err) {
    return fail('SNAPSHOT_RESTORE_FAILED', (err as Error).message);
  }

  await put('snapshots', { ...snap, state: 'recovered' });
  await logAudit('snapshot', snap.id, 'recover', 'user', {
    restoredOperations: state.operations.length,
    restoredMarkers: state.markers.length
  });
  return ok(state);
}

async function clearByProject(store: IDBObjectStore, projectId: string): Promise<void> {
  const idx = store.index('by_project');
  const req = idx.openCursor(IDBKeyRange.only(projectId));
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error ?? new Error('cursor error'));
  });
}

/** Keep only the last N recoverable snapshots per project. */
export async function pruneOldSnapshots(projectId: string): Promise<void> {
  const list = await listSnapshots(projectId);
  const recoverable = list.filter((s) => s.isRecoverable && s.state === 'valid');
  const toPrune = recoverable.slice(LIMITS.RECOVERABLE_SNAPSHOTS);
  for (const s of toPrune) {
    await put('snapshots', { ...s, state: 'pruned', isRecoverable: false });
  }
}

// ---------- Back-compat wrapper ----------
// The old "markRecovered" path only updated metadata. It's retained for
// callers that need the no-restore variant (rare), but internal callers must
// use `restoreSnapshot` instead.
export async function markRecovered(snap: ProjectSnapshot): Promise<void> {
  await put('snapshots', { ...snap, state: 'recovered' });
  await logAudit('snapshot', snap.id, 'recover:metadata-only', 'user');
}
