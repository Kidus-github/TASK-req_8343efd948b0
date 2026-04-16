<script lang="ts">
  import { onMount } from 'svelte';
  import { generatePayload, listQuotas } from '$lib/services/integration';
  import type { IntegrationTokenQuota } from '$lib/types';
  import { pushToast } from '$lib/stores/toast';
  import { passphraseGate } from '$lib/util/passphraseGate';

  let tokenName = 'default';
  let type: 'rest' | 'graphql' | 'webhook' = 'rest';
  let path = '/v1/audio/process';
  let eventName = 'export.completed';
  let quotas: IntegrationTokenQuota[] = [];
  let lastContent = '';
  let folderHandle: FileSystemDirectoryHandle | null = null;

  onMount(async () => {
    quotas = await listQuotas();
  });

  async function onGenerate(): Promise<void> {
    const ok = await passphraseGate('generate an artifact');
    if (!ok) return;
    const fields: Record<string, unknown> =
      type === 'rest'
        ? { path, method: 'POST' }
        : type === 'webhook'
        ? { event: eventName }
        : {};
    const res = await generatePayload(tokenName, type, fields);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    lastContent = res.data.content;
    quotas = await listQuotas();
    if (folderHandle) {
      try {
        // File System Access API: write into chosen folder.
        // @ts-expect-error — not present in older TS DOM libs
        const fileHandle = await folderHandle.getFileHandle(res.data.artifact.filename, {
          create: true
        });
        // @ts-expect-error
        const writable = await fileHandle.createWritable();
        await writable.write(res.data.content);
        await writable.close();
        pushToast('success', `Wrote ${res.data.artifact.filename} to selected folder.`);
      } catch (err) {
        pushToast('error', `Folder write failed: ${(err as Error).message}`);
      }
    } else {
      pushToast('success', `Generated ${res.data.artifact.filename}.`);
    }
  }

  async function chooseFolder(): Promise<void> {
    // @ts-expect-error — File System Access API may be unavailable
    if (!window.showDirectoryPicker) {
      pushToast('warning', 'This browser does not support folder selection.');
      return;
    }
    // @ts-expect-error
    folderHandle = await window.showDirectoryPicker();
    pushToast('success', `Folder permission granted.`);
  }

  function download(): void {
    if (!lastContent) return;
    const blob = new Blob([lastContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `artifact-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="stack" style="max-width: 1000px;">
  <h2 style="margin: 0;">Open Platform Kit</h2>
  <p class="hint">
    Generate sample REST/GraphQL/webhook-style payloads locally. Artifacts are
    never transmitted.
  </p>

  <div class="card">
    <div class="row" style="flex-wrap: wrap; gap: 0.75rem;">
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Token</span>
        <input bind:value={tokenName} />
      </label>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Type</span>
        <select bind:value={type}>
          <option value="rest">REST</option>
          <option value="graphql">GraphQL</option>
          <option value="webhook">Webhook</option>
        </select>
      </label>
      {#if type === 'rest'}
        <label class="stack" style="gap: 0.2rem;">
          <span class="label">Path</span>
          <input bind:value={path} />
        </label>
      {/if}
      {#if type === 'webhook'}
        <label class="stack" style="gap: 0.2rem;">
          <span class="label">Event</span>
          <input bind:value={eventName} />
        </label>
      {/if}
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">&nbsp;</span>
        <button on:click={chooseFolder}>
          {folderHandle ? 'Folder: selected' : 'Choose folder'}
        </button>
      </div>
      <div class="stack" style="gap: 0.2rem;">
        <span class="label">&nbsp;</span>
        <button class="primary" on:click={onGenerate}>Generate</button>
      </div>
    </div>
  </div>

  {#if quotas.length > 0}
    <div class="card">
      <h4 style="margin-top: 0;">Quotas (today)</h4>
      <table class="table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Date</th>
            <th>Used</th>
            <th>Limit</th>
          </tr>
        </thead>
        <tbody>
          {#each quotas as q}
            <tr>
              <td>{q.tokenName}</td>
              <td>{q.dateKey}</td>
              <td>{q.usedCount}</td>
              <td>{q.dailyQuota}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if lastContent}
    <div class="card">
      <h4 style="margin-top: 0;">Generated artifact</h4>
      <pre style="background: #0f172a; color: #e2e8f0; padding: 0.8rem; border-radius: 6px; overflow: auto;">{lastContent}</pre>
      <button on:click={download}>Download</button>
    </div>
  {/if}
</div>
