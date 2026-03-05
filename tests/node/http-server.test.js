import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startTestServer } from './helpers/test-server.js';

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
        resolve({
          body: Buffer.concat(chunks).toString('utf-8'),
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

test('HTTP server serves health, runtime config, and static assets', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const healthResponse = await httpRequest(`${app.baseUrl}/health`);
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(healthResponse.body, 'ok');

  const runtimeConfigResponse = await httpRequest(`${app.baseUrl}/app-config.js`);
  assert.equal(runtimeConfigResponse.statusCode, 200);
  assert.match(runtimeConfigResponse.body, /window\.__COLLABMD_CONFIG__/);

  const indexResponse = await httpRequest(`${app.baseUrl}/`);
  assert.equal(indexResponse.statusCode, 200);
  assert.match(indexResponse.body, /CollabMD/);

  const assetHeadResponse = await httpRequest(`${app.baseUrl}/assets/css/style.css`, { method: 'HEAD' });
  assert.equal(assetHeadResponse.statusCode, 200);
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

test('HTTP server enforces markdown-only /api/file mutations', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  await writeFile(join(app.vaultDir, 'secret.txt'), 'not markdown', 'utf-8');

  const deleteResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('secret.txt')}`, {
    method: 'DELETE',
  });
  assert.equal(deleteResponse.statusCode, 400);
  assert.match(deleteResponse.body, /must end in \.md/i);

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
  assert.match(renameResponse.body, /Old path must end in \.md/i);
});
