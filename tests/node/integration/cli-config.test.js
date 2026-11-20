import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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
        await waitForCondition(() => output.includes('Share URL:'));
        assert.match(output, /#auth_password=test-cli-password\b/u);
      }
    } finally {
      if (!exited) child.kill('SIGTERM');
      await exit;
    }
  });
}
