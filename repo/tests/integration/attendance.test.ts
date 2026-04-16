import { describe, expect, it } from 'vitest';
import {
  listMatches,
  recordMatch,
  resolveManually,
  startSession
} from '../../src/lib/services/attendance';

describe('attendance engine', () => {
  it('auto-accepts top-1 above threshold', async () => {
    const s = await startSession('batch', { topN: 3, confidenceThreshold: 0.7 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const r = await recordMatch(s.data.id, 'subj', [
      { ref: 'a', confidence: 0.9 },
      { ref: 'b', confidence: 0.6 },
      { ref: 'c', confidence: 0.4 }
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0].finalOutcome).toBe('auto_accepted');
    expect(r.data[1].finalOutcome).toBe('suggested');
  });

  it('routes to manual review when below threshold', async () => {
    const s = await startSession('batch', { topN: 2, confidenceThreshold: 0.9 });
    if (!s.ok) throw new Error('setup');
    const r = await recordMatch(s.data.id, 'subj', [
      { ref: 'a', confidence: 0.5 },
      { ref: 'b', confidence: 0.3 }
    ]);
    if (!r.ok) throw new Error('rec');
    expect(r.data.every((m) => m.finalOutcome === 'suggested')).toBe(true);
    const resolved = await resolveManually(r.data[0].id, 'accepted');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.data.manuallyResolved).toBe(true);
  });

  it('records no_match when candidate list is empty', async () => {
    const s = await startSession('batch');
    if (!s.ok) throw new Error('setup');
    const r = await recordMatch(s.data.id, 'subj', []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0].finalOutcome).toBe('no_match');

    const all = await listMatches(s.data.id);
    expect(all.length).toBe(1);
  });

  it('rejects invalid threshold and topN', async () => {
    const bad1 = await startSession('batch', { confidenceThreshold: 1.5 });
    expect(bad1.ok).toBe(false);
    const bad2 = await startSession('batch', { topN: 0 });
    expect(bad2.ok).toBe(false);
  });
});
