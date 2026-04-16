<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    addTrack,
    createPlaylist,
    deletePlaylist,
    listPlaylists,
    listTracks,
    nextShuffleIndex,
    removeTrack,
    resolvePlayableBlob,
    searchTracks,
    updatePlaylist
  } from '$lib/services/playlists';
  import { all } from '$lib/db/indexeddb';
  import type { ImportedAudioFile, PlaybackMode, Playlist, PlaylistTrack } from '$lib/types';
  import { pushToast } from '$lib/stores/toast';
  import { confirmModal } from '$lib/stores/modal';
  import { LIMITS } from '$lib/util/constants';

  let playlists: Playlist[] = [];
  let active: Playlist | null = null;
  let tracks: PlaylistTrack[] = [];
  let query = '';
  let newName = '';
  let files: ImportedAudioFile[] = [];
  let addFileId = '';
  let addNote = '';

  // Playback state
  let audio: HTMLAudioElement | null = null;
  let currentTrackId: string | null = null;
  let playing = false;
  let positionSec = 0;
  let durationSec = 0;
  let currentObjectUrl: string | null = null;
  let playedIds = new Set<string>();

  onMount(refresh);
  onDestroy(() => {
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  });

  async function refresh(): Promise<void> {
    playlists = await listPlaylists();
    files = await all<ImportedAudioFile>('importedAudio');
    if (files.length && !addFileId) addFileId = files[0].id;
    if (active) {
      active = playlists.find((p) => p.id === active!.id) ?? null;
      if (active) tracks = await listTracks(active.id);
      else tracks = [];
    }
  }

  async function onCreate(): Promise<void> {
    if (!newName.trim()) return;
    const res = await createPlaylist(newName);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    pushToast('success', 'Playlist created.');
    newName = '';
    playlists = await listPlaylists();
    active = res.data;
    tracks = [];
  }

  async function onAddTrack(): Promise<void> {
    if (!active) return;
    const file = files.find((f) => f.id === addFileId);
    if (!file) return;
    const res = await addTrack(active.id, file.id, file.originalFilename, addNote);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    tracks = await listTracks(active.id);
    addNote = '';
  }

  async function onRemoveTrack(id: string): Promise<void> {
    await removeTrack(id);
    if (active) tracks = await listTracks(active.id);
  }

  async function onDelete(p: Playlist): Promise<void> {
    const ok = await confirmModal({
      title: `Delete playlist "${p.name}"?`,
      message: 'Tracks will be removed from this playlist (source files stay).',
      destructive: true
    });
    if (!ok) return;
    await deletePlaylist(p.id);
    if (active?.id === p.id) {
      active = null;
      tracks = [];
      stop();
    }
    await refresh();
  }

  async function selectPlaylist(p: Playlist): Promise<void> {
    active = p;
    tracks = await listTracks(p.id);
    playedIds = new Set();
    stop();
  }

  async function onModeChange(e: Event): Promise<void> {
    if (!active) return;
    const mode = (e.target as HTMLSelectElement).value as PlaybackMode;
    const res = await updatePlaylist(active.id, { playbackMode: mode });
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    active = res.data;
    playlists = await listPlaylists();
    playedIds = new Set();
    pushToast('info', `Mode persisted: ${mode}`);
  }

  async function playTrack(track: PlaylistTrack): Promise<void> {
    // A PlaylistTrack stores the ImportedAudioFile id; the actual audio blob
    // is keyed by that file's `blobRef`. Resolve through the file record so
    // playback always reaches the real bytes and blob storage can evolve
    // without the playlist UI knowing about it.
    const blob = await resolvePlayableBlob(track.fileId);
    if (!blob) {
      pushToast('error', 'Source audio missing for this track.');
      return;
    }
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(blob);
    audio = new Audio(currentObjectUrl);
    audio.addEventListener('loadedmetadata', () => {
      durationSec = audio?.duration ?? 0;
    });
    audio.addEventListener('timeupdate', () => {
      positionSec = audio?.currentTime ?? 0;
    });
    audio.addEventListener('ended', () => {
      playedIds.add(track.id);
      playing = false;
      void advance();
    });
    currentTrackId = track.id;
    await audio.play().catch(() => {});
    playing = true;
  }

  async function advance(): Promise<void> {
    if (!active) return;
    const mode: PlaybackMode = active.playbackMode;
    const ids = tracks.map((t) => t.id);
    if (ids.length === 0) return;
    if (mode === 'single-repeat' && currentTrackId) {
      const t = tracks.find((t) => t.id === currentTrackId);
      if (t) await playTrack(t);
      return;
    }
    if (mode === 'sequential') {
      const idx = Math.max(0, ids.indexOf(currentTrackId ?? ids[0]));
      const next = tracks[idx + 1];
      if (next) await playTrack(next);
      else {
        playing = false;
        currentTrackId = null;
      }
      return;
    }
    if (mode === 'shuffle') {
      const nextIdx = nextShuffleIndex(ids, playedIds);
      if (nextIdx < 0) return;
      await playTrack(tracks[nextIdx]);
    }
  }

  function stop(): void {
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
    audio = null;
    playing = false;
    currentTrackId = null;
    positionSec = 0;
    durationSec = 0;
  }

  function pauseResume(): void {
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => {});
      playing = true;
    } else {
      audio.pause();
      playing = false;
    }
  }

  async function nextManual(): Promise<void> {
    if (!active) return;
    if (currentTrackId) playedIds.add(currentTrackId);
    await advance();
  }

  async function prevManual(): Promise<void> {
    if (!active) return;
    const idx = tracks.findIndex((t) => t.id === currentTrackId);
    if (idx > 0) await playTrack(tracks[idx - 1]);
  }

  function formatSec(s: number): string {
    const total = Math.max(0, Math.floor(s));
    const m = Math.floor(total / 60);
    const r = total % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  $: searchResults = searchTracks(tracks, query);
</script>

<div class="stack" style="max-width: 1100px;">
  <div class="row">
    <h2 style="margin: 0;">Playlists</h2>
    <div class="grow" />
    <input placeholder="New playlist name" bind:value={newName} />
    <button class="primary" on:click={onCreate} disabled={!newName.trim()}>Create</button>
  </div>

  <div class="row" style="align-items: stretch; gap: 1rem;">
    <div class="card" style="width: 260px; min-height: 320px;">
      {#if playlists.length === 0}
        <p class="muted">No playlists yet.</p>
      {/if}
      {#each playlists as p (p.id)}
        <div
          class="sidebar-item {active?.id === p.id ? 'active' : ''}"
          role="button"
          tabindex="0"
          on:click={() => selectPlaylist(p)}
          on:keydown={(e) => {
            if (e.key === 'Enter') void selectPlaylist(p);
          }}
        >
          <div><strong>{p.name}</strong></div>
          <div class="tag">{p.playbackMode}</div>
        </div>
      {/each}
    </div>

    <div class="card grow">
      {#if !active}
        <p class="muted">Select or create a playlist.</p>
      {:else}
        <div class="row">
          <h3 style="margin: 0;">{active.name}</h3>
          <div class="grow" />
          <select value={active.playbackMode} on:change={onModeChange}>
            <option value="sequential">Sequential</option>
            <option value="single-repeat">Single repeat</option>
            <option value="shuffle">Shuffle</option>
          </select>
          <button class="danger" on:click={() => active && onDelete(active)}>Delete</button>
        </div>

        <div class="muted" style="margin-top: 0.3rem;">
          {tracks.length} / {LIMITS.MAX_PLAYLIST_TRACKS} tracks
        </div>

        <div class="card" style="margin-top: 0.6rem; background: var(--bg);">
          <div class="row">
            <strong>Now playing:</strong>
            <span>{currentTrackId ? tracks.find((t) => t.id === currentTrackId)?.filenameCache ?? '—' : '—'}</span>
            <div class="grow" />
            <span class="tag">{formatSec(positionSec)} / {formatSec(durationSec)}</span>
          </div>
          <div class="row" style="margin-top: 0.4rem;">
            <button on:click={prevManual} disabled={!currentTrackId}>⏮ Prev</button>
            <button class="primary" on:click={pauseResume} disabled={!audio}>
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <button on:click={nextManual} disabled={tracks.length === 0}>⏭ Next</button>
            <button on:click={stop} disabled={!audio}>⏹ Stop</button>
            <div class="grow" />
            <span class="pill">{active.playbackMode}</span>
          </div>
        </div>

        <div class="row" style="margin-top: 0.6rem; flex-wrap: wrap; gap: 0.5rem;">
          <select bind:value={addFileId}>
            {#each files as f}<option value={f.id}>{f.originalFilename}</option>{/each}
          </select>
          <input placeholder="Note" bind:value={addNote} />
          <button class="primary" on:click={onAddTrack} disabled={!addFileId}>Add track</button>
        </div>

        <div class="row" style="margin-top: 0.75rem;">
          <input placeholder="Search filename or note" bind:value={query} />
        </div>

        <table class="table" style="margin-top: 0.5rem;">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Note</th>
              <th style="width: 1%;" />
            </tr>
          </thead>
          <tbody>
            {#each searchResults as r (r.track.id)}
              <tr>
                <td>{r.track.filenameCache} {#if currentTrackId === r.track.id}<span class="pill success">playing</span>{/if}</td>
                <td>{r.track.noteCache}</td>
                <td>
                  <button class="primary" on:click={() => playTrack(r.track)}>Play</button>
                  <button class="danger" on:click={() => onRemoveTrack(r.track.id)}>Remove</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
</div>
