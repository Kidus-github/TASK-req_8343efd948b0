// Playlist playback: mode persistence and next-track selection logic round-trip.

import { describe, expect, it } from 'vitest';
import {
  addTrack,
  createPlaylist,
  getPlaylist,
  listTracks,
  nextShuffleIndex,
  updatePlaylist
} from '../../src/lib/services/playlists';
import { importBatch } from '../../src/lib/services/imports';
import { createProject } from '../../src/lib/services/projects';
import { encodeWavBytes } from '../../src/lib/util/audio';

async function primeFile(): Promise<string> {
  const p = await createProject('PL');
  if (!p.ok) throw new Error('project');
  const bytes = encodeWavBytes([new Float32Array(4410), new Float32Array(4410)], 44100);
  const blob = new Blob([bytes], { type: 'audio/wav' });
  const imp = await importBatch(p.data.id, [
    { name: 'a.wav', size: blob.size, mimeType: 'audio/wav', data: blob }
  ]);
  if (!imp.ok) throw new Error('import');
  return imp.data.accepted[0].id;
}

describe('playlist playback mode persistence', () => {
  it('persists mode changes across reloads', async () => {
    const fileId = await primeFile();
    const pl = await createPlaylist('List A', 'sequential');
    if (!pl.ok) throw new Error('create');
    await addTrack(pl.data.id, fileId, 'a.wav', 'intro');
    // Swap mode
    const upd = await updatePlaylist(pl.data.id, { playbackMode: 'shuffle' });
    expect(upd.ok).toBe(true);
    // Read back
    const reloaded = await getPlaylist(pl.data.id);
    expect(reloaded?.playbackMode).toBe('shuffle');
    // Swap again
    await updatePlaylist(pl.data.id, { playbackMode: 'single-repeat' });
    const second = await getPlaylist(pl.data.id);
    expect(second?.playbackMode).toBe('single-repeat');
  });

  it('shuffle visits every track exactly once before any repeats', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    const played = new Set<string>();
    const picks = new Set<string>();
    // Simulate the UI's next-track logic until every track is visited.
    for (let step = 0; step < 4; step++) {
      const idx = nextShuffleIndex(ids, played);
      expect(idx).toBeGreaterThanOrEqual(0);
      const id = ids[idx];
      expect(played.has(id)).toBe(false); // no repeat until full pass
      played.add(id);
      picks.add(id);
    }
    expect(picks.size).toBe(4);
  });

  it('sequential advances through the list in order', async () => {
    const fileId = await primeFile();
    const pl = await createPlaylist('List B', 'sequential');
    if (!pl.ok) throw new Error('create');
    for (let i = 0; i < 3; i++) await addTrack(pl.data.id, fileId, `t${i}.wav`, `note ${i}`);
    const tracks = await listTracks(pl.data.id);
    expect(tracks.length).toBe(3);
    // Sequential "next" from each index is the adjacent track.
    for (let i = 0; i < tracks.length - 1; i++) {
      expect(tracks[i + 1].sortIndex).toBe(tracks[i].sortIndex + 1);
    }
  });
});
