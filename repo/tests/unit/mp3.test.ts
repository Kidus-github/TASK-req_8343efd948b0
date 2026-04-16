// Verify that MP3 output is actually a real MP3 byte stream — not WAV wrapped
// in an mp3 mime type. We check the MPEG frame sync bytes (0xFF 0xE*) and the
// first frame's header layer.

import { describe, expect, it } from 'vitest';
import { encodeMp3Bytes } from '../../src/lib/util/audio';

function makeSineBuffer(samples: number, sampleRate: number, hz: number): Float32Array {
  const buf = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    buf[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.3;
  }
  return buf;
}

function findMp3Frame(bytes: Uint8Array): number {
  // MPEG audio frames start with 11 sync bits: 0xFF 0xE*
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) return i;
  }
  return -1;
}

describe('real MP3 encoder', () => {
  it('emits MPEG frame sync bytes (not RIFF/WAVE)', async () => {
    const sr = 44100;
    const left = makeSineBuffer(sr, sr, 440); // 1 second of 440Hz
    const right = makeSineBuffer(sr, sr, 440);
    const bytes = await encodeMp3Bytes([left, right], sr, 192);
    expect(bytes.length).toBeGreaterThan(0);

    // Must NOT start with RIFF
    const header = new TextDecoder().decode(bytes.slice(0, 4));
    expect(header).not.toBe('RIFF');

    // Must contain an MPEG frame sync.
    const idx = findMp3Frame(bytes);
    expect(idx).toBeGreaterThanOrEqual(0);
    // Layer bits (bit 1-2 of byte after sync): 01 = Layer III
    const layerBits = (bytes[idx + 1] >> 1) & 0x03;
    expect(layerBits).toBe(0x01);
  });

  it('supports all documented bitrates', async () => {
    const sr = 44100;
    const buf = makeSineBuffer(sr / 4, sr, 880);
    for (const br of [128, 192, 320] as const) {
      const bytes = await encodeMp3Bytes([buf, buf], sr, br);
      const idx = findMp3Frame(bytes);
      expect(idx).toBeGreaterThanOrEqual(0);
    }
  });

  it('higher bitrate produces a larger file for the same content', async () => {
    const sr = 44100;
    const buf = makeSineBuffer(sr, sr, 1000);
    const low = await encodeMp3Bytes([buf, buf], sr, 128);
    const high = await encodeMp3Bytes([buf, buf], sr, 320);
    expect(high.length).toBeGreaterThan(low.length);
  });
});
