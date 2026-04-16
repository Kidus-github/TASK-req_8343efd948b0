// Cohort module: bulk CSV import / export with row-level validation.
// Partial-accept by default; rows failing validation are reported.

import type {
  ClassGroup,
  CohortMembership,
  CohortWindow,
  Organization,
  Program,
  Result,
  RolePosition
} from '../types';
import { all, put, tx } from '../db/indexeddb';
import { newId, nowIso } from '../util/ids';
import { parseCsv, stringifyCsv } from '../util/csv';
import { validateCohortWindow } from '../util/validators';
import { ok, fail, ErrorCodes } from '../util/errors';

export type CohortEntity =
  | 'organizations'
  | 'programs'
  | 'classGroups'
  | 'rolePositions'
  | 'cohortWindows'
  | 'cohortMemberships';

export interface CsvImportReport {
  entity: CohortEntity;
  accepted: number;
  rejected: number;
  rejections: Array<{ rowIndex: number; errors: Array<{ code: string; message: string }> }>;
}

const REQUIRED_COLS: Record<CohortEntity, string[]> = {
  organizations: ['canonicalId', 'name'],
  programs: ['canonicalId', 'organizationId', 'name'],
  classGroups: ['canonicalId', 'programId', 'name'],
  rolePositions: ['canonicalId', 'organizationId', 'name'],
  cohortWindows: ['classGroupId', 'startDate', 'endDate'],
  cohortMemberships: ['cohortWindowId', 'subjectId']
};

const STORE_BY_ENTITY: Record<CohortEntity, string> = {
  organizations: 'organizations',
  programs: 'programs',
  classGroups: 'classGroups',
  rolePositions: 'rolePositions',
  cohortWindows: 'cohortWindows',
  cohortMemberships: 'cohortMemberships'
};

export async function importCohortCsv(
  entity: CohortEntity,
  csvText: string,
  opts: { strict?: boolean } = {}
): Promise<Result<CsvImportReport>> {
  const { headers, rows } = parseCsv(csvText);
  const required = REQUIRED_COLS[entity];
  const missing = required.filter((c) => !headers.includes(c));
  if (missing.length) {
    return fail(
      ErrorCodes.CSV_ROW_INVALID,
      `Missing required columns: ${missing.join(', ')}.`
    );
  }
  const rejections: CsvImportReport['rejections'] = [];
  const accepted: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const errors: Array<{ code: string; message: string }> = [];
    const rec = buildRecord(entity, row, errors);
    if (errors.length) {
      rejections.push({ rowIndex: i + 2, errors });
      if (opts.strict) {
        return fail(
          ErrorCodes.CSV_ROW_INVALID,
          `Strict mode: row ${i + 2} invalid.`,
          { rejections }
        );
      }
      continue;
    }
    accepted.push(rec);
  }

  await tx([STORE_BY_ENTITY[entity]], 'readwrite', async ([store]) => {
    for (const rec of accepted) store.put(rec);
  });

  return ok({
    entity,
    accepted: accepted.length,
    rejected: rejections.length,
    rejections
  });
}

function buildRecord(
  entity: CohortEntity,
  row: Record<string, string>,
  errors: Array<{ code: string; message: string }>
): unknown {
  switch (entity) {
    case 'organizations': {
      if (!row.canonicalId) errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'canonicalId required' });
      if (!row.name) errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'name required' });
      const org: Organization = {
        id: row.id || newId('org'),
        canonicalId: row.canonicalId,
        name: row.name
      };
      return org;
    }
    case 'programs': {
      if (!row.canonicalId) errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'canonicalId required' });
      if (!row.organizationId)
        errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'organizationId required' });
      const rec: Program = {
        id: row.id || newId('prog'),
        canonicalId: row.canonicalId,
        organizationId: row.organizationId,
        name: row.name
      };
      return rec;
    }
    case 'classGroups': {
      if (!row.canonicalId) errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'canonicalId required' });
      if (!row.programId) errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'programId required' });
      const rec: ClassGroup = {
        id: row.id || newId('cls'),
        canonicalId: row.canonicalId,
        programId: row.programId,
        name: row.name
      };
      return rec;
    }
    case 'rolePositions': {
      if (!row.canonicalId) errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'canonicalId required' });
      if (!row.organizationId)
        errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'organizationId required' });
      const rec: RolePosition = {
        id: row.id || newId('rp'),
        canonicalId: row.canonicalId,
        organizationId: row.organizationId,
        name: row.name
      };
      return rec;
    }
    case 'cohortWindows': {
      const err = validateCohortWindow(row.startDate, row.endDate);
      if (err) errors.push({ code: err.code, message: err.message });
      const rec: CohortWindow = {
        id: row.id || newId('cw'),
        classGroupId: row.classGroupId,
        startDate: row.startDate,
        endDate: row.endDate
      };
      return rec;
    }
    case 'cohortMemberships': {
      if (!row.cohortWindowId)
        errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'cohortWindowId required' });
      if (!row.subjectId) errors.push({ code: ErrorCodes.CSV_ROW_INVALID, message: 'subjectId required' });
      const rec: CohortMembership = {
        id: row.id || newId('cm'),
        cohortWindowId: row.cohortWindowId,
        subjectId: row.subjectId,
        rolePositionId: row.rolePositionId || undefined
      };
      return rec;
    }
  }
}

export async function exportCohortCsv(entity: CohortEntity): Promise<string> {
  const records = await all<Record<string, unknown>>(STORE_BY_ENTITY[entity]);
  const cols = columnsFor(entity);
  return stringifyCsv(records, cols);
}

function columnsFor(entity: CohortEntity): string[] {
  switch (entity) {
    case 'organizations':
      return ['id', 'canonicalId', 'name'];
    case 'programs':
      return ['id', 'canonicalId', 'organizationId', 'name'];
    case 'classGroups':
      return ['id', 'canonicalId', 'programId', 'name'];
    case 'rolePositions':
      return ['id', 'canonicalId', 'organizationId', 'name'];
    case 'cohortWindows':
      return ['id', 'classGroupId', 'startDate', 'endDate'];
    case 'cohortMemberships':
      return ['id', 'cohortWindowId', 'subjectId', 'rolePositionId'];
  }
}
