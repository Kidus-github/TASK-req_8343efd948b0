// Open Platform Kit: generates sample REST/GraphQL/webhook payloads locally.
// Enforces a per-token daily quota and tracks generated-artifact metadata.

import type { GeneratedArtifact, IntegrationTokenQuota, Result } from '../types';
import { all, get, put } from '../db/indexeddb';
import { newId, nowIso, todayLocalDateKey } from '../util/ids';
import { ErrorCodes, fail, ok } from '../util/errors';
import { sha256Hex } from '../util/hash';
import { LIMITS } from '../util/constants';
import { logAudit } from './audit';

export type PayloadType = 'rest' | 'graphql' | 'webhook';

export async function listQuotas(): Promise<IntegrationTokenQuota[]> {
  return all<IntegrationTokenQuota>('quotas');
}

async function findOrCreateQuota(tokenName: string): Promise<IntegrationTokenQuota> {
  const dateKey = todayLocalDateKey();
  const all_ = await listQuotas();
  const existing = all_.find((q) => q.tokenName === tokenName && q.dateKey === dateKey);
  if (existing) return existing;
  const q: IntegrationTokenQuota = {
    id: newId('quota'),
    tokenName,
    dateKey,
    usedCount: 0,
    dailyQuota: LIMITS.DEFAULT_TOKEN_DAILY_QUOTA
  };
  await put('quotas', q);
  return q;
}

export async function generatePayload(
  tokenName: string,
  type: PayloadType,
  fields: Record<string, unknown>
): Promise<Result<{ artifact: GeneratedArtifact; content: string }>> {
  const quota = await findOrCreateQuota(tokenName);
  if (quota.usedCount >= quota.dailyQuota) {
    return fail(ErrorCodes.QUOTA_EXCEEDED, `Daily quota reached for token "${tokenName}".`);
  }

  const content = renderPayload(type, fields);
  const checksum = await sha256Hex(content);
  const artifact: GeneratedArtifact = {
    id: newId('art'),
    type,
    tokenName,
    filename: `${type}-${tokenName}-${Date.now()}.${type === 'rest' || type === 'webhook' ? 'json' : 'graphql'}`,
    createdAt: nowIso(),
    checksum
  };
  await put('artifacts', artifact);
  await put('quotas', { ...quota, usedCount: quota.usedCount + 1 });
  await logAudit('integration', artifact.id, 'generate', 'user', { type, tokenName });
  return ok({ artifact, content });
}

function renderPayload(type: PayloadType, fields: Record<string, unknown>): string {
  const now = new Date().toISOString();
  switch (type) {
    case 'rest':
      return JSON.stringify(
        {
          method: fields.method ?? 'POST',
          path: fields.path ?? '/v1/audio/process',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': newId('req')
          },
          body: fields.body ?? { files: [], projectId: fields.projectId ?? null },
          generatedAt: now,
          note: 'This is a local sample. It is never transmitted.'
        },
        null,
        2
      );
    case 'graphql':
      return [
        'query GetAudioProject($id: ID!) {',
        '  project(id: $id) {',
        '    id',
        '    name',
        '    files { id filename durationMs }',
        '  }',
        '}',
        '',
        `# generatedAt=${now}`,
        '# local sample; not transmitted'
      ].join('\n');
    case 'webhook':
      return JSON.stringify(
        {
          event: fields.event ?? 'export.completed',
          id: newId('evt'),
          occurredAt: now,
          data: fields.data ?? { itemId: 'sample' },
          note: 'Local webhook-style sample; never dispatched.'
        },
        null,
        2
      );
  }
}
