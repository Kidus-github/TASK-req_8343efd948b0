// Regression: playlist playback modes still behave correctly with the
// blobRef-based resolution in place. The previous test suite covered mode
// persistence + next-track selection logic; this asserts the modes remain
// wired to the resolver.

import { describe, expect, it } from 'vitest';
import {
  addTrack,
  createPlaylist,
  getPlaylist,
  listTracks,
  nextShuffleIndex,
  resolvePlayableBlob,
  updatePlaylist
} from '../../src/lib/services/playlists';
import { importBatch } from '../../src/lib/services/imports';
import { createProject } from '../../src/lib/services/projects';
import { encodeWavBytes } from '../../src/lib/util/audio';

function wavBlob(seconds = 0.5): Blob {
  const sr = 44100;
  const n = Math.floor(seconds * sr);
  const ch = new Float32Array(n);
  ch.fill(0.2);
  return new Blob([encodeWavBytes([ch, new Float32Array(ch)], sr)], { type: 'audio/wav' });
}

async function primePlaylist() {
  const p = await createProject('Modes');
  if (!p.ok) throw new Error('project');
  const a = wavBlob();
  const b = wavBlob();
  const c = wavBlob();
  const imp = await importBatch(p.data.id, [
    { name: 'a.wav', size: a.size, mimeType: 'audio/wav', data: a },
    { name: 'b.wav', size: b.size, mimeType: 'audio/wav', data: b },
    { name: 'c.wav', size: c.size, mimeType: 'audio/wav', data: c }
  ]);
  if (!imp.ok) throw new Error('import');
  const pl = await createPlaylist('Modes', 'sequential');
  if (!pl.ok) throw new Error('playlist');
  for (const f of imp.data.accepted) await addTrack(pl.data.id, f.id, f.originalFilename);
  return { playlistId: pl.data.id, fileIds: imp.data.accepted.map((f) => f.id) };
}

describe('playlist modes after blob-resolution fix', () => {
  it('resolves every track in sequential order through blobRef', async () => {
    const { playlistId, fileIds } = await primePlaylist();
    const tracks = await listTracks(playlistId);
    expect(tracks.length).toBe(3);
    // Emulate a sequential walk: each track resolves to a playable Blob.
    for (const t of tracks) {
      const blob = await resolvePlayableBlob(t.fileId);
      expect(blob).toBeInstanceOf(Blob);
      if (blob) expect(blob.size).toBeGreaterThan(44);
    }
    expect(fileIds.length).toBe(3);
  });

  it('persists mode changes and resolution still works after switching', async () => {
    const { playlistId } = await primePlaylist();
    const upd = await updatePlaylist(playlistId, { playbackMode: 'shuffle' });
    expect(upd.ok).toBe(true);
    const reloaded = await getPlaylist(playlistId);
    expect(reloaded?.playbackMode).toBe('shuffle');

    const tracks = await listTracks(playlistId);
    const ids = tracks.map((t) => t.id);
    const played = new Set<string>();
    // Simulate shuffle cycle; each pick must resolve a real Blob.
    for (let i = 0; i < ids.length; i++) {
      const idx = nextShuffleIndex(ids, played);
      const track = tracks[idx];
      played.add(track.id);
      const blob = await resolvePlayableBlob(track.fileId);
      expect(blob).toBeInstanceOf(Blob);
    }
  });

  it('single-repeat reuses the same track and still resolves', async () => {
    const { playlistId } = await primePlaylist();
    await updatePlaylist(playlistId, { playbackMode: 'single-repeat' });
    const tracks = await listTracks(playlistId);
    const first = tracks[0];
    for (let i = 0; i < 3; i++) {
      const blob = await resolvePlayableBlob(first.fileId);
      expect(blob).toBeInstanceOf(Blob);
    }
  });
});
