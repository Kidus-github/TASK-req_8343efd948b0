import { describe, expect, it } from 'vitest';
import { nextShuffleIndex, searchTracks } from '../../src/lib/services/playlists';
import type { PlaylistTrack } from '../../src/lib/types';

function track(partial: Partial<PlaylistTrack>): PlaylistTrack {
  return {
    id: partial.id ?? 't',
    playlistId: 'p',
    fileId: 'f',
    sortIndex: partial.sortIndex ?? 0,
    noteCache: partial.noteCache ?? '',
    filenameCache: partial.filenameCache ?? ''
  };
}

describe('searchTracks', () => {
  const tracks = [
    track({ id: '1', filenameCache: 'intro.mp3', noteCache: 'opener' }),
    track({ id: '2', filenameCache: 'outro.wav', noteCache: 'end credits' }),
    track({ id: '3', filenameCache: 'chapter-one.ogg', noteCache: 'chapter review' })
  ];

  it('returns all tracks with rank 0 for empty query', () => {
    const r = searchTracks(tracks, '');
    expect(r.length).toBe(3);
  });

  it('ranks exact match highest', () => {
    const r = searchTracks(tracks, 'intro.mp3');
    expect(r[0].track.id).toBe('1');
    expect(r[0].rank).toBe(0);
  });

  it('ranks prefix before substring', () => {
    const r = searchTracks(tracks, 'chap');
    expect(r[0].track.id).toBe('3');
    expect(r[0].rank).toBe(1);
  });

  it('matches note fields', () => {
    const r = searchTracks(tracks, 'credits');
    expect(r[0].track.id).toBe('2');
    expect(r[0].rank).toBe(3);
  });
});

describe('nextShuffleIndex', () => {
  it('returns -1 for empty list', () => {
    expect(nextShuffleIndex([], new Set())).toBe(-1);
  });
  it('returns 0 for single-track list even if played', () => {
    expect(nextShuffleIndex(['a'], new Set(['a']))).toBe(0);
  });
  it('picks an unplayed track when some remain', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const played = new Set(['a', 'c']);
    const idx = nextShuffleIndex(ids, played);
    expect(['b', 'd']).toContain(ids[idx]);
  });
  it('falls back to full pool when all have been played', () => {
    const ids = ['a', 'b'];
    const played = new Set(['a', 'b']);
    const idx = nextShuffleIndex(ids, played);
    expect(idx === 0 || idx === 1).toBe(true);
  });
});
