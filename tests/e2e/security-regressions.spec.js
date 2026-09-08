import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { PullBackupStore } from '../../src/server/infrastructure/persistence/pull-backup-store.js';
import { expect, openHome, test } from './helpers/app-fixture.js';

test('backup summaries open read-only and historical SVG scripts remain blocked', async ({ page, context, e2eServer }) => {
  await openHome(page);
  const git = (args) => promisify(execFile)('git', args, { cwd: e2eServer.vaultDir });
  await git(['init']);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>window.name="script-executed"</script><rect width="20" height="20"/></svg>';
  await writeFile(join(e2eServer.vaultDir, 'security.svg'), svg);
  await git(['add', 'security.svg']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'SVG fixture']);
  const backup = await new PullBackupStore({ vaultDir: e2eServer.vaultDir }).createBackup({ entries: [] });

  await page.request.get('/api/git/status?force=true');
  await page.reload();
  await page.locator('#gitSidebarTab').click();
  const popupPromise = context.waitForEvent('page');
  await page.locator(`[data-git-pull-backup-id="${backup.id}"]`).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup).toHaveURL(/\/git\/pull-backup-summary\?id=/);
  await expect(popup.locator('body')).toContainText('Recovery');
  expect((await page.request.get(`/api/file?path=${encodeURIComponent(backup.summaryPath)}`)).status()).toBe(404);

  const imagePage = await context.newPage();
  const response = await imagePage.goto(`${e2eServer.baseURL}/api/git/file-attachment?hash=HEAD&path=security.svg`);
  expect(response.status()).toBe(200);
  await expect(imagePage.locator('svg rect')).toHaveCount(1);
  expect(await imagePage.evaluate(() => window.name)).toBe('');
  expect(response.headers()['content-security-policy']).toContain('sandbox');
});
