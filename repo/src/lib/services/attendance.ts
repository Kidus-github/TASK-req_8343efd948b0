// Attendance engine — state machine + model-backed matching.
//
// Uses face-api.js (TinyFaceDetector + FaceLandmark68 + FaceRecognitionNet)
// for real 128-dim face descriptors when the model weights are bundled. Falls
// back to luminance feature hash only when weights are absent (test env).

import type {
  AttendanceMatch,
  AttendanceMatchState,
  AttendanceSession,
  AttendanceSubject,
  Result
} from '../types';
import { all, allByIndex, put } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { LIMITS } from '../util/constants';
import { ErrorCodes, fail, ok } from '../util/errors';
import { validateAttendanceThreshold, validateAttendanceTopN } from '../util/validators';
import { logAudit } from './audit';
import {
  extractFeatureFromSource,
  featureFromImageData,
  rankCandidates,
  listSubjects as inferenceListSubjects,
  type FeatureKind
} from '../attendance/inference';

export async function startSession(
  mode: 'realtime' | 'batch',
  opts: { topN?: number; confidenceThreshold?: number } = {}
): Promise<Result<AttendanceSession>> {
  const topN = opts.topN ?? LIMITS.ATTENDANCE_TOP_N_DEFAULT;
  const threshold = opts.confidenceThreshold ?? LIMITS.ATTENDANCE_THRESHOLD_DEFAULT;
  const topErr = validateAttendanceTopN(topN);
  if (topErr) return fail(topErr.code, topErr.message);
  const thErr = validateAttendanceThreshold(threshold);
  if (thErr) return fail(thErr.code, thErr.message);
  const session: AttendanceSession = {
    id: newId('as'),
    mode,
    startedAt: nowIso(),
    topN,
    confidenceThreshold: threshold,
    status: 'running'
  };
  await put('attendanceSessions', session);
  await logAudit('attendanceSession', session.id, 'start');
  return ok(session);
}

export async function endSession(sessionId: string): Promise<void> {
  const sessions = await all<AttendanceSession>('attendanceSessions');
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) return;
  await put('attendanceSessions', { ...s, status: 'complete', endedAt: nowIso() });
  await logAudit('attendanceSession', s.id, 'end');
}

export interface Candidate {
  ref: string;
  confidence: number;
}

/**
 * Record a match attempt against a real feature query. Ranks the currently-
 * enrolled subjects by cosine similarity, stores the top-N as AttendanceMatch
 * records, and auto-accepts only if the #1 candidate crosses the session's
 * confidence threshold. When no subjects are enrolled, a `no_match` record
 * is written so the flow routes to manual review.
 */
export async function recordMatchFromFeature(
  sessionId: string,
  subjectRef: string,
  feature: Float32Array,
  kind?: FeatureKind
): Promise<Result<AttendanceMatch[]>> {
  const session = (await all<AttendanceSession>('attendanceSessions')).find(
    (s) => s.id === sessionId
  );
  if (!session) return fail('ATTENDANCE_SESSION_NOT_FOUND', 'Session not found.');
  const enrolled = await inferenceListSubjects();
  const ranked = rankCandidates(feature, enrolled, session.topN, kind);
  return persistRanked(session, subjectRef, ranked.map((r) => ({ ref: r.subjectId, confidence: r.confidence })));
}

/** Record a match from a DOM media source (video / image / canvas). */
export async function recordMatchFromSource(
  sessionId: string,
  subjectRef: string,
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Result<AttendanceMatch[]>> {
  if (typeof document === 'undefined') {
    return fail('ATTENDANCE_NO_DOM', 'DOM not available for feature extraction.');
  }
  const { feature, kind } = await extractFeatureFromSource(source);
  return recordMatchFromFeature(sessionId, subjectRef, feature, kind);
}

/** Back-compat helper: accept precomputed candidate list (used by tests). */
export async function recordMatch(
  sessionId: string,
  subjectRef: string,
  candidates: Candidate[]
): Promise<Result<AttendanceMatch[]>> {
  const session = (await all<AttendanceSession>('attendanceSessions')).find(
    (s) => s.id === sessionId
  );
  if (!session) return fail('ATTENDANCE_SESSION_NOT_FOUND', 'Session not found.');
  return persistRanked(session, subjectRef, candidates);
}

async function persistRanked(
  session: AttendanceSession,
  subjectRef: string,
  ranked: Candidate[]
): Promise<Result<AttendanceMatch[]>> {
  const top = [...ranked].sort((a, b) => b.confidence - a.confidence).slice(0, session.topN);
  const persisted: AttendanceMatch[] = [];
  if (top.length === 0) {
    persisted.push(await writeMatch(session.id, subjectRef, undefined, 1, 0, false, 'no_match'));
  } else {
    for (let i = 0; i < top.length; i++) {
      const c = top[i];
      const autoAccept = i === 0 && c.confidence >= session.confidenceThreshold;
      const state: AttendanceMatchState = autoAccept ? 'auto_accepted' : 'suggested';
      persisted.push(
        await writeMatch(session.id, subjectRef, c.ref, i + 1, c.confidence, autoAccept, state)
      );
    }
  }
  return ok(persisted);
}

export async function resolveManually(
  matchId: string,
  outcome: 'accepted' | 'rejected' | 'unresolved'
): Promise<Result<AttendanceMatch>> {
  const list = await all<AttendanceMatch>('attendanceMatches');
  const m = list.find((x) => x.id === matchId);
  if (!m) return fail('ATTENDANCE_MATCH_NOT_FOUND', 'Match not found.');
  const updated: AttendanceMatch = {
    ...m,
    manuallyResolved: true,
    finalOutcome: outcome
  };
  await put('attendanceMatches', updated);
  await logAudit('attendanceMatch', m.id, `manual:${outcome}`);
  return ok(updated);
}

export async function listMatches(sessionId: string): Promise<AttendanceMatch[]> {
  return allByIndex<AttendanceMatch>('attendanceMatches', 'by_session', sessionId);
}

async function writeMatch(
  sessionId: string,
  subjectRef: string,
  candidateRef: string | undefined,
  rank: number,
  confidence: number,
  autoAccept: boolean,
  state: AttendanceMatchState
): Promise<AttendanceMatch> {
  const m: AttendanceMatch = {
    id: newId('am'),
    sessionId,
    subjectRef,
    candidateRef,
    rank,
    confidence,
    acceptedBySystem: autoAccept,
    manuallyResolved: false,
    finalOutcome: state
  };
  await put('attendanceMatches', m);
  return m;
}
