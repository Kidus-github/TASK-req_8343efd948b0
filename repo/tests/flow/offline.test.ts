// Offline e2e guard: any attempt to reach the network during tests must fail
// or be absent. We assert that `fetch` either isn't used at module scope or,
// if present, is not actually called by our service code.

import { describe, expect, it, vi } from 'vitest';

describe('offline guard', () => {
  it('fetch is not invoked when running core services', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network call in offline test');
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await import('../../src/lib/services/profile');
      await import('../../src/lib/services/projects');
      await import('../../src/lib/services/imports');
      await import('../../src/lib/services/queue');
      await import('../../src/lib/services/reports');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
