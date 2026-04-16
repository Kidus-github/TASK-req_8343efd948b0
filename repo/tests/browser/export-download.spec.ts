// Browser test: import -> edit -> export -> download.
// Verifies the full export pipeline produces a downloadable file in a real
// browser with real Web Workers + IndexedDB + AudioContext.

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
    const v = Math.round(Math.sin((2 * Math.PI * 880 * i) / sr) * 0.4 * 0x7fff);
    for (let c = 0; c < numChannels; c++) {
      buffer.writeInt16LE(v, off);
      off += 2;
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
  const fp = path.join(dir, 'export-test.wav');
  fs.writeFileSync(fp, buffer);
  return fp;
}

test.describe('Export download flow', () => {
  test('import -> export -> download produces a file', async ({ page }) => {
    test.setTimeout(90_000);
    const fixture = buildWavFixture();
    await page.goto('/');
    await page.evaluate(async () => {
      const dbs = (await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
      try { localStorage.clear(); } catch {}
    });
    await page.goto('/');
    // Profile + project.
    await page.getByLabel(/username/i).fill('Exporter');
    await page.locator('#cw-passphrase').fill('test-pass-1');
    await page.getByRole('button', { name: /create profile/i }).click();
    await page.getByPlaceholder(/new project name/i).fill('Export Proj');
    await page.getByRole('button', { name: /^create project$/i }).click();
    await page.getByRole('row', { name: /export proj/i }).getByRole('button', { name: /open/i }).click();
    // Import.
    await page.locator('input[type="file"][accept*=".wav"]').first().setInputFiles(fixture);
    await expect(page.locator('select').filter({ hasText: 'export-test.wav' })).toBeVisible({ timeout: 10_000 });
    // Switch to Export tab.
    await page.locator('.tab', { hasText: 'Export' }).click();
    // Add to cart as WAV.
    await page.locator('select').filter({ hasText: 'WAV' }).first().selectOption('wav');
    await page.getByRole('button', { name: /add to cart/i }).click();
    await expect(page.getByText(/added to export cart/i)).toBeVisible();
    // Open cart and confirm.
    await page.getByRole('button', { name: /open cart/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();
    // Modal appears.
    const modalConfirm = page.getByRole('button', { name: /^confirm$/i });
    await modalConfirm.click();
    // Wait for the export to complete and a Download button to appear.
    await expect(page.getByRole('button', { name: /download/i }).first()).toBeVisible({
      timeout: 30_000
    });
  });
});
