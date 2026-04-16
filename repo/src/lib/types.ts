// Core domain types for CleanWave.
// All IDs are opaque strings. Timestamps are ISO 8601 UTC strings.

export type Iso = string;

export type UiRole = 'editor' | 'reviewer' | 'operations';

export type Result<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; code: string; message: string; details?: unknown };

// ---------- Device profile ----------
export interface DeviceProfile {
  id: string;
  username: string;
  passphraseHashLocal: string; // never raw
  passphraseSalt: string;
  createdAt: Iso;
  updatedAt: Iso;
  uiRole: UiRole;
  theme: 'light' | 'dark';
  defaultPlaybackSpeed: number;
  quietHours: { start: string; end: string; allowHeavyJobs: boolean };
  lastOpenedProjectId?: string;
}

// ---------- Project ----------
export type ProjectStatus = 'draft' | 'active' | 'archived' | 'deleted';

export interface ProjectSettings {
  silenceThresholdDb: number;
  silenceMinDurationSec: number;
  normalizationLufs: number;
  defaultFadeSec: number;
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: Iso;
  updatedAt: Iso;
  lastOpenedAt?: Iso;
  activeTab: 'edit' | 'export' | 'reports';
  readOnlyReason?: string;
  settings: ProjectSettings;
  versionCounter: number;
}

// ---------- Imported audio ----------
export type ImportStatus = 'pending' | 'validating' | 'accepted' | 'rejected';

export interface ValidationError {
  code: string;
  message: string;
}

export interface ImportedAudioFile {
  id: string;
  projectId: string;
  originalFilename: string;
  mimeType: string;
  extension: 'mp3' | 'wav' | 'ogg';
  sizeBytes: number;
  durationMs?: number;
  sampleRate?: number;
  channels?: number;
  blobRef: string;
  importStatus: ImportStatus;
  validationErrors: ValidationError[];
  createdAt: Iso;
}

export interface ImportBatch {
  id: string;
  projectId: string;
  startedAt: Iso;
  completedAt?: Iso;
  fileCount: number;
  acceptedCount: number;
  rejectedCount: number;
  totalSizeBytes: number;
  status:
    | 'pending'
    | 'validating'
    | 'accepted_partial'
    | 'accepted_full'
    | 'failed'
    | 'complete';
}

// ---------- Edit operations ----------
export type EditOpType =
  | 'cut'
  | 'split'
  | 'merge'
  | 'fade_in'
  | 'fade_out'
  | 'silence_flag'
  | 'normalize_lufs'
  | 'balance_adjust';

export interface EditOperation {
  id: string;
  projectId: string;
  fileId: string;
  type: EditOpType;
  params: Record<string, unknown>;
  createdAt: Iso;
  sequenceIndex: number;
  previewEnabled?: boolean;
}

// ---------- Marker ----------
export interface Marker {
  id: string;
  projectId: string;
  fileId?: string;
  timestampMs: number;
  note: string;
  needsReview?: boolean;
  createdAt: Iso;
  updatedAt: Iso;
}

// ---------- Snapshot ----------
export interface ProjectSnapshot {
  id: string;
  projectId: string;
  snapshotOrdinal: number;
  createdAt: Iso;
  reason: 'autosave' | 'manual' | 'pre-export' | 'recovery';
  projectStateBlob: unknown;
  checksum: string;
  isRecoverable: boolean;
  state: 'creating' | 'valid' | 'corrupt' | 'pruned' | 'recovered';
}

// ---------- Playlist ----------
export type PlaybackMode = 'sequential' | 'single-repeat' | 'shuffle';

export interface Playlist {
  id: string;
  name: string;
  createdAt: Iso;
  updatedAt: Iso;
  playbackMode: PlaybackMode;
}

export interface PlaylistTrack {
  id: string;
  playlistId: string;
  fileId: string;
  sortIndex: number;
  noteCache: string;
  filenameCache: string;
}

// ---------- Export ----------
export type ExportFormat = 'mp3' | 'wav';
export type Mp3Bitrate = 128 | 192 | 320;

export type ExportCartStatus =
  | 'draft'
  | 'estimated'
  | 'confirmed'
  | 'rendering'
  | 'partial_failed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExportCart {
  id: string;
  projectId: string;
  status: ExportCartStatus;
  createdAt: Iso;
  confirmedAt?: Iso;
}

export interface ExportCartItem {
  id: string;
  cartId: string;
  sourceRef: string; // file id
  format: ExportFormat;
  bitrate?: Mp3Bitrate;
  sampleRate?: number;
  estimatedSizeBytes: number;
  estimatedRuntimeMs: number;
  /** true when the estimator was able to use a persisted duration. */
  durationKnown?: boolean;
  status: 'draft' | 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';
  outputBlobRef?: string;
  outputName?: string;
  outputBytes?: number;
}

// ---------- Job / queue ----------
export type JobType =
  | 'waveform'
  | 'silence_scan'
  | 'normalize'
  | 'export'
  | 'transcode';

export type JobStatus =
  | 'queued'
  | 'deferred_quiet_hours'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed_retryable'
  | 'stalled_candidate'
  | 'reclaimed'
  | 'failed_terminal'
  | 'cancelled';

export interface Job {
  id: string;
  projectId?: string;
  type: JobType;
  priority: number;
  status: JobStatus;
  createdAt: Iso;
  startedAt?: Iso;
  completedAt?: Iso;
  workerId?: string;
  inputRef: string;
  resultRef?: string;
  initialEstimateMs: number;
  runtimeMs: number;
  attemptCount: number;
  stallReclaimed: boolean;
  errorCode?: string;
  errorMessage?: string;
  lastHeartbeatAt?: Iso;
  /** Optional job-specific payload (e.g. channels to process). */
  payload?: Record<string, unknown>;
}

export interface WorkerRuntime {
  id: string;
  status: 'idle' | 'busy' | 'offline';
  successCount: number;
  failureCount: number;
  rating: number;
  lastHeartbeatAt?: Iso;
  currentJobId?: string;
}

// ---------- Reports ----------
export interface ReportMetrics {
  importedCount: number;
  rejectedCount: number;
  editedCount: number;
  exportedCount: number;
  conversionImportToEdit: number;
  conversionEditToExport: number;
  avgProcessingTimeMs: number;
  medianProcessingTimeMs: number;
  exportFormatBreakdown: Record<string, number>;
  failureCountsByJobType: Record<string, number>;
}

export interface ReportSnapshot {
  id: string;
  dateFrom: Iso;
  dateTo: Iso;
  filters: Record<string, unknown>;
  metrics: ReportMetrics;
  generatedAt: Iso;
}

// ---------- Quota / integration ----------
export interface IntegrationTokenQuota {
  id: string;
  tokenName: string;
  dateKey: string; // yyyy-mm-dd local
  usedCount: number;
  dailyQuota: number;
}

export interface GeneratedArtifact {
  id: string;
  type: 'rest' | 'graphql' | 'webhook';
  tokenName: string;
  folderHandleRef?: string;
  filename: string;
  createdAt: Iso;
  checksum: string;
}

// ---------- Cohort ----------
export interface Organization {
  id: string;
  name: string;
  canonicalId: string;
}
export interface Program {
  id: string;
  organizationId: string;
  name: string;
  canonicalId: string;
}
export interface ClassGroup {
  id: string;
  programId: string;
  name: string;
  canonicalId: string;
}
export interface RolePosition {
  id: string;
  organizationId: string;
  name: string;
  canonicalId: string;
}
export interface CohortWindow {
  id: string;
  classGroupId: string;
  startDate: string;
  endDate: string;
}
export interface CohortMembership {
  id: string;
  cohortWindowId: string;
  subjectId: string;
  rolePositionId?: string;
}

// ---------- Attendance ----------
export interface AttendanceSession {
  id: string;
  mode: 'realtime' | 'batch';
  startedAt: Iso;
  endedAt?: Iso;
  topN: number;
  confidenceThreshold: number;
  status: 'running' | 'complete' | 'cancelled';
}

export type AttendanceMatchState =
  | 'detected'
  | 'suggested'
  | 'auto_accepted'
  | 'manual_review'
  | 'accepted'
  | 'rejected'
  | 'unresolved'
  | 'no_match';

export interface AttendanceMatch {
  id: string;
  sessionId: string;
  subjectRef: string;
  candidateRef?: string;
  rank: number;
  confidence: number;
  acceptedBySystem: boolean;
  manuallyResolved: boolean;
  finalOutcome: AttendanceMatchState;
}

/** Enrolled subject template used for real on-device recognition. */
export interface AttendanceSubject {
  id: string;
  label: string;
  createdAt: Iso;
  featureVector: number[]; // L2-normalized vector
  /**
   * Which extractor produced the featureVector. 'luminance-face' means the
   * browser's FaceDetector API was used to crop the face before extraction;
   * 'luminance-full' means the feature covers the whole frame (fallback).
   * Matching only compares subjects of the same kind.
   */
  featureKind?: 'face-128' | 'luminance-full';
  externalRef?: string;
}

// ---------- Audit ----------
export interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: 'user' | 'system';
  timestamp: Iso;
  details?: Record<string, unknown>;
}

// ---------- Locks ----------
export interface ProjectLock {
  projectId: string;
  tabId: string;
  acquiredAt: Iso;
  lastHeartbeatAt: Iso;
}
