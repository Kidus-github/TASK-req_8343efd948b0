import type { AuditEvent } from '../types';
import { all, put } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';

export async function logAudit(
  entityType: string,
  entityId: string,
  action: string,
  actorType: AuditEvent['actorType'] = 'user',
  details?: Record<string, unknown>
): Promise<void> {
  const ev: AuditEvent = {
    id: newId('audit'),
    entityType,
    entityId,
    action,
    actorType,
    timestamp: nowIso(),
    details
  };
  await put('auditEvents', ev);
}

export async function listAudit(): Promise<AuditEvent[]> {
  const events = await all<AuditEvent>('auditEvents');
  return events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}
