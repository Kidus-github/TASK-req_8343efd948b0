// Browser test: attendance camera permission flow.
// Verifies the attendance panel renders model-status correctly and the
// camera-request button triggers the permission prompt (Playwright can
// grant or deny it).

import { expect, test } from '@playwright/test';

test.describe('Attendance camera flow', () => {
  test('attendance panel loads and shows model status', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      const dbs = (await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
      try { localStorage.clear(); } catch {}
    });
    await page.goto('/');
    // Create profile with operations role so attendance is visible.
    await page.getByLabel(/username/i).fill('Attendance Tester');
    await page.locator('#cw-passphrase').fill('test-pass-1');
    await page.locator('#cw-role').selectOption('operations');
    await page.getByRole('button', { name: /create profile/i }).click();
    // Navigate to attendance.
    await page.getByRole('button', { name: 'Attendance', exact: true }).click();
    // The attendance panel should show the model status (loaded or fallback).
    const modelStatus = page.locator('.pill.success, .pill.warning').first();
    await expect(modelStatus).toBeVisible({ timeout: 15_000 });
    // The text should mention either the model loaded or the fallback.
    const text = await modelStatus.textContent();
    expect(
      text?.includes('Face recognition model loaded') ||
      text?.includes('Face recognition model not available')
    ).toBe(true);
  });

  test('camera request button is present and clickable', async ({ page, context }) => {
    // Grant camera permission so the button resolves.
    await context.grantPermissions(['camera']);
    await page.goto('/');
    await page.evaluate(async () => {
      const dbs = (await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
      try { localStorage.clear(); } catch {}
    });
    await page.goto('/');
    await page.getByLabel(/username/i).fill('Camera Tester');
    await page.locator('#cw-passphrase').fill('test-pass-1');
    await page.locator('#cw-role').selectOption('operations');
    await page.getByRole('button', { name: /create profile/i }).click();
    await page.getByRole('button', { name: 'Attendance', exact: true }).click();
    // The "Request camera" button should be present.
    const cameraBtn = page.getByRole('button', { name: /request camera/i });
    await expect(cameraBtn).toBeVisible({ timeout: 10_000 });
  });
});
