// Direct Svelte component render test for PlaylistsPanel.
// Verifies the empty state, create flow with the real service, mode
// dropdown, and track-add flow against IndexedDB.

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import PlaylistsPanel from '../../src/lib/components/PlaylistsPanel.svelte';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';

async function seedFile(): Promise<void> {
  const r = await createProject('Playlist Test ' + Math.random().toString(36).slice(2, 6));
  if (!r.ok) return;
  await importBatch(r.data.id, [
    { name: 'song.mp3', size: 1024, mimeType: 'audio/mpeg', data: new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' }) }
  ]);
}

describe('PlaylistsPanel component', () => {
  beforeEach(async () => {
    await seedFile();
  });

  it('renders the Playlists heading and empty state', async () => {
    render(PlaylistsPanel);
    await waitFor(() => {
      expect(screen.getByText('Playlists')).toBeTruthy();
      expect(screen.getByText('No playlists yet.')).toBeTruthy();
    });
  });

  it('disables the Create button when input is empty', () => {
    render(PlaylistsPanel);
    const btn = screen.getByRole('button', { name: /^create$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables the Create button after typing a name', async () => {
    render(PlaylistsPanel);
    const input = screen.getByPlaceholderText(/new playlist name/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'My Mix' } });
    const btn = screen.getByRole('button', { name: /^create$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('creates a playlist and selects it as active', async () => {
    render(PlaylistsPanel);
    const input = screen.getByPlaceholderText(/new playlist name/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Morning Mix' } });
    await fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      // Active playlist heading appears.
      const headings = screen.getAllByText('Morning Mix');
      expect(headings.length).toBeGreaterThan(0);
    });
    // Tracks count starts at 0.
    expect(screen.getByText(/0 \/ 1000 tracks/i)).toBeTruthy();
  });

  it('shows playback mode select with three options', async () => {
    render(PlaylistsPanel);
    const input = screen.getByPlaceholderText(/new playlist name/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Modes Mix' } });
    await fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      const sel = screen.getAllByRole('combobox').find((s) => {
        const ss = s as HTMLSelectElement;
        return Array.from(ss.options).some((o) => o.value === 'shuffle');
      }) as HTMLSelectElement;
      expect(sel).toBeTruthy();
      const values = Array.from(sel.options).map((o) => o.value);
      expect(values).toEqual(['sequential', 'single-repeat', 'shuffle']);
    });
  });

  it('disables player controls when nothing is loaded', async () => {
    render(PlaylistsPanel);
    const input = screen.getByPlaceholderText(/new playlist name/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Empty Player' } });
    await fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await tick();
    const playBtn = (await screen.findByRole('button', { name: /▶ play/i })) as HTMLButtonElement;
    expect(playBtn.disabled).toBe(true);
    const stopBtn = (await screen.findByRole('button', { name: /⏹ stop/i })) as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(true);
  });

  it('renders the add-track UI (search input, file select, Add track button)', async () => {
    render(PlaylistsPanel);
    const input = screen.getByPlaceholderText(/new playlist name/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'UI Mix' } });
    await fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(
      () => {
        expect(screen.getByPlaceholderText('Note')).toBeTruthy();
        expect(screen.getByPlaceholderText(/search filename or note/i)).toBeTruthy();
        const matches = screen.getAllByRole('button')
          .filter((b) => /^add track$/i.test((b.textContent ?? '').trim()));
        expect(matches.length).toBeGreaterThan(0);
      },
      { timeout: 4000 }
    );
  });
});
