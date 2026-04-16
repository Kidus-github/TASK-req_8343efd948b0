<script lang="ts">
  import { sidebarKey, uiRole, profile } from '$lib/stores/session';
  import { confirmModal } from '$lib/stores/modal';
  import { resetDeviceProfile } from '$lib/services/profile';
  import { pushToast } from '$lib/stores/toast';
  import type { SidebarKey } from '$lib/stores/session';

  type Item = {
    key: SidebarKey;
    label: string;
    visibleFor: Array<'editor' | 'reviewer' | 'operations'>;
  };

  const items: Item[] = [
    { key: 'projects', label: 'Projects', visibleFor: ['editor', 'reviewer', 'operations'] },
    { key: 'playlists', label: 'Playlists', visibleFor: ['editor', 'reviewer'] },
    { key: 'reports', label: 'Reports', visibleFor: ['editor', 'reviewer', 'operations'] },
    { key: 'cohorts', label: 'Cohorts', visibleFor: ['operations'] },
    { key: 'integration', label: 'Open Platform Kit', visibleFor: ['operations'] },
    { key: 'attendance', label: 'Attendance', visibleFor: ['operations'] },
    { key: 'preferences', label: 'Preferences', visibleFor: ['editor', 'reviewer', 'operations'] }
  ];

  $: visible = items.filter((i) => i.visibleFor.includes($uiRole));

  async function resetDevice(): Promise<void> {
    const ok = await confirmModal({
      title: 'Reset device profile?',
      message:
        'This irreversibly deletes your profile and all local data (projects, playlists, audio, snapshots, reports, cohorts, attendance).',
      confirmLabel: 'Reset device',
      destructive: true
    });
    if (!ok) return;
    await resetDeviceProfile();
    profile.set(null);
    pushToast('warning', 'Device profile reset.');
  }
</script>

<aside
  class="card"
  style="width: 220px; margin: 0; border-radius: 0; border-right: 1px solid var(--border); border-top: none; border-bottom: none; border-left: none; overflow-y: auto;"
>
  <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.8rem;">CleanWave</div>
  <div class="tag" style="margin-bottom: 1rem;">Offline Audio Prep</div>

  <nav class="stack">
    {#each visible as item (item.key)}
      <div
        class="sidebar-item {$sidebarKey === item.key ? 'active' : ''}"
        role="button"
        tabindex="0"
        on:click={() => sidebarKey.set(item.key)}
        on:keydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') sidebarKey.set(item.key);
        }}
      >
        {item.label}
      </div>
    {/each}
  </nav>

  <div class="divider" />
  <div class="tag">Signed in as</div>
  <div>{$profile?.username ?? '—'}</div>
  <div class="tag" style="margin-top: 0.4rem;">Role: {$uiRole}</div>

  <button style="margin-top: 1rem; width: 100%;" class="danger" on:click={resetDevice}>
    Reset device profile
  </button>
</aside>
