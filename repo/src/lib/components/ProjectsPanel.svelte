<script lang="ts">
  import { onMount } from 'svelte';
  import {
    archiveProject,
    createProject,
    deleteProject,
    listProjects,
    restoreProject
  } from '$lib/services/projects';
  import type { Project } from '$lib/types';
  import { currentProject } from '$lib/stores/session';
  import { pushToast } from '$lib/stores/toast';
  import { confirmModal } from '$lib/stores/modal';

  let projects: Project[] = [];
  let newName = '';
  let filter: 'active' | 'archived' | 'all' = 'active';

  async function refresh(): Promise<void> {
    const list = await listProjects();
    projects = list.filter((p) => p.status !== 'deleted');
  }

  onMount(refresh);

  async function onCreate(): Promise<void> {
    const res = await createProject(newName);
    if (!res.ok) {
      pushToast('error', res.message);
      return;
    }
    pushToast('success', `Project "${res.data.name}" created.`);
    newName = '';
    currentProject.set(res.data);
    await refresh();
  }

  async function onArchive(p: Project): Promise<void> {
    const res = await archiveProject(p.id);
    if (!res.ok) pushToast('error', res.message);
    else pushToast('info', `Archived "${p.name}".`);
    await refresh();
  }

  async function onRestore(p: Project): Promise<void> {
    const res = await restoreProject(p.id);
    if (!res.ok) pushToast('error', res.message);
    else pushToast('info', `Restored "${p.name}".`);
    await refresh();
  }

  async function onDelete(p: Project): Promise<void> {
    const ok = await confirmModal({
      title: `Delete project "${p.name}"?`,
      message:
        'This deletes the project and all of its imports, edits, markers, snapshots, and export history.',
      confirmLabel: 'Delete',
      destructive: true
    });
    if (!ok) return;
    const res = await deleteProject(p.id);
    if (!res.ok) pushToast('error', res.message);
    else pushToast('warning', `Deleted "${p.name}".`);
    await refresh();
  }

  $: visible = projects.filter((p) => {
    if (filter === 'all') return true;
    return p.status === filter;
  });
</script>

<div class="stack" style="max-width: 960px;">
  <div class="row">
    <h2 style="margin: 0;">Projects</h2>
    <div class="grow" />
    <select bind:value={filter}>
      <option value="active">Active</option>
      <option value="archived">Archived</option>
      <option value="all">All</option>
    </select>
  </div>

  <div class="card">
    <div class="row">
      <input
        placeholder="New project name"
        bind:value={newName}
        on:keydown={(e) => {
          if (e.key === 'Enter') onCreate();
        }}
      />
      <button class="primary" on:click={onCreate} disabled={!newName.trim()}>
        Create project
      </button>
    </div>
  </div>

  <div class="card">
    {#if visible.length === 0}
      <p class="muted">No projects in this filter.</p>
    {:else}
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Updated</th>
            <th style="width: 1%;" />
          </tr>
        </thead>
        <tbody>
          {#each visible as p (p.id)}
            <tr>
              <td><strong>{p.name}</strong></td>
              <td>
                <span class="pill {p.status === 'active' ? 'success' : p.status === 'archived' ? 'warning' : ''}">
                  {p.status}
                </span>
              </td>
              <td class="muted">{new Date(p.updatedAt).toLocaleString()}</td>
              <td style="white-space: nowrap;">
                <button on:click={() => currentProject.set(p)}>Open</button>
                {#if p.status === 'active'}
                  <button on:click={() => onArchive(p)}>Archive</button>
                {:else if p.status === 'archived'}
                  <button on:click={() => onRestore(p)}>Restore</button>
                {/if}
                <button class="danger" on:click={() => onDelete(p)}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
