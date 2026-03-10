import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('npm pack includes built public assets required by the Homebrew install', async () => {
  await execFile('npm', ['run', 'build'], {
    cwd: rootDir,
  });

  const { stdout } = await execFile('npm', ['pack', '--dry-run', '--json'], {
    cwd: rootDir,
  });
  const [result] = JSON.parse(stdout);
  const packagedPaths = new Set((result?.files ?? []).map((file) => file.path));

  assert.ok(packagedPaths.has('public/index.html'));
  assert.ok(packagedPaths.has('public/assets/css/base.css'));
  assert.ok(packagedPaths.has('public/assets/css/style.css'));
  assert.ok(packagedPaths.has('public/assets/js/main.js'));
  assert.ok(packagedPaths.has('public/assets/vendor/highlight/github-dark.min.css'));
});
