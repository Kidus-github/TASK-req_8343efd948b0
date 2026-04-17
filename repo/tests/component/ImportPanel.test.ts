// Direct Svelte component render test for ImportPanel.
// Verifies the drop card, file input, empty/imported file table, and
// rendering of rejected rows after a real importBatch call.

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import ImportPanel from '../../src/lib/components/ImportPanel.svelte';
import { createProject } from '../../src/lib/services/projects';

async function newProjectId(): Promise<string> {
  const r = await createProject('Import Test Project ' + Math.random().toString(36).slice(2, 6));
  if (!r.ok) throw new Error('project setup failed');
  return r.data.id;
}

describe('ImportPanel component', () => {
  let projectId = '';

  beforeEach(async () => {
    projectId = await newProjectId();
  });

  it('renders the import card with heading and hint text', () => {
    render(ImportPanel, { props: { projectId } });
    expect(screen.getByText('Import audio')).toBeTruthy();
    expect(screen.getByText(/drop up to/i)).toBeTruthy();
  });

  it('renders a file input that accepts mp3, wav, ogg', () => {
    const { container } = render(ImportPanel, { props: { projectId } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('.mp3');
    expect(input.accept).toContain('.wav');
    expect(input.accept).toContain('.ogg');
  });

  it('shows the empty-state message when there are no imported files', async () => {
    render(ImportPanel, { props: { projectId } });
    await tick();
    expect(screen.getByText(/imported files \(0\)/i)).toBeTruthy();
    expect(screen.getByText(/no files yet/i)).toBeTruthy();
  });

  it('does not show a rejected-rows card on initial render', () => {
    const { container } = render(ImportPanel, { props: { projectId } });
    const headings = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent);
    expect(headings).not.toContain('Rejected rows');
  });

  it('drag over toggles the dragActive style on the drop zone', async () => {
    const { container } = render(ImportPanel, { props: { projectId } });
    const card = container.querySelector('[role="region"]') as HTMLElement;
    expect(card).toBeTruthy();
    const baseline = card.style.background;
    await fireEvent.dragOver(card);
    expect(card.style.background).not.toBe(baseline);
    // jsdom normalizes hex to rgb; assert on the normalized form.
    expect(card.style.background).toContain('238');
    await fireEvent.dragLeave(card);
    expect(card.style.background).toBe(baseline);
  });

  it('lists imported files after a successful import', async () => {
    const { container } = render(ImportPanel, { props: { projectId } });
    await tick();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(2048)], 'demo.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    await fireEvent.change(input);
    await waitFor(() => {
      expect(screen.getByText('demo.mp3')).toBeTruthy();
    });
    expect(screen.getByText(/imported files \(1\)/i)).toBeTruthy();
  });

  it('lists rejected rows for unsupported extensions in a partial-success batch', async () => {
    const { container } = render(ImportPanel, { props: { projectId } });
    await tick();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const good = new File([new Uint8Array(2048)], 'good.mp3', { type: 'audio/mpeg' });
    const bad = new File([new Uint8Array(64)], 'bad.flac', { type: 'audio/flac' });
    Object.defineProperty(input, 'files', { value: [good, bad] });
    await fireEvent.change(input);
    await waitFor(
      () => {
        expect(screen.getByText('Rejected rows')).toBeTruthy();
        expect(screen.getByText('bad.flac')).toBeTruthy();
      },
      { timeout: 4000 }
    );
  });
});
