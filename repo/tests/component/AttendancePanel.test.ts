// Direct Svelte component render test for AttendancePanel.
// Verifies the controls render, default top-N/threshold values, and
// that the Start session button is the visible action when no session
// is active.

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import AttendancePanel from '../../src/lib/components/AttendancePanel.svelte';
import { LIMITS } from '../../src/lib/util/constants';

describe('AttendancePanel component', () => {
  it('renders the Attendance heading', () => {
    render(AttendancePanel);
    expect(screen.getByText('Attendance')).toBeTruthy();
  });

  it('shows the on-device explanatory hint', () => {
    render(AttendancePanel);
    expect(screen.getByText(/on-device attendance/i)).toBeTruthy();
  });

  it('renders the Subjects card with a count of zero', () => {
    render(AttendancePanel);
    expect(screen.getByText(/subjects \(0\)/i)).toBeTruthy();
  });

  it('disables Capture from camera until camera is granted', () => {
    render(AttendancePanel);
    const btn = screen.getByRole('button', { name: /capture from camera/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows mode select with realtime and batch options', () => {
    render(AttendancePanel);
    const sel = screen.getAllByRole('combobox').find((s) => {
      const sel = s as HTMLSelectElement;
      return Array.from(sel.options).some((o) => o.value === 'realtime');
    }) as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain('realtime');
    expect(values).toContain('batch');
  });

  it('shows top-N input pre-filled with the default', () => {
    render(AttendancePanel);
    const input = screen.getByLabelText(/top-n/i) as HTMLInputElement;
    expect(Number(input.value)).toBe(LIMITS.ATTENDANCE_TOP_N_DEFAULT);
  });

  it('shows threshold input pre-filled with the default', () => {
    render(AttendancePanel);
    const input = screen.getByLabelText(/threshold/i) as HTMLInputElement;
    expect(Number(input.value)).toBe(LIMITS.ATTENDANCE_THRESHOLD_DEFAULT);
  });

  it('shows the Start session button when no session is running', () => {
    render(AttendancePanel);
    expect(screen.getByRole('button', { name: /start session/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /stop session/i })).toBeNull();
  });

  it('disables Request camera when mode is not realtime', async () => {
    render(AttendancePanel);
    const sel = screen.getAllByRole('combobox').find((s) => {
      const ss = s as HTMLSelectElement;
      return Array.from(ss.options).some((o) => o.value === 'realtime');
    }) as HTMLSelectElement;
    await fireEvent.change(sel, { target: { value: 'batch' } });
    await tick();
    const btn = screen.getByRole('button', { name: /request camera/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows a status pill about the model load state', async () => {
    render(AttendancePanel);
    await waitFor(() => {
      const successPill = screen.queryByText(/face recognition model loaded/i);
      const warningPill = screen.queryByText(/face recognition model not available/i);
      expect(successPill || warningPill).toBeTruthy();
    });
  });
});
