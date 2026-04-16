<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { currentProject, tabId, readOnly } from '$lib/stores/session';
  import {
    heartbeat,
    release,
    requestTakeover,
    subscribeLockEvents,
    tryAcquire
  } from '$lib/services/locks';
  import { latestRecoverable, restoreSnapshot, verifySnapshot } from '$lib/services/snapshots';
  import { workspaceRefreshBus } from '$lib/stores/workspace';
  import type { Project } from '$lib/types';
  import { pushToast } from '$lib/stores/toast';
  import { confirmModal } from '$lib/stores/modal';
  import { LIMITS } from '$lib/util/constants';
  import { updateProject } from '$lib/services/projects';
  import ImportPanel from './ImportPanel.svelte';
  import TimelineEditor from './TimelineEditor.svelte';
  import ExportPanel from './ExportPanel.svelte';
  import ReportsPanel from './ReportsPanel.svelte';

  export let project: Project;

  // Restore the tab the user last had open in this project.
  let tab: 'edit' | 'export' | 'reports' = project.activeTab ?? 'edit';

  function switchTab(t: typeof tab): void {
    tab = t;
    // Persist so it's restored on next project open.
    void updateProject(project.id, { activeTab: t });
  }
  let hbTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeLock: (() => void) | null = null;
  let peerWriterKnown = false;

  onMount(async () => {
    unsubscribeLock = subscribeLockEvents((ev) => {
      if (ev.projectId !== project.id) return;
      if (ev.tabId === $tabId) return;
      if (ev.kind === 'acquired') {
        if (!$readOnly) {
          // Someone else claimed the lock — drop to read-only and warn.
          readOnly.set(true);
          pushToast('warning', 'Another tab took the writable lock for this project. Now read-only.');
        } else {
          pushToast('info', 'Another tab is editing this project.');
        }
        peerWriterKnown = true;
      } else if (ev.kind === 'released') {
        peerWriterKnown = false;
        pushToast('info', 'The other tab released the lock. Reopen to regain write access.');
      } else if (ev.kind === 'takeover_request') {
        if (!$readOnly) {
          pushToast('warning', 'Another tab is requesting editor control for this project.');
        }
      }
    });

    const res = await tryAcquire(project.id, $tabId);
    if (!res.ok) {
      peerWriterKnown = true;
      const ok = await confirmModal({
        title: 'Open in read-only?',
        message: 'This project is open in another tab. Open read-only here?',
        confirmLabel: 'Open read-only',
        cancelLabel: 'Cancel'
      });
      if (!ok) {
        currentProject.set(null);
        return;
      }
      readOnly.set(true);
      pushToast('warning', 'Opened read-only.');
    } else {
      readOnly.set(false);
      hbTimer = setInterval(() => {
        heartbeat(project.id, $tabId).catch(() => {});
      }, LIMITS.LOCK_HEARTBEAT_MS);
    }

    // Offer recovery from last valid snapshot.
    const snap = await latestRecoverable(project.id);
    if (snap) {
      const valid = await verifySnapshot(snap);
      if (valid) {
        const ok = await confirmModal({
          title: 'Recover last snapshot?',
          message: `A recoverable snapshot is available from ${new Date(snap.createdAt).toLocaleString()}. Recovering overwrites the current operations and markers for this project.`,
          confirmLabel: 'Recover',
          cancelLabel: 'Skip'
        });
        if (ok) {
          const r = await restoreSnapshot(snap);
          if (!r.ok) {
            pushToast('error', `Restore failed: ${r.message}`);
          } else {
            pushToast(
              'success',
              `Restored ${r.data.operations.length} operation(s) and ${r.data.markers.length} marker(s).`
            );
            // Signal the active timeline editor to reload its state from DB.
            workspaceRefreshBus.update((n) => n + 1);
          }
        }
      }
    }
  });

  onDestroy(async () => {
    if (hbTimer) clearInterval(hbTimer);
    if (unsubscribeLock) unsubscribeLock();
    if (!$readOnly) {
      await release(project.id, $tabId).catch(() => {});
    }
  });

  async function onRequestTakeover(): Promise<void> {
    requestTakeover(project.id, $tabId);
    pushToast('info', 'Takeover requested. When the other tab closes, reopen the project here to edit.');
  }
</script>

<div class="stack" style="max-width: 1100px;">
  <div class="row">
    <h2 style="margin: 0;">{project.name}</h2>
    {#if $readOnly}
      <span class="pill warning">Read-only</span>
      <button on:click={onRequestTakeover}>Request editor takeover</button>
    {:else if peerWriterKnown}
      <span class="pill warning">Concurrent editor detected</span>
    {/if}
    <div class="grow" />
    <button on:click={() => currentProject.set(null)}>Close</button>
  </div>

  <div class="tab-bar">
    <div class="tab {tab === 'edit' ? 'active' : ''}" role="button" tabindex="0"
      on:click={() => switchTab('edit')}
      on:keydown={(e) => e.key === 'Enter' && switchTab('edit')}>Edit</div>
    <div class="tab {tab === 'export' ? 'active' : ''}" role="button" tabindex="0"
      on:click={() => switchTab('export')}
      on:keydown={(e) => e.key === 'Enter' && switchTab('export')}>Export</div>
    <div class="tab {tab === 'reports' ? 'active' : ''}" role="button" tabindex="0"
      on:click={() => switchTab('reports')}
      on:keydown={(e) => e.key === 'Enter' && switchTab('reports')}>Reports</div>
  </div>

  {#if tab === 'edit'}
    <ImportPanel projectId={project.id} />
    <TimelineEditor projectId={project.id} readOnly={$readOnly} />
  {:else if tab === 'export'}
    <ExportPanel projectId={project.id} readOnly={$readOnly} />
  {:else}
    <ReportsPanel />
  {/if}
</div>
