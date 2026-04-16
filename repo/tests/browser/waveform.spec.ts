// Browser test: waveform/timeline interaction.
// Verifies the timeline canvas renders after import and responds to clicks.

import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

function buildWavFixture(): string {
  const sr = 44100;
  const samples = sr;
  const numChannels = 2;
  const bitsPerSample = 16;
  const dataSize = samples * numChannels * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE((sr * numChannels * bitsPerSample) / 8, 28);
  buffer.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3 * 0x7fff);
    for (let c = 0; c < numChannels; c++) {
      buffer.writeInt16LE(v, off);
      off += 2;
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
  const fp = path.join(dir, 'wave.wav');
  fs.writeFileSync(fp, buffer);
  return fp;
}

test.describe('Waveform timeline', () => {
  test('canvas is rendered after import and responds to click for seek', async ({ page }) => {
    const fixture = buildWavFixture();
    await page.goto('/');
    // Clean state.
    await page.evaluate(async () => {
      const dbs = (await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
      try { localStorage.clear(); } catch {}
    });
    await page.goto('/');
    // Create profile + project.
    await page.getByLabel(/username/i).fill('Waveform Tester');
    await page.locator('#cw-passphrase').fill('test-pass-1');
    await page.getByRole('button', { name: /create profile/i }).click();
    await page.getByPlaceholder(/new project name/i).fill('Wave Proj');
    await page.getByRole('button', { name: /^create project$/i }).click();
    await page.getByRole('row', { name: /wave proj/i }).getByRole('button', { name: /open/i }).click();
    // Import.
    const fileInput = page.locator('input[type="file"][accept*=".wav"]').first();
    await fileInput.setInputFiles(fixture);
    // Wait for the waveform canvas to appear and be sized.
    const canvas = page.locator('canvas.waveform');
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(100);
    // Click on the canvas (roughly 30% from the left) — this should set the
    // playhead position without error.
    await canvas.click({ position: { x: box!.width * 0.3, y: box!.height / 2 } });
  });
});
