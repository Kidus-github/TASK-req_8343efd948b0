// IndexedDB schema for CleanWave. A single DB holds all object stores.
// Migrations are keyed off DB_VERSION; bump when changing stores.

export const DB_NAME = 'cleanwave';
export const DB_VERSION = 2;

export interface StoreDef {
  name: string;
  keyPath: string;
  indexes?: Array<{ name: string; keyPath: string | string[]; unique?: boolean }>;
}

export const STORES: StoreDef[] = [
  { name: 'deviceProfile', keyPath: 'id' },
  {
    name: 'projects',
    keyPath: 'id',
    indexes: [
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_name', keyPath: 'name', unique: true },
      { name: 'by_updatedAt', keyPath: 'updatedAt' }
    ]
  },
  {
    name: 'importedAudio',
    keyPath: 'id',
    indexes: [{ name: 'by_project', keyPath: 'projectId' }]
  },
  {
    name: 'importBatches',
    keyPath: 'id',
    indexes: [{ name: 'by_project', keyPath: 'projectId' }]
  },
  {
    name: 'blobs',
    keyPath: 'id'
  },
  {
    name: 'editOperations',
    keyPath: 'id',
    indexes: [
      { name: 'by_project', keyPath: 'projectId' },
      { name: 'by_file', keyPath: 'fileId' },
      { name: 'by_sequence', keyPath: ['projectId', 'sequenceIndex'] }
    ]
  },
  {
    name: 'markers',
    keyPath: 'id',
    indexes: [{ name: 'by_project', keyPath: 'projectId' }]
  },
  {
    name: 'snapshots',
    keyPath: 'id',
    indexes: [
      { name: 'by_project', keyPath: 'projectId' },
      { name: 'by_ordinal', keyPath: ['projectId', 'snapshotOrdinal'] }
    ]
  },
  {
    name: 'playlists',
    keyPath: 'id'
  },
  {
    name: 'playlistTracks',
    keyPath: 'id',
    indexes: [
      { name: 'by_playlist', keyPath: 'playlistId' },
      { name: 'by_sort', keyPath: ['playlistId', 'sortIndex'] }
    ]
  },
  {
    name: 'exportCarts',
    keyPath: 'id',
    indexes: [{ name: 'by_project', keyPath: 'projectId' }]
  },
  {
    name: 'exportCartItems',
    keyPath: 'id',
    indexes: [{ name: 'by_cart', keyPath: 'cartId' }]
  },
  {
    name: 'jobs',
    keyPath: 'id',
    indexes: [
      { name: 'by_status', keyPath: 'status' },
      { name: 'by_project', keyPath: 'projectId' }
    ]
  },
  {
    name: 'workers',
    keyPath: 'id'
  },
  {
    name: 'reports',
    keyPath: 'id'
  },
  {
    name: 'quotas',
    keyPath: 'id',
    indexes: [{ name: 'by_token_date', keyPath: ['tokenName', 'dateKey'], unique: true }]
  },
  {
    name: 'artifacts',
    keyPath: 'id'
  },
  {
    name: 'organizations',
    keyPath: 'id',
    indexes: [{ name: 'by_canonical', keyPath: 'canonicalId', unique: true }]
  },
  {
    name: 'programs',
    keyPath: 'id',
    indexes: [{ name: 'by_canonical', keyPath: 'canonicalId', unique: true }]
  },
  {
    name: 'classGroups',
    keyPath: 'id',
    indexes: [{ name: 'by_canonical', keyPath: 'canonicalId', unique: true }]
  },
  {
    name: 'rolePositions',
    keyPath: 'id',
    indexes: [{ name: 'by_canonical', keyPath: 'canonicalId', unique: true }]
  },
  {
    name: 'cohortWindows',
    keyPath: 'id'
  },
  {
    name: 'cohortMemberships',
    keyPath: 'id'
  },
  {
    name: 'attendanceSessions',
    keyPath: 'id'
  },
  {
    name: 'attendanceMatches',
    keyPath: 'id',
    indexes: [{ name: 'by_session', keyPath: 'sessionId' }]
  },
  {
    name: 'attendanceSubjects',
    keyPath: 'id'
  },
  {
    name: 'auditEvents',
    keyPath: 'id',
    indexes: [{ name: 'by_timestamp', keyPath: 'timestamp' }]
  },
  {
    name: 'locks',
    keyPath: 'projectId'
  }
];

export type StoreName = (typeof STORES)[number]['name'];
