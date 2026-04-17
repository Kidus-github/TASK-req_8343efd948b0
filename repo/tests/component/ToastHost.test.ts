// Direct Svelte component render test for ToastHost.
// Verifies that toasts pushed via the toast store render with the correct
// kind classNames and aria-live container.

import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import ToastHost from '../../src/lib/components/ToastHost.svelte';
import { toasts, pushToast } from '../../src/lib/stores/toast';

describe('ToastHost component', () => {
  beforeEach(() => {
    toasts.set([]);
  });

  it('renders an empty toast-host with aria-live polite by default', () => {
    const { container } = render(ToastHost);
    const host = container.querySelector('.toast-host');
    expect(host).toBeTruthy();
    expect(host!.getAttribute('aria-live')).toBe('polite');
    expect(host!.getAttribute('role')).toBe('status');
    expect(host!.children.length).toBe(0);
  });

  it('renders one toast per entry in the store', async () => {
    const { container } = render(ToastHost);
    toasts.set([
      { id: 't1', kind: 'info', message: 'Hello', durationMs: 1000 },
      { id: 't2', kind: 'success', message: 'Done', durationMs: 1000 }
    ]);
    await tick();
    const items = container.querySelectorAll('.toast');
    expect(items.length).toBe(2);
    expect(items[0].textContent?.trim()).toBe('Hello');
    expect(items[1].textContent?.trim()).toBe('Done');
  });

  it('applies the kind class to each toast', async () => {
    const { container } = render(ToastHost);
    toasts.set([
      { id: 'a', kind: 'error', message: 'Oops', durationMs: 1000 },
      { id: 'b', kind: 'warning', message: 'Careful', durationMs: 1000 }
    ]);
    await tick();
    const items = container.querySelectorAll('.toast');
    expect(items[0].className).toContain('error');
    expect(items[1].className).toContain('warning');
  });

  it('reactively renders new toasts when pushToast is called', async () => {
    const { container } = render(ToastHost);
    pushToast('success', 'Saved!', 5000);
    await tick();
    const items = container.querySelectorAll('.toast');
    expect(items.length).toBe(1);
    expect(items[0].textContent?.trim()).toBe('Saved!');
    expect(items[0].className).toContain('success');
  });
});
