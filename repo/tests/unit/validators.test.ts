import { describe, expect, it } from 'vitest';
import {
  extensionOf,
  isAllowedExtension,
  validateAttendanceThreshold,
  validateAttendanceTopN,
  validateBalance,
  validateCohortWindow,
  validateExportFormat,
  validateFadeSec,
  validateImportBatch,
  validateImportFile,
  validateMarkerNote,
  validatePassphrase,
  validatePlaybackSpeed,
  validateUsername
} from '../../src/lib/util/validators';
import { LIMITS } from '../../src/lib/util/constants';

describe('validateUsername', () => {
  it('rejects empty and too-long names', () => {
    expect(validateUsername('')).not.toBeNull();
    expect(validateUsername('x'.repeat(51))).not.toBeNull();
  });
  it('trims whitespace', () => {
    expect(validateUsername('   a  ')).toBeNull();
  });
  it('accepts valid', () => {
    expect(validateUsername('Nova')).toBeNull();
  });
});

describe('validatePassphrase', () => {
  it('requires min length', () => {
    expect(validatePassphrase('abc12')).not.toBeNull();
  });
  it('requires a digit', () => {
    expect(validatePassphrase('abcdefghi')).not.toBeNull();
  });
  it('accepts compliant passphrases', () => {
    expect(validatePassphrase('correct-horse-9')).toBeNull();
  });
});

describe('extensionOf / isAllowedExtension', () => {
  it('detects common extensions', () => {
    expect(extensionOf('file.Mp3')).toBe('mp3');
    expect(extensionOf('x.wav')).toBe('wav');
    expect(extensionOf('y.ogg')).toBe('ogg');
    expect(extensionOf('y')).toBe('');
  });
  it('allows only mp3/wav/ogg', () => {
    expect(isAllowedExtension('mp3')).toBe(true);
    expect(isAllowedExtension('flac')).toBe(false);
  });
});

describe('validateImportFile', () => {
  it('rejects empty filename', () => {
    expect(validateImportFile('', 1000)?.code).toBe('IMPORT_EMPTY_FILENAME');
  });
  it('rejects zero bytes', () => {
    expect(validateImportFile('a.mp3', 0)?.code).toBe('IMPORT_ZERO_BYTES');
  });
  it('rejects unsupported extension', () => {
    expect(validateImportFile('a.flac', 5)?.code).toBe('IMPORT_UNSUPPORTED_TYPE');
  });
  it('accepts valid', () => {
    expect(validateImportFile('song.mp3', 1024)).toBeNull();
  });
});

describe('validateImportBatch', () => {
  it('enforces file count cap', () => {
    const files = Array.from({ length: LIMITS.MAX_FILES_PER_BATCH + 1 }, (_, i) => ({
      name: `f${i}.mp3`,
      size: 100
    }));
    expect(validateImportBatch(files)?.code).toBe('IMPORT_TOO_MANY_FILES');
  });
  it('enforces total size cap', () => {
    const big = LIMITS.MAX_BATCH_BYTES + 1;
    expect(validateImportBatch([{ name: 'a.mp3', size: big }])?.code).toBe(
      'IMPORT_SIZE_LIMIT_EXCEEDED'
    );
  });
  it('accepts valid batches', () => {
    expect(validateImportBatch([{ name: 'a.mp3', size: 1024 }])).toBeNull();
  });
});

describe('validateFadeSec', () => {
  it('rejects below and above range', () => {
    expect(validateFadeSec(0.05)?.code).toBe('FADE_RANGE_INVALID');
    expect(validateFadeSec(10.1)?.code).toBe('FADE_RANGE_INVALID');
  });
  it('accepts boundary values', () => {
    expect(validateFadeSec(0.1)).toBeNull();
    expect(validateFadeSec(10.0)).toBeNull();
  });
  it('enforces 0.1s step', () => {
    expect(validateFadeSec(0.15)?.code).toBe('FADE_RANGE_INVALID');
    expect(validateFadeSec(1.2)).toBeNull();
  });
});

describe('validateBalance', () => {
  it('rejects non-integer and out-of-range', () => {
    expect(validateBalance(0.5)?.code).toBe('BALANCE_RANGE_INVALID');
    expect(validateBalance(101)?.code).toBe('BALANCE_RANGE_INVALID');
    expect(validateBalance(-101)?.code).toBe('BALANCE_RANGE_INVALID');
  });
  it('accepts valid integers', () => {
    expect(validateBalance(0)).toBeNull();
    expect(validateBalance(-100)).toBeNull();
    expect(validateBalance(100)).toBeNull();
  });
});

describe('validateMarkerNote', () => {
  it('requires a note', () => {
    expect(validateMarkerNote('')?.code).toBe('MARKER_NOTE_REQUIRED');
  });
  it('caps length', () => {
    expect(validateMarkerNote('x'.repeat(501))?.code).toBe('MARKER_NOTE_REQUIRED');
  });
  it('accepts short notes', () => {
    expect(validateMarkerNote('hello')).toBeNull();
  });
});

describe('validatePlaybackSpeed', () => {
  it('rejects out-of-range', () => {
    expect(validatePlaybackSpeed(0.4)?.code).toBe('SPEED_INVALID');
    expect(validatePlaybackSpeed(2.1)?.code).toBe('SPEED_INVALID');
  });
  it('accepts common speeds', () => {
    for (const s of [0.5, 1.0, 1.5, 2.0]) {
      expect(validatePlaybackSpeed(s)).toBeNull();
    }
  });
});

describe('validateExportFormat', () => {
  it('enforces mp3 bitrates', () => {
    expect(validateExportFormat('mp3', 64)?.code).toBe('EXPORT_INVALID_BITRATE');
    expect(validateExportFormat('mp3', 192)).toBeNull();
  });
  it('enforces wav sample rate', () => {
    expect(validateExportFormat('wav', undefined, 48000)?.code).toBe('EXPORT_INVALID_SAMPLE_RATE');
    expect(validateExportFormat('wav', undefined, 44100)).toBeNull();
    expect(validateExportFormat('wav')).toBeNull();
  });
});

describe('validateAttendance', () => {
  it('validates Top-N', () => {
    expect(validateAttendanceTopN(0)?.code).toBe('ATTENDANCE_TOP_N_INVALID');
    expect(validateAttendanceTopN(11)?.code).toBe('ATTENDANCE_TOP_N_INVALID');
    expect(validateAttendanceTopN(3)).toBeNull();
  });
  it('validates threshold', () => {
    expect(validateAttendanceThreshold(-0.1)?.code).toBe('ATTENDANCE_THRESHOLD_INVALID');
    expect(validateAttendanceThreshold(1.1)?.code).toBe('ATTENDANCE_THRESHOLD_INVALID');
    expect(validateAttendanceThreshold(0.75)).toBeNull();
  });
});

describe('validateCohortWindow', () => {
  it('requires start <= end', () => {
    expect(validateCohortWindow('2026-01-10', '2026-01-01')?.code).toBe(
      'COHORT_DATE_WINDOW_INVALID'
    );
    expect(validateCohortWindow('2026-01-01', '2026-01-10')).toBeNull();
  });
});
