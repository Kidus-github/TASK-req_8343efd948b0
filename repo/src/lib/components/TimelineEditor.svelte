<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    applyPreviews,
    appendOperation,
    deleteOperation,
    discardPreviews,
    listOperations,
    listOperationsForFile
  } from '$lib/services/edits';
  import { createMarker, deleteMarker, listMarkers } from '$lib/services/markers';
  import { createSnapshot } from '$lib/services/snapshots';
  import type { EditOperation, ImportedAudioFile, Marker } from '$lib/types';
  import { pushToast } from '$lib/stores/toast';
  import { selectModal } from '$lib/stores/modal';
  import { LIMITS } from '$lib/util/constants';
  import { listProjectFiles } from '$lib/services/imports';
  import { validateFadeSec, validateBalance } from '$lib/util/validators';
  import {
    applyOperationsAsync,
    invalidateDecoded,
    pcmForFile
  } from '$lib/audio/engine';
  import { computeWaveformPeaks, scanSilence } from '$lib/audio/smartDispatch';
  import { encodeWav, type PcmBuffer } from '$lib/util/audio';
  import { loadPrefs } from '$lib/db/prefs';
  import { importEventsBus, publishImportCompleted, workspaceRefreshBus } from '$lib/stores/workspace';

  export let projectId: string;
  export let readOnly = false;

  let files: ImportedAudioFile[] = [];
  let activeFileId: string | null = null;
  let activeFile: ImportedAudioFile | null = null;
  let markers: Marker[] = [];
  let operations: EditOperation[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let durationMs = 0;
  let positionMs = 0;
  let playing = false;
  let playbackSpeed = loadPrefs().defaultPlaybackSpeed ?? 1.0;

  let basePcm: PcmBuffer | null = null;
  let committedPcm: PcmBuffer | null = null;
  let previewPcm: PcmBuffer | null = null;
  let peaks: Array<{ min: number; max: number }> = [];
  let audio: HTMLAudioElement | null = null;
  let currentObjectUrl: string | null = null;

  let fadeInSec = 1.0;
  let fadeOutSec = 1.0;
  let balance = 0;
  let newMarkerNote = '';
  /** true = audition preview-only operations; false = committed-only audio. */
  let previewMode = false;

  let selectionStartMs: number | null = null;
  let selectionEndMs: number | null = null;

  let silenceRegions: Array<{ startMs: number; endMs: number }> = [];
  /** Visible busy indicator while heavy work is queued/running. */
  let busy = false;

  let autosaveTimer: ReturnType<typeof setInterval> | null = null;
  let lastSnapshotKey = '';

  let refreshKey = 0;
  const unsubscribeRefresh = workspaceRefreshBus.subscribe((v) => {
    if (v !== refreshKey) {
      refreshKey = v;
      // Snapshot restore or similar authoritative change. Reload from DB.
      void reloadFromDb();
    }
  });

  // React to import completions from the import panel. Re-read files from
  // the DB, preserve the current selection if still valid, otherwise select
  // the first newly-imported file so it becomes immediately editable.
  let lastImportCounter = 0;
  const unsubscribeImports = importEventsBus.subscribe((ev) => {
    if (!ev) return;
    if (ev.projectId !== projectId) return;
    if (ev.counter === lastImportCounter) return;
    lastImportCounter = ev.counter;
    void onImportCompleted(ev.acceptedFileIds);
  });

  async function onImportCompleted(acceptedFileIds: string[]): Promise<void> {
    const prevSelection = activeFileId;
    files = await listProjectFiles(projectId);
    if (prevSelection && files.some((f) => f.id === prevSelection)) {
      // Still-valid selection — keep it but refresh the metadata reference.
      activeFile = files.find((f) => f.id === prevSelection) ?? null;
      return;
    }
    // No valid selection — pick the first newly-imported file, else the
    // first file in the project.
    const firstNew = acceptedFileIds.find((id) => files.some((f) => f.id === id));
    const target = firstNew ?? files[0]?.id;
    if (target) await selectFile(target);
  }

  onMount(async () => {
    files = await listProjectFiles(projectId);
    if (files.length > 0) await selectFile(files[0].id);
    startAutosave();
  });

  onDestroy(() => {
    unsubscribeRefresh();
    unsubscribeImports();
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    if (autosaveTimer) clearInterval(autosaveTimer);
  });

  async function reloadFromDb(): Promise<void> {
    if (!activeFileId) return;
    await refreshState();
    await rebuildAudio();
    drawWaveform();
  }

  async function selectFile(id: string): Promise<void> {
    activeFileId = id;
    activeFile = files.find((f) => f.id === id) ?? null;
    selectionStartMs = null;
    selectionEndMs = null;
    positionMs = 0;
    await refreshState();
    await rebuildAudio();
    drawWaveform();
  }

  async function refreshState(): Promise<void> {
    markers = await listMarkers(projectId);
    operations = await listOperations(projectId);
    if (!activeFile) return;
    busy = true;
    try {
      basePcm = await pcmForFile(activeFile);
      const myOps = operations.filter((o) => o.fileId === activeFile!.id);
      const committed = myOps.filter((o) => !o.previewEnabled);
      committedPcm = await applyOperationsAsync(basePcm, committed);
      previewPcm = await applyOperationsAsync(basePcm, myOps, { includePreview: true });
      const active = previewMode ? previewPcm : committedPcm;
      durationMs = active.durationMs;
      // Heavy analysis queued through the smart scheduler (IndexedDB job
      // queue → rating-aware dispatch → worker → result).
      peaks = await computeWaveformPeaks(active.channels[0], 600);
      silenceRegions = await scanSilence(
        active.channels[0],
        active.sampleRate,
        LIMITS.SILENCE_THRESHOLD_DB,
        LIMITS.SILENCE_MIN_DURATION_SEC
      );
    } catch (err) {
      pushToast('error', `Decode failed: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  }

  async function rebuildAudio(): Promise<void> {
    if (!activeFile) return;
    const source = previewMode ? previewPcm : committedPcm;
    if (!source) return;
    const wasPlaying = playing;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    const blob = encodeWav(source.channels, source.sampleRate);
    currentObjectUrl = URL.createObjectURL(blob);
    audio = new Audio(currentObjectUrl);
    audio.playbackRate = playbackSpeed;
    audio.addEventListener('loadedmetadata', () => {
      durationMs = Math.round((audio?.duration ?? 0) * 1000);
    });
    audio.addEventListener('timeupdate', () => {
      positionMs = Math.round((audio?.currentTime ?? 0) * 1000);
      drawWaveform();
    });
    audio.addEventListener('ended', () => {
      playing = false;
    });
    if (wasPlaying) void audio.play().catch(() => {});
  }

  async function togglePreview(): Promise<void> {
    previewMode = !previewMode;
    await refreshState();
    await rebuildAudio();
    drawWaveform();
    pushToast(
      'info',
      previewMode ? 'Preview mode: auditioning staged ops.' : 'Preview off: auditioning committed ops only.'
    );
  }

  function playPause(): void {
    if (!audio) return;
    if (playing) {
      audio.pause();
      playing = false;
    } else {
      void audio.play().catch(() => {});
      playing = true;
    }
  }

  function seekBy(sec: number): void {
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + sec));
  }

  function changeSpeed(delta: number): void {
    const next = Math.max(LIMITS.SPEED_MIN, Math.min(LIMITS.SPEED_MAX, playbackSpeed + delta));
    playbackSpeed = Number(next.toFixed(1));
    if (audio) audio.playbackRate = playbackSpeed;
  }

  async function addMarker(): Promise<void> {
    if (!activeFileId) {
      pushToast('error', 'Select a file first.');
      return;
    }
    const res = await createMarker(projectId, positionMs, newMarkerNote, activeFileId, durationMs);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    newMarkerNote = '';
    markers = await listMarkers(projectId);
    drawWaveform();
    pushToast('success', 'Marker added.');
  }

  async function removeMarker(id: string): Promise<void> {
    await deleteMarker(id);
    markers = await listMarkers(projectId);
    drawWaveform();
  }

  async function stage(type: Parameters<typeof appendOperation>[2], params: Record<string, unknown>): Promise<void> {
    if (!activeFileId) return;
    const res = await appendOperation(projectId, activeFileId, type, params, true);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    await refreshState();
    if (previewMode) await rebuildAudio();
    drawWaveform();
    pushToast('info', `${type} staged — click Apply to commit, Discard to drop.`);
  }

  async function commit(type: Parameters<typeof appendOperation>[2], params: Record<string, unknown>): Promise<void> {
    if (!activeFileId) return;
    const res = await appendOperation(projectId, activeFileId, type, params, false);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    if (activeFile) invalidateDecoded(activeFile.id);
    await refreshState();
    await rebuildAudio();
    drawWaveform();
    pushToast('success', `${type} committed.`);
  }

  async function addFade(type: 'fade_in' | 'fade_out', asPreview: boolean): Promise<void> {
    const seconds = type === 'fade_in' ? fadeInSec : fadeOutSec;
    const err = validateFadeSec(seconds);
    if (err) {
      pushToast('error', err.message);
      return;
    }
    if (asPreview) await stage(type, { seconds });
    else await commit(type, { seconds });
  }

  async function applyBalanceOp(asPreview: boolean): Promise<void> {
    const err = validateBalance(balance);
    if (err) {
      pushToast('error', err.message);
      return;
    }
    if (asPreview) await stage('balance_adjust', { value: balance });
    else await commit('balance_adjust', { value: balance });
  }

  async function runSilenceScan(): Promise<void> {
    if (!activeFileId || !activeFile) return;
    // Dispatch the silence scan to the worker pool and consume its result
    // directly — this is what drives the overlay the user sees, not a
    // separate main-thread calculation.
    const active = previewMode ? previewPcm : committedPcm;
    if (!active) return;
    try {
      silenceRegions = await scanSilence(
        active.channels[0],
        active.sampleRate,
        LIMITS.SILENCE_THRESHOLD_DB,
        LIMITS.SILENCE_MIN_DURATION_SEC
      );
      drawWaveform();
    } catch (err) {
      pushToast('error', `Silence scan failed: ${(err as Error).message}`);
      return;
    }
    await commit('silence_flag', {
      thresholdDb: LIMITS.SILENCE_THRESHOLD_DB,
      minDurationSec: LIMITS.SILENCE_MIN_DURATION_SEC
    });
    pushToast('info', `Flagged ${silenceRegions.length} silence region(s).`);
  }

  async function runNormalize(asPreview: boolean): Promise<void> {
    if (!activeFile) return;
    // Normalization is implemented inside applyOperationsAsync via the pool
    // dispatcher, so committing the op is sufficient; the next refresh will
    // render through the worker. No separate enqueueJob is needed.
    if (asPreview) {
      await stage('normalize_lufs', { targetLufs: LIMITS.NORMALIZATION_LUFS });
    } else {
      await commit('normalize_lufs', { targetLufs: LIMITS.NORMALIZATION_LUFS });
    }
  }

  async function onCut(asPreview: boolean): Promise<void> {
    if (selectionStartMs == null || selectionEndMs == null) {
      pushToast('error', 'Select a range on the timeline first.');
      return;
    }
    const [s, e] = [selectionStartMs, selectionEndMs].sort((a, b) => a - b);
    if (asPreview) await stage('cut', { startMs: s, endMs: e });
    else await commit('cut', { startMs: s, endMs: e });
    selectionStartMs = null;
    selectionEndMs = null;
  }

  async function onSplit(): Promise<void> {
    if (selectionStartMs == null) {
      pushToast('error', 'Click on the timeline to set a split point first.');
      return;
    }
    if (!activeFile || !basePcm) {
      pushToast('error', 'No file loaded.');
      return;
    }
    const atMs = selectionStartMs;
    if (atMs <= 0 || atMs >= durationMs) {
      pushToast('error', 'Split point must be inside the file duration.');
      return;
    }

    // 1. Persist the second half [atMs..end] as a new ImportedAudioFile.
    const { sliceBuffer, encodeWavBytes } = await import('$lib/util/audio');
    const { put: dbPut } = await import('$lib/db/indexeddb');
    const { newId, nowIso } = await import('$lib/util/ids');

    // Build the rendered state up to (but not including) this split, then
    // slice the second half from it.
    const myOps = operations.filter(
      (o) => o.fileId === activeFile!.id && !o.previewEnabled
    );
    const rendered = await applyOperationsAsync(basePcm, myOps);
    const secondHalf = sliceBuffer(rendered, atMs, rendered.durationMs);
    const wavBytes = encodeWavBytes(secondHalf.channels, secondHalf.sampleRate);
    const blobId = newId('blob');
    await dbPut('blobs', {
      id: blobId,
      blob: new Blob([wavBytes], { type: 'audio/wav' }),
      bytes: new Uint8Array(wavBytes),
      mimeType: 'audio/wav'
    });
    const newFile: import('$lib/types').ImportedAudioFile = {
      id: newId('file'),
      projectId,
      originalFilename: activeFile.originalFilename.replace(
        /(\.[^.]+)$/,
        `_split-${Math.round(atMs)}ms$1`
      ),
      mimeType: 'audio/wav',
      extension: 'wav',
      sizeBytes: wavBytes.byteLength,
      durationMs: secondHalf.durationMs,
      sampleRate: secondHalf.sampleRate,
      channels: secondHalf.channels.length,
      blobRef: blobId,
      importStatus: 'accepted',
      validationErrors: [],
      createdAt: nowIso()
    };
    await dbPut('importedAudio', newFile);

    // 2. Commit the split operation on the original file so the first half
    //    is [0..atMs] in all future renders/exports.
    await commit('split', { atMs });

    // 3. Notify the workspace so the new file appears in the file list.
    publishImportCompleted(projectId, [newFile.id]);
    pushToast(
      'success',
      `Split at ${formatTime(atMs)}. "${newFile.originalFilename}" created with the second half.`
    );
  }

  async function onMerge(asPreview: boolean): Promise<void> {
    if (!activeFile) return;
    if (files.length < 2) {
      pushToast('error', 'Import at least one additional file to merge.');
      return;
    }
    const options = files
      .filter((f) => f.id !== activeFile!.id)
      .map((f) => ({ value: f.id, label: f.originalFilename }));
    const picked = await selectModal({
      title: `Merge "${activeFile.originalFilename}" with:`,
      message: 'The chosen file will be concatenated after the current file.',
      options
    });
    if (!picked) return;
    const partner = files.find((f) => f.id === picked);
    if (!partner) {
      pushToast('error', 'Partner file no longer available.');
      return;
    }
    if (asPreview) {
      await stage('merge', { partnerFileId: partner.id });
    } else {
      await commit('merge', { partnerFileId: partner.id });
    }
    pushToast('success', `Merged with ${partner.originalFilename}.`);
  }

  async function onApplyPreviews(): Promise<void> {
    if (!activeFileId) return;
    const res = await applyPreviews(projectId, activeFileId);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    if (res.data === 0) {
      pushToast('info', 'No preview operations to apply.');
      return;
    }
    if (activeFile) invalidateDecoded(activeFile.id);
    await refreshState();
    await rebuildAudio();
    drawWaveform();
    pushToast('success', `Applied ${res.data} preview operation(s).`);
  }

  async function onDiscardPreviews(): Promise<void> {
    if (!activeFileId) return;
    const res = await discardPreviews(projectId, activeFileId);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    if (res.data === 0) {
      pushToast('info', 'No preview operations to discard.');
      return;
    }
    await refreshState();
    await rebuildAudio();
    drawWaveform();
    pushToast('warning', `Discarded ${res.data} preview operation(s).`);
  }

  async function onRevertLast(): Promise<void> {
    if (!activeFileId) return;
    const mine = await listOperationsForFile(projectId, activeFileId);
    const committed = mine.filter((o) => !o.previewEnabled);
    if (committed.length === 0) {
      pushToast('info', 'No committed operations to revert.');
      return;
    }
    const last = committed[committed.length - 1];
    await deleteOperation(last.id);
    if (activeFile) invalidateDecoded(activeFile.id);
    await refreshState();
    await rebuildAudio();
    drawWaveform();
    pushToast('info', `Reverted committed ${last.type}.`);
  }

  function pxToMs(x: number): number {
    if (!canvas || durationMs === 0) return 0;
    const rect = canvas.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return Math.round(pct * durationMs);
  }

  function onCanvasMouseDown(e: MouseEvent): void {
    if (!canvas) return;
    const ms = pxToMs(e.clientX);
    selectionStartMs = ms;
    selectionEndMs = ms;
    if (audio) audio.currentTime = ms / 1000;
    drawWaveform();
  }

  function onCanvasMouseMove(e: MouseEvent): void {
    if (!canvas || selectionStartMs == null || e.buttons === 0) return;
    selectionEndMs = pxToMs(e.clientX);
    drawWaveform();
  }

  function onCanvasMouseUp(): void {
    if (selectionStartMs != null && selectionEndMs != null) {
      const [s, e] = [selectionStartMs, selectionEndMs].sort((a, b) => a - b);
      selectionStartMs = s;
      selectionEndMs = e;
    }
    drawWaveform();
  }

  function drawWaveform(): void {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = (canvas.width = canvas.clientWidth || 640);
    const h = (canvas.height = 140);
    const dark = document.documentElement.dataset.theme === 'dark';
    ctx.fillStyle = dark ? '#0b1120' : '#0f172a';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
    for (const r of silenceRegions) {
      if (durationMs === 0) break;
      const x0 = (r.startMs / durationMs) * w;
      const x1 = (r.endMs / durationMs) * w;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    ctx.fillStyle = '#60a5fa';
    if (peaks.length > 0) {
      const pxPerPeak = w / peaks.length;
      for (let i = 0; i < peaks.length; i++) {
        const p = peaks[i];
        const x = Math.floor(i * pxPerPeak);
        const midY = h / 2;
        const maxY = midY - (p.max * h) / 2;
        const minY = midY - (p.min * h) / 2;
        const barHeight = Math.max(1, minY - maxY);
        ctx.fillRect(x, maxY, Math.max(1, Math.floor(pxPerPeak)), barHeight);
      }
    }

    if (selectionStartMs != null && selectionEndMs != null && durationMs > 0) {
      const [s, e] = [selectionStartMs, selectionEndMs].sort((a, b) => a - b);
      const x0 = (s / durationMs) * w;
      const x1 = (e / durationMs) * w;
      ctx.fillStyle = 'rgba(96, 165, 250, 0.25)';
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    if (durationMs > 0) {
      const pos = (positionMs / durationMs) * w;
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, h);
      ctx.stroke();
    }

    ctx.fillStyle = '#fbbf24';
    for (const m of markers) {
      if (m.fileId && m.fileId !== activeFileId) continue;
      if (durationMs === 0) break;
      const x = (m.timestampMs / durationMs) * w;
      ctx.fillRect(x - 1, 0, 2, 10);
    }
  }

  function startAutosave(): void {
    autosaveTimer = setInterval(async () => {
      const ops = await listOperations(projectId);
      const ms = await listMarkers(projectId);
      // Include preview status so apply/discard still force a snapshot.
      const key = `${ops.length}:${ops.map((o) => `${o.id}:${o.previewEnabled ? 'p' : 'c'}`).join(',')}|${ms.length}:${ms.map((m) => m.id).join(',')}`;
      if (key === lastSnapshotKey) return;
      lastSnapshotKey = key;
      const res = await createSnapshot(projectId, 'autosave', { operations: ops, markers: ms });
      if (res.ok) pushToast('info', 'Snapshot saved.');
    }, LIMITS.AUTO_SAVE_INTERVAL_MS);
  }

  function formatTime(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function onSelectChange(e: Event): void {
    const el = e.target as HTMLSelectElement;
    void selectFile(el.value);
  }

  $: fileOps = operations.filter((o) => o.fileId === activeFileId);
  $: committedCount = fileOps.filter((o) => !o.previewEnabled).length;
  $: previewCount = fileOps.filter((o) => o.previewEnabled).length;
</script>

<div class="stack">
  <div class="card">
    <div class="row">
      <strong>File:</strong>
      <select value={activeFileId} on:change={onSelectChange} disabled={files.length === 0}>
        {#each files as f}
          <option value={f.id}>{f.originalFilename}</option>
        {/each}
      </select>
      <div class="grow" />
      <label class="row" style="gap: 0.3rem;">
        <input type="checkbox" checked={previewMode} on:change={togglePreview} disabled={readOnly} />
        <span>Preview mode</span>
      </label>
      {#if busy}
        <span class="pill warning">Processing...</span>
      {/if}
      {#if readOnly}
        <span class="pill warning">Read-only</span>
      {/if}
    </div>

    <canvas
      bind:this={canvas}
      class="waveform"
      style="margin-top: 0.6rem;"
      on:mousedown={onCanvasMouseDown}
      on:mousemove={onCanvasMouseMove}
      on:mouseup={onCanvasMouseUp}
      on:mouseleave={onCanvasMouseUp}
    />

    <div class="row" style="margin-top: 0.6rem; font-size: 0.85rem;">
      {#if selectionStartMs != null && selectionEndMs != null}
        <span class="pill">Selection: {formatTime(Math.min(selectionStartMs, selectionEndMs))} – {formatTime(Math.max(selectionStartMs, selectionEndMs))}</span>
      {:else}
        <span class="muted">Click-drag the timeline to select a range, or click for a split point.</span>
      {/if}
    </div>

    <div class="row" style="margin-top: 0.75rem;">
      <button on:click={() => seekBy(-LIMITS.SEEK_STEP_SEC)} disabled={!audio}>
        -{LIMITS.SEEK_STEP_SEC}s
      </button>
      <button class="primary" on:click={playPause} disabled={!audio}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button on:click={() => seekBy(LIMITS.SEEK_STEP_SEC)} disabled={!audio}>
        +{LIMITS.SEEK_STEP_SEC}s
      </button>
      <div class="grow" />
      <button on:click={() => changeSpeed(-LIMITS.SPEED_STEP)} disabled={playbackSpeed <= LIMITS.SPEED_MIN}>
        -0.1x
      </button>
      <span>{playbackSpeed.toFixed(1)}x</span>
      <button on:click={() => changeSpeed(LIMITS.SPEED_STEP)} disabled={playbackSpeed >= LIMITS.SPEED_MAX}>
        +0.1x
      </button>
    </div>

    <div class="muted" style="margin-top: 0.5rem; font-size: 0.85rem;">
      {formatTime(positionMs)} / {formatTime(durationMs)}
    </div>
  </div>

  <div class="card">
    <h4 style="margin-top: 0;">Edits</h4>
    <p class="hint">
      "Stage" adds a preview-only operation; "Commit" writes it as final. Preview ops are
      auditioned when Preview mode is on, and never ship in exports until you Apply them.
    </p>

    <div class="row" style="flex-wrap: wrap; gap: 0.75rem;">
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">Range</span>
        <button on:click={() => onCut(true)} disabled={readOnly || selectionStartMs == null || selectionEndMs == null}>
          Stage cut
        </button>
        <button on:click={() => onCut(false)} disabled={readOnly || selectionStartMs == null || selectionEndMs == null}>
          Commit cut
        </button>
        <button on:click={onSplit} disabled={readOnly || selectionStartMs == null}>
          Split at point
        </button>
      </div>

      <div class="stack" style="gap: 0.2rem;">
        <span class="label">Merge</span>
        <button on:click={() => onMerge(true)} disabled={readOnly || files.length < 2}>
          Stage merge…
        </button>
        <button on:click={() => onMerge(false)} disabled={readOnly || files.length < 2}>
          Commit merge…
        </button>
      </div>

      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Fade in (s)</span>
        <input
          type="number"
          min={LIMITS.FADE_MIN_SEC}
          max={LIMITS.FADE_MAX_SEC}
          step={LIMITS.FADE_STEP_SEC}
          bind:value={fadeInSec}
          disabled={readOnly}
        />
        <button on:click={() => addFade('fade_in', true)} disabled={readOnly || !activeFileId}>Stage fade in</button>
        <button on:click={() => addFade('fade_in', false)} disabled={readOnly || !activeFileId}>Commit fade in</button>
      </label>

      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Fade out (s)</span>
        <input
          type="number"
          min={LIMITS.FADE_MIN_SEC}
          max={LIMITS.FADE_MAX_SEC}
          step={LIMITS.FADE_STEP_SEC}
          bind:value={fadeOutSec}
          disabled={readOnly}
        />
        <button on:click={() => addFade('fade_out', true)} disabled={readOnly || !activeFileId}>Stage fade out</button>
        <button on:click={() => addFade('fade_out', false)} disabled={readOnly || !activeFileId}>Commit fade out</button>
      </label>

      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Balance ({LIMITS.BALANCE_MIN}..{LIMITS.BALANCE_MAX})</span>
        <input
          type="number"
          min={LIMITS.BALANCE_MIN}
          max={LIMITS.BALANCE_MAX}
          step={1}
          bind:value={balance}
          disabled={readOnly}
        />
        <button on:click={() => applyBalanceOp(true)} disabled={readOnly || !activeFileId}>Stage balance</button>
        <button on:click={() => applyBalanceOp(false)} disabled={readOnly || !activeFileId}>Commit balance</button>
      </label>

      <div class="stack" style="gap: 0.2rem;">
        <span class="label">Analysis / LUFS</span>
        <button on:click={runSilenceScan} disabled={readOnly || !activeFileId}>
          Flag silence
        </button>
        <button on:click={() => runNormalize(true)} disabled={readOnly || !activeFileId}>
          Stage normalize
        </button>
        <button on:click={() => runNormalize(false)} disabled={readOnly || !activeFileId}>
          Commit normalize to {LIMITS.NORMALIZATION_LUFS} LUFS
        </button>
      </div>

      <div class="stack" style="gap: 0.2rem;">
        <span class="label">Preview queue ({previewCount})</span>
        <button on:click={onApplyPreviews} disabled={readOnly || previewCount === 0} class="primary">
          Apply staged
        </button>
        <button on:click={onDiscardPreviews} disabled={readOnly || previewCount === 0}>
          Discard staged
        </button>
        <button on:click={onRevertLast} disabled={readOnly || committedCount === 0}>
          Revert last committed
        </button>
      </div>
    </div>

    <div class="muted" style="margin-top: 0.5rem; font-size: 0.85rem;">
      Committed: {committedCount} · Staged preview: {previewCount} · Silence regions: {silenceRegions.length}
    </div>
  </div>

  <div class="card">
    <h4 style="margin-top: 0;">Markers ({markers.length}/{LIMITS.MAX_MARKERS_PER_PROJECT})</h4>
    <div class="row">
      <input
        bind:value={newMarkerNote}
        maxlength={LIMITS.MARKER_NOTE_MAX}
        placeholder="Marker note"
        disabled={readOnly}
      />
      <button
        class="primary"
        on:click={addMarker}
        disabled={readOnly || !newMarkerNote.trim() || !activeFileId}
      >
        Add marker at {formatTime(positionMs)}
      </button>
    </div>
    {#if markers.length > 0}
      <table class="table" style="margin-top: 0.5rem;">
        <thead>
          <tr>
            <th>Time</th>
            <th>Note</th>
            <th style="width: 1%;" />
          </tr>
        </thead>
        <tbody>
          {#each markers as m (m.id)}
            <tr>
              <td>{formatTime(m.timestampMs)}</td>
              <td>{m.note}</td>
              <td>
                <button class="danger" on:click={() => removeMarker(m.id)} disabled={readOnly}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<svelte:window on:resize={drawWaveform} />
