import { test, expect } from '@playwright/test';
import { startTestServer } from '../node/helpers/test-server.js';

test('vault URLs, copied file links, and switching preserve the requested vault', async ({ browser }) => {
  const server = await startTestServer({
    basePath: '/docs',
    vaults: [{ id: 'alpha', seed: '# Alpha note\n' }, { id: 'beta', seed: '# Beta note\n' }],
  });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const recipientContext = await browser.newContext();
  try {
    await recipientContext.addInitScript(() => {
      localStorage.setItem('collabmd-user-name', 'Recipient');
      localStorage.setItem('collabmd.activeVault', 'alpha');
    });
    await context.addInitScript(() => {
      localStorage.setItem('collabmd-user-name', 'Link tester');
      localStorage.setItem('collabmd.activeVault', 'alpha');
    });
    const page = await context.newPage();
    await page.goto(`${server.appBaseUrl}/?vault=beta&file=test.md`);
    await expect(page.locator('.cm-content')).toContainText('Beta note');
    await expect(page).toHaveURL(`${server.appBaseUrl}/?vault=beta#file=test.md`);
    await page.locator('.file-tree-item[data-path="test.md"]').click({ button: 'right' });
    await page.getByText('Copy as URL', { exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`${server.appBaseUrl}/?vault=beta#file=test.md`);
    await page.evaluate(() => {
      window.testClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    });
    await page.locator('.file-tree-item[data-path="test.md"]').click({ button: 'right' });
    await page.getByText('Copy as URL', { exact: true }).click();
    expect(await page.evaluate(() => window.testClipboard.readText())).toBe(copied);
    await expect(page.locator('.clipboard-fallback')).toHaveCount(0);
    const recipient = await recipientContext.newPage();
    await recipient.goto(copied);
    await expect(recipient.locator('.cm-content')).toContainText('Beta note');
    await page.locator('.vault-switcher-button').click();
    await page.getByRole('menuitem', { name: 'alpha', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('Alpha note');
    await expect(page).toHaveURL(`${server.appBaseUrl}/?vault=alpha#file=test.md`);
    await recipient.reload();
    await expect(recipient.locator('.cm-content')).toContainText('Beta note');
  } finally {
    await recipientContext.close();
    await context.close();
    await server.close();
  }
});
