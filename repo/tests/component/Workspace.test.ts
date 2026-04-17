// Direct Svelte component render test for Workspace.
// Verifies project header, tab switching, read-only state pill, and
// the Close button clears the current project store.

import { render, screen, fireEvent, within, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { describe, expect, it, beforeEach } from 'vitest';
import Workspace from '../../src/lib/components/Workspace.svelte';
import { currentProject, readOnly, tabId } from '../../src/lib/stores/session';
import type { Project } from '../../src/lib/types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-ws',
    name: 'Workspace Project',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    activeTab: 'edit',
    settings: {
      silenceThresholdDb: -35,
      silenceMinDurationSec: 0.6,
      normalizationLufs: -14,
      defaultFadeSec: 1.0
    },
    versionCounter: 1,
    ...overrides
  };
}

function tabBar(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.tab-bar');
  if (!el) throw new Error('tab-bar not found');
  return el as HTMLElement;
}

describe('Workspace component', () => {
  beforeEach(() => {
    currentProject.set(null);
    readOnly.set(false);
    tabId.set('tab-test-' + Math.random().toString(36).slice(2, 6));
  });

  it('renders the project name as the heading', async () => {
    const project = makeProject({ name: 'Pilot Project' });
    render(Workspace, { props: { project } });
    expect(screen.getByText('Pilot Project')).toBeTruthy();
  });

  it('renders Edit, Export, Reports tab buttons', () => {
    const { container } = render(Workspace, { props: { project: makeProject() } });
    const bar = tabBar(container);
    expect(within(bar).getByText('Edit')).toBeTruthy();
    expect(within(bar).getByText('Export')).toBeTruthy();
    expect(within(bar).getByText('Reports')).toBeTruthy();
  });

  it('starts on the project.activeTab tab and marks it active', async () => {
    const { container } = render(Workspace, { props: { project: makeProject({ activeTab: 'export' }) } });
    await tick();
    const bar = tabBar(container);
    const exportTab = within(bar).getByText('Export');
    expect(exportTab.className).toContain('active');
    const editTab = within(bar).getByText('Edit');
    expect(editTab.className).not.toContain('active');
  });

  it('clicking another tab marks it active', async () => {
    const { container } = render(Workspace, { props: { project: makeProject({ activeTab: 'edit' }) } });
    const bar = tabBar(container);
    await fireEvent.click(within(bar).getByText('Reports'));
    await tick();
    expect(within(bar).getByText('Reports').className).toContain('active');
    expect(within(bar).getByText('Edit').className).not.toContain('active');
  });

  it('shows the Read-only pill and a Request editor takeover button when readOnly', async () => {
    readOnly.set(true);
    render(Workspace, { props: { project: makeProject() } });
    await tick();
    // The Read-only pill renders at least once; child editor may also render its own.
    expect(screen.getAllByText('Read-only').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /request editor takeover/i })).toBeTruthy();
  });

  it('does not show the takeover button when not readOnly', () => {
    readOnly.set(false);
    render(Workspace, { props: { project: makeProject() } });
    expect(screen.queryByRole('button', { name: /request editor takeover/i })).toBeNull();
  });

  it('Close button clears the currentProject store', async () => {
    currentProject.set(makeProject());
    render(Workspace, { props: { project: makeProject() } });
    await fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    await waitFor(() => {
      expect(get(currentProject)).toBeNull();
    });
  });
});
