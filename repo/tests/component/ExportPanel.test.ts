// Direct Svelte component render test for ExportPanel.
// Verifies the rendered controls, the readOnly disabled state, and the
// cart-drawer open/close affordances against the real services + IndexedDB.

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import ExportPanel from '../../src/lib/components/ExportPanel.svelte';
import { createProject } from '../../src/lib/services/projects';
import { currentProject } from '../../src/lib/stores/session';
import type { Project } from '../../src/lib/types';

async function setupProject(): Promise<Project> {
  const r = await createProject('Export Test ' + Math.random().toString(36).slice(2, 6));
  if (!r.ok) throw new Error('project setup failed');
  return r.data;
}

describe('ExportPanel component', () => {
  let project: Project;

  beforeEach(async () => {
    project = await setupProject();
    currentProject.set(project);
  });

  it('renders the Export heading and description', () => {
    render(ExportPanel, { props: { projectId: project.id } });
    expect(screen.getByText('Export')).toBeTruthy();
    expect(screen.getByText(/batch up to/i)).toBeTruthy();
  });

  it('shows the format select with mp3 and wav options', () => {
    render(ExportPanel, { props: { projectId: project.id } });
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const fmt = selects.find((s) =>
      Array.from(s.options).some((o) => o.value === 'mp3') &&
      Array.from(s.options).some((o) => o.value === 'wav')
    );
    expect(fmt).toBeTruthy();
  });

  it('shows mp3 bitrate selector when format is mp3 (default)', async () => {
    render(ExportPanel, { props: { projectId: project.id } });
    await tick();
    expect(screen.getByText('Bitrate')).toBeTruthy();
  });

  it('hides mp3 bitrate selector when format is wav', async () => {
    render(ExportPanel, { props: { projectId: project.id } });
    await tick();
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const fmt = selects.find((s) =>
      Array.from(s.options).some((o) => o.value === 'mp3') &&
      Array.from(s.options).some((o) => o.value === 'wav')
    ) as HTMLSelectElement;
    await fireEvent.change(fmt, { target: { value: 'wav' } });
    await tick();
    expect(screen.queryByText('Bitrate')).toBeNull();
  });

  it('disables the Add to cart and Batch add buttons when readOnly', async () => {
    render(ExportPanel, { props: { projectId: project.id, readOnly: true } });
    await tick();
    const add = screen.getByRole('button', { name: /^add to cart$/i }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const batch = screen.getByRole('button', { name: /batch add/i }) as HTMLButtonElement;
    expect(batch.disabled).toBe(true);
  });

  it('disables the Open cart button when there are no items in the cart', () => {
    render(ExportPanel, { props: { projectId: project.id } });
    const btn = screen.getByRole('button', { name: /open cart/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows the source-file label, format label, and source-file selector', () => {
    render(ExportPanel, { props: { projectId: project.id } });
    expect(screen.getByText('Source file')).toBeTruthy();
    expect(screen.getAllByText('Format').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the batch-add card with format / bitrate controls', async () => {
    render(ExportPanel, { props: { projectId: project.id } });
    await tick();
    const heading = screen.getByText(/batch add all/i);
    expect(heading).toBeTruthy();
    // The split-by-all-bitrates checkbox is visible while a batch MP3 is selected.
    expect(screen.getByText(/split by all bitrates/i)).toBeTruthy();
  });

  it('renders three MP3 bitrate options matching the LIMITS list', () => {
    render(ExportPanel, { props: { projectId: project.id } });
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const bitrate = selects.find((s) =>
      Array.from(s.options).some((o) => o.value === '192') &&
      Array.from(s.options).some((o) => o.value === '128')
    ) as HTMLSelectElement;
    const values = Array.from(bitrate.options).map((o) => o.value);
    expect(values).toEqual(['128', '192', '320']);
  });
});
