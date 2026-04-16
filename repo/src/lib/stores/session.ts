// Session-level Svelte stores: current profile, selected project, UI role,
// active sidebar section, active tab.

import { writable, derived } from 'svelte/store';
import type { DeviceProfile, Project, UiRole } from '../types';

export type SidebarKey = 'projects' | 'playlists' | 'reports' | 'cohorts' | 'integration' | 'attendance' | 'preferences';
export type TabKey = 'edit' | 'export' | 'reports';

export const profile = writable<DeviceProfile | null>(null);
export const currentProject = writable<Project | null>(null);
export const sidebarKey = writable<SidebarKey>('projects');
export const tabKey = writable<TabKey>('edit');
export const tabId = writable<string>('tab-' + Math.random().toString(36).slice(2, 8));
export const readOnly = writable<boolean>(false);

export const uiRole = derived(profile, ($p) => ($p?.uiRole ?? 'editor') as UiRole);
