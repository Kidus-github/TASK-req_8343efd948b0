import { expect, test } from '@playwright/test';
import { buildWavFixture, createLocalProfile, resetBrowserState } from './helpers';

test.describe('Export download flow', () => {
  test('import -> export -> download updates the report and produces a browser download', async ({ page }) => {
    test.setTimeout(90_000);
    const fixture = buildWavFixture('export-test.wav', 880);
    await resetBrowserState(page);

    await createLocalProfile(page, 'Exporter', 'test-pass-1');
    await page.getByPlaceholder(/new project name/i).fill('Export Proj');
    await page.getByRole('button', { name: /^create project$/i }).click();

    await page.locator('input[type="file"][accept*=".wav"]').first().setInputFiles(fixture);
    await expect(page.locator('select').filter({ hasText: 'export-test.wav' })).toBeVisible({ timeout: 10_000 });

    await page.locator('.tab', { hasText: 'Export' }).click();
    await page.locator('select').filter({ hasText: 'WAV' }).first().selectOption('wav');
    await page.getByRole('button', { name: /add to cart/i }).click();
    await expect(page.getByText(/added to export cart/i)).toBeVisible();

    await page.getByRole('button', { name: /open cart/i }).click();
    await page.getByRole('button', { name: /confirm & render/i }).click();
    await page.getByRole('button', { name: /^confirm$/i }).click();

    const downloadButton = page.getByRole('button', { name: /download/i }).first();
    await expect(downloadButton).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;
    expect(await download.suggestedFilename()).toMatch(/\.wav$/i);

    await page.locator('.tab', { hasText: 'Reports' }).click();
    await expect(page.locator('tr', { hasText: 'Imported' })).toContainText('1');
    await expect(page.locator('tr', { hasText: 'Exported' })).toContainText('1');
    await expect(page.locator('.card', { hasText: 'Export format breakdown' })).toContainText(/wav/i);
  });
});
