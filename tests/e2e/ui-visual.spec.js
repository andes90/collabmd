import {
  expect,
  openFile,
  test,
  writeVaultFileAndResetCollab,
} from './helpers/app-fixture.js';
import { startTestServer } from '../node/helpers/test-server.js';

test.describe('ui visual regression', () => {
  test('matches the steady-state desktop workspace shell', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-theme', 'light');
      window.localStorage.setItem('collabmd-user-name', 'Audit User');
    });

    await openFile(page, 'README.md', { userName: 'Audit User', waitFor: 'preview' });
    await expect(page.locator('#previewContent')).toContainText('My Vault');
    await expect(page.locator('#activeFileName')).toHaveText('README');

    await expect(page).toHaveScreenshot('desktop-workspace-shell.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });

  test('matches the steady-state mobile preview shell', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-theme', 'light');
      window.localStorage.setItem('collabmd-user-name', 'Audit User');
    });

    await openFile(page, 'README.md', { userName: 'Audit User', waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
    await expect(page.locator('#previewContent')).toContainText('My Vault');

    await expect(page).toHaveScreenshot('mobile-preview-shell.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });

  test('covers a dark desktop Create menu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-theme', 'dark');
      window.localStorage.setItem('collabmd-user-name', 'Audit User');
    });
    await openFile(page, 'README.md', { userName: 'Audit User', waitFor: 'preview' });

    await page.locator('#sidebarCreateBtn').click();
    await expect(page.locator('.create-menu')).toBeVisible();
    await expect(page).toHaveScreenshot('desktop-dark-create-menu.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });

  test('covers a light mobile Create dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-theme', 'light');
      window.localStorage.setItem('collabmd-user-name', 'Audit User');
    });
    await openFile(page, 'README.md', { userName: 'Audit User', waitFor: 'preview' });

    await page.locator('#sidebarToggle').click();
    await page.locator('#sidebarCreateBtn').click();
    await page.locator('.create-action-sheet').getByRole('button', { name: /Markdown note/i }).click();
    await expect(page.locator('#fileActionDialog')).toBeVisible();
    await expect(page).toHaveScreenshot('mobile-light-create-dialog.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });

  test('covers the production diff error route on light desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-theme', 'light');
      window.localStorage.setItem('collabmd-user-name', 'Audit User');
    });
    await openFile(page, 'README.md', { userName: 'Audit User', waitFor: 'preview' });
    await page.route('**/git/diff?*', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: 'Synthetic visual-test failure' }),
        contentType: 'application/json',
        status: 500,
      });
    });

    await page.evaluate(() => { window.location.hash = 'git-diff='; });
    await expect(page.locator('#diffContent').getByRole('alert')).toHaveText('Failed to load git diff');
    await expect(page.locator('#diff-page')).toBeVisible();
    await expect(page).toHaveScreenshot('desktop-light-diff-states.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });

  test('covers a dark mobile Base editor state', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-theme', 'dark');
      window.localStorage.setItem('collabmd-user-name', 'Audit User');
    });
    await openFile(page, 'README.md', { userName: 'Audit User', waitFor: 'preview' });
    await writeVaultFileAndResetCollab(page, {
      path: 'visual-base-item.md',
      content: '# Visual Base Item\n\n#visualbase\n',
    });
    await writeVaultFileAndResetCollab(page, {
      path: 'visual.base',
      content: [
        'filters: file.ext == "md" && file.hasTag("visualbase")',
        'views:',
        '  - type: table',
        '    name: All',
        '    order: [file.name]',
      ].join('\n'),
    });
    await page.goto('about:blank');
    await openFile(page, 'visual.base', { userName: 'Audit User', waitFor: 'preview' });
    await expect(page.locator('.bases-shell')).toBeVisible();

    await expect(page).toHaveScreenshot('mobile-dark-base-editor.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });

  test('matches the password auth gate', async ({ page }) => {
    const app = await startTestServer({
      auth: {
        password: 'visual-secret',
        strategy: 'password',
      },
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem('collabmd-theme', 'dark');
        window.localStorage.setItem('collabmd-user-name', 'Audit User');
      });

      await page.goto(`${app.baseUrl}/#file=test.md`);
      await expect(page.locator('.auth-gate-card')).toBeVisible();

      await expect(page).toHaveScreenshot('auth-gate-password.png', {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        maxDiffPixelRatio: 0.015,
      });
    } finally {
      await app.close();
    }
  });
});
