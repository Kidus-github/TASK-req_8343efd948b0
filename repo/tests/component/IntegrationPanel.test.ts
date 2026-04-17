// Direct Svelte component render test for IntegrationPanel.
// Verifies the type-conditional fields, the choose-folder button, and
// the absence of quotas / artifact panels on initial render.

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import IntegrationPanel from '../../src/lib/components/IntegrationPanel.svelte';

describe('IntegrationPanel component', () => {
  beforeEach(() => {
    // Clear FS Access API hint between tests.
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it('renders the Open Platform Kit heading', () => {
    render(IntegrationPanel);
    expect(screen.getByText('Open Platform Kit')).toBeTruthy();
  });

  it('renders the explanatory hint about offline-only artifacts', () => {
    render(IntegrationPanel);
    expect(screen.getByText(/never transmitted/i)).toBeTruthy();
  });

  it('renders the Token, Type, and Path inputs by default (REST)', () => {
    render(IntegrationPanel);
    expect(screen.getByText('Token')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('Path')).toBeTruthy();
  });

  it('switches Path -> Event when the type is set to webhook', async () => {
    render(IntegrationPanel);
    const typeSelect = screen.getAllByRole('combobox').find((s) => {
      const sel = s as HTMLSelectElement;
      return Array.from(sel.options).some((o) => o.value === 'rest');
    }) as HTMLSelectElement;
    await fireEvent.change(typeSelect, { target: { value: 'webhook' } });
    await tick();
    expect(screen.getByText('Event')).toBeTruthy();
    expect(screen.queryByText('Path')).toBeNull();
  });

  it('hides both Path and Event fields when type is graphql', async () => {
    render(IntegrationPanel);
    const typeSelect = screen.getAllByRole('combobox').find((s) => {
      const sel = s as HTMLSelectElement;
      return Array.from(sel.options).some((o) => o.value === 'rest');
    }) as HTMLSelectElement;
    await fireEvent.change(typeSelect, { target: { value: 'graphql' } });
    await tick();
    expect(screen.queryByText('Path')).toBeNull();
    expect(screen.queryByText('Event')).toBeNull();
  });

  it('shows a Choose folder button by default and a Generate button', () => {
    render(IntegrationPanel);
    expect(screen.getByRole('button', { name: /choose folder/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^generate$/i })).toBeTruthy();
  });

  it('does not render the Generated artifact card on initial mount', () => {
    const { container } = render(IntegrationPanel);
    const headings = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent);
    expect(headings).not.toContain('Generated artifact');
  });
});
