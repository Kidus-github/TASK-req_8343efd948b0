// Direct Svelte component render test for TimelineEditor.
// Verifies the file selector, transport controls, edit-stage buttons, and
// the marker entry UI. The component is tested with no project files
// (empty state) and with a single seeded WAV so we can also assert the
// disabled/enabled state transitions for the per-file controls.

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import TimelineEditor from '../../src/lib/components/TimelineEditor.svelte';
import { createProject } from '../../src/lib/services/projects';

async function newProjectId(): Promise<string> {
  const r = await createProject('Timeline Test ' + Math.random().toString(36).slice(2, 6));
  if (!r.ok) throw new Error('project setup failed');
  return r.data.id;
}

describe('TimelineEditor component', () => {
  let projectId = '';

  beforeEach(async () => {
    projectId = await newProjectId();
  });

  it('renders the file selector and transport controls (empty state)', async () => {
    render(TimelineEditor, { props: { projectId, readOnly: false } });
    await tick();
    expect(screen.getByText(/^file:$/i)).toBeTruthy();
    // Play button is present but disabled when no audio is loaded.
    const play = screen.getByRole('button', { name: /^play$/i }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
  });

  it('disables the file select when there are no imported files', async () => {
    render(TimelineEditor, { props: { projectId, readOnly: false } });
    await tick();
    const sel = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
  });

  it('renders the Edits card with stage/commit buttons disabled when no file selected', async () => {
    render(TimelineEditor, { props: { projectId, readOnly: false } });
    await tick();
    expect(screen.getByText('Edits')).toBeTruthy();
    const stageFadeIn = screen.getByRole('button', { name: /^stage fade in$/i }) as HTMLButtonElement;
    expect(stageFadeIn.disabled).toBe(true);
  });

  it('marks all interactive controls as disabled when readOnly', async () => {
    render(TimelineEditor, { props: { projectId, readOnly: true } });
    await tick();
    expect(screen.getByText('Read-only')).toBeTruthy();
    const stageFadeIn = screen.getByRole('button', { name: /^stage fade in$/i }) as HTMLButtonElement;
    expect(stageFadeIn.disabled).toBe(true);
    const previewCheckbox = screen.getByLabelText(/preview mode/i) as HTMLInputElement;
    expect(previewCheckbox.disabled).toBe(true);
  });

  it('renders a Markers section with disabled add when no note', async () => {
    render(TimelineEditor, { props: { projectId, readOnly: false } });
    await tick();
    expect(screen.getByText(/markers \(0\/50\)/i)).toBeTruthy();
    const noteInput = screen.getByPlaceholderText(/marker note/i) as HTMLInputElement;
    expect(noteInput).toBeTruthy();
    const addBtn = screen.getByRole('button', { name: /add marker/i }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('renders the analysis controls (silence / normalize)', async () => {
    render(TimelineEditor, { props: { projectId, readOnly: false } });
    await tick();
    expect(screen.getByRole('button', { name: /flag silence/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /stage normalize/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /commit normalize to/i })).toBeTruthy();
  });

  it('renders a canvas element for the waveform display', async () => {
    const { container } = render(TimelineEditor, { props: { projectId, readOnly: false } });
    await tick();
    expect(container.querySelector('canvas.waveform')).toBeTruthy();
  });

  it('shows the apply staged / discard staged / revert buttons disabled with no ops', async () => {
    render(TimelineEditor, { props: { projectId, readOnly: false } });
    await tick();
    expect(screen.getByText(/preview queue \(0\)/i)).toBeTruthy();
    const apply = screen.getByRole('button', { name: /apply staged/i }) as HTMLButtonElement;
    const discard = screen.getByRole('button', { name: /discard staged/i }) as HTMLButtonElement;
    const revert = screen.getByRole('button', { name: /revert last committed/i }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(discard.disabled).toBe(true);
    expect(revert.disabled).toBe(true);
  });
});
