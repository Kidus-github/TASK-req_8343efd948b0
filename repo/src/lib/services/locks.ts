// Project write-lock / multi-tab coordination using IndexedDB + BroadcastChannel.
// Rule: only one writable tab per project; stale locks expire after 45s.
//
// Coordination is live: every tab that calls `subscribeLockEvents` receives
// real-time notifications when another tab acquires/releases a lock or
// attempts to take over. This is how the UI drops into read-only mode as
// soon as another tab becomes the writer.

import type { ProjectLock, Result } from '../types';
import { get, put, del } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { LIMITS } from '../util/constants';
import { ErrorCodes, fail, ok } from '../util/errors';
import { logAudit } from './audit';

const CHANNEL = 'cleanwave.locks';

export type LockEventKind = 'acquired' | 'released' | 'takeover_request' | 'takeover_granted';

export interface LockEvent {
  kind: LockEventKind;
  projectId: string;
  tabId: string;
  at: string;
}

function hasBC(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

function emit(event: LockEvent): void {
  if (!hasBC()) return;
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.postMessage(event);
    c.close();
  } catch {
    // ignore
  }
}

/**
 * Subscribe to lock events on the shared channel. Returns an unsubscribe
 * function. Safe to call in components; if BroadcastChannel is unavailable,
 * the handler simply never fires.
 */
export function subscribeLockEvents(handler: (ev: LockEvent) => void): () => void {
  if (!hasBC()) return () => undefined;
  const c = new BroadcastChannel(CHANNEL);
  const listener = (e: MessageEvent): void => {
    const data = e.data as LockEvent | undefined;
    if (!data || typeof data !== 'object') return;
    if (!('projectId' in data) || !('kind' in data)) return;
    handler(data);
  };
  c.addEventListener('message', listener);
  return () => {
    c.removeEventListener('message', listener);
    c.close();
  };
}

export function newTabId(): string {
  return newId('tab');
}

function isStale(lock: ProjectLock): boolean {
  return Date.now() - Date.parse(lock.lastHeartbeatAt) > LIMITS.LOCK_EXPIRY_MS;
}

export async function tryAcquire(projectId: string, tabId: string): Promise<Result<ProjectLock>> {
  const existing = await get<ProjectLock>('locks', projectId);
  if (existing && existing.tabId !== tabId && !isStale(existing)) {
    return fail(ErrorCodes.PROJECT_LOCK_ACTIVE, 'Project is open in another tab.');
  }
  const lock: ProjectLock = {
    projectId,
    tabId,
    acquiredAt: existing?.acquiredAt && existing.tabId === tabId ? existing.acquiredAt : nowIso(),
    lastHeartbeatAt: nowIso()
  };
  await put('locks', lock);
  emit({ kind: 'acquired', projectId, tabId, at: lock.lastHeartbeatAt });
  await logAudit('lock', projectId, 'acquire');
  return ok(lock);
}

export async function heartbeat(projectId: string, tabId: string): Promise<Result<ProjectLock>> {
  const existing = await get<ProjectLock>('locks', projectId);
  if (!existing || existing.tabId !== tabId) {
    return fail(ErrorCodes.PROJECT_LOCK_ACTIVE, 'Not lock owner.');
  }
  const updated: ProjectLock = { ...existing, lastHeartbeatAt: nowIso() };
  await put('locks', updated);
  return ok(updated);
}

export async function release(projectId: string, tabId: string): Promise<Result<true>> {
  const existing = await get<ProjectLock>('locks', projectId);
  if (!existing) return ok(true);
  if (existing.tabId !== tabId) {
    return fail(ErrorCodes.PROJECT_LOCK_ACTIVE, 'Not lock owner; cannot release.');
  }
  await del('locks', projectId);
  emit({ kind: 'released', projectId, tabId, at: nowIso() });
  await logAudit('lock', projectId, 'release');
  return ok(true);
}

/** Request a takeover: asks the current owner to release. */
export function requestTakeover(projectId: string, tabId: string): void {
  emit({ kind: 'takeover_request', projectId, tabId, at: nowIso() });
}

export async function inspect(projectId: string): Promise<ProjectLock | undefined> {
  const l = await get<ProjectLock>('locks', projectId);
  if (!l) return undefined;
  if (isStale(l)) return undefined;
  return l;
}
