import { describe, expect, it } from 'vitest';
import {
  createSnapshot,
  latestRecoverable,
  listSnapshots,
  verifySnapshot
} from '../../src/lib/services/snapshots';
import { createProject } from '../../src/lib/services/projects';
import { LIMITS } from '../../src/lib/util/constants';

describe('snapshots', () => {
  it('creates, verifies, and prunes old snapshots', async () => {
    const p = await createProject('Snap');
    if (!p.ok) throw new Error('setup');
    for (let i = 0; i < LIMITS.RECOVERABLE_SNAPSHOTS + 2; i++) {
      await createSnapshot(p.data.id, 'autosave', { ops: i });
    }
    const all = await listSnapshots(p.data.id);
    const valid = all.filter((s) => s.state === 'valid' && s.isRecoverable);
    expect(valid.length).toBe(LIMITS.RECOVERABLE_SNAPSHOTS);

    const latest = await latestRecoverable(p.data.id);
    expect(latest).toBeDefined();
    if (latest) {
      const good = await verifySnapshot(latest);
      expect(good).toBe(true);
    }
  });

  it('detects tampered snapshots', async () => {
    const p = await createProject('Tamper');
    if (!p.ok) throw new Error('setup');
    const s = await createSnapshot(p.data.id, 'manual', { x: 1 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const tampered = { ...s.data, projectStateBlob: { x: 999 } };
    expect(await verifySnapshot(tampered)).toBe(false);
  });
});
