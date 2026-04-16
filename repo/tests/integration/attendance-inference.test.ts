// Real attendance inference: featureFromImageData / luminance + cosine
// similarity correctly ranks an enrolled subject when given a close query.

import { describe, expect, it } from 'vitest';
import {
  FEATURE_DIM,
  FEATURE_GRID,
  featureFromLuminance,
  rankCandidates,
  similarity,
  enrollSubjectFromFeature,
  listSubjects,
  toConfidence
} from '../../src/lib/attendance/inference';
import {
  recordMatchFromFeature,
  startSession,
  listMatches
} from '../../src/lib/services/attendance';
import type { AttendanceSubject } from '../../src/lib/types';

function gridAt(rowVal: (r: number, c: number) => number): Float32Array {
  const v = new Float32Array(FEATURE_DIM);
  for (let r = 0; r < FEATURE_GRID; r++) {
    for (let c = 0; c < FEATURE_GRID; c++) {
      v[r * FEATURE_GRID + c] = rowVal(r, c);
    }
  }
  return v;
}

describe('attendance inference math', () => {
  it('feature vectors are L2-normalized (||v|| ≈ 1) after extraction', () => {
    const raw = gridAt((r, c) => (r + c) / (FEATURE_GRID * 2));
    const f = featureFromLuminance(raw);
    let norm = 0;
    for (let i = 0; i < f.length; i++) norm += f[i] * f[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it('identical inputs produce similarity = 1 → confidence = 1', () => {
    const a = featureFromLuminance(gridAt((r, c) => r + c));
    const b = featureFromLuminance(gridAt((r, c) => r + c));
    expect(similarity(a, b)).toBeCloseTo(1, 5);
    expect(toConfidence(similarity(a, b))).toBeCloseTo(1, 5);
  });

  it('different gradients produce lower similarity', () => {
    const enrolled = featureFromLuminance(gridAt((r, c) => r + c)); // diagonal gradient
    const close = featureFromLuminance(gridAt((r, c) => r + c + 0.01)); // small noise
    const far = featureFromLuminance(gridAt((_, c) => c * 5)); // very different pattern
    expect(similarity(enrolled, close)).toBeGreaterThan(similarity(enrolled, far));
  });

  it('rankCandidates places the best match first', () => {
    const query = featureFromLuminance(gridAt((r, c) => r * c));
    const subjects: AttendanceSubject[] = [
      {
        id: 's1',
        label: 'match',
        createdAt: '2026-01-01',
        featureVector: Array.from(featureFromLuminance(gridAt((r, c) => r * c)))
      },
      {
        id: 's2',
        label: 'noisy',
        createdAt: '2026-01-01',
        featureVector: Array.from(featureFromLuminance(gridAt((r, c) => r + c + 0.3)))
      },
      {
        id: 's3',
        label: 'very-different',
        createdAt: '2026-01-01',
        featureVector: Array.from(featureFromLuminance(gridAt(() => -5)))
      }
    ];
    const ranked = rankCandidates(query, subjects, 3);
    expect(ranked[0].subjectId).toBe('s1');
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence);
  });
});

describe('attendance end-to-end with real features', () => {
  it('enrolls, matches, and auto-accepts when above threshold', async () => {
    const feat = featureFromLuminance(gridAt((r, c) => (r + c) * 3));
    await enrollSubjectFromFeature('Alice', feat);
    const subjects = await listSubjects();
    expect(subjects.length).toBe(1);
    const s = await startSession('batch', { topN: 3, confidenceThreshold: 0.95 });
    if (!s.ok) throw new Error('session');
    const close = featureFromLuminance(gridAt((r, c) => (r + c) * 3 + 0.0001));
    const r = await recordMatchFromFeature(s.data.id, 'incoming', close);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0].candidateRef).toBe(subjects[0].id);
    expect(r.data[0].finalOutcome).toBe('auto_accepted');
    const matches = await listMatches(s.data.id);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('routes to manual review when below threshold', async () => {
    const feat = featureFromLuminance(gridAt((r, c) => (r - c) * 2));
    await enrollSubjectFromFeature('Bob', feat);
    const s = await startSession('batch', { topN: 2, confidenceThreshold: 0.99 });
    if (!s.ok) throw new Error('session');
    // Very different query.
    const query = featureFromLuminance(gridAt((r, c) => (r + c) * -7));
    const r = await recordMatchFromFeature(s.data.id, 'incoming', query);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0].finalOutcome).toBe('suggested');
  });

  it('records no_match when there are no enrolled subjects', async () => {
    const s = await startSession('batch');
    if (!s.ok) throw new Error('session');
    const query = featureFromLuminance(gridAt((r, c) => r + c));
    const r = await recordMatchFromFeature(s.data.id, 'nobody', query);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0].finalOutcome).toBe('no_match');
  });
});
