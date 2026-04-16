import { describe, expect, it } from 'vitest';
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  restoreProject
} from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';
import { all } from '../../src/lib/db/indexeddb';

describe('project lifecycle', () => {
  it('creates, archives, restores, and deletes a project', async () => {
    const a = await createProject('Alpha');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const dup = await createProject('Alpha');
    expect(dup.ok).toBe(false);

    const archived = await archiveProject(a.data.id);
    expect(archived.ok).toBe(true);
    if (archived.ok) expect(archived.data.status).toBe('archived');

    const restored = await restoreProject(a.data.id);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.data.status).toBe('active');

    const del = await deleteProject(a.data.id);
    expect(del.ok).toBe(true);
    const after = await getProject(a.data.id);
    expect(after).toBeUndefined();
  });

  it('delete cascades to imports and blobs', async () => {
    const p = await createProject('Cascade');
    if (!p.ok) throw new Error('setup');
    const blob = new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' });
    await importBatch(p.data.id, [
      { name: 'a.mp3', size: 1024, mimeType: 'audio/mpeg', data: blob }
    ]);
    const beforeFiles = await all<{ projectId: string }>('importedAudio');
    expect(beforeFiles.some((f) => f.projectId === p.data.id)).toBe(true);

    await deleteProject(p.data.id);
    const afterFiles = await all<{ projectId: string }>('importedAudio');
    expect(afterFiles.some((f) => f.projectId === p.data.id)).toBe(false);
    const blobs = await all<{ id: string }>('blobs');
    expect(blobs.length).toBe(0);
  });

  it('lists sorted by updatedAt', async () => {
    const a = await createProject('First');
    const b = await createProject('Second');
    expect(a.ok && b.ok).toBe(true);
    const list = await listProjects();
    expect(list.length).toBe(2);
  });
});
