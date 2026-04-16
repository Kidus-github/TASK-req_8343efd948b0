// Playlist blob lookup: the UI must resolve a track's fileId to the
// ImportedAudioFile record and load audio from that record's blobRef, not
// directly by fileId. Regression test for the earlier bug where the UI
// looked up `blobs[track.fileId]`, which is never a valid key.

import { describe, expect, it } from 'vitest';
import { addTrack, createPlaylist, resolvePlayableBlob } from '../../src/lib/services/playlists';
import { importBatch } from '../../src/lib/services/imports';
import { createProject } from '../../src/lib/services/projects';
import { encodeWavBytes } from '../../src/lib/util/audio';
import { all, get } from '../../src/lib/db/indexeddb';
import type { ImportedAudioFile } from '../../src/lib/types';

function toneBlob(): Blob {
  const sr = 44100;
  const n = sr;
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
  return new Blob([encodeWavBytes([l, new Float32Array(l)], sr)], { type: 'audio/wav' });
}

describe('playlist blob resolution', () => {
  it('resolves through ImportedAudioFile.blobRef, not directly from fileId', async () => {
    const p = await createProject('PlaylistBlob');
    if (!p.ok) throw new Error('project');
    const blob = toneBlob();
    const imp = await importBatch(p.data.id, [
      { name: 'a.wav', size: blob.size, mimeType: 'audio/wav', data: blob }
    ]);
    if (!imp.ok) throw new Error('import');
    const file = imp.data.accepted[0];

    // Sanity: the blob is keyed by blobRef, not by fileId.
    expect(file.blobRef).toBeDefined();
    expect(file.blobRef).not.toBe(file.id);
    const byWrongKey = await get('blobs', file.id);
    expect(byWrongKey).toBeUndefined(); // The OLD broken path returns nothing
    const byRightKey = await get('blobs', file.blobRef);
    expect(byRightKey).toBeDefined();

    // Create a playlist track.
    const pl = await createPlaylist('List');
    if (!pl.ok) throw new Error('playlist');
    const added = await addTrack(pl.data.id, file.id, file.originalFilename, 'hello');
    expect(added.ok).toBe(true);

    // The repaired resolver must return a playable Blob from the track's fileId.
    const resolved = await resolvePlayableBlob(file.id);
    expect(resolved).toBeInstanceOf(Blob);
    if (!resolved) return;
    // It must have content, not zero bytes.
    expect(resolved.size).toBeGreaterThan(44);
  });

  it('returns null when the file record is missing', async () => {
    const resolved = await resolvePlayableBlob('no-such-file-id');
    expect(resolved).toBeNull();
  });

  it('falls back to bytes + mime when a native Blob is not preserved', async () => {
    // Simulate a blob record with only bytes + mimeType (the fake-indexeddb
    // shape). Production browsers retain the Blob directly; this guards the
    // fallback path so playback still works under test or degraded stores.
    await import('../../src/lib/db/indexeddb').then(async (db) => {
      const bytes = new Uint8Array(
        encodeWavBytes([new Float32Array(100), new Float32Array(100)], 44100)
      );
      await db.put('blobs', {
        id: 'blob-bytes-only',
        bytes,
        mimeType: 'audio/wav'
      });
      const file: ImportedAudioFile = {
        id: 'file-bytes-only',
        projectId: 'proj-x',
        originalFilename: 'bytes.wav',
        mimeType: 'audio/wav',
        extension: 'wav',
        sizeBytes: bytes.length,
        blobRef: 'blob-bytes-only',
        importStatus: 'accepted',
        validationErrors: [],
        createdAt: '2026-01-01T00:00:00Z'
      };
      await db.put('importedAudio', file);
    });

    const resolved = await resolvePlayableBlob('file-bytes-only');
    expect(resolved).toBeInstanceOf(Blob);
    if (!resolved) return;
    expect(resolved.type).toContain('wav');
    expect(resolved.size).toBeGreaterThan(44);
  });
});
