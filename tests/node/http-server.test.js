import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createServer } from 'node:http';
import { request } from 'node:http';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { startTestServer } from './helpers/test-server.js';
import { waitForCondition } from './helpers/test-server.js';
import { waitForProviderSync } from './helpers/collaboration-protocol.js';

const execFile = promisify(execFileCallback);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clientDistDir = resolve(rootDir, 'dist/client');

function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      headers,
      method,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          body: bodyBuffer.toString('utf-8'),
          bodyBuffer,
          headers: res.headers,
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

function extractCookieHeader(setCookieHeader) {
  const rawValue = Array.isArray(setCookieHeader)
    ? setCookieHeader[0]
    : setCookieHeader;
  return String(rawValue || '').split(';')[0];
}

function extractAssetPath(html, pattern, label) {
  const match = String(html || '').match(pattern);
  assert.ok(match, `expected ${label} asset path`);
  return match[1];
}

async function createPublicDirSnapshot() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-public-'));
  const publicDir = resolve(tempRoot, 'public');
  await cp(clientDistDir, publicDir, { recursive: true });

  return {
    cleanup: () => rm(tempRoot, { force: true, recursive: true }),
    publicDir,
  };
}

async function startPlantUmlStub() {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url || '');
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
    });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="8" y="24">stub</text></svg>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }),
    requests,
    url: `http://127.0.0.1:${port}/plantuml`,
  };
}

test('HTTP server serves health, runtime config, and static assets', async (t) => {
  const publicDirSnapshot = await createPublicDirSnapshot();
  t.after(() => publicDirSnapshot.cleanup());

  const app = await startTestServer({
    publicDir: publicDirSnapshot.publicDir,
  });
  t.after(() => app.close());

  const healthResponse = await httpRequest(`${app.baseUrl}/health`);
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(healthResponse.body, 'ok');

  const runtimeConfigResponse = await httpRequest(`${app.baseUrl}/app-config.js`);
  assert.equal(runtimeConfigResponse.statusCode, 200);
  assert.match(runtimeConfigResponse.body, /window\.__COLLABMD_CONFIG__/);
  assert.match(runtimeConfigResponse.body, /"gitEnabled":true/);
  assert.match(runtimeConfigResponse.body, /"strategy":"none"/);
  assert.match(runtimeConfigResponse.body, /"build":\{"id":"[^"]+"/);
  assert.equal(runtimeConfigResponse.headers['cache-control'], 'no-store');

  const versionResponse = await httpRequest(`${app.baseUrl}/version.json`);
  assert.equal(versionResponse.statusCode, 200);
  assert.equal(versionResponse.headers['cache-control'], 'no-store');
  const versionPayload = JSON.parse(versionResponse.body);
  assert.equal(versionPayload.build.packageVersion, app.server.config.build.packageVersion);
  assert.equal(versionPayload.build.id, app.server.config.build.id);

  const indexResponse = await httpRequest(`${app.baseUrl}/`);
  assert.equal(indexResponse.statusCode, 200);
  assert.match(indexResponse.body, /CollabMD/);
  assert.equal(indexResponse.headers['cache-control'], 'no-store');
  const styleAssetPath = extractAssetPath(indexResponse.body, /href="\.\/(assets\/[^"]+-[A-Za-z0-9_-]{8,}\.css)"/, 'style asset');

  const assetHeadResponse = await httpRequest(`${app.baseUrl}/${styleAssetPath}`, { method: 'HEAD' });
  assert.equal(assetHeadResponse.statusCode, 200);
  assert.equal(assetHeadResponse.headers['cache-control'], 'public, max-age=31536000, immutable');

  const compressedAssetResponse = await httpRequest(`${app.baseUrl}/${styleAssetPath}`, {
    headers: {
      'Accept-Encoding': 'gzip',
    },
  });
  assert.equal(compressedAssetResponse.statusCode, 200);
  assert.equal(compressedAssetResponse.headers['content-encoding'], 'gzip');
  assert.match(gunzipSync(compressedAssetResponse.bodyBuffer).toString('utf8'), /--color-bg/);
});

test('HTTP server compresses large JSON API responses without changing payloads', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const largeContent = '# Large\n\n' + 'payload '.repeat(400);
  await writeFile(join(app.vaultDir, 'large.md'), largeContent, 'utf8');

  const fileResponse = await httpRequest(`${app.baseUrl}/api/file?path=large.md`, {
    headers: {
      'Accept-Encoding': 'gzip',
    },
  });

  assert.equal(fileResponse.statusCode, 200);
  assert.equal(fileResponse.headers['content-encoding'], 'gzip');

  const payload = JSON.parse(gunzipSync(fileResponse.bodyBuffer).toString('utf8'));
  assert.equal(payload.path, 'large.md');
  assert.equal(payload.content, largeContent);
});

test('HTTP server serves /api/files from the cached workspace tree', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const createResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    body: JSON.stringify({ content: '# Cached\n', path: 'docs/cached.md' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(createResponse.statusCode, 201);

  app.server.vaultFileStore.tree = async () => {
    throw new Error('tree() should not be called for /api/files');
  };

  const treeResponse = await httpRequest(`${app.baseUrl}/api/files`);
  assert.equal(treeResponse.statusCode, 200);
  assert.match(treeResponse.body, /"path":"docs\/cached\.md"/);
  assert.match(treeResponse.body, /"type":"directory"/);
});

test('HTTP server renames directories and requires recursive delete for non-empty folders', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const createDirResponse = await httpRequest(`${app.baseUrl}/api/directory`, {
    body: JSON.stringify({ path: 'docs/guides' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(createDirResponse.statusCode, 201);

  const createFileResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    body: JSON.stringify({ content: '# Guide\n', path: 'docs/guides/guide.md' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(createFileResponse.statusCode, 201);

  const renameDirResponse = await httpRequest(`${app.baseUrl}/api/directory`, {
    body: JSON.stringify({ oldPath: 'docs/guides', newPath: 'docs/reference' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
  assert.equal(renameDirResponse.statusCode, 200);

  const renamedTreeResponse = await httpRequest(`${app.baseUrl}/api/files`);
  assert.equal(renamedTreeResponse.statusCode, 200);
  assert.match(renamedTreeResponse.body, /"path":"docs\/reference"/);
  assert.match(renamedTreeResponse.body, /"path":"docs\/reference\/guide\.md"/);

  const rejectedDeleteResponse = await httpRequest(`${app.baseUrl}/api/directory?path=docs%2Freference`, {
    method: 'DELETE',
  });
  assert.equal(rejectedDeleteResponse.statusCode, 409);
  assert.match(rejectedDeleteResponse.body, /Directory is not empty/);

  const recursiveDeleteResponse = await httpRequest(`${app.baseUrl}/api/directory?path=docs%2Freference&recursive=1`, {
    method: 'DELETE',
  });
  assert.equal(recursiveDeleteResponse.statusCode, 200);

  const finalTreeResponse = await httpRequest(`${app.baseUrl}/api/files`);
  assert.equal(finalTreeResponse.statusCode, 200);
  assert.doesNotMatch(finalTreeResponse.body, /docs\/reference/);
});

test('HTTP server serves prefixed routes when BASE_PATH is configured', async (t) => {
  const publicDirSnapshot = await createPublicDirSnapshot();
  t.after(() => publicDirSnapshot.cleanup());

  const app = await startTestServer({
    auth: {
      password: 'test-password-123',
      strategy: 'password',
    },
    basePath: '/collabmd',
    publicDir: publicDirSnapshot.publicDir,
  });
  t.after(() => app.close());

  const redirectResponse = await httpRequest(`${app.baseUrl}/collabmd`, { method: 'HEAD' });
  assert.equal(redirectResponse.statusCode, 308);
  assert.equal(redirectResponse.headers.location, '/collabmd/');

  const runtimeConfigResponse = await httpRequest(`${app.appBaseUrl}/app-config.js`);
  assert.equal(runtimeConfigResponse.statusCode, 200);
  assert.match(runtimeConfigResponse.body, /"basePath":"\/collabmd"/);
  assert.match(runtimeConfigResponse.body, /"sessionEndpoint":"\/collabmd\/api\/auth\/session"/);

  const versionResponse = await httpRequest(`${app.appBaseUrl}/version.json`);
  assert.equal(versionResponse.statusCode, 200);
  assert.equal(versionResponse.headers['cache-control'], 'no-store');
  const versionPayload = JSON.parse(versionResponse.body);
  assert.equal(versionPayload.build.packageVersion, app.server.config.build.packageVersion);
  assert.equal(versionPayload.build.id, app.server.config.build.id);

  const indexResponse = await httpRequest(`${app.appBaseUrl}/`);
  const styleAssetPath = extractAssetPath(indexResponse.body, /href="\.\/(assets\/[^"]+-[A-Za-z0-9_-]{8,}\.css)"/, 'style asset');
  const assetResponse = await httpRequest(`${app.appBaseUrl}/${styleAssetPath}`);
  assert.equal(assetResponse.statusCode, 200);

  const unauthenticatedApiResponse = await httpRequest(`${app.appBaseUrl}/api/files`);
  assert.equal(unauthenticatedApiResponse.statusCode, 401);

  const loginResponse = await httpRequest(`${app.appBaseUrl}/api/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  assert.equal(loginResponse.statusCode, 200);
  assert.match(String(loginResponse.headers['set-cookie']), /Path=\/collabmd/);

  const cookieHeader = extractCookieHeader(loginResponse.headers['set-cookie']);
  const authenticatedApiResponse = await httpRequest(`${app.appBaseUrl}/api/files`, {
    headers: {
      Cookie: cookieHeader,
    },
  });
  assert.equal(authenticatedApiResponse.statusCode, 200);
  assert.match(authenticatedApiResponse.body, /test\.md/);
});

test('HTTP server exposes git status and diff endpoints for git-backed vaults', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'tests@example.com',
    GIT_AUTHOR_NAME: 'CollabMD Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.com',
    GIT_COMMITTER_NAME: 'CollabMD Tests',
  };
  await execFile('git', ['init'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Initial commit'], { cwd: app.vaultDir, env: gitEnv });
  await writeFile(join(app.vaultDir, 'test.md'), '# Test\n\nHello from git.\n', 'utf8');

  const statusResponse = await httpRequest(`${app.baseUrl}/api/git/status`);
  assert.equal(statusResponse.statusCode, 200);
  assert.match(statusResponse.body, /"isGitRepo":true/);
  assert.match(statusResponse.body, /"workingTree":1/);

  const diffResponse = await httpRequest(`${app.baseUrl}/api/git/diff?scope=all`);
  assert.equal(diffResponse.statusCode, 200);
  assert.match(diffResponse.body, /"filesChanged":1/);
  assert.match(diffResponse.body, /"path":"test.md"/);

  const metaDiffResponse = await httpRequest(`${app.baseUrl}/api/git/diff?scope=all&metaOnly=true`);
  assert.equal(metaDiffResponse.statusCode, 200);
  assert.match(metaDiffResponse.body, /"metaOnly":true/);
  assert.match(metaDiffResponse.body, /"path":"test.md"/);

  const historyResponse = await httpRequest(`${app.baseUrl}/api/git/history?limit=10&offset=0`);
  assert.equal(historyResponse.statusCode, 200);
  assert.match(historyResponse.body, /"commits":\[/);
  assert.match(historyResponse.body, /"subject":"Initial commit"/);

  const headHash = String((await execFile('git', ['rev-parse', 'HEAD'], { cwd: app.vaultDir, env: gitEnv })).stdout).trim();
  const commitMetaResponse = await httpRequest(`${app.baseUrl}/api/git/commit?hash=${headHash}&metaOnly=true`);
  assert.equal(commitMetaResponse.statusCode, 200);
  assert.match(commitMetaResponse.body, /"source":"commit"/);
  assert.match(commitMetaResponse.body, /"path":"test.md"/);

  const commitDiffResponse = await httpRequest(`${app.baseUrl}/api/git/commit?hash=${headHash}&path=test.md`);
  assert.equal(commitDiffResponse.statusCode, 200);
  assert.match(commitDiffResponse.body, /"hunks":\[/);

  const stageResponse = await httpRequest(`${app.baseUrl}/api/git/stage`, {
    body: JSON.stringify({ path: 'test.md' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(stageResponse.statusCode, 200);
  assert.match(stageResponse.body, /"ok":true/);

  const commitResponse = await httpRequest(`${app.baseUrl}/api/git/commit`, {
    body: JSON.stringify({ message: 'Commit staged changes' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(commitResponse.statusCode, 200);
  assert.match(commitResponse.body, /"shortHash":"/);

  const cleanStatusResponse = await httpRequest(`${app.baseUrl}/api/git/status?force=true`);
  assert.equal(cleanStatusResponse.statusCode, 200);
  assert.match(cleanStatusResponse.body, /"changedFiles":0/);
});

test('HTTP server exposes git push and pull endpoints for repos with an upstream', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const remoteDir = await mkdtemp(join(tmpdir(), 'collabmd-http-git-remote-'));
  const peerDir = await mkdtemp(join(tmpdir(), 'collabmd-http-git-peer-'));
  t.after(async () => {
    await rm(remoteDir, { force: true, recursive: true });
    await rm(peerDir, { force: true, recursive: true });
  });

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'tests@example.com',
    GIT_AUTHOR_NAME: 'CollabMD Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.com',
    GIT_COMMITTER_NAME: 'CollabMD Tests',
  };
  await execFile('git', ['init'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Initial commit'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['init', '--bare', remoteDir], { env: gitEnv });
  await execFile('git', ['remote', 'add', 'origin', remoteDir], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['push', '-u', 'origin', 'master'], { cwd: app.vaultDir, env: gitEnv });

  await writeFile(join(app.vaultDir, 'test.md'), '# Test\n\nLocal push change.\n', 'utf8');
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Local push commit'], { cwd: app.vaultDir, env: gitEnv });

  const pushResponse = await httpRequest(`${app.baseUrl}/api/git/push`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(pushResponse.statusCode, 200);
  assert.match(pushResponse.body, /"ok":true/);

  await execFile('git', ['clone', remoteDir, peerDir], { env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: peerDir, env: gitEnv });
  await writeFile(join(peerDir, 'test.md'), '# Test\n\nLocal push change.\nPeer pull change.\n', 'utf8');
  await execFile('git', ['add', 'test.md'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Peer pull commit'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['push'], { cwd: peerDir, env: gitEnv });

  const pullResponse = await httpRequest(`${app.baseUrl}/api/git/pull`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(pullResponse.statusCode, 200);
  assert.match(pullResponse.body, /"ok":true/);

  const fileResponse = await httpRequest(`${app.baseUrl}/api/file?path=test.md`);
  assert.equal(fileResponse.statusCode, 200);
  assert.match(fileResponse.body, /Peer pull change/);
});

test('HTTP server returns pull backup metadata and lists saved pull backups', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const remoteDir = await mkdtemp(join(tmpdir(), 'collabmd-http-git-remote-backup-'));
  const peerDir = await mkdtemp(join(tmpdir(), 'collabmd-http-git-peer-backup-'));
  t.after(async () => {
    await rm(remoteDir, { force: true, recursive: true });
    await rm(peerDir, { force: true, recursive: true });
  });

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'tests@example.com',
    GIT_AUTHOR_NAME: 'CollabMD Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.com',
    GIT_COMMITTER_NAME: 'CollabMD Tests',
  };
  await execFile('git', ['init'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Initial commit'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['init', '--bare', remoteDir], { env: gitEnv });
  await execFile('git', ['remote', 'add', 'origin', remoteDir], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['push', '-u', 'origin', 'master'], { cwd: app.vaultDir, env: gitEnv });

  await execFile('git', ['clone', remoteDir, peerDir], { env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: peerDir, env: gitEnv });
  await writeFile(join(peerDir, 'test.md'), '# Test\n\nRemote version.\n', 'utf8');
  await execFile('git', ['add', 'test.md'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Remote overlap'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['push'], { cwd: peerDir, env: gitEnv });

  await writeFile(join(app.vaultDir, 'test.md'), '# Test\n\nLocal overlap.\n', 'utf8');

  const pullResponse = await httpRequest(`${app.baseUrl}/api/git/pull`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(pullResponse.statusCode, 200);
  assert.match(pullResponse.body, /"pullBackup":\{/);
  assert.match(pullResponse.body, /"fileCount":1/);

  const backupsResponse = await httpRequest(`${app.baseUrl}/api/git/pull-backups`);
  assert.equal(backupsResponse.statusCode, 200);
  assert.match(backupsResponse.body, /"summaryPath":"\.collabmd\/pull-backups\/.*\/summary\.md"/);

  const backupsPayload = JSON.parse(backupsResponse.body);
  const summaryPath = backupsPayload.backups[0].summaryPath;
  const summaryResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent(summaryPath)}`);
  assert.equal(summaryResponse.statusCode, 200);
  assert.match(summaryResponse.body, /Pull Backup/);

  const fileResponse = await httpRequest(`${app.baseUrl}/api/file?path=test.md`);
  assert.equal(fileResponse.statusCode, 200);
  assert.match(fileResponse.body, /Remote version/);
});

test('HTTP server returns a typed error code when pull cannot fast-forward', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const remoteDir = await mkdtemp(join(tmpdir(), 'collabmd-http-git-remote-diverged-'));
  const peerDir = await mkdtemp(join(tmpdir(), 'collabmd-http-git-peer-diverged-'));
  t.after(async () => {
    await rm(remoteDir, { force: true, recursive: true });
    await rm(peerDir, { force: true, recursive: true });
  });

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'tests@example.com',
    GIT_AUTHOR_NAME: 'CollabMD Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.com',
    GIT_COMMITTER_NAME: 'CollabMD Tests',
  };
  await execFile('git', ['init'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Initial commit'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['init', '--bare', remoteDir], { env: gitEnv });
  await execFile('git', ['remote', 'add', 'origin', remoteDir], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['push', '-u', 'origin', 'master'], { cwd: app.vaultDir, env: gitEnv });

  await writeFile(join(app.vaultDir, 'test.md'), '# Test\n\nLocal commit.\n', 'utf8');
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Local commit'], { cwd: app.vaultDir, env: gitEnv });

  await execFile('git', ['clone', remoteDir, peerDir], { env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: peerDir, env: gitEnv });
  await writeFile(join(peerDir, 'test.md'), '# Test\n\nPeer commit.\n', 'utf8');
  await execFile('git', ['add', 'test.md'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Peer commit'], { cwd: peerDir, env: gitEnv });
  await execFile('git', ['push'], { cwd: peerDir, env: gitEnv });

  const pullResponse = await httpRequest(`${app.baseUrl}/api/git/pull`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  assert.equal(pullResponse.statusCode, 409);
  assert.match(pullResponse.body, /"code":"pull_diverged_ff_only"/);
});

test('HTTP server exposes git reset-file for restoring a file from the current branch HEAD', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'tests@example.com',
    GIT_AUTHOR_NAME: 'CollabMD Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.com',
    GIT_COMMITTER_NAME: 'CollabMD Tests',
  };

  await execFile('git', ['init'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Initial commit'], { cwd: app.vaultDir, env: gitEnv });

  await writeFile(join(app.vaultDir, 'test.md'), '# Local\n', 'utf8');
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });

  const resetResponse = await httpRequest(`${app.baseUrl}/api/git/reset-file`, {
    body: JSON.stringify({ path: 'test.md' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  assert.equal(resetResponse.statusCode, 200);
  assert.match(resetResponse.body, /"sourceRef":"HEAD"/);
  assert.match(resetResponse.body, /"changedPaths":\["test\.md"\]/);

  const fileResponse = await httpRequest(`${app.baseUrl}/api/file?path=test.md`);
  assert.equal(fileResponse.statusCode, 200);
  assert.match(fileResponse.body, /# Test/);
});

test('HTTP git reset invalidates stale collaboration snapshots so reopening hydrates from disk', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'tests@example.com',
    GIT_AUTHOR_NAME: 'CollabMD Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.com',
    GIT_COMMITTER_NAME: 'CollabMD Tests',
  };

  await execFile('git', ['init'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['config', 'user.name', 'CollabMD Tests'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['add', 'test.md'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Initial commit'], { cwd: app.vaultDir, env: gitEnv });

  await writeFile(join(app.vaultDir, 'test.md'), '# Local dirty\n', 'utf8');

  const staleDoc = new Y.Doc();
  t.after(() => staleDoc.destroy());
  staleDoc.getText('codemirror').insert(0, '# Stale snapshot\n');
  await app.server.vaultFileStore.writeCollaborationSnapshot('test.md', Y.encodeStateAsUpdate(staleDoc));

  const resetResponse = await httpRequest(`${app.baseUrl}/api/git/reset-file`, {
    body: JSON.stringify({ path: 'test.md' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(resetResponse.statusCode, 200);

  await waitForCondition(async () => {
    const snapshot = await app.server.vaultFileStore.readCollaborationSnapshot('test.md');
    return snapshot === null;
  });

  const serverUrl = `ws://127.0.0.1:${app.port}${app.server.config.wsBasePath}`;
  const reopenedDoc = new Y.Doc();
  const provider = new WebsocketProvider(serverUrl, 'test.md', reopenedDoc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
  t.after(() => {
    provider.destroy();
    reopenedDoc.destroy();
  });

  await waitForProviderSync(provider);
  assert.equal(reopenedDoc.getText('codemirror').toString(), '# Test\n\nHello from test vault.\n');
});

test('HTTP server enforces password auth for API session flow', async (t) => {
  const publicDirSnapshot = await createPublicDirSnapshot();
  t.after(() => publicDirSnapshot.cleanup());

  const app = await startTestServer({
    auth: {
      password: 'test-password-123',
      strategy: 'password',
    },
    publicDir: publicDirSnapshot.publicDir,
  });
  t.after(() => app.close());

  const runtimeConfigResponse = await httpRequest(`${app.baseUrl}/app-config.js`);
  assert.equal(runtimeConfigResponse.statusCode, 200);
  assert.match(runtimeConfigResponse.body, /"strategy":"password"/);

  const unauthenticatedApiResponse = await httpRequest(`${app.baseUrl}/api/files`);
  assert.equal(unauthenticatedApiResponse.statusCode, 401);
  assert.match(unauthenticatedApiResponse.body, /Authentication required/);

  const badLoginResponse = await httpRequest(`${app.baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  assert.equal(badLoginResponse.statusCode, 401);

  const loginResponse = await httpRequest(`${app.baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  assert.equal(loginResponse.statusCode, 200);

  const cookieHeader = extractCookieHeader(loginResponse.headers['set-cookie']);
  assert.match(cookieHeader, /^collabmd_auth=/);

  const authenticatedApiResponse = await httpRequest(`${app.baseUrl}/api/files`, {
    headers: {
      Cookie: cookieHeader,
    },
  });
  assert.equal(authenticatedApiResponse.statusCode, 200);
  assert.match(authenticatedApiResponse.body, /test\.md/);
});

test('HTTP server proxies esm.sh modules through a same-origin path', async (t) => {
  const originalFetch = globalThis.fetch;
  const upstreamRequests = [];
  globalThis.fetch = async (url) => {
    upstreamRequests.push(String(url));
    return new Response('export * from "/react@19.2.0/es2022/react.mjs";\n', {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Content-Type': 'application/javascript; charset=utf-8',
      },
      status: 200,
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/_esm/test-module`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'public, max-age=60');
  assert.match(response.body, /"\/_esm\/react@19\.2\.0\/es2022\/react\.mjs"/);
  assert.deepEqual(upstreamRequests, ['https://esm.sh/test-module']);
});

test('HTTP server rejects invalid HTML payloads from esm.sh module requests', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<!DOCTYPE html><html><body>bad edge cache</body></html>', {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
    },
    status: 200,
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/_esm/d3-fetch@3?target=es2022`);
  assert.equal(response.statusCode, 502);
  assert.equal(response.body, 'Bad Gateway');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('HTTP server rejects unsupported methods and missing files', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const postResponse = await httpRequest(`${app.baseUrl}/`, { method: 'POST' });
  assert.equal(postResponse.statusCode, 405);

  const missingResponse = await httpRequest(`${app.baseUrl}/missing-file.txt`);
  assert.equal(missingResponse.statusCode, 404);
});

test('HTTP server rejects cross-origin write requests', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: '# should-not-write',
      path: 'blocked.md',
    }),
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body, /Cross-origin write requests are not allowed/);

  const fileResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('blocked.md')}`);
  assert.equal(fileResponse.statusCode, 404);
});

test('HTTP server returns 400 for invalid JSON payloads', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{bad json',
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Invalid JSON payload/);
});

test('HTTP server returns 413 for oversized request payloads', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const hugeBody = JSON.stringify({
    content: 'a'.repeat(8_400_000),
    path: 'big.md',
  });

  const response = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: hugeBody,
  });

  assert.equal(response.statusCode, 413);
  assert.match(response.body, /Request body too large/);
});

test('HTTP server rejects unsupported /api/file mutations outside the vault file set', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  await writeFile(join(app.vaultDir, 'secret.txt'), 'not markdown', 'utf-8');

  const deleteResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('secret.txt')}`, {
    method: 'DELETE',
  });
  assert.equal(deleteResponse.statusCode, 400);
  assert.match(deleteResponse.body, /must end in \.md, .*\.png, .*\.svg/i);

  const renameResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      oldPath: 'secret.txt',
      newPath: 'secret.md',
    }),
  });
  assert.equal(renameResponse.statusCode, 400);
  assert.match(renameResponse.body, /Old path must be a vault file \(\.md, .*\.png, .*\.svg\)/i);
});

test('HTTP server uploads and serves vault-owned image attachments', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const uploadResponse = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    headers: {
      'Content-Type': 'image/png',
      'X-CollabMD-File-Name': encodeURIComponent('Product Screenshot.png'),
      'X-CollabMD-Source-Path': encodeURIComponent('test.md'),
    },
    method: 'POST',
  });

  assert.equal(uploadResponse.statusCode, 201);
  assert.match(uploadResponse.body, /"markdown":"!\[Product Screenshot\]\(test\.assets\/product-screenshot-/);
  assert.match(uploadResponse.body, /"path":"test\.assets\/product-screenshot-[^"]+\.png"/);

  const uploadedPath = JSON.parse(uploadResponse.body).path;
  const attachmentResponse = await httpRequest(`${app.baseUrl}/api/attachment?path=${encodeURIComponent(uploadedPath)}`);
  assert.equal(attachmentResponse.statusCode, 200);
  assert.equal(attachmentResponse.headers['content-type'], 'image/png');
  assert.equal(attachmentResponse.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(Array.from(attachmentResponse.bodyBuffer), [0x89, 0x50, 0x4e, 0x47]);

  const treeResponse = await httpRequest(`${app.baseUrl}/api/files`);
  assert.equal(treeResponse.statusCode, 200);
  assert.match(treeResponse.body, /"type":"image"/);
  assert.match(treeResponse.body, /"name":"test\.assets"/);
});

test('HTTP server serves attachment bytes for password-authenticated workspaces with a session cookie', async (t) => {
  const app = await startTestServer({
    auth: {
      password: 'test-password-123',
      strategy: 'password',
    },
  });
  t.after(() => app.close());

  const loginResponse = await httpRequest(`${app.baseUrl}/api/auth/session`, {
    body: JSON.stringify({ password: 'test-password-123' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(loginResponse.statusCode, 200);
  const cookieHeader = extractCookieHeader(loginResponse.headers['set-cookie']);

  const uploadResponse = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: Buffer.from([0x47, 0x49, 0x46]),
    headers: {
      Cookie: cookieHeader,
      'Content-Type': 'image/gif',
      'X-CollabMD-File-Name': encodeURIComponent('pasted.gif'),
      'X-CollabMD-Source-Path': encodeURIComponent('test.md'),
    },
    method: 'POST',
  });
  assert.equal(uploadResponse.statusCode, 201);

  const uploadedPath = JSON.parse(uploadResponse.body).path;
  const attachmentResponse = await httpRequest(`${app.baseUrl}/api/attachment?path=${encodeURIComponent(uploadedPath)}`, {
    headers: {
      Cookie: cookieHeader,
    },
  });
  assert.equal(attachmentResponse.statusCode, 200);
  assert.equal(attachmentResponse.headers['content-type'], 'image/gif');
  assert.deepEqual(Array.from(attachmentResponse.bodyBuffer), [0x47, 0x49, 0x46]);
});

test('HTTP server rejects invalid attachment uploads', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const missingSourceResponse = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    headers: {
      'Content-Type': 'image/png',
    },
    method: 'POST',
  });
  assert.equal(missingSourceResponse.statusCode, 400);
  assert.match(missingSourceResponse.body, /Missing source document path/);

  const invalidTypeResponse = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: Buffer.from('hello'),
    headers: {
      'Content-Type': 'text/plain',
      'X-CollabMD-Source-Path': encodeURIComponent('test.md'),
    },
    method: 'POST',
  });
  assert.equal(invalidTypeResponse.statusCode, 400);
  assert.match(invalidTypeResponse.body, /Unsupported image type/);
});

test('HTTP server decodes encoded attachment metadata headers and hardens SVG responses', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const uploadResponse = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    headers: {
      'Content-Type': 'image/svg+xml',
      'X-CollabMD-File-Name': encodeURIComponent('diagram résumé.svg'),
      'X-CollabMD-Source-Path': encodeURIComponent('catatan/café.md'),
    },
    method: 'POST',
  });

  assert.equal(uploadResponse.statusCode, 201);
  const uploadBody = JSON.parse(uploadResponse.body);
  assert.match(uploadBody.markdown, /!\[diagram résumé\]\(caf%C3%A9\.assets\/diagram-r-sum-/);
  assert.match(uploadBody.path, /^catatan\/café\.assets\/diagram-r-sum-[^/]+\.svg$/);

  const attachmentResponse = await httpRequest(`${app.baseUrl}/api/attachment?path=${encodeURIComponent(uploadBody.path)}`);
  assert.equal(attachmentResponse.statusCode, 200);
  assert.equal(attachmentResponse.headers['content-type'], 'image/svg+xml');
  assert.equal(attachmentResponse.headers['x-content-type-options'], 'nosniff');
  assert.equal(
    attachmentResponse.headers['content-security-policy'],
    "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox",
  );
  assert.match(
    String(attachmentResponse.headers['content-disposition']),
    new RegExp(`filename\\*=UTF-8''${encodeURIComponent(basename(uploadBody.path))}`),
  );
});

test('HTTP server rejects malformed encoded attachment metadata headers', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    headers: {
      'Content-Type': 'image/png',
      'X-CollabMD-File-Name': '%E0%A4%A',
      'X-CollabMD-Source-Path': encodeURIComponent('test.md'),
    },
    method: 'POST',
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Invalid attachment metadata header encoding/);
});

test('HTTP server reads and writes .mmd files through /api/file', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const createResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'architecture.mmd',
      content: 'flowchart TD\n  A --> B\n',
    }),
  });
  assert.equal(createResponse.statusCode, 201);

  const readResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('architecture.mmd')}`);
  assert.equal(readResponse.statusCode, 200);
  assert.match(readResponse.body, /A --> B/);

  const updateResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'architecture.mmd',
      content: 'flowchart TD\n  B --> C\n',
    }),
  });
  assert.equal(updateResponse.statusCode, 200);

  const updatedReadResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('architecture.mmd')}`);
  assert.equal(updatedReadResponse.statusCode, 200);
  assert.match(updatedReadResponse.body, /B --> C/);
});

test('HTTP server reads and writes .plantuml files through /api/file', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const createResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'architecture.plantuml',
      content: '@startuml\nAlice -> Bob: Hi\n@enduml\n',
    }),
  });
  assert.equal(createResponse.statusCode, 201);

  const readResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('architecture.plantuml')}`);
  assert.equal(readResponse.statusCode, 200);
  assert.match(readResponse.body, /Alice -> Bob: Hi/);

  const updateResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'architecture.plantuml',
      content: '@startuml\nBob -> Alice: Ack\n@enduml\n',
    }),
  });
  assert.equal(updateResponse.statusCode, 200);

  const updatedReadResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('architecture.plantuml')}`);
  assert.equal(updatedReadResponse.statusCode, 200);
  assert.match(updatedReadResponse.body, /Bob -> Alice: Ack/);
});

test('HTTP server proxies PlantUML renders through the configured renderer', async (t) => {
  const plantUmlStub = await startPlantUmlStub();
  t.after(() => plantUmlStub.close());

  const app = await startTestServer({
    plantumlServerUrl: plantUmlStub.url,
  });
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/plantuml/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: '@startuml\nAlice -> Bob: Hello\n@enduml\n',
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<svg/);
  assert.equal(plantUmlStub.requests.length, 1);
  assert.match(plantUmlStub.requests[0], /^\/plantuml\/svg\//);
});
