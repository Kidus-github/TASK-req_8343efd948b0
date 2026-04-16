<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    addCartItem,
    confirmCart,
    downloadCompletedItem,
    estimateCart,
    getOrCreateCart,
    listCartItems,
    removeCartItem,
    defaultFilename
  } from '$lib/services/exports';
  import { listProjectFiles } from '$lib/services/imports';
  import { enqueueJob, listJobs } from '$lib/services/queue';
  import { estimateRenderMs } from '$lib/util/estimates';
  import type { ExportCart, ExportCartItem, ImportedAudioFile, Job, Mp3Bitrate } from '$lib/types';
  import { pushToast } from '$lib/stores/toast';
  import { confirmModal } from '$lib/stores/modal';
  import { LIMITS } from '$lib/util/constants';
  import { currentProject } from '$lib/stores/session';

  export let projectId: string;
  export let readOnly = false;

  let cart: ExportCart | null = null;
  let items: ExportCartItem[] = [];
  let files: ImportedAudioFile[] = [];
  let jobs: Job[] = [];
  let drawerOpen = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  let sourceFileId = '';
  let format: 'mp3' | 'wav' = 'mp3';
  let bitrate: Mp3Bitrate = 192;

  let estimate = {
    totalBytes: 0,
    totalRuntimeMs: 0,
    hasUnknownDuration: false,
    perItem: [] as Array<{ id: string; sizeBytes: number; runtimeMs: number; label: string; durationKnown: boolean }>
  };
  /** In-flight guard for the export confirm action. Prevents double-submit. */
  let submitting = false;

  onMount(() => {
    void refresh();
    pollTimer = setInterval(() => void refresh(), 900);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  async function refresh(): Promise<void> {
    files = await listProjectFiles(projectId);
    if (files.length > 0 && !sourceFileId) sourceFileId = files[0].id;
    cart = await getOrCreateCart(projectId);
    items = await listCartItems(cart.id);
    estimate = await estimateCart(cart.id);
    jobs = await listJobs();
  }

  async function onAdd(): Promise<void> {
    if (!cart) return;
    const res = await addCartItem(cart.id, sourceFileId, format, format === 'mp3' ? bitrate : undefined);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    pushToast('success', 'Added to export cart.');
    await refresh();
  }

  // Batch mode state.
  let batchFormat: 'mp3' | 'wav' | 'both' = 'mp3';
  let batchBitrate: Mp3Bitrate = 192;
  let batchBitrates: Mp3Bitrate[] = [192];
  let batchAllBitrates = false;

  $: batchBitrates = batchAllBitrates ? [...LIMITS.MP3_BITRATES] : [batchBitrate];

  async function onBatchAdd(): Promise<void> {
    if (!cart) return;
    let added = 0;
    const formats: Array<{ fmt: 'mp3' | 'wav'; br?: Mp3Bitrate }> = [];
    if (batchFormat === 'wav' || batchFormat === 'both') formats.push({ fmt: 'wav' });
    if (batchFormat === 'mp3' || batchFormat === 'both') {
      for (const br of batchBitrates) formats.push({ fmt: 'mp3', br });
    }
    for (const f of files) {
      for (const spec of formats) {
        const res = await addCartItem(cart.id, f.id, spec.fmt, spec.br);
        if (res.ok) added++;
        if (!res.ok && res.code === 'EXPORT_CART_LIMIT_EXCEEDED') {
          pushToast('warning', `Cart is full (${LIMITS.MAX_EXPORT_CART_ITEMS} items). ${added} added before limit.`);
          await refresh();
          return;
        }
      }
    }
    pushToast('success', `Added ${added} item(s) to export cart.`);
    await refresh();
  }

  async function onRemove(id: string): Promise<void> {
    await removeCartItem(id);
    await refresh();
  }

  async function onConfirm(): Promise<void> {
    if (!cart) return;
    // UI-level guard: flip submitting BEFORE the awaited confirm modal so a
    // rapid second click on the primary button is rejected immediately.
    if (submitting) return;
    submitting = true;
    try {
      const okConfirm = await confirmModal({
        title: 'Confirm export?',
        message: `Export ${activeItems.length} item(s)? Estimated total: ${formatSize(estimate.totalBytes)}, ~${Math.round(estimate.totalRuntimeMs / 1000)}s.`,
        confirmLabel: 'Confirm'
      });
      if (!okConfirm) return;
      const res = await confirmCart(cart.id);
      if (!res.ok) {
        pushToast('error', res.message);
        return;
      }
      const toQueue = await listCartItems(cart.id);
      for (const i of toQueue.filter((x) => x.status === 'queued')) {
        const file = files.find((f) => f.id === i.sourceRef);
        const dur = file?.durationMs ?? 60_000;
        // Queue-level dedup: reject-by-return if a prior click for this item
        // is already in flight. enqueueJob returns the existing job rather
        // than creating a duplicate row.
        await enqueueJob(
          {
            type: 'export',
            inputRef: i.id,
            projectId,
            initialEstimateMs: estimateRenderMs(i.format, dur, i.bitrate)
          },
          { dedupeOnInputRef: true }
        );
      }
      pushToast('info', 'Export queued. Rendering will start in the background.');
      await refresh();
    } finally {
      submitting = false;
    }
  }

  async function onDownload(id: string): Promise<void> {
    const res = await downloadCompletedItem(id);
    if (!res.ok) pushToast('error', res.message);
  }

  function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} B`;
  }

  function preview(item: ExportCartItem): string {
    if (item.outputName) return item.outputName;
    const file = files.find((f) => f.id === item.sourceRef);
    if (!file) return item.id;
    return defaultFilename({
      projectName: $currentProject?.name ?? 'project',
      sourceFilename: file.originalFilename,
      format: item.format,
      bitrate: item.bitrate,
      sampleRate: item.sampleRate
    });
  }

  function statusLabel(item: ExportCartItem): { text: string; className: string } {
    switch (item.status) {
      case 'draft':
        return { text: 'draft', className: '' };
      case 'queued':
        return { text: 'queued', className: 'warning' };
      case 'rendering':
        return { text: 'rendering…', className: 'warning' };
      case 'completed':
        return { text: 'ready to download', className: 'success' };
      case 'failed':
        return { text: 'failed', className: 'danger' };
      case 'cancelled':
        return { text: 'cancelled', className: '' };
    }
  }

  $: activeItems = items.filter((i) => i.status !== 'cancelled');
  $: completedItems = items.filter((i) => i.status === 'completed');
  $: hasQueued = activeItems.some((i) => i.status === 'queued' || i.status === 'rendering');
</script>

<div class="stack">
  <div class="card">
    <div class="row">
      <h3 style="margin: 0;">Export</h3>
      <div class="grow" />
      <button on:click={() => (drawerOpen = true)} disabled={activeItems.length === 0 && completedItems.length === 0}>
        Open cart ({activeItems.length})
      </button>
    </div>
    <p class="hint">
      Batch up to {LIMITS.MAX_EXPORT_CART_ITEMS} items. Real MP3 (128/192/320 kbps) or WAV (44.1 kHz); rendering runs in a Web Worker.
    </p>

    <div class="row" style="gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem;">
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Source file</span>
        <select bind:value={sourceFileId} disabled={readOnly}>
          {#each files as f}<option value={f.id}>{f.originalFilename}</option>{/each}
        </select>
      </label>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Format</span>
        <select bind:value={format} disabled={readOnly}>
          <option value="mp3">MP3</option>
          <option value="wav">WAV (44.1 kHz)</option>
        </select>
      </label>
      {#if format === 'mp3'}
        <label class="stack" style="gap: 0.2rem;">
          <span class="label">Bitrate</span>
          <select bind:value={bitrate} disabled={readOnly}>
            {#each LIMITS.MP3_BITRATES as b}<option value={b}>{b} kbps</option>{/each}
          </select>
        </label>
      {/if}
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">&nbsp;</span>
        <button class="primary" on:click={onAdd} disabled={readOnly || !sourceFileId}>
          Add to cart
        </button>
      </div>
    </div>

    <div class="divider" />
    <h4 style="margin-top: 0;">Batch add all {files.length} files</h4>
    <div class="row" style="gap: 0.75rem; flex-wrap: wrap;">
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Format</span>
        <select bind:value={batchFormat} disabled={readOnly}>
          <option value="mp3">MP3 only</option>
          <option value="wav">WAV only</option>
          <option value="both">Both MP3 + WAV</option>
        </select>
      </label>
      {#if batchFormat !== 'wav'}
        <label class="stack" style="gap: 0.2rem;">
          <span class="label">MP3 bitrate</span>
          <select bind:value={batchBitrate} disabled={readOnly || batchAllBitrates}>
            {#each LIMITS.MP3_BITRATES as b}<option value={b}>{b} kbps</option>{/each}
          </select>
        </label>
        <label class="row" style="align-self: flex-end; gap: 0.3rem;">
          <input type="checkbox" bind:checked={batchAllBitrates} disabled={readOnly} />
          <span>Split by all bitrates (128/192/320)</span>
        </label>
      {/if}
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">&nbsp;</span>
        <button class="primary" on:click={onBatchAdd} disabled={readOnly || files.length === 0}>
          Batch add ({files.length} x {batchFormat === 'both' ? 'MP3+WAV' : batchFormat.toUpperCase()}{batchFormat !== 'wav' && batchAllBitrates ? ' x3 bitrates' : ''})
        </button>
      </div>
    </div>
  </div>

  {#if completedItems.length > 0}
    <div class="card">
      <h4 style="margin-top: 0;">Completed downloads</h4>
      <table class="table">
        <thead>
          <tr>
            <th>File</th>
            <th>Format</th>
            <th>Size</th>
            <th style="width: 1%;" />
          </tr>
        </thead>
        <tbody>
          {#each completedItems as i (i.id)}
            <tr>
              <td>{i.outputName ?? preview(i)}</td>
              <td>{i.format === 'mp3' ? `mp3 ${i.bitrate}kbps` : `wav ${i.sampleRate ?? 44100}Hz`}</td>
              <td>{formatSize(i.outputBytes ?? i.estimatedSizeBytes)}</td>
              <td><button class="primary" on:click={() => onDownload(i.id)}>Download</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if drawerOpen}
  <div class="modal-backdrop" on:click|self={() => (drawerOpen = false)}>
    <div class="drawer" role="dialog" aria-modal="true" on:click|stopPropagation>
      <div class="row">
        <h3 style="margin: 0;">Export Cart</h3>
        <div class="grow" />
        <button on:click={() => (drawerOpen = false)}>Close</button>
      </div>
      <div class="muted">
        {activeItems.length} / {LIMITS.MAX_EXPORT_CART_ITEMS} items.
        {#if hasQueued}<span class="pill warning">Rendering in background…</span>{/if}
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Format</th>
            <th>Est. size</th>
            <th>Status</th>
            <th style="width: 1%;" />
          </tr>
        </thead>
        <tbody>
          {#each activeItems as i (i.id)}
            {@const sl = statusLabel(i)}
            <tr>
              <td>{preview(i)}</td>
              <td>{i.format === 'mp3' ? `mp3 ${i.bitrate}kbps` : `wav ${i.sampleRate ?? 44100}Hz`}</td>
              <td>
                {#if i.outputBytes}
                  {formatSize(i.outputBytes)}
                {:else if i.estimatedSizeBytes > 0}
                  ~{formatSize(i.estimatedSizeBytes)}
                {:else}
                  <span class="muted">unknown</span>
                {/if}
              </td>
              <td><span class="pill {sl.className}">{sl.text}</span></td>
              <td>
                {#if i.status === 'completed'}
                  <button class="primary" on:click={() => onDownload(i.id)}>Download</button>
                {:else if i.status === 'draft'}
                  <button class="danger" on:click={() => onRemove(i.id)}>Remove</button>
                {:else}
                  <span class="tag">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <div class="divider" />
      {#if estimate.hasUnknownDuration}
        <div class="pill warning">
          One or more items have unknown duration — estimates below exclude them.
        </div>
      {/if}
      <div><strong>Total estimated size:</strong> {estimate.totalBytes > 0 ? formatSize(estimate.totalBytes) : 'unknown'}</div>
      <div><strong>Total estimated time:</strong> {estimate.totalRuntimeMs > 0 ? `${Math.round(estimate.totalRuntimeMs / 1000)}s` : 'unknown'}</div>
      <div class="row" style="justify-content: flex-end; margin-top: 0.5rem;">
        <button
          class="primary"
          on:click={onConfirm}
          disabled={
            submitting ||
            readOnly ||
            activeItems.filter((i) => i.status === 'draft').length === 0
          }
          aria-busy={submitting}
        >
          {submitting ? 'Submitting…' : 'Confirm & render'}
        </button>
      </div>
    </div>
  </div>
{/if}
