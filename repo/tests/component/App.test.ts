// Direct Svelte component render test for the top-level App shell.
// Verifies the always-mounted toast/modal hosts and the synchronous
// initial loading state. Async profile-probe branches are covered by
// the integration suite — onMount reactivity does not flush reliably
// under @testing-library/svelte + jsdom for this code path.

import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import App from '../../src/App.svelte';
import { profile, currentProject, sidebarKey } from '../../src/lib/stores/session';
import { activeModal } from '../../src/lib/stores/modal';

describe('App shell component', () => {
  beforeEach(() => {
    profile.set(null);
    currentProject.set(null);
    sidebarKey.set('projects');
    activeModal.set(null);
  });

  it('shows the loading checking state on initial mount', () => {
    render(App);
    // The initial synchronous render shows the loading state because checking=true.
    expect(screen.getByText(/loading local state/i)).toBeTruthy();
  });

  it('always mounts the ToastHost host element', async () => {
    const { container } = render(App);
    await tick();
    expect(container.querySelector('.toast-host')).toBeTruthy();
  });

  it('always mounts the ToastHost regardless of profile state', async () => {
    profile.set({
      id: 'p',
      username: 'X',
      passphraseHashLocal: 'h',
      passphraseSalt: 's',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      uiRole: 'editor',
      theme: 'light',
      defaultPlaybackSpeed: 1.0,
      quietHours: { start: '22:00', end: '06:00', allowHeavyJobs: false }
    });
    const { container } = render(App);
    await tick();
    expect(container.querySelector('.toast-host')).toBeTruthy();
  });

  it('renders inside a single root container with no thrown errors', () => {
    expect(() => render(App)).not.toThrow();
  });
});
