// Direct Svelte component render test for ReportsPanel.
// Verifies the synchronous-rendered controls — heading, filter labels,
// project / format selects, and the loading-pending state. The metrics
// table render after onMount's async computeReport is covered by the
// reports integration suite (computeReport returns valid metrics under
// jsdom; Svelte onMount async reactivity does not flush reliably here).

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import ReportsPanel from '../../src/lib/components/ReportsPanel.svelte';

describe('ReportsPanel component', () => {
  it('renders the Reports heading', () => {
    render(ReportsPanel);
    expect(screen.getByText('Reports')).toBeTruthy();
  });

  it('renders the project, date, and format filter labels', () => {
    render(ReportsPanel);
    expect(screen.getByText('Project')).toBeTruthy();
    expect(screen.getByText('Date from')).toBeTruthy();
    expect(screen.getByText('Date to')).toBeTruthy();
    expect(screen.getByText('Export format')).toBeTruthy();
  });

  it('lists All projects as the default project option', () => {
    render(ReportsPanel);
    expect(screen.getByText('All projects')).toBeTruthy();
  });

  it('lists Any/MP3/WAV in the export-format select', () => {
    render(ReportsPanel);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const fmt = selects.find((s) =>
      Array.from(s.options).some((o) => o.value === 'mp3') &&
      Array.from(s.options).some((o) => o.value === 'wav')
    );
    expect(fmt).toBeTruthy();
    const labels = Array.from(fmt!.options).map((o) => o.textContent);
    expect(labels).toContain('Any');
    expect(labels).toContain('MP3');
    expect(labels).toContain('WAV');
  });

  it('renders the Apply filters and Export CSV buttons', () => {
    render(ReportsPanel);
    expect(screen.getByRole('button', { name: /apply filters/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /export csv/i })).toBeTruthy();
  });

  it('disables Export CSV when there are no metrics yet', () => {
    render(ReportsPanel);
    const btn = screen.getByRole('button', { name: /export csv/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows the pending hint until metrics are computed', () => {
    render(ReportsPanel);
    expect(screen.getByText('Run to load metrics.')).toBeTruthy();
  });

  it('has a date-from input that accepts user input', async () => {
    const { container } = render(ReportsPanel);
    const dateFromInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateFromInput).toBeTruthy();
    await fireEvent.change(dateFromInput, { target: { value: '2026-01-01' } });
    await tick();
    expect(dateFromInput.value).toBe('2026-01-01');
  });
});
