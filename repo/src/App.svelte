<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ToastHost from '$lib/components/ToastHost.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import ProfileGate from '$lib/components/ProfileGate.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import ProjectsPanel from '$lib/components/ProjectsPanel.svelte';
  import PlaylistsPanel from '$lib/components/PlaylistsPanel.svelte';
  import ReportsPanel from '$lib/components/ReportsPanel.svelte';
  import CohortsPanel from '$lib/components/CohortsPanel.svelte';
  import IntegrationPanel from '$lib/components/IntegrationPanel.svelte';
  import AttendancePanel from '$lib/components/AttendancePanel.svelte';
  import PreferencesPanel from '$lib/components/PreferencesPanel.svelte';
  import Workspace from '$lib/components/Workspace.svelte';
  import { profile, currentProject, sidebarKey } from '$lib/stores/session';
  import { getProfile, hasProfile, updateProfile } from '$lib/services/profile';
  import { getProject } from '$lib/services/projects';
  import { loadPrefs, savePrefs } from '$lib/db/prefs';
  import { startWorkerPool, stopWorkerPool } from '$lib/audio/workerPool';

  let checking = true;
  let gateMode: 'create' | 'unlock' = 'create';

  onMount(async () => {
    // Apply persisted theme before first paint.
    const prefs = loadPrefs();
    document.documentElement.dataset.theme = prefs.theme;
    if (await hasProfile()) {
      gateMode = 'unlock';
      const existing = await getProfile();
      if (existing) {
        sidebarKey.set('projects');
        profile.set(null); // require passphrase unlock
      }
    }
    checking = false;
    await startWorkerPool();
  });

  onDestroy(() => stopWorkerPool());

  // When profile becomes available, restore last-opened project if any.
  let restoredOnce = false;
  $: if ($profile && !restoredOnce) {
    restoredOnce = true;
    const lastId = $profile.lastOpenedProjectId;
    if (lastId) {
      void getProject(lastId).then((p) => {
        if (p && p.status !== 'deleted') currentProject.set(p);
      });
    }
  }

  // Persist last-opened project id into the profile.
  $: if ($profile && $currentProject && $profile.lastOpenedProjectId !== $currentProject.id) {
    const pid = $currentProject.id;
    void updateProfile({ lastOpenedProjectId: pid }).then((res) => {
      if (res.ok) profile.set(res.data);
    });
  }

  // Keep preferences store in sync when profile is created.
  $: if ($profile) {
    const prefs = loadPrefs();
    savePrefs({
      ...prefs,
      theme: $profile.theme ?? prefs.theme,
      defaultPlaybackSpeed: $profile.defaultPlaybackSpeed ?? prefs.defaultPlaybackSpeed,
      quietHours: $profile.quietHours ?? prefs.quietHours,
      uiRole: $profile.uiRole ?? prefs.uiRole
    });
    document.documentElement.dataset.theme = $profile.theme ?? prefs.theme;
  }
</script>

<ToastHost />
<ConfirmModal />

{#if checking}
  <div class="modal-backdrop" style="position: relative;"><p>Loading local state…</p></div>
{:else if !$profile}
  <ProfileGate mode={gateMode} />
{:else if $currentProject}
  <div style="display: flex; height: 100vh;">
    <Sidebar />
    <main style="flex: 1; overflow: auto; padding: 1.2rem;">
      <Workspace project={$currentProject} />
    </main>
  </div>
{:else}
  <div style="display: flex; height: 100vh;">
    <Sidebar />
    <main style="flex: 1; overflow: auto; padding: 1.2rem;">
      {#if $sidebarKey === 'projects'}
        <ProjectsPanel />
      {:else if $sidebarKey === 'playlists'}
        <PlaylistsPanel />
      {:else if $sidebarKey === 'reports'}
        <ReportsPanel />
      {:else if $sidebarKey === 'cohorts'}
        <CohortsPanel />
      {:else if $sidebarKey === 'integration'}
        <IntegrationPanel />
      {:else if $sidebarKey === 'attendance'}
        <AttendancePanel />
      {:else if $sidebarKey === 'preferences'}
        <PreferencesPanel />
      {/if}
    </main>
  </div>
{/if}
