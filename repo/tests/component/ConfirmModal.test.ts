// Direct Svelte component render test for ConfirmModal.
// Renders the real component and asserts the three modal variants
// (confirm, prompt, select) show the correct UI elements.

import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ConfirmModal from '../../src/lib/components/ConfirmModal.svelte';
import { activeModal } from '../../src/lib/stores/modal';

describe('ConfirmModal component', () => {
  it('renders nothing when activeModal is null', () => {
    activeModal.set(null);
    const { container } = render(ConfirmModal);
    expect(container.querySelector('.modal')).toBeNull();
  });

  it('renders confirm variant with title, message, and two buttons', () => {
    activeModal.set({
      kind: 'confirm',
      opts: { title: 'Delete project?', message: 'This cannot be undone.' },
      resolve: () => {}
    });
    render(ConfirmModal);
    expect(screen.getByText('Delete project?')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy();
    activeModal.set(null);
  });

  it('renders prompt variant with an input field', () => {
    activeModal.set({
      kind: 'prompt',
      opts: { title: 'Enter passphrase', placeholder: 'Your passphrase' },
      resolve: () => {}
    });
    render(ConfirmModal);
    expect(screen.getByText('Enter passphrase')).toBeTruthy();
    expect(screen.getByPlaceholderText('Your passphrase')).toBeTruthy();
    activeModal.set(null);
  });

  it('renders select variant with a dropdown', () => {
    activeModal.set({
      kind: 'select',
      opts: {
        title: 'Pick a file',
        options: [
          { value: 'a', label: 'File A' },
          { value: 'b', label: 'File B' }
        ]
      },
      resolve: () => {}
    });
    render(ConfirmModal);
    expect(screen.getByText('Pick a file')).toBeTruthy();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    activeModal.set(null);
  });

  it('confirm Cancel button calls resolve(false)', async () => {
    let resolved: boolean | null = null;
    activeModal.set({
      kind: 'confirm',
      opts: { title: 'Sure?', message: 'Really?' },
      resolve: (v: boolean) => { resolved = v; }
    });
    render(ConfirmModal);
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(resolved).toBe(false);
  });

  it('confirm Confirm button calls resolve(true)', async () => {
    let resolved: boolean | null = null;
    activeModal.set({
      kind: 'confirm',
      opts: { title: 'Sure?', message: 'Really?' },
      resolve: (v: boolean) => { resolved = v; }
    });
    render(ConfirmModal);
    await fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(resolved).toBe(true);
  });
});
