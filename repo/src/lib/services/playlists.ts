import type { ImportedAudioFile, PlaybackMode, Playlist, PlaylistTrack, Result } from '../types';
import { all, allByIndex, del, get, put } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { LIMITS } from '../util/constants';
import { ErrorCodes, fail, ok } from '../util/errors';
import { logAudit } from './audit';

export async function createPlaylist(
  name: string,
  playbackMode: PlaybackMode = 'sequential'
): Promise<Result<Playlist>> {
  const trimmed = name.trim();
  if (!trimmed) return fail('PLAYLIST_INVALID', 'Playlist name is required.');
  const p: Playlist = {
    id: newId('pl'),
    name: trimmed,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    playbackMode
  };
  await put('playlists', p);
  await logAudit('playlist', p.id, 'create');
  return ok(p);
}

export async function listPlaylists(): Promise<Playlist[]> {
  const list = await all<Playlist>('playlists');
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPlaylist(id: string): Promise<Playlist | undefined> {
  return get<Playlist>('playlists', id);
}

export async function updatePlaylist(
  id: string,
  patch: Partial<Omit<Playlist, 'id' | 'createdAt'>>
): Promise<Result<Playlist>> {
  const p = await getPlaylist(id);
  if (!p) return fail('PLAYLIST_NOT_FOUND', 'Playlist not found.');
  const updated: Playlist = { ...p, ...patch, updatedAt: nowIso() };
  await put('playlists', updated);
  return ok(updated);
}

export async function deletePlaylist(id: string): Promise<void> {
  const tracks = await allByIndex<PlaylistTrack>('playlistTracks', 'by_playlist', id);
  for (const t of tracks) await del('playlistTracks', t.id);
  await del('playlists', id);
  await logAudit('playlist', id, 'delete');
}

export async function listTracks(playlistId: string): Promise<PlaylistTrack[]> {
  const list = await allByIndex<PlaylistTrack>('playlistTracks', 'by_playlist', playlistId);
  return list.sort((a, b) => a.sortIndex - b.sortIndex);
}

export async function addTrack(
  playlistId: string,
  fileId: string,
  filename: string,
  note: string = ''
): Promise<Result<PlaylistTrack>> {
  const tracks = await listTracks(playlistId);
  if (tracks.length >= LIMITS.MAX_PLAYLIST_TRACKS) {
    return fail(
      ErrorCodes.PLAYLIST_LIMIT_EXCEEDED,
      `Max ${LIMITS.MAX_PLAYLIST_TRACKS} tracks per playlist.`
    );
  }
  const t: PlaylistTrack = {
    id: newId('pt'),
    playlistId,
    fileId,
    sortIndex: tracks.length,
    noteCache: note,
    filenameCache: filename
  };
  await put('playlistTracks', t);
  return ok(t);
}

export async function removeTrack(trackId: string): Promise<void> {
  await del('playlistTracks', trackId);
}

export interface SearchResult {
  track: PlaylistTrack;
  rank: number; // lower is better
}

export function searchTracks(tracks: PlaylistTrack[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks.map((t) => ({ track: t, rank: 0 }));
  const results: SearchResult[] = [];
  for (const t of tracks) {
    const fname = (t.filenameCache ?? '').toLowerCase();
    const note = (t.noteCache ?? '').toLowerCase();
    let rank = -1;
    if (fname === q) rank = 0;
    else if (fname.startsWith(q)) rank = 1;
    else if (fname.includes(q)) rank = 2;
    else if (note.includes(q)) rank = 3;
    if (rank >= 0) results.push({ track: t, rank });
  }
  return results.sort((a, b) => a.rank - b.rank || a.track.filenameCache.localeCompare(b.track.filenameCache));
}

/**
 * Resolve a playlist track's file id to a Blob ready for playback.
 *
 * A PlaylistTrack stores an `ImportedAudioFile.id`, NOT a blob id — the blob
 * itself is keyed by `ImportedAudioFile.blobRef`. This helper does that
 * lookup and also handles the bytes-only storage fallback so callers don't
 * need to know about either detail.
 *
 * Returns null if the file record or its backing bytes cannot be found.
 */
export async function resolvePlayableBlob(fileId: string): Promise<Blob | null> {
  const file = await get<ImportedAudioFile>('importedAudio', fileId);
  if (!file) return null;
  const blobRec = await get<{
    id: string;
    blob?: Blob;
    bytes?: Uint8Array | ArrayBuffer;
    mimeType?: string;
  }>('blobs', file.blobRef);
  if (!blobRec) return null;
  const mime = blobRec.mimeType ?? blobRec.blob?.type ?? file.mimeType ?? 'audio/mpeg';
  if (blobRec.blob && blobRec.blob.size > 0) return blobRec.blob;
  if (blobRec.bytes) return new Blob([blobRec.bytes], { type: mime });
  return null;
}

/**
 * Shuffle respecting the "no immediate repeat until all remaining tracks have
 * been visited" rule. `played` is the set of recently played IDs.
 */
export function nextShuffleIndex(
  trackIds: string[],
  played: ReadonlySet<string>
): number {
  if (trackIds.length === 0) return -1;
  if (trackIds.length === 1) return 0;
  const candidates = trackIds.map((_, i) => i).filter((i) => !played.has(trackIds[i]));
  const pool = candidates.length > 0 ? candidates : trackIds.map((_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)];
}
