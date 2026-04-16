import { describe, expect, it } from 'vitest';
import { exportCohortCsv, importCohortCsv } from '../../src/lib/services/cohorts';

describe('cohort CSV import/export', () => {
  it('accepts valid rows and reports invalid rows row-by-row', async () => {
    const csv = 'canonicalId,name\nacme,Acme Inc\n,NoCanonical\nwidget,Widget Co\n';
    const r = await importCohortCsv('organizations', csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.accepted).toBe(2);
    expect(r.data.rejected).toBe(1);
    expect(r.data.rejections[0].rowIndex).toBe(3);
  });

  it('fails in strict mode on the first invalid row', async () => {
    const csv = 'canonicalId,name\n,bad\n';
    const r = await importCohortCsv('organizations', csv, { strict: true });
    expect(r.ok).toBe(false);
  });

  it('rejects missing required columns', async () => {
    const csv = 'name\nAcme\n';
    const r = await importCohortCsv('organizations', csv);
    expect(r.ok).toBe(false);
  });

  it('validates cohort window start <= end', async () => {
    const csv = 'classGroupId,startDate,endDate\ncg1,2026-05-01,2026-01-01\n';
    const r = await importCohortCsv('cohortWindows', csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rejected).toBe(1);
    expect(r.data.rejections[0].errors[0].code).toBe('COHORT_DATE_WINDOW_INVALID');
  });

  it('exports CSV with canonical columns', async () => {
    await importCohortCsv('organizations', 'canonicalId,name\nacme,Acme Inc\n');
    const csv = await exportCohortCsv('organizations');
    expect(csv).toContain('canonicalId');
    expect(csv).toContain('acme');
  });
});
