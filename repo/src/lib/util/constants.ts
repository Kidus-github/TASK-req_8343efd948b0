// Authoritative numeric/enum limits from the PRD.
// Centralized so validators, estimators, and UI all agree on a single source.

export const LIMITS = Object.freeze({
  // Profile
  USERNAME_MIN: 1,
  USERNAME_MAX: 50,
  PASSPHRASE_MIN: 8,

  // Import
  MAX_FILES_PER_BATCH: 200,
  MAX_BATCH_BYTES: 2 * 1024 * 1024 * 1024, // 2 GB
  ALLOWED_EXTENSIONS: ['mp3', 'wav', 'ogg'] as const,

  // Editing
  FADE_MIN_SEC: 0.1,
  FADE_MAX_SEC: 10.0,
  FADE_STEP_SEC: 0.1,
  SILENCE_THRESHOLD_DB: -35,
  SILENCE_MIN_DURATION_SEC: 0.6,
  NORMALIZATION_LUFS: -14,
  BALANCE_MIN: -100,
  BALANCE_MAX: 100,

  // Playback
  SEEK_STEP_SEC: 15,
  SPEED_MIN: 0.5,
  SPEED_MAX: 2.0,
  SPEED_STEP: 0.1,

  // Markers
  MAX_MARKERS_PER_PROJECT: 50,
  MARKER_NOTE_MAX: 500,

  // Playlist
  MAX_PLAYLIST_TRACKS: 1000,

  // Export
  MAX_EXPORT_CART_ITEMS: 20,
  MP3_BITRATES: [128, 192, 320] as const,
  WAV_SAMPLE_RATE: 44100,

  // Auto-save / snapshots
  AUTO_SAVE_INTERVAL_MS: 30_000,
  RECOVERABLE_SNAPSHOTS: 3,

  // Queue / workers
  STALL_MULTIPLIER: 2,
  RECLAIM_WINDOW_MS: 10_000,
  MAX_JOB_ATTEMPTS: 3,
  WORKER_HEARTBEAT_MS: 2_000,

  // Multi-tab
  LOCK_EXPIRY_MS: 45_000,
  LOCK_HEARTBEAT_MS: 5_000,

  // Attendance
  ATTENDANCE_TOP_N_MIN: 1,
  ATTENDANCE_TOP_N_MAX: 10,
  ATTENDANCE_THRESHOLD_MIN: 0.0,
  ATTENDANCE_THRESHOLD_MAX: 1.0,
  ATTENDANCE_THRESHOLD_DEFAULT: 0.75,
  ATTENDANCE_TOP_N_DEFAULT: 3,

  // Integration
  DEFAULT_TOKEN_DAILY_QUOTA: 100
});

export type AllowedExtension = (typeof LIMITS.ALLOWED_EXTENSIONS)[number];
export type Mp3BitrateValue = (typeof LIMITS.MP3_BITRATES)[number];
