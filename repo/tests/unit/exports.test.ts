import { describe, expect, it } from 'vitest';
import { applyCollisionSuffix, defaultFilename } from '../../src/lib/services/exports';

describe('defaultFilename', () => {
  it('builds canonical stem and respects extension', () => {
    const name = defaultFilename({
      projectName: 'Podcast / S2',
      sourceFilename: 'Ep 01 — Intro.mp3',
      format: 'mp3',
      bitrate: 192,
      timestamp: new Date('2026-04-15T10:11:12Z')
    });
    expect(name).toMatch(/Podcast-S2_Ep-01-Intro_mp3-192kbps_20260415T101112Z.mp3/);
  });
  it('wav uses sample rate spec', () => {
    const name = defaultFilename({
      projectName: 'p',
      sourceFilename: 'a.wav',
      format: 'wav',
      sampleRate: 44100,
      timestamp: new Date('2026-04-15T10:11:12Z')
    });
    expect(name.endsWith('.wav')).toBe(true);
    expect(name).toContain('wav-44100hz');
  });
});

describe('applyCollisionSuffix', () => {
  it('returns desired if unused', () => {
    expect(applyCollisionSuffix([], 'a.mp3')).toBe('a.mp3');
  });
  it('appends incrementing suffix', () => {
    expect(applyCollisionSuffix(['a.mp3'], 'a.mp3')).toBe('a_1.mp3');
    expect(applyCollisionSuffix(['a.mp3', 'a_1.mp3'], 'a.mp3')).toBe('a_2.mp3');
  });
});
