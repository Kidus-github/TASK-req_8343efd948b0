// Browser test: multi-tab lock / read-only behavior.
// Opens the same project in two browser contexts and verifies the second
// one gets the read-only warning.

import { expect, test } from '@playwright/test';

async function setupProfile(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    const dbs = (await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
    for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
    try { localStorage.clear(); } catch {}
  });
  await page.goto('/');
  await page.getByLabel(/username/i).fill('Multi-Tab Tester');
  await page.locator('#cw-passphrase').fill('test-pass-1');
  await page.getByRole('button', { name: /create profile/i }).click();
  await page.getByPlaceholder(/new project name/i).fill('Shared Proj');
  await page.getByRole('button', { name: /^create project$/i }).click();
}

test.describe('Multi-tab lock', () => {
  test('second tab sees read-only or lock warning when opening the same project', async ({
    browser
  }) => {
    // Tab 1: create a profile and open the project.
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await setupProfile(page1);
    await page1.getByRole('row', { name: /shared proj/i }).getByRole('button', { name: /open/i }).click();
    await expect(page1.getByRole('heading', { name: 'Shared Proj' })).toBeVisible();

    // Tab 2: same browser context (shared IndexedDB). Unlock and open same project.
    const page2 = await ctx1.newPage();
    await page2.goto('/');
    // Already unlocked in this context; profile exists so we get the unlock gate.
    await page2.locator('#cw-passphrase').fill('test-pass-1');
    await page2.getByRole('button', { name: /unlock/i }).click();
    await page2.getByRole('row', { name: /shared proj/i }).getByRole('button', { name: /open/i }).click();

    // Expect either a "read-only" pill, the lock modal, or a toast warning.
    const readOnlyIndicator = page2.getByText(/read-only/i);
    const lockModal = page2.getByText(/open in another tab/i);
    await expect(readOnlyIndicator.or(lockModal).first()).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
  });
});
