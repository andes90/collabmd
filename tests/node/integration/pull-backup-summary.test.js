import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { startTestServer } from '../helpers/test-server.js';

test('pull backup summaries remain authenticated, read-only, and confined to backup summaries', async (t) => {
  const app = await startTestServer({ auth: { strategy: 'password', password: 'backup-test' } });
  t.after(() => app.close());
  const id = '20260908-120000-abc1234';
  const summaryPath = `.collabmd/pull-backups/${id}/summary.md`;
  await mkdir(join(app.vaultDir, '.collabmd/pull-backups', id), { recursive: true });
  const summary = '# Pull Backup\n<script>alert(1)</script>\n';
  await writeFile(join(app.vaultDir, summaryPath), summary);
  const url = `${app.baseUrl}/api/git/pull-backup-summary?id=${id}`;
  assert.equal((await fetch(url)).status, 401);
  const login = await fetch(`${app.baseUrl}/api/auth/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'backup-test' }),
  });
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  assert.equal(await response.text(), summary);
  for (const invalidId of ['../config', `${id}/files/test.md`, 'missing', 'linked']) {
    if (invalidId === 'linked') {
      await symlink(join(app.vaultDir, '.collabmd/pull-backups', id), join(app.vaultDir, '.collabmd/pull-backups/linked'));
    }
    assert.equal((await fetch(`${app.baseUrl}/api/git/pull-backup-summary?id=${encodeURIComponent(invalidId)}`, { headers })).status, 404);
  }
  assert.equal((await fetch(`${app.baseUrl}/api/file?path=${encodeURIComponent(summaryPath)}`, { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 404);
});
