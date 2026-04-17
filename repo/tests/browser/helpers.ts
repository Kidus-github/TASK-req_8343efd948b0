import type { Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export function buildWavFixture(filename: string, hz = 440): string {
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
    const v = Math.round(Math.sin((2 * Math.PI * hz * i) / sr) * 0.4 * 0x7fff);
    for (let c = 0; c < numChannels; c++) {
      buffer.writeInt16LE(v, off);
      off += 2;
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
  const fp = path.join(dir, filename);
  fs.writeFileSync(fp, buffer);
  return fp;
}

export async function resetBrowserState(page: Page): Promise<void> {
  // Force prefs to allow heavy jobs regardless of wall-clock time. The app
  // defers export renders during quiet hours (22:00–06:00) by default, and
  // App.svelte re-syncs profile.quietHours into prefs every time the profile
  // changes — so a one-shot localStorage seed won't stick. Intercept writes
  // to the prefs key and force allowHeavyJobs back to true on every save.
  await page.addInitScript(() => {
    const KEY = 'cleanwave.prefs.v1';
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === KEY) {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object') {
            parsed.quietHours = {
              start: '22:00',
              end: '06:00',
              ...(parsed.quietHours ?? {}),
              allowHeavyJobs: true
            };
            value = JSON.stringify(parsed);
          }
        } catch {
          // Leave value untouched on parse error.
        }
      }
      return origSet.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const dbs =
      (await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
    try {
      localStorage.clear();
    } catch {
      // Ignore environments without localStorage access.
    }
    try {
      localStorage.setItem(
        'cleanwave.prefs.v1',
        JSON.stringify({
          theme: 'light',
          defaultPlaybackSpeed: 1.0,
          quietHours: { start: '22:00', end: '06:00', allowHeavyJobs: true },
          uiRole: 'editor',
          showDisclaimer: false
        })
      );
    } catch {
      // Ignore storage failures.
    }
    try {
      sessionStorage.clear();
    } catch {
      // Ignore environments without sessionStorage access.
    }
  });
  await page.goto('/');
}

export async function createLocalProfile(
  page: Page,
  username: string,
  passphrase: string,
  role: 'editor' | 'reviewer' | 'operations' = 'editor'
): Promise<void> {
  await page.getByLabel(/username/i).fill(username);
  await page.locator('#cw-passphrase').fill(passphrase);
  await page.locator('#cw-role').selectOption(role);
  await page.getByRole('button', { name: /create profile/i }).click();
}
