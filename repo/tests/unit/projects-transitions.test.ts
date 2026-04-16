import { describe, expect, it } from 'vitest';
import { allowedTransition } from '../../src/lib/services/projects';

describe('project lifecycle transitions', () => {
  it('allows draft → active/archived/deleted', () => {
    expect(allowedTransition('draft', 'active')).toBe(true);
    expect(allowedTransition('draft', 'archived')).toBe(true);
    expect(allowedTransition('draft', 'deleted')).toBe(true);
  });
  it('allows active → archived/deleted only', () => {
    expect(allowedTransition('active', 'archived')).toBe(true);
    expect(allowedTransition('active', 'deleted')).toBe(true);
    expect(allowedTransition('active', 'draft')).toBe(false);
  });
  it('allows archived ↔ active', () => {
    expect(allowedTransition('archived', 'active')).toBe(true);
    expect(allowedTransition('archived', 'deleted')).toBe(true);
    expect(allowedTransition('archived', 'draft')).toBe(false);
  });
  it('disallows any transition from deleted', () => {
    expect(allowedTransition('deleted', 'active')).toBe(false);
    expect(allowedTransition('deleted', 'archived')).toBe(false);
    expect(allowedTransition('deleted', 'draft')).toBe(false);
  });
});
