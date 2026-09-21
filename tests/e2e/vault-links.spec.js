import { test, expect } from '@playwright/test';
import { startTestServer } from '../node/helpers/test-server.js';

test('startup applies the saved theme and loading surface before the app module runs', async ({ page }) => {
  const server = await startTestServer();
  try {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('collabmd-theme', 'light'));
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto(`${server.appBaseUrl}/`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('status')).toHaveText('Opening workspace…');
    await expect(page.locator('#appShell')).toBeHidden();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('status')).toBeVisible();
  } finally {
    await page.goto('about:blank');
    await server.close();
  }
});

test('vault navigation stays available while a document waits for realtime sync', async ({ page }) => {
  const server = await startTestServer({ vaults: [{ id: 'alpha' }, { id: 'beta' }] });
  try {
    await page.addInitScript(() => localStorage.setItem('collabmd-user-name', 'Offline tester'));
    await page.routeWebSocket(/\/ws\/v\/alpha\/test\.md/, () => {});
    await page.goto(`${server.appBaseUrl}/?vault=alpha#file=test.md`);
    await expect(page.locator('.cm-content')).toContainText('alpha');
    await expect(page.locator('#workspaceLoading')).toHaveCount(0);
    await page.locator('.vault-switcher-button').click();
    await page.getByRole('menuitem', { name: 'beta', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('beta');
  } finally {
    await page.goto('about:blank');
    await server.close();
  }
});

test('optional vault dashboard searches names, preserves light theme, and bypasses direct links', async ({ page }) => {
  const server = await startTestServer({
    basePath: '/docs',
    vaultDashboard: true,
    vaults: [{ id: 'alpha', name: 'Cool project', seed: '# Alpha note\n' }, { id: 'beta', name: 'Team notes', seed: '# Beta note\n' }],
  });
  const connections = [];
  page.on('websocket', (socket) => connections.push(socket.url()));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('collabmd-theme', 'light');
      localStorage.setItem('collabmd-user-name', 'Vault tester');
      localStorage.setItem('collabmd.activeVault', 'beta');
    });
    await page.goto(`${server.appBaseUrl}/`);
    await expect(page.getByRole('heading', { name: 'Choose a vault' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(connections).toEqual([]);
    await expect(page.locator('#appShell')).toBeHidden();
    const input = page.getByRole('searchbox', { name: 'Find a vault' });
    await input.fill('missing');
    await expect(page.getByText('No matching vaults.')).toBeVisible();
    await input.fill('clprj');
    await expect(page.getByRole('link', { name: 'Cool project' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Team notes' })).toBeHidden();
    await input.press('Enter');
    await expect(page).toHaveURL(`${server.appBaseUrl}/?vault=alpha`);
    await expect(page.locator('#workspaceLoading')).toHaveCount(0);
    await expect(page.locator('.vault-switcher-name')).toHaveText('Cool project');
    await page.goto(`${server.appBaseUrl}/?vault=beta&file=test.md`);
    await expect(page.locator('.cm-content')).toContainText('Beta note');
    await page.locator('.vault-switcher-button').click();
    const filter = page.getByRole('searchbox', { name: 'Filter vaults…' });
    await filter.fill('clprj');
    await expect(page.getByRole('menuitem', { name: 'Team notes' })).toBeHidden();
    await filter.press('Enter');
    await expect(page.locator('.cm-content')).toContainText('Alpha note');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page).toHaveURL(`${server.appBaseUrl}/?vault=alpha#file=test.md`);
    await page.goto(`${server.appBaseUrl}/`);
    await expect(page.getByRole('heading', { name: 'Choose a vault' })).toBeVisible();
  } finally {
    await page.goto('about:blank');
    await server.close();
  }
});

test('mobile vault popup searches IDs and restores focus on Escape', async ({ page }) => {
  const server = await startTestServer({
    vaults: [{ id: 'alpha', name: 'Cool project' }, { id: 'beta', name: 'Team notes' }],
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('collabmd-user-name', 'Mobile tester'));
    await page.goto(`${server.appBaseUrl}/?vault=alpha`);
    await expect(page.locator('#workspaceLoading')).toHaveCount(0);
    if (!await page.locator('.vault-switcher-button').isVisible()) {
      await page.locator('#sidebarToggle').click();
    }
    await page.locator('.vault-switcher-button').click();
    await page.getByRole('searchbox', { name: 'Filter vaults…' }).fill('bt');
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Cool project' })).toBeHidden();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Team notes' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('.vault-switcher-button')).toBeFocused();
    await page.locator('.vault-switcher-button').click();
    await page.getByRole('searchbox', { name: 'Filter vaults…' }).fill('beta');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${server.appBaseUrl}/?vault=beta`);
    await expect(page.locator('#workspaceLoading')).toHaveCount(0);
  } finally {
    await page.goto('about:blank');
    await server.close();
  }
});

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
