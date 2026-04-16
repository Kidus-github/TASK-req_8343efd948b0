// LocalStorage preferences layer. Contains only small, non-sensitive preferences.
// Authoritative data lives in IndexedDB. This file intentionally has a tiny surface.

const KEY = 'cleanwave.prefs.v1';

export interface Preferences {
  theme: 'light' | 'dark';
  defaultPlaybackSpeed: number;
  quietHours: { start: string; end: string; allowHeavyJobs: boolean };
  uiRole: 'editor' | 'reviewer' | 'operations';
  showDisclaimer: boolean;
}

const DEFAULT: Preferences = {
  theme: 'light',
  defaultPlaybackSpeed: 1.0,
  quietHours: { start: '22:00', end: '06:00', allowHeavyJobs: false },
  uiRole: 'editor',
  showDisclaimer: true
};

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function loadPrefs(): Preferences {
  if (!hasLocalStorage()) return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT, ...parsed };
  } catch {
    return { ...DEFAULT };
  }
}

export function savePrefs(p: Preferences): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage pressure - ignore; caller should surface a warning.
  }
}

export function resetPrefs(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function defaultPrefs(): Preferences {
  return { ...DEFAULT };
}
