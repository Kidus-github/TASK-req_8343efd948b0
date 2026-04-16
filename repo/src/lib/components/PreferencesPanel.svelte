<script lang="ts">
  import { onMount } from 'svelte';
  import { profile } from '$lib/stores/session';
  import { updateProfile } from '$lib/services/profile';
  import { loadPrefs, savePrefs, type Preferences } from '$lib/db/prefs';
  import { pushToast } from '$lib/stores/toast';
  import { LIMITS } from '$lib/util/constants';

  let prefs: Preferences = loadPrefs();

  onMount(() => {
    prefs = loadPrefs();
    // Reflect profile-level values where available.
    if ($profile) {
      prefs = {
        ...prefs,
        theme: $profile.theme ?? prefs.theme,
        defaultPlaybackSpeed: $profile.defaultPlaybackSpeed ?? prefs.defaultPlaybackSpeed,
        uiRole: $profile.uiRole ?? prefs.uiRole,
        quietHours: $profile.quietHours ?? prefs.quietHours
      };
    }
  });

  async function persist(): Promise<void> {
    savePrefs(prefs);
    document.documentElement.dataset.theme = prefs.theme;
    if ($profile) {
      const res = await updateProfile({
        theme: prefs.theme,
        defaultPlaybackSpeed: prefs.defaultPlaybackSpeed,
        uiRole: prefs.uiRole,
        quietHours: prefs.quietHours
      });
      if (res.ok) profile.set(res.data);
    }
    pushToast('success', 'Preferences saved.');
  }
</script>

<div class="stack" style="max-width: 720px;">
  <h2 style="margin: 0;">Preferences</h2>
  <p class="hint">
    Lightweight preferences live in LocalStorage. Role, theme, and quiet hours are
    mirrored into the DeviceProfile so they persist in IndexedDB as well.
  </p>

  <div class="card">
    <label class="label" for="pref-theme">Theme</label>
    <select id="pref-theme" bind:value={prefs.theme}>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>

    <label class="label" style="margin-top: 0.75rem;" for="pref-speed">
      Default playback speed ({LIMITS.SPEED_MIN}×..{LIMITS.SPEED_MAX}×)
    </label>
    <input
      id="pref-speed"
      type="number"
      min={LIMITS.SPEED_MIN}
      max={LIMITS.SPEED_MAX}
      step={LIMITS.SPEED_STEP}
      bind:value={prefs.defaultPlaybackSpeed}
    />

    <label class="label" style="margin-top: 0.75rem;" for="pref-role">UI role</label>
    <select id="pref-role" bind:value={prefs.uiRole}>
      <option value="editor">Editor</option>
      <option value="reviewer">Reviewer</option>
      <option value="operations">Operations</option>
    </select>

    <div class="row" style="gap: 0.5rem; margin-top: 0.75rem;">
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Quiet hours start</span>
        <input type="time" bind:value={prefs.quietHours.start} />
      </label>
      <label class="stack" style="gap: 0.2rem;">
        <span class="label">Quiet hours end</span>
        <input type="time" bind:value={prefs.quietHours.end} />
      </label>
      <label class="row" style="align-self: flex-end; gap: 0.3rem;">
        <input type="checkbox" bind:checked={prefs.quietHours.allowHeavyJobs} />
        <span>Allow heavy exports during quiet hours</span>
      </label>
    </div>

    <div class="divider" />
    <button class="primary" on:click={persist}>Save preferences</button>
  </div>
</div>
