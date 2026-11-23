import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { waitForCondition } from '../helpers/test-server.js';

async function choosePort() {
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

for (const usePortFlag of [false, true]) {
  test(`CLI uses ${usePortFlag ? '--port before PORT and isolates the tunnel password' : 'PORT when no flag is supplied'}`, async (t) => {
    const vault = await mkdtemp(join(tmpdir(), 'collabmd-cli-config-'));
    t.after(() => rm(vault, { force: true, recursive: true }));
    const port = await choosePort();
    const env = { ...process.env, AUTH_STRATEGY: 'none', HOST: '127.0.0.1', PORT: String(port) };
    const args = ['bin/collabmd.js', vault];
    if (usePortFlag) {
      const fakeCloudflared = join(vault, 'cloudflared');
      await writeFile(fakeCloudflared, `#!/bin/sh
if [ -n "\${AUTH_PASSWORD+x}" ]; then exit 1; fi
printf '%s\\n' 'https://example.trycloudflare.com'
`, { mode: 0o700 });
      env.CLOUDFLARED_BIN = fakeCloudflared;
      env.AUTH_PASSWORD = 'test-env-password';
      env.PORT = String(port === 1234 ? 1235 : 1234);
      args.push('--port', String(port), '--auth', 'password', '--auth-password', 'test-cli-password');
    } else {
      args.push('--no-tunnel');
    }

    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let exited = false;
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.resume();
    const exit = once(child, 'exit').then(() => { exited = true; });
    try {
      await waitForCondition(() => exited || output.includes('Ready for collaboration'));
      assert.equal(exited, false);
      assert.match(output, new RegExp(`Local:  http://localhost:${port}\\b`, 'u'));
      if (usePortFlag) {
        await waitForCondition(() => output.includes('https://example.trycloudflare.com'));
        assert.doesNotMatch(output, /test-cli-password|test-env-password|#auth_password=/u);
      }
    } finally {
      if (!exited) child.kill('SIGTERM');
      await exit;
    }
  });
}


test('local Structurizr starts after cloning a missing Git-backed vault', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'collabmd-cli-bootstrap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const vault = join(root, 'vault');
  const run = promisify(execFile);
  await mkdir(source);
  await run('git', ['init', '-q', source]);
  await writeFile(join(source, 'guide.md'), 'Source document');
  await run('git', ['-C', source, 'add', 'guide.md']);
  await run('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Initial']);
  // Finish at the Compose boundary so this test needs no renderer or network.
  await writeFile(join(root, 'docker'), `#!/bin/sh
test -f "$HOST_VAULT_DIR/guide.md" && echo "renderer saw the checkout"
exit 2
`, { mode: 0o700 });

  await assert.rejects(run(process.execPath, ['bin/collabmd.js', vault, '--local-structurizr', '--no-tunnel'], {
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      COLLABMD_GIT_REPO_URL: source,
      COLLABMD_GIT_SSH_PRIVATE_KEY_B64: Buffer.from('local fixture').toString('base64'),
    },
  }), (error) => {
    assert.match(error.stdout, /renderer saw the checkout/u);
    assert.match(error.stderr, /Failed to start local Structurizr/u);
    return true;
  });
});
