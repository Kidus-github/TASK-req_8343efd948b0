import { expect, test } from '@playwright/test';
import { buildWavFixture, createLocalProfile, resetBrowserState } from './helpers';

test.describe('CleanWave smoke', () => {
  test('profile -> project -> import -> marker -> export -> reports -> playlist search', async ({ page }) => {
    test.setTimeout(90_000);
    const fixture = buildWavFixture('smoke.wav', 440);
    await resetBrowserState(page);

    await expect(page.getByRole('heading', { name: /create your local profile/i })).toBeVisible();
    await createLocalProfile(page, 'Smoke Tester', 'offline-gate-9');
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();

    await page.getByPlaceholder(/new project name/i).fill('Smoke Project');
    await page.getByRole('button', { name: /^create project$/i }).click();
    await expect(page.getByRole('heading', { name: 'Smoke Project' })).toBeVisible();

    await page.locator('input[type="file"][accept*=".wav"]').first().setInputFiles(fixture);
    const editorFileSelect = page.locator('select').filter({ hasText: 'smoke.wav' });
    await expect(editorFileSelect).toBeVisible({ timeout: 10_000 });

    const waveform = page.locator('canvas.waveform');
    await waveform.click({ position: { x: 80, y: 40 } });
    await page.getByPlaceholder(/marker note/i).fill('intro cue');
    await page.getByRole('button', { name: /add marker at/i }).click();
    await expect(page.getByRole('cell', { name: /intro cue/i })).toBeVisible();

    await page.getByRole('button', { name: 'Export' }).or(page.locator('.tab', { hasText: 'Export' })).first().click();
    await page.getByRole('button', { name: /add to cart/i }).click();
    await expect(page.getByText(/added to export cart/i)).toBeVisible();

    await page.getByRole('button', { name: /open cart/i }).click();
    const confirm = page.getByRole('button', { name: /confirm & render|submitting/i });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await page.getByRole('button', { name: /^confirm$/i }).click();
    await expect(page.getByRole('button', { name: /download/i }).first()).toBeVisible({
      timeout: 30_000
    });

    await page.getByRole('button', { name: 'Reports' }).or(page.locator('.tab', { hasText: 'Reports' })).first().click();
    await expect(page.locator('tr', { hasText: 'Exported' })).toContainText('1');

    await page.getByRole('button', { name: /close/i }).click();
    await page.getByRole('button', { name: /playlists/i }).click();
    await page.getByPlaceholder(/new playlist name/i).fill('Smoke List');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByRole('heading', { name: 'Smoke List' })).toBeVisible();
    await page.getByPlaceholder(/^note$/i).fill('opening');
    await page.getByRole('button', { name: /add track/i }).click();
    await expect(page.getByRole('cell', { name: /smoke\.wav/i })).toBeVisible();
    await page.getByPlaceholder(/search filename or note/i).fill('opening');
    await expect(page.getByRole('cell', { name: /opening/i })).toBeVisible();
  });
});
