import { test, expect } from '@playwright/test';

import { startTestServer } from '../node/helpers/test-server.js';

const AUTH_PASSWORD = 'playwright-secret';

test.describe('password auth', () => {
  let app;

  test.beforeAll(async () => {
    app = await startTestServer({
      auth: {
        password: AUTH_PASSWORD,
        strategy: 'password',
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-user-name', 'Playwright User');
    });
  });

  test('requires a password before opening the editor and preserves the session across reloads', async ({ page }) => {
    await page.goto(`${app.baseUrl}/#file=test.md`);

    await expect(page.locator('.auth-gate-card')).toBeVisible();
    await page.locator('.auth-gate-input').fill('wrong-password');
    await page.locator('.auth-gate-button').click();
    await expect(page.locator('.auth-gate-error')).toContainText('Incorrect password');

    await page.locator('.auth-gate-input').fill(AUTH_PASSWORD);
    await page.locator('.auth-gate-button').click();

    await expect(page.locator('.cm-editor')).toBeVisible();

    await page.reload();
    await expect(page.locator('.auth-gate-card')).toHaveCount(0);
    await expect(page.locator('.cm-editor')).toBeVisible();
  });

  test('requires a new login in a fresh browser context', async ({ browser }) => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-user-name', 'Fresh Context User');
    });

    await page.goto(app.baseUrl);
    await expect(page.locator('.auth-gate-card')).toBeVisible();

    await page.close();
  });

  test('accepts a shared password from the URL fragment and removes it after login', async ({ page }) => {
    await page.goto(`${app.baseUrl}/#auth_password=${AUTH_PASSWORD}&file=test.md`);

    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page.locator('.auth-gate-card')).toHaveCount(0);
    await expect(page).toHaveURL(/#file=test\.md$/);
  });
});
