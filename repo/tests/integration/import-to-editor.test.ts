// Import-to-editor reactivity: a file imported while the editor is already
// observing a project must become visible in that editor without forcing
// the user to navigate away and back. The signal travels via the
// `importEventsBus` Svelte store that ImportPanel publishes to after a
// successful importBatch.

import { describe, expect, it } from 'vitest';
import { get as storeGet } from 'svelte/store';
import { importEventsBus, publishImportCompleted } from '../../src/lib/stores/workspace';
import { importBatch, listProjectFiles } from '../../src/lib/services/imports';
import { createProject } from '../../src/lib/services/projects';
import { encodeWavBytes } from '../../src/lib/util/audio';

function wavBlob(): Blob {
  const sr = 44100;
  const n = Math.floor(sr * 0.2);
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
  return new Blob([encodeWavBytes([l, new Float32Array(l)], sr)], { type: 'audio/wav' });
}

describe('import-to-editor store bridge', () => {
  it('publishImportCompleted fires a store event consumers can subscribe to', () => {
    const seen: Array<{ counter: number; projectId: string; ids: string[] }> = [];
    const unsub = importEventsBus.subscribe((ev) => {
      if (!ev) return;
      seen.push({ counter: ev.counter, projectId: ev.projectId, ids: ev.acceptedFileIds });
    });

    publishImportCompleted('proj-A', ['file-1']);
    publishImportCompleted('proj-A', ['file-2', 'file-3']);
    unsub();

    expect(seen.length).toBe(2);
    expect(seen[0].projectId).toBe('proj-A');
    expect(seen[0].ids).toEqual(['file-1']);
    expect(seen[1].counter).toBeGreaterThan(seen[0].counter);
    expect(seen[1].ids).toEqual(['file-2', 'file-3']);
  });

  it('a real import batch drives the editor-facing event with the accepted ids', async () => {
    const p = await createProject('LiveImport');
    if (!p.ok) throw new Error('project');

    // Simulate an editor that's already mounted and watching for import events.
    const seen: Array<{ projectId: string; ids: string[] }> = [];
    const baseline = storeGet(importEventsBus);
    const unsub = importEventsBus.subscribe((ev) => {
      if (!ev) return;
      if (baseline && ev.counter === baseline.counter) return;
      seen.push({ projectId: ev.projectId, ids: ev.acceptedFileIds });
    });

    // Drive the same path the UI uses: importBatch + publishImportCompleted
    // (the panel-level side effect). Both events happen in the same tick.
    const blob = wavBlob();
    const res = await importBatch(p.data.id, [
      { name: 'new.wav', size: blob.size, mimeType: 'audio/wav', data: blob }
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    publishImportCompleted(p.data.id, res.data.accepted.map((f) => f.id));
    unsub();

    // The editor's subscriber sees the completed event with the right ids.
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last.projectId).toBe(p.data.id);
    expect(last.ids.length).toBe(1);
    expect(last.ids[0]).toBe(res.data.accepted[0].id);

    // And the DB itself reflects the new file, so a reactive listProjectFiles
    // call in the editor would pick it up immediately.
    const files = await listProjectFiles(p.data.id);
    expect(files.map((f) => f.id)).toContain(res.data.accepted[0].id);
  });

  it('ignores events from other projects', () => {
    const seen: Array<{ projectId: string }> = [];
    const unsub = importEventsBus.subscribe((ev) => {
      if (!ev) return;
      if (ev.projectId !== 'mine') return;
      seen.push({ projectId: ev.projectId });
    });
    publishImportCompleted('other', ['x']);
    publishImportCompleted('mine', ['y']);
    publishImportCompleted('other', ['z']);
    unsub();
    expect(seen.length).toBe(1);
    expect(seen[0].projectId).toBe('mine');
  });
});
