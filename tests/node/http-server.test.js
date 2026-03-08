import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

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
  const app = await startTestServer();
  t.after(() => app.close());

  const healthResponse = await httpRequest(`${app.baseUrl}/health`);
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(healthResponse.body, 'ok');

  const runtimeConfigResponse = await httpRequest(`${app.baseUrl}/app-config.js`);
  assert.equal(runtimeConfigResponse.statusCode, 200);
  assert.match(runtimeConfigResponse.body, /window\.__COLLABMD_CONFIG__/);
  assert.equal(runtimeConfigResponse.headers['cache-control'], 'no-store');

  const indexResponse = await httpRequest(`${app.baseUrl}/`);
  assert.equal(indexResponse.statusCode, 200);
  assert.match(indexResponse.body, /CollabMD/);
  assert.equal(indexResponse.headers['cache-control'], 'no-store');

  const assetHeadResponse = await httpRequest(`${app.baseUrl}/assets/css/style.css`, { method: 'HEAD' });
  assert.equal(assetHeadResponse.statusCode, 200);
  assert.equal(assetHeadResponse.headers['cache-control'], 'public, max-age=3600, stale-while-revalidate=86400');

  const compressedAssetResponse = await httpRequest(`${app.baseUrl}/assets/css/style.css`, {
    headers: {
      'Accept-Encoding': 'gzip',
    },
  });
  assert.equal(compressedAssetResponse.statusCode, 200);
  assert.equal(compressedAssetResponse.headers['content-encoding'], 'gzip');
  assert.match(gunzipSync(compressedAssetResponse.bodyBuffer).toString('utf8'), /--color-bg/);
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

test('HTTP server enforces markdown-only /api/file mutations', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  await writeFile(join(app.vaultDir, 'secret.txt'), 'not markdown', 'utf-8');

  const deleteResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('secret.txt')}`, {
    method: 'DELETE',
  });
  assert.equal(deleteResponse.statusCode, 400);
  assert.match(deleteResponse.body, /must end in \.md, \.excalidraw, or \.puml/i);

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
  assert.match(renameResponse.body, /Old path must be a vault file \(\.md, \.excalidraw, or \.puml\)/i);
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
