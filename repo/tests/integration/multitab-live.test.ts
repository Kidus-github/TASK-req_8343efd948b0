// Live multi-tab coordination via BroadcastChannel: a subscriber receives
// 'acquired' / 'released' events from other tabs in real time.

import { describe, expect, it } from 'vitest';
import { newTabId, release, subscribeLockEvents, tryAcquire } from '../../src/lib/services/locks';
import { createProject } from '../../src/lib/services/projects';

describe('BroadcastChannel live coordination', () => {
  it('delivers acquired event to other subscribers', async () => {
    const p = await createProject('Live');
    if (!p.ok) throw new Error('setup');
    const tabA = newTabId();
    const tabB = newTabId();

    const events: Array<{ kind: string; tabId: string }> = [];
    const unsub = subscribeLockEvents((ev) => {
      if (ev.projectId !== p.data.id) return;
      events.push({ kind: ev.kind, tabId: ev.tabId });
    });

    await tryAcquire(p.data.id, tabA);
    // Allow microtasks to flush any async listeners.
    await Promise.resolve();

    expect(events.find((e) => e.kind === 'acquired' && e.tabId === tabA)).toBeTruthy();

    await release(p.data.id, tabA);
    await Promise.resolve();
    expect(events.find((e) => e.kind === 'released' && e.tabId === tabA)).toBeTruthy();

    // Second tab acquires, original subscriber still receives.
    await tryAcquire(p.data.id, tabB);
    await Promise.resolve();
    expect(events.filter((e) => e.kind === 'acquired').length).toBeGreaterThanOrEqual(2);

    unsub();
  });

  it('unsubscribe stops delivering further events', async () => {
    const p = await createProject('LiveUnsub');
    if (!p.ok) throw new Error('setup');
    const tab = newTabId();

    let count = 0;
    const unsub = subscribeLockEvents(() => {
      count++;
    });
    await tryAcquire(p.data.id, tab);
    await Promise.resolve();
    const baseline = count;
    unsub();
    await release(p.data.id, tab);
    await Promise.resolve();
    expect(count).toBe(baseline);
  });
});
