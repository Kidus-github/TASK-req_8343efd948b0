<script lang="ts">
  import { createProfile, getProfile, verifyPassphrase, resetDeviceProfile } from '$lib/services/profile';
  import { profile } from '$lib/stores/session';
  import { pushToast } from '$lib/stores/toast';
  import { confirmModal } from '$lib/stores/modal';
  import { validatePassphrase, validateUsername } from '$lib/util/validators';
  import type { UiRole } from '$lib/types';
  import { LIMITS } from '$lib/util/constants';

  export let mode: 'create' | 'unlock' = 'create';

  let username = '';
  let passphrase = '';
  let role: UiRole = 'editor';
  let error = '';

  $: usernameError = mode === 'create' ? validateUsername(username)?.message ?? '' : '';
  $: passphraseError = validatePassphrase(passphrase)?.message ?? '';

  async function submit(): Promise<void> {
    error = '';
    if (mode === 'create') {
      const res = await createProfile(username, passphrase, role);
      if (!res.ok) {
        error = res.message;
        return;
      }
      profile.set(res.data);
      pushToast('success', `Profile created for ${res.data.username}.`);
    } else {
      const res = await verifyPassphrase(passphrase);
      if (!res.ok) {
        error = res.message;
        return;
      }
      const p = await getProfile();
      if (p) profile.set(p);
      pushToast('success', `Welcome back, ${p?.username ?? 'local user'}.`);
    }
  }

  async function resetDevice(): Promise<void> {
    const ok = await confirmModal({
      title: 'Reset this device profile?',
      message:
        'This irreversibly deletes the local profile, projects, playlists, imported audio, snapshots, reports, cohorts, and attendance data from this browser.',
      confirmLabel: 'Reset device',
      destructive: true
    });
    if (!ok) return;
    await resetDeviceProfile();
    profile.set(null);
    username = '';
    passphrase = '';
    pushToast('warning', 'Device profile reset. Local data cleared.');
    mode = 'create';
  }
</script>

<div class="modal-backdrop" style="position: relative; min-height: 100vh; background: var(--bg);">
  <div class="modal" style="width: min(440px, 92vw); margin-top: 10vh;">
    <h3>
      {mode === 'create' ? 'Create your local profile' : 'Unlock CleanWave'}
    </h3>
    <p class="hint">
      This passphrase is a local convenience gate — not real authentication. It's
      validated only on this device.
    </p>

    {#if mode === 'create'}
      <label class="label" for="cw-username">Username</label>
      <input
        id="cw-username"
        bind:value={username}
        placeholder="e.g. Nova"
        maxlength={LIMITS.USERNAME_MAX}
      />
      {#if usernameError}
        <small style="color: var(--danger);">{usernameError}</small>
      {/if}
    {/if}

    <label class="label" for="cw-passphrase" style="margin-top: 0.75rem;">
      Passphrase (min {LIMITS.PASSPHRASE_MIN} chars, include a digit)
    </label>
    <input id="cw-passphrase" type="password" bind:value={passphrase} />
    {#if passphraseError}
      <small style="color: var(--danger);">{passphraseError}</small>
    {/if}

    {#if mode === 'create'}
      <label class="label" for="cw-role" style="margin-top: 0.75rem;">UI role</label>
      <select id="cw-role" bind:value={role}>
        <option value="editor">Editor — full editing &amp; export</option>
        <option value="reviewer">Reviewer — playback &amp; annotations</option>
        <option value="operations">Operations — reports, cohorts, integration</option>
      </select>
      <p class="hint">
        Role selection only affects visible menus. It's not a security boundary on
        a single local device.
      </p>
    {/if}

    {#if error}
      <p style="color: var(--danger); margin-top: 0.5rem;">{error}</p>
    {/if}

    <div class="row" style="justify-content: space-between; margin-top: 1rem;">
      <button on:click={resetDevice}>Reset this device profile</button>
      <button
        class="primary"
        on:click={submit}
        disabled={mode === 'create' ? Boolean(usernameError || passphraseError) : Boolean(passphraseError)}
      >
        {mode === 'create' ? 'Create profile' : 'Unlock'}
      </button>
    </div>
  </div>
</div>
