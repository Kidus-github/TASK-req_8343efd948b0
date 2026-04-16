// Multi-tab coordination e2e: only one writable tab can hold the lock.
// Second tab must fall back to read-only; lock release allows reacquisition.

import { describe, expect, it } from 'vitest';
import { newTabId, release, tryAcquire } from '../../src/lib/services/locks';
import { createProject } from '../../src/lib/services/projects';

describe('multi-tab lock e2e', () => {
  it('second tab blocks, first releases, second acquires', async () => {
    const p = await createProject('MultiTab');
    if (!p.ok) throw new Error('setup');
    const tab1 = newTabId();
    const tab2 = newTabId();
    expect((await tryAcquire(p.data.id, tab1)).ok).toBe(true);
    const blocked = await tryAcquire(p.data.id, tab2);
    expect(blocked.ok).toBe(false);
    await release(p.data.id, tab1);
    expect((await tryAcquire(p.data.id, tab2)).ok).toBe(true);
  });
});
