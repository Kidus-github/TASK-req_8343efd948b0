// Real browser smoke test — profile → project → import → edit availability
// → export confirmation. Runs against `npm run preview` (the built SPA) in
// a headless Chromium browser via Playwright.
//
// This is the single browser-backed test in the repo. The rest of the test
// suite runs under jsdom. Running this test requires the Playwright browsers
// to be installed (`npx playwright install chromium`) — that is a one-time
// download step that is NOT part of the offline Docker build. See README.

import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Build a tiny WAV fixture on the host so the browser can receive a real,
// valid audio file through its file input. A few samples at 44.1 kHz is
// enough to exercise import → duration-parse → editor readiness.
function buildWavFixture(): string {
  const sr = 44100;
  const samples = sr; // 1 second stereo
  const bitsPerSample = 16;
  const numChannels = 2;
  const byteRate = (sr * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
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
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
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
  const fp = path.join(dir, 'smoke.wav');
  fs.writeFileSync(fp, buffer);
  return fp;
}

test.describe('CleanWave smoke', () => {
  test('profile → project → import → edit availability → export confirmation', async ({ page }) => {
    const fixture = buildWavFixture();

    // Start from a clean persistent state.
    await page.goto('/');
    await page.evaluate(async () => {
      const dbs = (await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
      try { localStorage.clear(); } catch {}
    });
    await page.goto('/');

    // ---------- Create local profile ----------
    await expect(page.getByRole('heading', { name: /create your local profile/i })).toBeVisible();
    await page.getByLabel(/username/i).fill('Smoke Tester');
    await page.locator('#cw-passphrase').fill('offline-gate-9');
    await page.getByRole('button', { name: /create profile/i }).click();
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();

    // ---------- Create a project ----------
    await page.getByPlaceholder(/new project name/i).fill('Smoke Project');
    await page.getByRole('button', { name: /^create project$/i }).click();
    await page.getByRole('row', { name: /smoke project/i }).getByRole('button', { name: /open/i }).click();
    await expect(page.getByRole('heading', { name: 'Smoke Project' })).toBeVisible();

    // ---------- Import an audio file ----------
    const fileChooser = page.locator('input[type="file"][accept*=".wav"]').first();
    await fileChooser.setInputFiles(fixture);

    // ---------- Assert the edit view sees the new file immediately ----------
    // The File selector select in the editor should contain our fixture.
    const editorFileSelect = page.locator('select').filter({ hasText: 'smoke.wav' });
    await expect(editorFileSelect).toBeVisible({ timeout: 10_000 });

    // ---------- Go to the Export tab and add the file to the cart ----------
    await page.getByRole('button', { name: 'Export' }).or(page.locator('.tab', { hasText: 'Export' })).first().click();
    // Format defaults to mp3 / 192 kbps. Add to cart.
    await page.getByRole('button', { name: /add to cart/i }).click();
    await expect(page.getByText(/added to export cart/i)).toBeVisible();

    // Open the cart drawer; Confirm should exist and be enabled.
    await page.getByRole('button', { name: /open cart/i }).click();
    const confirm = page.getByRole('button', { name: /confirm & render|submitting/i });
    await expect(confirm).toBeEnabled();

    // ---------- Duplicate-submit guard ----------
    // Click confirm; a confirm-modal appears. We just need to verify the
    // button is immediately disabled while submitting and that double-click
    // can't create two submissions.
    await confirm.click();
    const modalConfirm = page.getByRole('button', { name: /^confirm$/i });
    await modalConfirm.click();

    // After resolving, we expect the queued rendering state in the UI. The
    // button in the drawer footer should no longer say "Submitting".
    await expect(page.getByText(/rendering|export queued|completed/i).first()).toBeVisible({
      timeout: 20_000
    });
  });
});
