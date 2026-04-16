// Component-level state tests for key UI behaviors:
// - profile validation messages
// - import rejection row rendering data
// - export submit-lock / disabled state
// - active-tab persistence round-trip
//
// These test the state/logic layer that drives UI rendering rather than
// the DOM itself (which would need a full Svelte component mount harness).
// They ensure the service layer produces the correct inputs for the UI.

import { describe, expect, it } from 'vitest';
import { validatePassphrase, validateUsername } from '../../src/lib/util/validators';
import { importBatch } from '../../src/lib/services/imports';
import { createProject, getProject, updateProject } from '../../src/lib/services/projects';
import { enqueueJob } from '../../src/lib/services/queue';
import type { Job } from '../../src/lib/types';
import { all } from '../../src/lib/db/indexeddb';

// ---- Profile validation ----

describe('profile validation state for UI rendering', () => {
  it('returns an error message for empty username', () => {
    const err = validateUsername('');
    expect(err).not.toBeNull();
    expect(err!.message).toContain('character');
  });

  it('returns null (valid) for a good username', () => {
    expect(validateUsername('Nova')).toBeNull();
  });

  it('returns an error for passphrase missing a digit', () => {
    const err = validatePassphrase('abcdefghi');
    expect(err).not.toBeNull();
    expect(err!.message).toContain('digit');
  });

  it('returns an error for passphrase too short', () => {
    const err = validatePassphrase('ab1');
    expect(err).not.toBeNull();
    expect(err!.message).toContain('8');
  });

  it('returns null for a valid passphrase', () => {
    expect(validatePassphrase('correct-horse-9')).toBeNull();
  });
});

// ---- Import rejection row data ----

describe('import rejection produces row-level error data for the UI table', () => {
  it('rejected files carry per-row error codes and messages', async () => {
    const p = await createProject('RejectionUI');
    if (!p.ok) throw new Error('project');
    const res = await importBatch(p.data.id, [
      { name: 'ok.mp3', size: 1024, mimeType: 'audio/mpeg', data: new Blob([new Uint8Array(1024)]) },
      { name: 'bad.flac', size: 100, mimeType: 'audio/flac', data: new Blob([new Uint8Array(100)]) },
      { name: '', size: 10, data: new Blob([new Uint8Array(10)]) }
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rejected.length).toBe(2);
    // Each rejection has a filename and at least one error with a code.
    for (const r of res.data.rejected) {
      expect(typeof r.filename).toBe('string');
      expect(r.errors.length).toBeGreaterThan(0);
      expect(typeof r.errors[0].code).toBe('string');
      expect(typeof r.errors[0].message).toBe('string');
    }
  });
});

// ---- Export submit-lock / dedup ----

describe('export submit-lock state for the UI', () => {
  it('dedupeOnInputRef prevents a second queued job for the same item', async () => {
    const first = await enqueueJob(
      { type: 'export', inputRef: 'ui-item-X', initialEstimateMs: 500 },
      { dedupeOnInputRef: true }
    );
    const second = await enqueueJob(
      { type: 'export', inputRef: 'ui-item-X', initialEstimateMs: 500 },
      { dedupeOnInputRef: true }
    );
    // Same job returned — UI can rely on this for idempotent submit.
    expect(second.id).toBe(first.id);
    const jobs = (await all<Job>('jobs')).filter(
      (j) => j.inputRef === 'ui-item-X' && j.type === 'export'
    );
    expect(jobs.length).toBe(1);
  });
});

// ---- activeTab persistence ----

describe('activeTab is persisted and restored per project', () => {
  it('stores activeTab via updateProject and reads it back', async () => {
    const p = await createProject('TabPersist');
    if (!p.ok) throw new Error('project');
    // Default is 'edit'.
    expect(p.data.activeTab).toBe('edit');
    // Switch to export and persist.
    await updateProject(p.data.id, { activeTab: 'export' });
    const reloaded = await getProject(p.data.id);
    expect(reloaded?.activeTab).toBe('export');
    // Switch to reports.
    await updateProject(p.data.id, { activeTab: 'reports' });
    const again = await getProject(p.data.id);
    expect(again?.activeTab).toBe('reports');
  });
});
