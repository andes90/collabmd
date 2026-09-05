import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { request } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { startTestServer, waitForCondition } from '../helpers/test-server.js';
import { waitForProviderSync } from '../helpers/collaboration-protocol.js';

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

async function runGitOutput(cwd, args) {
  const result = await execFile('git', args, {
    cwd,
    env: { ...process.env },
  });
  return String(result.stdout ?? '').trim();
}

function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { agent: false, headers, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf-8'),
          statusCode: res.statusCode,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function startTwoVaultServer(t) {
  const app = await startTestServer({
    vaults: [
      { id: 'alpha', seed: '# Alpha\n' },
      { id: 'beta', seed: '# Beta\n' },
    ],
  });
  t.after(() => app.close());
  return app;
}

test('vault routing lists vaults and isolates file trees', async (t) => {
  const app = await startTwoVaultServer(t);

  const listResponse = await httpRequest(`${app.baseUrl}/api/vaults`);
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(listResponse.body), {
    activeVault: 'alpha',
    vaults: [{ id: 'alpha' }, { id: 'beta' }],
  });

  const alphaResponse = await httpRequest(`${app.baseUrl}/api/v/alpha/files`);
  const betaResponse = await httpRequest(`${app.baseUrl}/api/v/beta/files`);
  assert.equal(alphaResponse.statusCode, 200);
  assert.equal(betaResponse.statusCode, 200);
  assert.match(alphaResponse.body, /test\.md/);
  assert.match(betaResponse.body, /test\.md/);

  const alphaFile = await httpRequest(`${app.baseUrl}/api/v/alpha/file?path=test.md`);
  const betaFile = await httpRequest(`${app.baseUrl}/api/v/beta/file?path=test.md`);
  assert.match(JSON.parse(alphaFile.body).content, /Alpha/);
  assert.match(JSON.parse(betaFile.body).content, /Beta/);

  // Legacy paths keep serving the primary vault.
  const legacyFile = await httpRequest(`${app.baseUrl}/api/file?path=test.md`);
  assert.match(JSON.parse(legacyFile.body).content, /Alpha/);

  const unknownResponse = await httpRequest(`${app.baseUrl}/api/v/gamma/files`);
  assert.equal(unknownResponse.statusCode, 404);
});

test('vault routing scopes writes to the addressed vault', async (t) => {
  const app = await startTwoVaultServer(t);

  const createResponse = await httpRequest(`${app.baseUrl}/api/v/beta/file`, {
    body: JSON.stringify({ content: '# Only beta\n', path: 'beta-only.md' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(createResponse.statusCode, 201);

  const betaContent = await readFile(join(app.tempRoot, 'beta', 'beta-only.md'), 'utf-8');
  assert.equal(betaContent, '# Only beta\n');

  const alphaTree = await httpRequest(`${app.baseUrl}/api/v/alpha/files`);
  assert.doesNotMatch(alphaTree.body, /beta-only/);
});

test('vault routing isolates collaboration rooms per vault', async (t) => {
  const app = await startTwoVaultServer(t);
  const wsBase = `ws://127.0.0.1:${app.port}${app.server.config.wsBasePath}`;

  const alphaDoc = new Y.Doc();
  const betaDoc = new Y.Doc();
  const alphaProvider = new WebsocketProvider(`${wsBase}/v/alpha`, 'shared.md', alphaDoc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
  const betaProvider = new WebsocketProvider(`${wsBase}/v/beta`, 'shared.md', betaDoc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
  t.after(() => {
    alphaProvider.destroy();
    betaProvider.destroy();
    alphaDoc.destroy();
    betaDoc.destroy();
  });

  await waitForProviderSync(alphaProvider);
  await waitForProviderSync(betaProvider);

  alphaDoc.getText('codemirror').insert(0, 'alpha-edit');
  await waitForCondition(() => betaDoc.getText('codemirror').toString() === 'alpha-edit', {
    timeoutMs: 500,
  }).then(
    () => {
      throw new Error('beta room received alpha-only content');
    },
    (error) => {
      assert.match(error.message, /Timed out/);
    },
  );
  assert.equal(alphaDoc.getText('codemirror').toString().includes('alpha-edit'), true);
});

test('vault routing scopes git status and commits per vault', async (t) => {
  const app = await startTwoVaultServer(t);
  const alphaDir = join(app.tempRoot, 'alpha');
  const betaDir = join(app.tempRoot, 'beta');
  for (const dir of [alphaDir, betaDir]) {
    await runGit(dir, ['init']);
    await runGit(dir, ['add', '.']);
    await runGit(dir, ['commit', '-m', 'init']);
  }
  await writeFile(join(alphaDir, 'test.md'), '# Alpha dirty\n', 'utf-8');

  const git = async (vaultId, path, options) => {
    const response = await httpRequest(`${app.baseUrl}/api/v/${vaultId}/git/${path}`, options);
    return { body: JSON.parse(response.body), statusCode: response.statusCode };
  };

  const alphaStatus = await git('alpha', 'status');
  const betaStatus = await git('beta', 'status');
  assert.equal(alphaStatus.statusCode, 200);
  assert.equal(betaStatus.statusCode, 200);
  assert.equal(alphaStatus.body.isGitRepo, true);
  assert.equal(betaStatus.body.isGitRepo, true);
  assert.equal(alphaStatus.body.summary.workingTree, 1);
  assert.equal(betaStatus.body.summary.workingTree, 0);

  // Legacy git paths keep serving the primary vault.
  const legacyStatus = await httpRequest(`${app.baseUrl}/api/git/status`);
  assert.equal(JSON.parse(legacyStatus.body).summary.workingTree, 1);

  await writeFile(join(betaDir, 'test.md'), '# Beta change\n', 'utf-8');
  const post = (vaultId, path, payload) => git(vaultId, path, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal((await post('beta', 'stage-all', {})).statusCode, 200);
  const commit = await post('beta', 'commit', { message: 'beta change' });
  assert.equal(commit.statusCode, 200);
  assert.equal(commit.body.commit.message, 'beta change');

  assert.match(await runGitOutput(betaDir, ['log', '--oneline']), /beta change/);
  assert.doesNotMatch(await runGitOutput(alphaDir, ['log', '--oneline']), /beta change/);
});
