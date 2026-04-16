// Pure validation helpers. All validators return either null (valid) or an
// error code + human-readable message, so UI and services can share them.

import { LIMITS, type AllowedExtension } from './constants';
import { ErrorCodes } from './errors';

export interface FieldError {
  code: string;
  message: string;
}

export function validateUsername(raw: string): FieldError | null {
  const v = (raw ?? '').trim();
  if (v.length < LIMITS.USERNAME_MIN || v.length > LIMITS.USERNAME_MAX) {
    return {
      code: ErrorCodes.PROFILE_INVALID,
      message: `Username must be ${LIMITS.USERNAME_MIN}-${LIMITS.USERNAME_MAX} characters.`
    };
  }
  return null;
}

export function validatePassphrase(raw: string): FieldError | null {
  if (!raw || raw.length < LIMITS.PASSPHRASE_MIN) {
    return {
      code: ErrorCodes.PROFILE_INVALID,
      message: `Passphrase must be at least ${LIMITS.PASSPHRASE_MIN} characters.`
    };
  }
  if (!/[0-9]/.test(raw)) {
    return {
      code: ErrorCodes.PROFILE_INVALID,
      message: 'Passphrase must include at least one digit.'
    };
  }
  return null;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function isAllowedExtension(ext: string): ext is AllowedExtension {
  return (LIMITS.ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

export function validateImportFile(
  filename: string,
  sizeBytes: number
): FieldError | null {
  if (!filename || !filename.trim()) {
    return { code: ErrorCodes.IMPORT_EMPTY_FILENAME, message: 'File has no name.' };
  }
  if (sizeBytes <= 0) {
    return { code: ErrorCodes.IMPORT_ZERO_BYTES, message: 'File is empty (0 bytes).' };
  }
  const ext = extensionOf(filename);
  if (!isAllowedExtension(ext)) {
    return {
      code: ErrorCodes.IMPORT_UNSUPPORTED_TYPE,
      message: `Unsupported file type ".${ext}". Allowed: mp3, wav, ogg.`
    };
  }
  return null;
}

export function validateImportBatch(
  files: Array<{ name: string; size: number }>
): FieldError | null {
  if (files.length > LIMITS.MAX_FILES_PER_BATCH) {
    return {
      code: ErrorCodes.IMPORT_TOO_MANY_FILES,
      message: `Batch exceeds ${LIMITS.MAX_FILES_PER_BATCH} files (got ${files.length}).`
    };
  }
  const total = files.reduce((n, f) => n + (f.size || 0), 0);
  if (total > LIMITS.MAX_BATCH_BYTES) {
    return {
      code: ErrorCodes.IMPORT_SIZE_LIMIT_EXCEEDED,
      message: `Batch exceeds 2 GB combined size.`
    };
  }
  return null;
}

export function validateFadeSec(sec: number): FieldError | null {
  if (!Number.isFinite(sec) || sec < LIMITS.FADE_MIN_SEC || sec > LIMITS.FADE_MAX_SEC) {
    return {
      code: ErrorCodes.FADE_RANGE_INVALID,
      message: `Fade must be between ${LIMITS.FADE_MIN_SEC}s and ${LIMITS.FADE_MAX_SEC}s.`
    };
  }
  // Enforce 0.1s step.
  const steps = Math.round(sec / LIMITS.FADE_STEP_SEC);
  if (Math.abs(steps * LIMITS.FADE_STEP_SEC - sec) > 1e-6) {
    return {
      code: ErrorCodes.FADE_RANGE_INVALID,
      message: `Fade must be a multiple of 0.1s.`
    };
  }
  return null;
}

export function validateBalance(n: number): FieldError | null {
  if (!Number.isInteger(n) || n < LIMITS.BALANCE_MIN || n > LIMITS.BALANCE_MAX) {
    return {
      code: ErrorCodes.BALANCE_RANGE_INVALID,
      message: `Balance must be an integer between ${LIMITS.BALANCE_MIN} and ${LIMITS.BALANCE_MAX}.`
    };
  }
  return null;
}

export function validateMarkerNote(note: string): FieldError | null {
  const v = (note ?? '').trim();
  if (v.length === 0) {
    return { code: ErrorCodes.MARKER_NOTE_REQUIRED, message: 'Marker note is required.' };
  }
  if (v.length > LIMITS.MARKER_NOTE_MAX) {
    return {
      code: ErrorCodes.MARKER_NOTE_REQUIRED,
      message: `Marker note must be <= ${LIMITS.MARKER_NOTE_MAX} chars.`
    };
  }
  return null;
}

export function validatePlaybackSpeed(speed: number): FieldError | null {
  if (!Number.isFinite(speed) || speed < LIMITS.SPEED_MIN || speed > LIMITS.SPEED_MAX) {
    return {
      code: 'SPEED_INVALID',
      message: `Playback speed must be between ${LIMITS.SPEED_MIN}x and ${LIMITS.SPEED_MAX}x.`
    };
  }
  return null;
}

export function validateExportFormat(
  format: 'mp3' | 'wav',
  bitrate?: number,
  sampleRate?: number
): FieldError | null {
  if (format === 'mp3') {
    if (bitrate == null) {
      return { code: ErrorCodes.EXPORT_INVALID_BITRATE, message: 'MP3 requires a bitrate.' };
    }
    if (!(LIMITS.MP3_BITRATES as readonly number[]).includes(bitrate)) {
      return {
        code: ErrorCodes.EXPORT_INVALID_BITRATE,
        message: `MP3 bitrate must be one of ${LIMITS.MP3_BITRATES.join(', ')} kbps.`
      };
    }
    return null;
  }
  if (format === 'wav') {
    const sr = sampleRate ?? LIMITS.WAV_SAMPLE_RATE;
    if (sr !== LIMITS.WAV_SAMPLE_RATE) {
      return {
        code: ErrorCodes.EXPORT_INVALID_SAMPLE_RATE,
        message: `WAV must be ${LIMITS.WAV_SAMPLE_RATE} Hz.`
      };
    }
    return null;
  }
  return { code: ErrorCodes.EXPORT_INVALID_FORMAT, message: `Unknown format: ${format}.` };
}

export function validateAttendanceTopN(n: number): FieldError | null {
  if (!Number.isInteger(n) || n < LIMITS.ATTENDANCE_TOP_N_MIN || n > LIMITS.ATTENDANCE_TOP_N_MAX) {
    return {
      code: ErrorCodes.ATTENDANCE_TOP_N_INVALID,
      message: `Top-N must be integer ${LIMITS.ATTENDANCE_TOP_N_MIN}..${LIMITS.ATTENDANCE_TOP_N_MAX}.`
    };
  }
  return null;
}

export function validateAttendanceThreshold(t: number): FieldError | null {
  if (
    !Number.isFinite(t) ||
    t < LIMITS.ATTENDANCE_THRESHOLD_MIN ||
    t > LIMITS.ATTENDANCE_THRESHOLD_MAX
  ) {
    return {
      code: ErrorCodes.ATTENDANCE_THRESHOLD_INVALID,
      message: `Threshold must be in [${LIMITS.ATTENDANCE_THRESHOLD_MIN}, ${LIMITS.ATTENDANCE_THRESHOLD_MAX}].`
    };
  }
  return null;
}

export function validateCohortWindow(
  startDate: string,
  endDate: string
): FieldError | null {
  const s = Date.parse(startDate);
  const e = Date.parse(endDate);
  if (Number.isNaN(s) || Number.isNaN(e)) {
    return {
      code: ErrorCodes.COHORT_DATE_WINDOW_INVALID,
      message: 'Cohort window dates must be valid ISO dates.'
    };
  }
  if (s > e) {
    return {
      code: ErrorCodes.COHORT_DATE_WINDOW_INVALID,
      message: 'Cohort window startDate must be <= endDate.'
    };
  }
  return null;
}
