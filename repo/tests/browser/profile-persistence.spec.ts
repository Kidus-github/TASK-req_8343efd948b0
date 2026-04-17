import { expect, test } from '@playwright/test';
import { createLocalProfile, resetBrowserState } from './helpers';

test.describe('Profile persistence and reset', () => {
  test('reload requires unlock, restores the last open project, and supports device reset', async ({ page }) => {
    test.setTimeout(90_000);
    await resetBrowserState(page);

    await createLocalProfile(page, 'Persistent User', 'offline-lock-9');
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();

    await page.getByPlaceholder(/new project name/i).fill('Restore Me');
    await page.getByRole('button', { name: /^create project$/i }).click();
    await expect(page.getByRole('heading', { name: 'Restore Me' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: /unlock cleanwave/i })).toBeVisible();
    await page.locator('#cw-passphrase').fill('offline-lock-9');
    await page.getByRole('button', { name: /^unlock$/i }).click();
    await expect(page.getByRole('heading', { name: 'Restore Me' })).toBeVisible();

    await page.getByRole('button', { name: /reset device profile/i }).click();
    await page.getByRole('button', { name: /^reset device$/i }).click();
    await expect(page.getByRole('heading', { name: /create your local profile/i })).toBeVisible();
  });
});
