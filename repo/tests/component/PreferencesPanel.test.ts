// Direct Svelte component render test for PreferencesPanel.
// Verifies the controls render with their labels and that Save Preferences
// writes to LocalStorage and updates the document theme dataset.

import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import PreferencesPanel from '../../src/lib/components/PreferencesPanel.svelte';
import { profile } from '../../src/lib/stores/session';
import { resetPrefs, loadPrefs } from '../../src/lib/db/prefs';

describe('PreferencesPanel component', () => {
  beforeEach(() => {
    profile.set(null);
    resetPrefs();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the Preferences heading and explanatory hint', () => {
    render(PreferencesPanel);
    expect(screen.getByText('Preferences')).toBeTruthy();
    expect(screen.getByText(/lightweight preferences live in localstorage/i)).toBeTruthy();
  });

  it('renders the theme select with light and dark options', () => {
    render(PreferencesPanel);
    const sel = screen.getByLabelText(/theme/i) as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain('light');
    expect(values).toContain('dark');
  });

  it('renders the default playback speed input', () => {
    render(PreferencesPanel);
    const input = screen.getByLabelText(/default playback speed/i) as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(Number(input.min)).toBeGreaterThan(0);
  });

  it('renders the UI role select with editor/reviewer/operations', () => {
    render(PreferencesPanel);
    const role = screen.getByLabelText(/ui role/i) as HTMLSelectElement;
    const values = Array.from(role.options).map((o) => o.value);
    expect(values).toContain('editor');
    expect(values).toContain('reviewer');
    expect(values).toContain('operations');
  });

  it('renders the quiet hours start/end and allowHeavyJobs checkbox', () => {
    render(PreferencesPanel);
    expect(screen.getByText('Quiet hours start')).toBeTruthy();
    expect(screen.getByText('Quiet hours end')).toBeTruthy();
    expect(screen.getByText(/allow heavy exports/i)).toBeTruthy();
  });

  it('Save preferences persists changes to LocalStorage and updates dataset.theme', async () => {
    render(PreferencesPanel);
    const themeSelect = screen.getByLabelText(/theme/i) as HTMLSelectElement;
    await fireEvent.change(themeSelect, { target: { value: 'dark' } });
    await fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
    expect(loadPrefs().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('toggling the allow-heavy-jobs checkbox is reflected in saved prefs', async () => {
    render(PreferencesPanel);
    const cb = screen.getByLabelText(/allow heavy exports/i) as HTMLInputElement;
    expect(cb.checked).toBe(false);
    await fireEvent.click(cb);
    await fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
    expect(loadPrefs().quietHours.allowHeavyJobs).toBe(true);
  });
});
