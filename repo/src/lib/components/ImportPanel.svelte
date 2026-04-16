<script lang="ts">
  import { onMount } from 'svelte';
  import { importBatch, listProjectFiles, type RawImportCandidate } from '$lib/services/imports';
  import type { ImportedAudioFile, ValidationError } from '$lib/types';
  import { pushToast } from '$lib/stores/toast';
  import { currentProject } from '$lib/stores/session';
  import { publishImportCompleted } from '$lib/stores/workspace';
  import { LIMITS } from '$lib/util/constants';

  export let projectId: string;

  let files: ImportedAudioFile[] = [];
  let rejected: Array<{ filename: string; errors: ValidationError[] }> = [];
  let dragActive = false;
  let importing = false;

  onMount(async () => {
    files = await listProjectFiles(projectId);
  });

  async function handleFiles(list: FileList | File[]): Promise<void> {
    if (importing) return;
    importing = true;
    try {
    const arr = Array.from(list);
    const candidates: RawImportCandidate[] = arr.map((f) => ({
      name: f.name,
      size: f.size,
      mimeType: f.type,
      data: f
    }));
    const res = await importBatch(projectId, candidates);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    rejected = res.data.rejected;
    files = await listProjectFiles(projectId);
    // Notify the rest of the workspace (notably the timeline editor) that
    // new files have been added to this project. Without this signal, an
    // already-open editor would not see the new files until the user
    // navigated away and back.
    publishImportCompleted(
      projectId,
      res.data.accepted.map((f) => f.id)
    );
    if (rejected.length > 0) {
      pushToast(
        'warning',
        `Imported ${res.data.accepted.length} file(s); ${rejected.length} rejected.`
      );
    } else {
      pushToast('success', `Imported ${res.data.accepted.length} file(s).`);
    }
    } finally {
      importing = false;
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragActive = false;
    if (e.dataTransfer?.files?.length) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    dragActive = true;
  }

  function onDragLeave(): void {
    dragActive = false;
  }

  function onBrowse(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) void handleFiles(input.files);
  }

  function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} B`;
  }
</script>

<div class="stack">
  <div
    class="card"
    role="region"
    aria-label="Drop audio files to import"
    on:drop={onDrop}
    on:dragover={onDragOver}
    on:dragleave={onDragLeave}
    style="border-style: dashed; background: {dragActive ? '#eef2ff' : 'var(--panel)'}; cursor: pointer;"
  >
    <h3 style="margin-top: 0;">
      Import audio
      {#if importing}<span class="pill warning" style="margin-left: 0.5rem;">Importing...</span>{/if}
    </h3>
    <p class="hint">
      Drop up to {LIMITS.MAX_FILES_PER_BATCH} files (mp3, wav, ogg). Combined max 2 GB.
      Invalid files are listed below with row-level errors; valid files are imported.
    </p>
    <input type="file" multiple accept=".mp3,.wav,.ogg" on:change={onBrowse} />
  </div>

  {#if rejected.length > 0}
    <div class="card">
      <h4 style="margin-top: 0;">Rejected rows</h4>
      <table class="table">
        <thead>
          <tr>
            <th>Filename</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {#each rejected as r}
            <tr>
              <td>{r.filename}</td>
              <td>
                {#each r.errors as e}
                  <div><span class="pill danger">{e.code}</span> {e.message}</div>
                {/each}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="card">
    <h4 style="margin-top: 0;">Imported files ({files.length})</h4>
    {#if files.length === 0}
      <p class="muted">No files yet.</p>
    {:else}
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Size</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each files as f (f.id)}
            <tr>
              <td>{f.originalFilename}</td>
              <td>{f.extension}</td>
              <td>{formatSize(f.sizeBytes)}</td>
              <td><span class="pill success">{f.importStatus}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
