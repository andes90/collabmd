import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { loadConfig } from '../../src/server/config/env.js';
import { createAppServer } from '../../src/server/create-app-server.js';
import { prepareConfigForStartup } from '../../src/server/startup/git-remote-bootstrap.js';

const execFile = promisify(execFileCallback);

async function runGit(cwd, args) {
  await execFile('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_AUTHOR_NAME: 'CollabMD Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'CollabMD Tests',
    },
  });
}

async function createBareRemoteFixture(t, {
  initialContent = '# Test\n\nHello from remote.\n',
} = {}) {
  const remoteDir = await mkdtemp(join(tmpdir(), 'collabmd-bootstrap-remote-'));
  const seedDir = await mkdtemp(join(tmpdir(), 'collabmd-bootstrap-seed-'));

  t.after(async () => {
    await rm(remoteDir, { force: true, recursive: true });
    await rm(seedDir, { force: true, recursive: true });
  });

  await runGit(remoteDir, ['init', '--bare']);
  await runGit(seedDir, ['init']);
  await runGit(seedDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(seedDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(seedDir, 'test.md'), initialContent, 'utf8');
  await runGit(seedDir, ['add', 'test.md']);
  await runGit(seedDir, ['commit', '-m', 'Initial commit']);
  await runGit(seedDir, ['remote', 'add', 'origin', remoteDir]);
  await runGit(seedDir, ['push', '-u', 'origin', 'master']);

  return {
    remoteDir,
    seedDir,
  };
}

function createBootstrapConfig(vaultDir, remoteDir, {
  identityEmail = '',
  identityName = '',
} = {}) {
  return loadConfig({
    git: {
      identity: {
        email: identityEmail,
        name: identityName,
      },
      remote: {
        repoUrl: remoteDir,
        sshPrivateKeyBase64: Buffer.from('dummy-private-key', 'utf8').toString('base64'),
      },
    },
    vaultDir,
  });
}

function extractPrivateKeyPath(commandEnv = {}) {
  const command = String(commandEnv.GIT_SSH_COMMAND ?? '');
  const match = command.match(/-i '([^']+)'/u);
  return match?.[1] ?? '';
}

function httpRequest(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          statusCode: res.statusCode,
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

test('prepareConfigForStartup clones the configured repo into an empty vault directory', async (t) => {
  const { remoteDir } = await createBareRemoteFixture(t);
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-bootstrap-clone-'));
  const vaultDir = join(tempRoot, 'vault');
  const config = createBootstrapConfig(vaultDir, remoteDir, {
    identityEmail: 'bot@example.com',
    identityName: 'CollabMD Bot',
  });

  t.after(async () => {
    await config.git?.cleanup?.();
    await rm(tempRoot, { force: true, recursive: true });
  });

  await prepareConfigForStartup(config);

  const content = await readFile(join(vaultDir, 'test.md'), 'utf8');
  const excludeContent = await readFile(join(vaultDir, '.git', 'info', 'exclude'), 'utf8');
  const repoUserName = (await execFile('git', ['config', 'user.name'], { cwd: vaultDir })).stdout.trim();
  const repoUserEmail = (await execFile('git', ['config', 'user.email'], { cwd: vaultDir })).stdout.trim();
  assert.match(content, /Hello from remote/);
  assert.equal(config.git.commandEnv?.GIT_TERMINAL_PROMPT, '0');
  assert.match(excludeContent, /^\.collabmd\/$/m);
  assert.equal(repoUserName, 'CollabMD Bot');
  assert.equal(repoUserEmail, 'bot@example.com');
});

test('prepareConfigForStartup reuses a matching checkout and fast-forwards it to the remote default branch', async (t) => {
  const { remoteDir } = await createBareRemoteFixture(t);
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-bootstrap-reuse-'));
  const vaultDir = join(tempRoot, 'vault');
  const peerDir = join(tempRoot, 'peer');
  const config = createBootstrapConfig(vaultDir, remoteDir);

  t.after(async () => {
    await config.git?.cleanup?.();
    await rm(tempRoot, { force: true, recursive: true });
  });

  await runGit(tempRoot, ['clone', remoteDir, vaultDir]);
  await runGit(tempRoot, ['clone', remoteDir, peerDir]);
  await runGit(peerDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(peerDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(peerDir, 'test.md'), '# Test\n\nHello from remote.\nPulled update.\n', 'utf8');
  await runGit(peerDir, ['add', 'test.md']);
  await runGit(peerDir, ['commit', '-m', 'Peer update']);
  await runGit(peerDir, ['push']);

  await prepareConfigForStartup(config);

  const content = await readFile(join(vaultDir, 'test.md'), 'utf8');
  const excludeContent = await readFile(join(vaultDir, '.git', 'info', 'exclude'), 'utf8');
  assert.match(content, /Pulled update/);
  assert.equal((excludeContent.match(/^\.collabmd\/$/gm) || []).length, 1);
});

test('prepareConfigForStartup fails when an existing checkout points to a different origin', async (t) => {
  const { remoteDir } = await createBareRemoteFixture(t);
  const { remoteDir: otherRemoteDir } = await createBareRemoteFixture(t, {
    initialContent: '# Other\n',
  });
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-bootstrap-mismatch-'));
  const vaultDir = join(tempRoot, 'vault');
  const config = createBootstrapConfig(vaultDir, remoteDir);

  t.after(async () => {
    await config.git?.cleanup?.();
    await rm(tempRoot, { force: true, recursive: true });
  });

  await runGit(tempRoot, ['clone', otherRemoteDir, vaultDir]);

  await assert.rejects(
    () => prepareConfigForStartup(config),
    /does not match configured repo/,
  );
});

test('prepareConfigForStartup reuses a dirty checkout without syncing it', async (t) => {
  const { remoteDir } = await createBareRemoteFixture(t);
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-bootstrap-dirty-'));
  const vaultDir = join(tempRoot, 'vault');
  const peerDir = join(tempRoot, 'peer');
  const config = createBootstrapConfig(vaultDir, remoteDir);

  t.after(async () => {
    await config.git?.cleanup?.();
    await rm(tempRoot, { force: true, recursive: true });
  });

  await runGit(tempRoot, ['clone', remoteDir, vaultDir]);
  await runGit(tempRoot, ['clone', remoteDir, peerDir]);
  await runGit(peerDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(peerDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(peerDir, 'test.md'), '# Test\n\nHello from remote.\nRemote update.\n', 'utf8');
  await runGit(peerDir, ['add', 'test.md']);
  await runGit(peerDir, ['commit', '-m', 'Peer update']);
  await runGit(peerDir, ['push']);
  await writeFile(join(vaultDir, 'test.md'), '# Test\n\nlocal dirty change\n', 'utf8');

  await prepareConfigForStartup(config);

  const content = await readFile(join(vaultDir, 'test.md'), 'utf8');
  assert.equal(content, '# Test\n\nlocal dirty change\n');
});

test('prepareConfigForStartup cleans up temporary key files created from base64 input', async (t) => {
  const { remoteDir } = await createBareRemoteFixture(t);
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-bootstrap-key-'));
  const vaultDir = join(tempRoot, 'vault');
  const config = createBootstrapConfig(vaultDir, remoteDir);

  t.after(async () => {
    await config.git?.cleanup?.();
    await rm(tempRoot, { force: true, recursive: true });
  });

  await prepareConfigForStartup(config);

  const tempKeyPath = extractPrivateKeyPath(config.git.commandEnv);
  assert.equal(tempKeyPath.length > 0, true);

  await readFile(tempKeyPath, 'utf8');
  await config.git.cleanup();

  await assert.rejects(
    () => readFile(tempKeyPath, 'utf8'),
    /ENOENT/,
  );
});

test('server can start against a freshly bootstrapped vault and serve cloned files', async (t) => {
  const { remoteDir } = await createBareRemoteFixture(t);
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-bootstrap-server-'));
  const vaultDir = join(tempRoot, 'vault');
  const config = createBootstrapConfig(vaultDir, remoteDir);
  let server = null;

  t.after(async () => {
    await server?.close().catch(() => undefined);
    await rm(tempRoot, { force: true, recursive: true });
  });

  await prepareConfigForStartup(config);
  config.host = '127.0.0.1';
  config.port = 0;
  server = createAppServer(config);

  const { port } = await server.listen();
  const response = await httpRequest(`http://127.0.0.1:${port}/api/file?path=test.md`);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Hello from remote/);
});
