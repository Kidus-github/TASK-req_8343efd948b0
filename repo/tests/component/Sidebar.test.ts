// Direct Svelte component render test for Sidebar.
// Verifies role-based visibility, navigation clicks, signed-in display,
// and reset device button wiring.

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { describe, expect, it, beforeEach } from 'vitest';
import Sidebar from '../../src/lib/components/Sidebar.svelte';
import { profile, sidebarKey } from '../../src/lib/stores/session';
import { activeModal } from '../../src/lib/stores/modal';
import type { DeviceProfile } from '../../src/lib/types';

function makeProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    id: 'prof-test',
    username: 'TestUser',
    passphraseHashLocal: 'x',
    passphraseSalt: 'y',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    uiRole: 'editor',
    theme: 'light',
    defaultPlaybackSpeed: 1.0,
    quietHours: { start: '22:00', end: '06:00', allowHeavyJobs: false },
    ...overrides
  };
}

describe('Sidebar component', () => {
  beforeEach(() => {
    profile.set(null);
    sidebarKey.set('projects');
    activeModal.set(null);
  });

  it('shows the CleanWave brand and tagline', () => {
    render(Sidebar);
    expect(screen.getByText('CleanWave')).toBeTruthy();
    expect(screen.getByText('Offline Audio Prep')).toBeTruthy();
  });

  it('shows editor-visible items for the editor role', () => {
    profile.set(makeProfile({ uiRole: 'editor' }));
    render(Sidebar);
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Playlists')).toBeTruthy();
    expect(screen.getByText('Reports')).toBeTruthy();
    expect(screen.getByText('Preferences')).toBeTruthy();
    expect(screen.queryByText('Cohorts')).toBeNull();
    expect(screen.queryByText('Open Platform Kit')).toBeNull();
    expect(screen.queryByText('Attendance')).toBeNull();
  });

  it('shows operations-only items for the operations role', () => {
    profile.set(makeProfile({ uiRole: 'operations' }));
    render(Sidebar);
    expect(screen.getByText('Cohorts')).toBeTruthy();
    expect(screen.getByText('Open Platform Kit')).toBeTruthy();
    expect(screen.getByText('Attendance')).toBeTruthy();
    expect(screen.queryByText('Playlists')).toBeNull();
  });

  it('hides cohorts/integration/attendance from reviewer role', () => {
    profile.set(makeProfile({ uiRole: 'reviewer' }));
    render(Sidebar);
    expect(screen.getByText('Playlists')).toBeTruthy();
    expect(screen.queryByText('Cohorts')).toBeNull();
    expect(screen.queryByText('Open Platform Kit')).toBeNull();
    expect(screen.queryByText('Attendance')).toBeNull();
  });

  it('shows the signed-in username and role', () => {
    profile.set(makeProfile({ username: 'Alice', uiRole: 'reviewer' }));
    render(Sidebar);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText(/role: reviewer/i)).toBeTruthy();
  });

  it('shows em dash for username when no profile set', () => {
    profile.set(null);
    render(Sidebar);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('clicking a sidebar item updates the sidebarKey store', async () => {
    profile.set(makeProfile({ uiRole: 'editor' }));
    render(Sidebar);
    await fireEvent.click(screen.getByText('Reports'));
    expect(get(sidebarKey)).toBe('reports');
    await fireEvent.click(screen.getByText('Preferences'));
    expect(get(sidebarKey)).toBe('preferences');
  });

  it('keydown Enter on a sidebar item also activates it', async () => {
    profile.set(makeProfile({ uiRole: 'editor' }));
    render(Sidebar);
    const playlists = screen.getByText('Playlists');
    await fireEvent.keyDown(playlists, { key: 'Enter' });
    expect(get(sidebarKey)).toBe('playlists');
  });

  it('marks the active item with the active class', async () => {
    profile.set(makeProfile({ uiRole: 'editor' }));
    sidebarKey.set('reports');
    render(Sidebar);
    await tick();
    const reports = screen.getByText('Reports');
    expect(reports.className).toContain('active');
    const projects = screen.getByText('Projects');
    expect(projects.className).not.toContain('active');
  });

  it('Reset device profile button opens a confirm modal', async () => {
    profile.set(makeProfile({ uiRole: 'editor' }));
    render(Sidebar);
    await fireEvent.click(screen.getByRole('button', { name: /reset device profile/i }));
    const m = get(activeModal);
    expect(m).not.toBeNull();
    expect(m!.kind).toBe('confirm');
    // Cancel so the rest of the suite stays clean.
    (m as { resolve: (v: boolean) => void }).resolve(false);
    activeModal.set(null);
  });
});
