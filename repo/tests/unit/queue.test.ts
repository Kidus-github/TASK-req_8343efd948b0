import { describe, expect, it } from 'vitest';
import {
  isInQuietHours,
  pickNextJob,
  shouldReclaim
} from '../../src/lib/services/queue';
import type { Job } from '../../src/lib/types';

function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    type: 'export',
    inputRef: 'x',
    priority: 0,
    status: 'queued',
    createdAt: '2026-04-15T09:00:00.000Z',
    initialEstimateMs: 5000,
    runtimeMs: 0,
    attemptCount: 0,
    stallReclaimed: false,
    ...overrides
  };
}

describe('isInQuietHours', () => {
  it('returns false when start == end', () => {
    expect(isInQuietHours(new Date('2026-04-15T23:00:00Z'), '00:00', '00:00')).toBe(false);
  });
  it('wraps around midnight', () => {
    // quiet = 22:00-06:00
    const inside = new Date(2026, 3, 15, 23, 0, 0);
    const outside = new Date(2026, 3, 15, 10, 0, 0);
    expect(isInQuietHours(inside, '22:00', '06:00')).toBe(true);
    expect(isInQuietHours(outside, '22:00', '06:00')).toBe(false);
  });
});

describe('pickNextJob', () => {
  const opts = { quietStart: '00:00', quietEnd: '00:00', now: new Date('2026-04-15T12:00:00Z') };
  it('returns null on empty queue', () => {
    expect(pickNextJob([], opts)).toBeNull();
  });
  it('prefers higher priority', () => {
    const jobs = [
      baseJob({ id: 'a', priority: 1, initialEstimateMs: 10000 }),
      baseJob({ id: 'b', priority: 5, initialEstimateMs: 10000 })
    ];
    expect(pickNextJob(jobs, opts)?.id).toBe('b');
  });
  it('prefers shorter jobs when priority ties', () => {
    const jobs = [
      baseJob({ id: 'long', initialEstimateMs: 10000 }),
      baseJob({ id: 'short', initialEstimateMs: 2000 })
    ];
    expect(pickNextJob(jobs, opts)?.id).toBe('short');
  });
  it('defers heavy jobs during quiet hours unless allowed', () => {
    const quiet = {
      quietStart: '00:00',
      quietEnd: '23:59',
      now: new Date(2026, 3, 15, 12, 0, 0)
    };
    const jobs = [baseJob({ id: 'heavy', type: 'export' }), baseJob({ id: 'light', type: 'waveform' })];
    expect(pickNextJob(jobs, quiet)?.id).toBe('light');
    expect(pickNextJob(jobs, { ...quiet, allowHeavyInQuietHours: true })?.id).toBe('heavy');
  });
});

describe('shouldReclaim', () => {
  const base = baseJob({ status: 'running', startedAt: '2026-04-15T10:00:00.000Z', initialEstimateMs: 1000 });
  const now = Date.parse('2026-04-15T10:00:15.000Z'); // 15s after start, 2x threshold is 2s

  it('requires running/stalled status', () => {
    expect(shouldReclaim({ ...base, status: 'queued' }, now)).toBe(false);
  });
  it('requires stall threshold crossed', () => {
    expect(shouldReclaim({ ...base, initialEstimateMs: 60_000 }, now)).toBe(false);
  });
  it('reclaims when no heartbeat', () => {
    expect(shouldReclaim(base, now)).toBe(true);
  });
  it('reclaims when heartbeat older than reclaim window', () => {
    const j = { ...base, lastHeartbeatAt: '2026-04-15T10:00:00.500Z' }; // 14.5s ago
    expect(shouldReclaim(j, now)).toBe(true);
  });
  it('does not reclaim with fresh heartbeat', () => {
    const j = { ...base, lastHeartbeatAt: '2026-04-15T10:00:14.500Z' }; // 0.5s ago
    expect(shouldReclaim(j, now)).toBe(false);
  });
});
