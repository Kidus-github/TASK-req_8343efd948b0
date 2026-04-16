import { describe, expect, it } from 'vitest';
import { createMarker, deleteMarker, listMarkers, updateMarker } from '../../src/lib/services/markers';
import { createProject } from '../../src/lib/services/projects';
import { LIMITS } from '../../src/lib/util/constants';

describe('markers', () => {
  it('creates, lists, updates, and deletes', async () => {
    const p = await createProject('Markers');
    if (!p.ok) throw new Error('setup');
    const m = await createMarker(p.data.id, 1000, 'chapter 1', undefined, 10000);
    expect(m.ok).toBe(true);
    if (!m.ok) return;

    const list1 = await listMarkers(p.data.id);
    expect(list1.length).toBe(1);

    const upd = await updateMarker(m.data.id, { note: 'chapter one' });
    expect(upd.ok).toBe(true);

    await deleteMarker(m.data.id);
    const list2 = await listMarkers(p.data.id);
    expect(list2.length).toBe(0);
  });

  it('enforces 50 marker cap', async () => {
    const p = await createProject('CapMarkers');
    if (!p.ok) throw new Error('setup');
    for (let i = 0; i < LIMITS.MAX_MARKERS_PER_PROJECT; i++) {
      const r = await createMarker(p.data.id, i * 100, `note ${i}`, undefined, 60_000);
      expect(r.ok).toBe(true);
    }
    const over = await createMarker(p.data.id, 999, 'too many', undefined, 60_000);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('MARKER_LIMIT_EXCEEDED');
  });

  it('rejects out-of-range timestamps', async () => {
    const p = await createProject('RangeMarkers');
    if (!p.ok) throw new Error('setup');
    const bad = await createMarker(p.data.id, 10_001, 'past', undefined, 10_000);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('MARKER_TIMESTAMP_OUT_OF_RANGE');
  });
});
