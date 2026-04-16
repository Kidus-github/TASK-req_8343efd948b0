import { describe, expect, it } from 'vitest';
import { heartbeat, inspect, newTabId, release, tryAcquire } from '../../src/lib/services/locks';
import { createProject } from '../../src/lib/services/projects';

describe('project locks', () => {
  it('first tab acquires, second tab cannot write', async () => {
    const p = await createProject('Locks');
    if (!p.ok) throw new Error('setup');
    const tabA = newTabId();
    const tabB = newTabId();

    const a = await tryAcquire(p.data.id, tabA);
    expect(a.ok).toBe(true);
    const b = await tryAcquire(p.data.id, tabB);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('PROJECT_LOCK_ACTIVE');

    const hb = await heartbeat(p.data.id, tabA);
    expect(hb.ok).toBe(true);

    const rel = await release(p.data.id, tabA);
    expect(rel.ok).toBe(true);
    const after = await inspect(p.data.id);
    expect(after).toBeUndefined();
  });

  it('reacquire by the same tab is idempotent', async () => {
    const p = await createProject('LocksIdem');
    if (!p.ok) throw new Error('setup');
    const tab = newTabId();
    const a = await tryAcquire(p.data.id, tab);
    expect(a.ok).toBe(true);
    const a2 = await tryAcquire(p.data.id, tab);
    expect(a2.ok).toBe(true);
  });
});
