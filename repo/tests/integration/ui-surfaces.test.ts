// Targeted UI-surface coverage for panels the audit identified as
// undertested: cohorts UI flow, integration artifacts UI flow,
// preferences UI flow, reports UI flow, and confirm-modal state.
//
// These are service-layer tests that exercise the same state each
// panel component reads and writes, proving the rendering inputs
// are correct without requiring a full Svelte component mount.

import { describe, expect, it, vi } from 'vitest';

// ---- Cohorts UI ----

import { exportCohortCsv, importCohortCsv } from '../../src/lib/services/cohorts';

describe('cohorts UI flow', () => {
  it('import with valid CSV returns accepted count and no rejections', async () => {
    const csv = 'canonicalId,name\nacme,Acme Inc\nwidget,Widget Co\n';
    const r = await importCohortCsv('organizations', csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.accepted).toBe(2);
    expect(r.data.rejected).toBe(0);
    expect(r.data.rejections.length).toBe(0);
  });

  it('import with invalid rows returns per-row rejection objects for UI table', async () => {
    const csv = 'canonicalId,name\n,MissingId\nacme,OK\n';
    const r = await importCohortCsv('organizations', csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rejected).toBe(1);
    expect(r.data.rejections[0].rowIndex).toBe(2);
    expect(r.data.rejections[0].errors[0].code).toBeTruthy();
  });

  it('export produces CSV string the UI can offer as download', async () => {
    await importCohortCsv('organizations', 'canonicalId,name\nacme,Acme\n');
    const csv = await exportCohortCsv('organizations');
    expect(csv).toContain('canonicalId');
    expect(csv).toContain('acme');
  });
});

// ---- Integration artifacts UI ----

import { generatePayload, listQuotas } from '../../src/lib/services/integration';

describe('integration artifacts UI flow', () => {
  it('generates a REST payload the UI can display', async () => {
    const r = await generatePayload('default', 'rest', { path: '/v1/audio' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.content).toContain('/v1/audio');
    expect(r.data.artifact.type).toBe('rest');
    expect(r.data.artifact.filename).toContain('rest');
  });

  it('tracks quota so the UI can show used/limit', async () => {
    await generatePayload('tok1', 'rest', {});
    await generatePayload('tok1', 'graphql', {});
    const quotas = await listQuotas();
    const tok1 = quotas.find((q) => q.tokenName === 'tok1');
    expect(tok1).toBeTruthy();
    expect(tok1!.usedCount).toBe(2);
    expect(tok1!.dailyQuota).toBeGreaterThan(0);
  });
});

// ---- Preferences UI ----

import { loadPrefs, savePrefs, resetPrefs, defaultPrefs } from '../../src/lib/db/prefs';
import { createProfile, getProfile, updateProfile } from '../../src/lib/services/profile';

describe('preferences UI flow', () => {
  it('round-trips theme and speed through LocalStorage', () => {
    resetPrefs();
    const d = defaultPrefs();
    savePrefs({ ...d, theme: 'dark', defaultPlaybackSpeed: 1.5 });
    const loaded = loadPrefs();
    expect(loaded.theme).toBe('dark');
    expect(loaded.defaultPlaybackSpeed).toBe(1.5);
  });

  it('persists quiet-hours allowHeavyJobs toggle into DeviceProfile', async () => {
    await createProfile('PrefUser', 'passw0rd1');
    const upd = await updateProfile({
      quietHours: { start: '23:00', end: '05:00', allowHeavyJobs: true }
    });
    expect(upd.ok).toBe(true);
    const p = await getProfile();
    expect(p?.quietHours.allowHeavyJobs).toBe(true);
  });

  it('persists UI role so sidebar visibility changes', async () => {
    await createProfile('RoleUser', 'passw0rd2');
    await updateProfile({ uiRole: 'operations' });
    const p = await getProfile();
    expect(p?.uiRole).toBe('operations');
  });
});

// ---- Reports UI ----

import { computeReport, reportToCsv, type ReportFilters } from '../../src/lib/services/reports';
import { createProject } from '../../src/lib/services/projects';
import { importBatch } from '../../src/lib/services/imports';

describe('reports UI flow', () => {
  it('computeReport with no data returns zeroes the UI can render', async () => {
    const m = await computeReport();
    expect(m.importedCount).toBe(0);
    expect(m.exportedCount).toBe(0);
    expect(m.avgProcessingTimeMs).toBe(0);
    expect(Object.keys(m.exportFormatBreakdown).length).toBe(0);
  });

  it('computeReport with projectId filter narrows to that project', async () => {
    const pA = await createProject('A');
    const pB = await createProject('B');
    if (!pA.ok || !pB.ok) throw new Error('setup');
    await importBatch(pA.data.id, [
      { name: 'a.mp3', size: 1024, mimeType: 'audio/mpeg', data: new Blob([new Uint8Array(1024)]) }
    ]);
    const all = await computeReport();
    const onlyA = await computeReport({ projectId: pA.data.id });
    const onlyB = await computeReport({ projectId: pB.data.id });
    expect(all.importedCount).toBeGreaterThanOrEqual(onlyA.importedCount);
    expect(onlyA.importedCount).toBe(1);
    expect(onlyB.importedCount).toBe(0);
  });

  it('reportToCsv produces a downloadable CSV with preamble the UI offers', async () => {
    const m = await computeReport();
    const filters: ReportFilters = { dateFrom: '2026-01-01T00:00:00Z' };
    const csv = reportToCsv(m, filters);
    expect(csv).toContain('# CleanWave operations report');
    expect(csv).toContain('metric,value');
    expect(csv).toContain('importedCount');
  });
});

// ---- Confirm modal state ----

import { confirmModal, promptModal, selectModal, activeModal } from '../../src/lib/stores/modal';
import { get as storeGet } from 'svelte/store';

describe('confirm/prompt/select modal state for UI rendering', () => {
  it('confirmModal sets activeModal with kind=confirm and resolves on user action', async () => {
    const promise = confirmModal({ title: 'Delete?', message: 'Are you sure?' });
    const state = storeGet(activeModal);
    expect(state).not.toBeNull();
    expect(state!.kind).toBe('confirm');
    // Simulate user clicking Confirm (the ConfirmModal component would
    // call resolve + activeModal.set(null); here we just resolve).
    (state as { resolve: (v: boolean) => void }).resolve(true);
    const result = await promise;
    expect(result).toBe(true);
    // Clean up for the next test.
    activeModal.set(null);
  });

  it('promptModal sets kind=prompt and delivers the entered value', async () => {
    const promise = promptModal({ title: 'Name?', placeholder: 'Enter name' });
    const state = storeGet(activeModal);
    expect(state!.kind).toBe('prompt');
    (state as { resolve: (v: string | null) => void }).resolve('Alice');
    expect(await promise).toBe('Alice');
  });

  it('selectModal sets kind=select and delivers the chosen value', async () => {
    const promise = selectModal({
      title: 'Pick file',
      options: [
        { value: 'a', label: 'File A' },
        { value: 'b', label: 'File B' }
      ]
    });
    const state = storeGet(activeModal);
    expect(state!.kind).toBe('select');
    (state as { resolve: (v: string | null) => void }).resolve('b');
    expect(await promise).toBe('b');
  });

  it('cancel resolves confirm as false and prompt/select as null', async () => {
    const cp = confirmModal({ title: 'X', message: 'Y' });
    (storeGet(activeModal) as { resolve: (v: boolean) => void }).resolve(false);
    expect(await cp).toBe(false);

    const pp = promptModal({ title: 'X' });
    (storeGet(activeModal) as { resolve: (v: string | null) => void }).resolve(null);
    expect(await pp).toBeNull();

    const sp = selectModal({ title: 'X', options: [] });
    (storeGet(activeModal) as { resolve: (v: string | null) => void }).resolve(null);
    expect(await sp).toBeNull();
  });
});
