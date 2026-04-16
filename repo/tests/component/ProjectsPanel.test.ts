// Direct Svelte component render test for ProjectsPanel.
// Mounts the real component, interacts with the create-project input,
// and asserts the rendered table row behavior.

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import ProjectsPanel from '../../src/lib/components/ProjectsPanel.svelte';

describe('ProjectsPanel component', () => {
  it('renders the Projects heading and create input', () => {
    render(ProjectsPanel);
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByPlaceholderText(/new project name/i)).toBeTruthy();
  });

  it('has a Create project button that is disabled when input is empty', () => {
    render(ProjectsPanel);
    const btn = screen.getByRole('button', { name: /create project/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables the Create button when text is entered', async () => {
    render(ProjectsPanel);
    const input = screen.getByPlaceholderText(/new project name/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Test Proj' } });
    const btn = screen.getByRole('button', { name: /create project/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates a project and shows it in the table', async () => {
    render(ProjectsPanel);
    const input = screen.getByPlaceholderText(/new project name/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Component Test' } });
    await fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    // The project should appear in the table after async refresh.
    await waitFor(() => {
      expect(screen.getByText('Component Test')).toBeTruthy();
    });
  });

  it('shows Open, Archive, and Delete buttons for each project row', async () => {
    render(ProjectsPanel);
    const input = screen.getByPlaceholderText(/new project name/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Btn Test' } });
    await fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => {
      expect(screen.getByText('Btn Test')).toBeTruthy();
    });
    // The row should have Open, Archive, Delete buttons.
    const row = screen.getByText('Btn Test').closest('tr');
    expect(row).toBeTruthy();
    const buttons = row!.querySelectorAll('button');
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).toContain('Open');
    expect(labels).toContain('Archive');
    expect(labels).toContain('Delete');
  });

  it('shows a filter dropdown with Active/Archived/All', () => {
    render(ProjectsPanel);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('active');
    expect(options).toContain('archived');
    expect(options).toContain('all');
  });
});
