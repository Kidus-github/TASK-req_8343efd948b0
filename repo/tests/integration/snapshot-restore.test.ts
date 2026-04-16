// Prove that restoreSnapshot writes saved project state back into the live
// IndexedDB stores, not just updating the snapshot's metadata.

import { describe, expect, it } from 'vitest';
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot
} from '../../src/lib/services/snapshots';
import { appendOperation, deleteOperation, listOperations } from '../../src/lib/services/edits';
import { createMarker, deleteMarker, listMarkers } from '../../src/lib/services/markers';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';

async function primeProject() {
  const p = await createProject('Restore');
  if (!p.ok) throw new Error('project');
  const blob = new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' });
  const imp = await importBatch(p.data.id, [
    { name: 'clip.mp3', size: blob.size, mimeType: 'audio/mpeg', data: blob }
  ]);
  if (!imp.ok) throw new Error('import');
  return { projectId: p.data.id, fileId: imp.data.accepted[0].id };
}

describe('restoreSnapshot', () => {
  it('writes saved operations and markers back to their stores', async () => {
    const { projectId, fileId } = await primeProject();

    // Populate an initial state we want to capture.
    const fade = await appendOperation(projectId, fileId, 'fade_in', { seconds: 1 });
    expect(fade.ok).toBe(true);
    const marker = await createMarker(projectId, 100, 'chapter-1', fileId, 10_000);
    expect(marker.ok).toBe(true);

    // Snapshot it.
    const beforeOps = await listOperations(projectId);
    const beforeMarkers = await listMarkers(projectId);
    const snap = await createSnapshot(projectId, 'manual', {
      operations: beforeOps,
      markers: beforeMarkers
    });
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;

    // Mutate state after the snapshot so restore has something to overwrite.
    await deleteOperation(fade.ok ? fade.data.id : '');
    if (marker.ok) await deleteMarker(marker.data.id);
    await appendOperation(projectId, fileId, 'balance_adjust', { value: -50 });

    const mutatedOps = await listOperations(projectId);
    const mutatedMarkers = await listMarkers(projectId);
    expect(mutatedOps.length).toBe(1);
    expect(mutatedOps[0].type).toBe('balance_adjust');
    expect(mutatedMarkers.length).toBe(0);

    // Restore — assertion: live state matches the snapshot, not the mutated form.
    const restored = await restoreSnapshot(snap.data);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.data.operations.length).toBe(1);
    expect(restored.data.markers.length).toBe(1);

    const finalOps = await listOperations(projectId);
    const finalMarkers = await listMarkers(projectId);
    expect(finalOps.length).toBe(1);
    expect(finalOps[0].type).toBe('fade_in');
    expect(finalMarkers.length).toBe(1);
    expect(finalMarkers[0].note).toBe('chapter-1');

    // And the snapshot's own metadata reflects the real recovery.
    const after = (await listSnapshots(projectId)).find((s) => s.id === snap.data.id);
    expect(after?.state).toBe('recovered');
  });

  it('refuses to restore a corrupt (tampered) snapshot', async () => {
    const { projectId, fileId } = await primeProject();
    await appendOperation(projectId, fileId, 'fade_in', { seconds: 1 });
    const snap = await createSnapshot(projectId, 'manual', {
      operations: await listOperations(projectId),
      markers: await listMarkers(projectId)
    });
    if (!snap.ok) throw new Error('setup');

    const tampered = { ...snap.data, projectStateBlob: { operations: [], markers: [{ id: 'x' }] } };
    const r = await restoreSnapshot(tampered as typeof snap.data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SNAPSHOT_CORRUPT');
  });

  it('handles an empty saved state by clearing live ops/markers', async () => {
    const { projectId, fileId } = await primeProject();
    const snap = await createSnapshot(projectId, 'manual', { operations: [], markers: [] });
    if (!snap.ok) throw new Error('setup');
    // Add mutations afterwards.
    await appendOperation(projectId, fileId, 'fade_in', { seconds: 1 });
    await createMarker(projectId, 10, 'n', fileId, 10_000);

    const r = await restoreSnapshot(snap.data);
    expect(r.ok).toBe(true);
    expect((await listOperations(projectId)).length).toBe(0);
    expect((await listMarkers(projectId)).length).toBe(0);
  });
});
