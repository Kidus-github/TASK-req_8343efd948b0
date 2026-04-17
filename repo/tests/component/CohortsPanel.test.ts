// Direct Svelte component render test for CohortsPanel.
// Verifies the entity selector, strict toggle, and that the import button
// is correctly disabled until CSV text is entered.

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import CohortsPanel from '../../src/lib/components/CohortsPanel.svelte';

describe('CohortsPanel component', () => {
  it('renders the Cohorts heading and explanation', () => {
    render(CohortsPanel);
    expect(screen.getByText('Cohorts')).toBeTruthy();
    expect(screen.getByText(/bulk import\/export cohort records/i)).toBeTruthy();
  });

  it('lists all six cohort entity options in the selector', () => {
    render(CohortsPanel);
    const sel = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toEqual([
      'organizations',
      'programs',
      'classGroups',
      'rolePositions',
      'cohortWindows',
      'cohortMemberships'
    ]);
  });

  it('renders a Strict checkbox unchecked by default', () => {
    render(CohortsPanel);
    const cb = screen.getByLabelText(/strict/i) as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it('renders a CSV textarea and a disabled Import button when empty', () => {
    const { container } = render(CohortsPanel);
    expect(container.querySelector('textarea')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /^import$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables Import once CSV text is entered', async () => {
    const { container } = render(CohortsPanel);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    await fireEvent.input(ta, { target: { value: 'canonicalId,name\nacme,Acme\n' } });
    await tick();
    const btn = screen.getByRole('button', { name: /^import$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('renders the export button labelled with the active entity', async () => {
    render(CohortsPanel);
    expect(screen.getByRole('button', { name: /export organizations csv/i })).toBeTruthy();
    const sel = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    await fireEvent.change(sel, { target: { value: 'programs' } });
    await tick();
    expect(screen.getByRole('button', { name: /export programs csv/i })).toBeTruthy();
  });

  it('shows the last accepted count starting at 0', () => {
    render(CohortsPanel);
    expect(screen.getByText(/last accepted: 0/i)).toBeTruthy();
  });

  it('does not render the Row errors card on initial mount', () => {
    const { container } = render(CohortsPanel);
    const headings = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent);
    expect(headings).not.toContain('Row errors');
  });
});
