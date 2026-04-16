import { describe, expect, it } from 'vitest';
import { generatePayload, listQuotas } from '../../src/lib/services/integration';
import { LIMITS } from '../../src/lib/util/constants';

describe('Open Platform Kit', () => {
  it('generates REST/GraphQL/webhook artifacts and tracks quota', async () => {
    const r1 = await generatePayload('default', 'rest', { path: '/v1/x' });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.data.content).toContain('/v1/x');

    const r2 = await generatePayload('default', 'graphql', {});
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.data.content).toContain('query GetAudioProject');

    const r3 = await generatePayload('default', 'webhook', { event: 'export.failed' });
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.data.content).toContain('export.failed');

    const quotas = await listQuotas();
    expect(quotas[0].usedCount).toBe(3);
  });

  it('enforces daily quota', async () => {
    for (let i = 0; i < LIMITS.DEFAULT_TOKEN_DAILY_QUOTA; i++) {
      const r = await generatePayload('cap', 'rest', {});
      expect(r.ok).toBe(true);
    }
    const over = await generatePayload('cap', 'rest', {});
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('QUOTA_EXCEEDED');
  });
});
