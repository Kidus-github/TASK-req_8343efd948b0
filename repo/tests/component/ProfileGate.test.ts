// Direct Svelte component render test for ProfileGate.
// Uses @testing-library/svelte to mount the real component in jsdom
// and assert visible UI behavior + conditional states.

import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ProfileGate from '../../src/lib/components/ProfileGate.svelte';

describe('ProfileGate component', () => {
  it('renders the create-profile heading in create mode', () => {
    render(ProfileGate, { props: { mode: 'create' } });
    expect(screen.getByText('Create your local profile')).toBeTruthy();
  });

  it('renders the unlock heading in unlock mode', () => {
    render(ProfileGate, { props: { mode: 'unlock' } });
    expect(screen.getByText('Unlock CleanWave')).toBeTruthy();
  });

  it('shows username field only in create mode', () => {
    const { unmount } = render(ProfileGate, { props: { mode: 'create' } });
    expect(screen.getByLabelText(/username/i)).toBeTruthy();
    unmount();
    render(ProfileGate, { props: { mode: 'unlock' } });
    expect(screen.queryByLabelText(/username/i)).toBeNull();
  });

  it('shows role selector only in create mode', () => {
    render(ProfileGate, { props: { mode: 'create' } });
    expect(screen.getByLabelText(/ui role/i)).toBeTruthy();
  });

  it('always shows the passphrase field', () => {
    render(ProfileGate, { props: { mode: 'create' } });
    expect(screen.getByLabelText(/passphrase/i)).toBeTruthy();
  });

  it('shows a convenience-gate disclaimer', () => {
    render(ProfileGate, { props: { mode: 'create' } });
    expect(screen.getByText(/convenience gate/i)).toBeTruthy();
  });

  it('disables the submit button when passphrase is empty', () => {
    render(ProfileGate, { props: { mode: 'create' } });
    const btn = screen.getByRole('button', { name: /create profile/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows passphrase validation error when input is too short', async () => {
    render(ProfileGate, { props: { mode: 'create' } });
    // Use the explicit id since the label text matches multiple elements.
    const input = document.getElementById('cw-passphrase') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'abc' } });
    expect(screen.getByText(/at least 8/i)).toBeTruthy();
  });

  it('shows passphrase digit error when no digit is present', async () => {
    render(ProfileGate, { props: { mode: 'create' } });
    const input = document.getElementById('cw-passphrase') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'abcdefghi' } });
    // The validation error is rendered in a <small> tag.
    const smalls = document.querySelectorAll('small');
    const hasDigitError = Array.from(smalls).some((el) => /digit/i.test(el.textContent ?? ''));
    expect(hasDigitError).toBe(true);
  });

  it('has a Reset this device profile button', () => {
    render(ProfileGate, { props: { mode: 'create' } });
    expect(screen.getByRole('button', { name: /reset this device profile/i })).toBeTruthy();
  });
});
