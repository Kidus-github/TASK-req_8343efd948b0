// Preferences round-trip: LocalStorage + DeviceProfile.

import { describe, expect, it, beforeEach } from 'vitest';
import { defaultPrefs, loadPrefs, resetPrefs, savePrefs } from '../../src/lib/db/prefs';
import { createProfile, updateProfile, getProfile } from '../../src/lib/services/profile';

beforeEach(() => {
  resetPrefs();
});

describe('LocalStorage preferences', () => {
  it('loads defaults when nothing is stored', () => {
    const p = loadPrefs();
    expect(p.theme).toBe('light');
    expect(p.defaultPlaybackSpeed).toBe(1.0);
    expect(p.quietHours.allowHeavyJobs).toBe(false);
  });

  it('persists overrides', () => {
    const d = defaultPrefs();
    savePrefs({ ...d, theme: 'dark', defaultPlaybackSpeed: 1.5 });
    const r = loadPrefs();
    expect(r.theme).toBe('dark');
    expect(r.defaultPlaybackSpeed).toBe(1.5);
  });

  it('reset clears stored preferences', () => {
    savePrefs({ ...defaultPrefs(), theme: 'dark' });
    resetPrefs();
    expect(loadPrefs().theme).toBe('light');
  });
});

describe('DeviceProfile preferences', () => {
  it('updateProfile persists last-opened project + theme + speed', async () => {
    const c = await createProfile('U', 'passw0rd1');
    expect(c.ok).toBe(true);
    const upd = await updateProfile({
      lastOpenedProjectId: 'proj-x',
      theme: 'dark',
      defaultPlaybackSpeed: 1.5,
      quietHours: { start: '23:00', end: '05:00', allowHeavyJobs: true }
    });
    expect(upd.ok).toBe(true);
    const r = await getProfile();
    expect(r?.lastOpenedProjectId).toBe('proj-x');
    expect(r?.theme).toBe('dark');
    expect(r?.defaultPlaybackSpeed).toBe(1.5);
    expect(r?.quietHours.allowHeavyJobs).toBe(true);
  });
});
