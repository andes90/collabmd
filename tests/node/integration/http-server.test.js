import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createServer } from 'node:http';
import { request } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { extractAssetPath } from '../helpers/asset-path.js';
import { extractCookieHeader } from '../helpers/cookie.js';
import { waitForCondition } from '../helpers/test-server.js';
import { createImageBuffer, createOrientedJpegBuffer } from '../helpers/image-fixtures.js';
import { startTestServer } from '../helpers/test-server.js';
import { waitForProviderSync } from '../helpers/collaboration-protocol.js';

const execFile = promisify(execFileCallback);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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

function listZipEntryNames(buffer) {
  const endOfCentralDirectorySignature = 0x06054b50;
  const centralDirectoryFileHeaderSignature = 0x02014b50;
  let endOfCentralDirectoryOffset = -1;

  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === endOfCentralDirectorySignature) {
      endOfCentralDirectoryOffset = index;
      break;
    }
  }

  assert.notEqual(endOfCentralDirectoryOffset, -1, 'expected zip end of central directory');

  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectoryOffset + 16);
  const entryCount = buffer.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const entryNames = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), centralDirectoryFileHeaderSignature, 'expected central directory header');

    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraFieldLength = buffer.readUInt16LE(cursor + 30);
    const fileCommentLength = buffer.readUInt16LE(cursor + 32);
    entryNames.push(buffer.toString('utf8', cursor + 46, cursor + 46 + fileNameLength));
    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entryNames;
}

async function createPublicDirSnapshot() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-public-'));
  const publicDir = resolve(tempRoot, 'public');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rm(publicDir, { force: true, recursive: true });
    await cp(clientDistDir, publicDir, { recursive: true });

    try {
      const indexHtml = await readFile(resolve(publicDir, 'index.html'), 'utf8');
      if (indexHtml.includes('./assets/') && indexHtml.includes('CollabMD')) {
        break;
      }
    } catch {
      // Retry if another test process is rebuilding the dist snapshot concurrently.
    }

    if (attempt === 2) {
      throw new Error('Failed to prepare a stable public asset snapshot');
    }

    await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 100));
  }

  return {
    cleanup: () => rm(tempRoot, { force: true, recursive: true }),
    publicDir,
  };
}

async function startStructurizrStub() {
  const requests = [];
  const images = new Map();
  const fallbackThumbnail = Buffer.from('fallback-thumbnail');
  const server = createServer(async (req, res) => {
    const requestPath = req.url || '';
    requests.push(requestPath);

    if (requestPath === '/api/workspace/1') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end('{"success":true}');
      return;
    }

    if (requestPath === '/static/img/thumbnail-not-available.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(fallbackThumbnail);
      return;
    }

    if (requestPath.startsWith('/workspace/1/images/')) {
      if (req.method === 'PUT') {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        images.set(requestPath, Buffer.concat(chunks));
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end('{"success":true}');
        return;
      }

      const image = images.get(requestPath);
      if (req.method === 'GET' && image) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(image);
        return;
      }

      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.end('<html><head></head><body><script src="/static/app.js"></script><a href="/workspace/1/diagrams#Context">Context</a></body></html>');
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
    fallbackThumbnail,
    requests,
    url: `http://127.0.0.1:${port}`,
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
  const styleAssetPath = extractAssetPath(indexResponse.body, /<link[^>]+rel="stylesheet"[^>]+href="\.\/(assets\/[^"]+-[A-Za-z0-9_-]{8,}\.css)"/, 'style asset');

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

test('HTTP server searches vault text with ripgrep-backed API', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  await mkdir(join(app.vaultDir, 'docs'), { recursive: true });
  await writeFile(join(app.vaultDir, 'docs', 'guide.md'), '# Guide\n\nFind the search needle here.\n', 'utf8');
  await writeFile(join(app.vaultDir, 'docs', 'report.html'), '<h1>HTML needle</h1>\n', 'utf8');
  await writeFile(join(app.vaultDir, 'diagram.drawio'), '<mxfile>needle in drawio text</mxfile>\n', 'utf8');
  await writeFile(join(app.vaultDir, 'sketch.excalidraw'), JSON.stringify({
    elements: [
      { id: 'visible', isDeleted: false, text: 'Visible needle label', type: 'text' },
      { id: 'deleted', isDeleted: true, text: 'Deleted needle label', type: 'text' },
      { id: 'shape', points: [['needle', 0]], type: 'rectangle' },
    ],
    type: 'excalidraw',
  }), 'utf8');

  const response = await httpRequest(`${app.baseUrl}/api/search?q=needle&limit=10`);
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);

  assert.equal(payload.ok, true);
  assert.equal(payload.search.backend, 'ripgrep');
  assert.equal(payload.files.some((entry) => entry.file === 'docs/guide.md'), true);
  assert.equal(payload.files.some((entry) => entry.file === 'docs/report.html' && entry.kind === 'html'), true);
  assert.equal(payload.files.some((entry) => entry.file === 'diagram.drawio'), true);
  assert.equal(payload.files.some((entry) => entry.file === 'sketch.excalidraw'), true);
  const sketch = payload.files.find((entry) => entry.file === 'sketch.excalidraw');
  assert.equal(sketch?.kind, 'excalidraw');
  assert.equal(sketch?.matchCount, 1);
  assert.match(sketch?.snippets[0]?.text ?? '', /Visible needle label/u);

  const structuralResponse = await httpRequest(`${app.baseUrl}/api/search?q=points&limit=10`);
  const structuralPayload = JSON.parse(structuralResponse.body);
  assert.equal(structuralPayload.files.some((entry) => entry.file === 'sketch.excalidraw'), false);

  const guide = payload.files.find((entry) => entry.file === 'docs/guide.md');
  assert.equal(guide.snippets[0].line, 3);
  assert.match(guide.snippets[0].text, /needle/);
});

test('HTTP server cancels an in-flight text search when the client disconnects', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  let searchSignal = null;
  let searchAborted = false;
  app.server.searchService.search = ({ signal }) => new Promise((_resolve, reject) => {
    searchSignal = signal;
    signal.addEventListener('abort', () => {
      searchAborted = true;
      const error = new Error('search aborted');
      error.code = 'ABORT_ERR';
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });

  const clientRequest = request(`${app.baseUrl}/api/search?q=needle`, () => {});
  clientRequest.on('error', () => {});
  clientRequest.end();

  await waitForCondition(() => searchSignal !== null);
  clientRequest.destroy();
  await waitForCondition(() => searchAborted);
});

test('HTTP server reports unavailable global text search when ripgrep is missing', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  app.server.searchService.available = false;
  app.server.searchService.unavailableReason = 'ripgrep is not installed on the server';

  const response = await httpRequest(`${app.baseUrl}/api/search?q=needle`);
  assert.equal(response.statusCode, 503);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.search.available, false);
  assert.match(payload.error, /requires ripgrep/i);
});

test('HTTP server queries and exports Obsidian base results', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  await writeFile(join(app.vaultDir, 'notes.md'), [
    '---',
    'status: open',
    'points: 3',
    '---',
    '',
    '# Note',
    '',
    '#task',
  ].join('\n'), 'utf8');
  await writeFile(join(app.vaultDir, 'done.md'), [
    '---',
    'status: done',
    'points: 5',
    '---',
    '',
    '# Done',
    '',
    '#task',
  ].join('\n'), 'utf8');
  await writeFile(join(app.vaultDir, 'tasks.base'), [
    'filters: file.ext == "md" && file.hasTag("task")',
    'properties:',
    '  note.status: {}',
    '  note.points: {}',
    'views:',
    '  - type: table',
    '    name: Board',
    '    order: [file.name, note.status, note.points]',
    '    sort:',
    '      - property: note.points',
    '        direction: desc',
  ].join('\n'), 'utf8');

  const queryResponse = await httpRequest(`${app.baseUrl}/api/base/query`, {
    body: JSON.stringify({ path: 'tasks.base', view: 'Board' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  assert.equal(queryResponse.statusCode, 200);
  const queryPayload = JSON.parse(queryResponse.body);
  assert.equal(queryPayload.ok, true);
  assert.equal(queryPayload.result.totalRows, 2);
  assert.deepEqual(queryPayload.result.rows.map((row) => row.path), ['done.md', 'notes.md']);
  assert.equal(queryPayload.result.view.name, 'Board');
  assert.equal('csv' in queryPayload.result, false);

  const exportResponse = await httpRequest(`${app.baseUrl}/api/base/export`, {
    body: JSON.stringify({ path: 'tasks.base', view: 'Board' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  assert.equal(exportResponse.statusCode, 200);
  assert.equal(exportResponse.headers['content-type'], 'text/csv; charset=utf-8');
  assert.match(String(exportResponse.headers['content-disposition']), /filename="tasks\.csv"/);
  assert.match(exportResponse.body, /^name,status,points\n/);
  assert.match(exportResponse.body, /done\.md,done,5/);
});

test('HTTP server returns base metadata, property values, and transformed source', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  await writeFile(join(app.vaultDir, 'notes.md'), [
    '---',
    'status: open',
    'points: 3',
    '---',
  ].join('\n'), 'utf8');
  await writeFile(join(app.vaultDir, 'done.md'), [
    '---',
    'status: done',
    'points: 5',
    '---',
  ].join('\n'), 'utf8');
  await writeFile(join(app.vaultDir, 'tasks.base'), [
    'filters: file.ext == "md"',
    'formulas:',
    '  bucket: \'if(note.status == "done", "Closed", "Open")\'',
    'properties:',
    '  note.status: {}',
    '  note.points: {}',
    '  formula.bucket:',
    '    displayName: Bucket',
    'views:',
    '  - type: table',
    '    name: Board',
    '    order: [note.status, formula.bucket]',
  ].join('\n'), 'utf8');

  const queryResponse = await httpRequest(`${app.baseUrl}/api/base/query`, {
    body: JSON.stringify({ path: 'tasks.base', view: 'Board' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const queryPayload = JSON.parse(queryResponse.body);

  assert.equal(queryPayload.result.meta.editable, true);
  assert.ok(queryPayload.result.meta.availableProperties.some((property) => property.id === 'formula.bucket'));

  const valuesResponse = await httpRequest(`${app.baseUrl}/api/base/property-values`, {
    body: JSON.stringify({ path: 'tasks.base', propertyId: 'note.points', view: 'Board' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const valuesPayload = JSON.parse(valuesResponse.body);

  assert.equal(valuesResponse.statusCode, 200);
  assert.deepEqual(valuesPayload.result.values.map((entry) => entry.text), ['3', '5']);

  const transformResponse = await httpRequest(`${app.baseUrl}/api/base/transform`, {
    body: JSON.stringify({
      mutation: {
        config: {
          filters: 'note.status == "done"',
          groupBy: null,
          order: ['note.status', 'formula.bucket'],
          sort: [],
        },
        type: 'set-view-config',
        view: 'Board',
      },
      path: 'tasks.base',
      view: 'Board',
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const transformPayload = JSON.parse(transformResponse.body);

  assert.equal(transformResponse.statusCode, 200);
  assert.match(transformPayload.result.source, /filters: note\.status == "done"/);
  assert.equal(transformPayload.result.result.totalRows, 1);
});

test('HTTP base queries flush pending external file changes before serving cached snapshots', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  await writeFile(join(app.vaultDir, 'notes.md'), [
    '---',
    'status: open',
    '---',
    '',
    '# Note',
  ].join('\n'), 'utf8');
  await writeFile(join(app.vaultDir, 'tasks.base'), [
    'filters: file.path == "notes.md"',
    'properties:',
    '  note.status: {}',
    'views:',
    '  - type: table',
    '    order: [note.status]',
  ].join('\n'), 'utf8');
  app.server.fileSystemSyncService.handleWatchEvent('change', 'notes.md');
  app.server.fileSystemSyncService.handleWatchEvent('change', 'tasks.base');

  const initialResponse = await httpRequest(`${app.baseUrl}/api/base/query`, {
    body: JSON.stringify({ path: 'tasks.base' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  assert.equal(initialResponse.statusCode, 200);
  assert.equal(JSON.parse(initialResponse.body).result.rows[0].cells['note.status'].value, 'open');

  let scanCalls = 0;
  const originalScanWorkspaceState = app.server.vaultFileStore.scanWorkspaceState.bind(app.server.vaultFileStore);
  app.server.vaultFileStore.scanWorkspaceState = async (...args) => {
    scanCalls += 1;
    return originalScanWorkspaceState(...args);
  };

  await writeFile(join(app.vaultDir, 'notes.md'), [
    '---',
    'status: done',
    '---',
    '',
    '# Note',
  ].join('\n'), 'utf8');
  app.server.fileSystemSyncService.handleWatchEvent('change', 'notes.md');

  const refreshedResponse = await httpRequest(`${app.baseUrl}/api/base/query`, {
    body: JSON.stringify({ path: 'tasks.base' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  assert.equal(refreshedResponse.statusCode, 200);
  assert.equal(JSON.parse(refreshedResponse.body).result.rows[0].cells['note.status'].value, 'done');
  assert.equal(scanCalls, 0);
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

  app.server.vaultFileStore.scanWorkspaceState = async () => {
    throw new Error('scanWorkspaceState() should not be called for /api/files');
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
  assert.equal(indexResponse.statusCode, 200);
  const styleAssetPath = extractAssetPath(indexResponse.body, /<link[^>]+rel="stylesheet"[^>]+href="\.\/(assets\/[^"]+-[A-Za-z0-9_-]{8,}\.css)"/, 'style asset');
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

  const diagramBytes = await createImageBuffer('png');
  await writeFile(join(app.vaultDir, 'diagram.png'), diagramBytes);
  await execFile('git', ['add', 'diagram.png'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Add diagram'], { cwd: app.vaultDir, env: gitEnv });
  const imageCommitHash = String((await execFile('git', ['rev-parse', 'HEAD'], { cwd: app.vaultDir, env: gitEnv })).stdout).trim();
  const imageResponse = await httpRequest(`${app.baseUrl}/api/git/file-attachment?hash=${imageCommitHash}&path=diagram.png`);
  assert.equal(imageResponse.statusCode, 200);
  assert.equal(imageResponse.headers['content-type'], 'image/png');
  assert.equal(imageResponse.headers['content-disposition'], 'inline; filename="diagram.png"; filename*=UTF-8\'\'diagram.png');
  assert.deepEqual(imageResponse.bodyBuffer, diagramBytes);

  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>';
  await writeFile(join(app.vaultDir, 'diagram.svg'), svg);
  await execFile('git', ['add', 'diagram.svg'], { cwd: app.vaultDir, env: gitEnv });
  await execFile('git', ['commit', '-m', 'Add SVG'], { cwd: app.vaultDir, env: gitEnv });
  const svgResponse = await httpRequest(`${app.baseUrl}/api/git/file-attachment?hash=HEAD&path=diagram.svg`);
  const currentSvgResponse = await httpRequest(`${app.baseUrl}/api/attachment?path=diagram.svg`);
  assert.equal(svgResponse.statusCode, 200);
  assert.equal(svgResponse.body, svg);
  assert.match(svgResponse.headers['content-security-policy'], /default-src 'none'/);
  assert.match(svgResponse.headers['content-security-policy'], /(?:^|; )sandbox(?:;|$)/);
  assert.equal(svgResponse.headers['content-security-policy'], currentSvgResponse.headers['content-security-policy']);

  const stageResponse = await httpRequest(`${app.baseUrl}/api/git/stage`, {
    body: JSON.stringify({ path: 'test.md' }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assert.equal(stageResponse.statusCode, 200);
  assert.match(stageResponse.body, /"ok":true/);

  const unstageAllResponse = await httpRequest(`${app.baseUrl}/api/git/unstage-all`, {
    method: 'POST',
  });
  assert.equal(unstageAllResponse.statusCode, 200);
  assert.match(unstageAllResponse.body, /"ok":true/);

  const stageAllResponse = await httpRequest(`${app.baseUrl}/api/git/stage-all`, {
    method: 'POST',
  });
  assert.equal(stageAllResponse.statusCode, 200);
  assert.match(stageAllResponse.body, /"ok":true/);

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

test('HTTP git commands preserve author, managed scope, and reconciliation metadata', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());
  const author = { email: 'author@example.com', name: 'Request Author' };
  const calls = [];
  const observations = [];
  const workspaceChange = { changedPaths: ['test.md'] };
  app.server.authService.getAuthenticatedUser = () => author;
  app.server.gitService.commitStaged = async (options) => {
    assert.equal(app.server.workspaceMutationCoordinator.isGloballySuppressed(), true);
    calls.push(['commit', options]);
    return { ok: true };
  };
  app.server.gitService.pullBranch = async (options) => {
    assert.equal(app.server.workspaceMutationCoordinator.isGloballySuppressed(), true);
    calls.push(['pull', options]);
    return { ok: true, sourceRef: 'test-ref', workspaceChange };
  };
  app.server.workspaceMutationCoordinator.reconcileVaultChangeObservation = async (observation) => {
    observations.push(observation);
  };

  for (const [action, body] of [['commit', { message: 'Saved work' }], ['pull', undefined]]) {
    const response = await httpRequest(`${app.baseUrl}/api/git/${action}`, {
      body: body && JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'x-collabmd-request-id': 'request-123' },
      method: 'POST',
    });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).ok, true);
  }
  assert.deepEqual(calls, [
    ['commit', { author, message: 'Saved work' }],
    ['pull', { author }],
  ]);
  assert.deepEqual(observations, [{
    action: 'pull', origin: 'git', requestId: 'request-123', sourceRef: 'test-ref', workspaceChange,
  }]);

  for (const action of ['stage', 'unstage', 'reset-file', 'commit']) {
    const response = await httpRequest(`${app.baseUrl}/api/git/${action}`, {
      body: '{}', headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: `Missing ${action === 'commit' ? 'message' : 'path'}` });
  }
  for (const action of ['stage', 'unstage', 'stage-all', 'unstage-all', 'commit', 'push', 'pull', 'reset-file']) {
    const response = await httpRequest(`${app.baseUrl}/api/git/${action}`, { method: 'DELETE' });
    assert.equal(response.statusCode, 404);
  }
  assert.equal(calls.length, 2);
  assert.equal(observations.length, 1);
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
  await execFile('git', ['push', '-u', 'origin', 'HEAD'], { cwd: app.vaultDir, env: gitEnv });

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
  await execFile('git', ['push', '-u', 'origin', 'HEAD'], { cwd: app.vaultDir, env: gitEnv });

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
  const blockedSummaryResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent(summaryPath)}`);
  assert.equal(blockedSummaryResponse.statusCode, 404);
  const summaryResponse = await httpRequest(`${app.baseUrl}/api/git/pull-backup-summary?id=${encodeURIComponent(backupsPayload.backups[0].id)}`);
  assert.equal(summaryResponse.statusCode, 200);
  assert.match(summaryResponse.body, /Pull Backup/);

  const fileResponse = await httpRequest(`${app.baseUrl}/api/file?path=test.md`);
  assert.equal(fileResponse.statusCode, 200);
  assert.match(fileResponse.body, /Remote version/);
});

test('HTTP server returns a typed error code when pulled commits conflict', async (t) => {
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
  await execFile('git', ['push', '-u', 'origin', 'HEAD'], { cwd: app.vaultDir, env: gitEnv });

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
  assert.match(pullResponse.body, /"code":"pull_conflicted_commits"/);
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
    body: await createImageBuffer('png'),
    headers: {
      'Content-Type': 'image/png',
      'X-CollabMD-File-Name': encodeURIComponent('Product Screenshot.png'),
      'X-CollabMD-Source-Path': encodeURIComponent('test.md'),
    },
    method: 'POST',
  });

  assert.equal(uploadResponse.statusCode, 201);
  assert.match(uploadResponse.body, /"markdown":"!\[Product Screenshot\]\(assets\/product-screenshot-/);
  assert.match(uploadResponse.body, /"path":"assets\/product-screenshot-[^"]+\.webp"/);

  const uploadedPath = JSON.parse(uploadResponse.body).path;
  const attachmentResponse = await httpRequest(`${app.baseUrl}/api/attachment?path=${encodeURIComponent(uploadedPath)}`);
  assert.equal(attachmentResponse.statusCode, 200);
  assert.equal(attachmentResponse.headers['content-type'], 'image/webp');
  assert.equal(attachmentResponse.headers['x-content-type-options'], 'nosniff');
  assert.equal((await sharp(attachmentResponse.bodyBuffer).metadata()).format, 'webp');

  const treeResponse = await httpRequest(`${app.baseUrl}/api/files`);
  assert.equal(treeResponse.statusCode, 200);
  assert.match(treeResponse.body, /"type":"image"/);
  assert.match(treeResponse.body, /"name":"assets"/);
});

test('HTTP server uploads every supported vault file type without changing its bytes', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const files = [
    'guide.md',
    'guide.markdown',
    'guide.mdx',
    'report.html',
    'legacy.htm',
    'view.base',
    'scene.excalidraw',
    'diagram.drawio',
    'flow.mmd',
    'flow.mermaid',
    'sequence.puml',
    'sequence.plantuml',
    'workspace.dsl',
    'guide.pdf',
    'image.png',
    'image.jpg',
    'image.jpeg',
    'image.webp',
    'image.gif',
    'image.svg',
  ];

  for (const filePath of files) {
    const isPdf = filePath.endsWith('.pdf');
    const content = Buffer.from(isPdf
      ? `%PDF-1.7\nuploaded:${filePath}\n%%EOF\n`
      : `uploaded:${filePath}`);
    const response = await httpRequest(`${app.baseUrl}/api/file/upload`, {
      body: content,
      headers: {
        'Content-Type': isPdf ? 'application/pdf' : 'application/octet-stream',
        'X-CollabMD-File-Path': encodeURIComponent(`uploads/${filePath}`),
      },
      method: 'POST',
    });

    assert.equal(response.statusCode, 201, filePath);
    assert.deepEqual(await readFile(join(app.vaultDir, 'uploads', filePath)), content);
  }

  const invalidPathResponse = await httpRequest(`${app.baseUrl}/api/file/upload`, {
    body: Buffer.from('not supported'),
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-CollabMD-File-Path': encodeURIComponent('uploads/readme.txt'),
    },
    method: 'POST',
  });
  assert.equal(invalidPathResponse.statusCode, 400);

  const duplicateResponse = await httpRequest(`${app.baseUrl}/api/file/upload`, {
    body: Buffer.from('duplicate'),
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-CollabMD-File-Path': encodeURIComponent('uploads/guide.md'),
    },
    method: 'POST',
  });
  assert.equal(duplicateResponse.statusCode, 409);
});

test('HTTP server gives only PDF uploads the larger upload limit', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const pdfContent = Buffer.concat([
    Buffer.from('%PDF-1.7\nlarge upload\n'),
    Buffer.alloc(8_388_608, 0x20),
    Buffer.from('\n%%EOF\n'),
  ]);
  const pdfResponse = await httpRequest(`${app.baseUrl}/api/file/upload`, {
    body: pdfContent,
    headers: {
      'Content-Type': 'application/pdf',
      'X-CollabMD-File-Path': encodeURIComponent('uploads/large.pdf'),
    },
    method: 'POST',
  });

  assert.equal(pdfResponse.statusCode, 201);
  assert.deepEqual(await readFile(join(app.vaultDir, 'uploads', 'large.pdf')), pdfContent);

  const nonPdfResponse = await httpRequest(`${app.baseUrl}/api/file/upload`, {
    body: Buffer.alloc(8_388_609, 0x61),
    headers: {
      'Content-Type': 'text/markdown',
      'X-CollabMD-File-Path': encodeURIComponent('uploads/large.md'),
    },
    method: 'POST',
  });

  assert.equal(nonPdfResponse.statusCode, 413);
  assert.match(nonPdfResponse.body, /Request body too large/);
});

test('HTTP server enforces the configured PDF upload limit', async (t) => {
  const app = await startTestServer({ maxPdfUploadBytes: 32 });
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/file/upload`, {
    body: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]),
    headers: {
      'Content-Type': 'application/pdf',
      'X-CollabMD-File-Path': encodeURIComponent('uploads/too-large.pdf'),
    },
    method: 'POST',
  });

  assert.equal(response.statusCode, 413);
  assert.match(response.body, /Request body too large/);
});

test('HTTP server validates PDF uploads before creating files', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const wrongMimeResponse = await httpRequest(`${app.baseUrl}/api/file/upload`, {
    body: Buffer.from('%PDF-1.7\n%%EOF\n'),
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-CollabMD-File-Path': encodeURIComponent('uploads/wrong-mime.pdf'),
    },
    method: 'POST',
  });

  assert.equal(wrongMimeResponse.statusCode, 400);
  assert.match(wrongMimeResponse.body, /PDF uploads must use application\/pdf/);

  const invalidSignatureResponse = await httpRequest(`${app.baseUrl}/api/file/upload`, {
    body: Buffer.from('not a PDF'),
    headers: {
      'Content-Type': 'application/pdf',
      'X-CollabMD-File-Path': encodeURIComponent('uploads/invalid.pdf'),
    },
    method: 'POST',
  });

  assert.equal(invalidSignatureResponse.statusCode, 400);
  assert.match(invalidSignatureResponse.body, /Invalid PDF file/);
  await assert.rejects(
    () => readFile(join(app.vaultDir, 'uploads', 'invalid.pdf')),
    { code: 'ENOENT' },
  );
});

test('HTTP server auto-orients JPEG uploads before serving converted WebP attachments', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const uploadResponse = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: await createOrientedJpegBuffer(),
    headers: {
      'Content-Type': 'image/jpeg',
      'X-CollabMD-File-Name': encodeURIComponent('Portrait.jpg'),
      'X-CollabMD-Source-Path': encodeURIComponent('test.md'),
    },
    method: 'POST',
  });

  assert.equal(uploadResponse.statusCode, 201);

  const uploadedPath = JSON.parse(uploadResponse.body).path;
  const attachmentResponse = await httpRequest(`${app.baseUrl}/api/attachment?path=${encodeURIComponent(uploadedPath)}`);
  assert.equal(attachmentResponse.statusCode, 200);

  const metadata = await sharp(attachmentResponse.bodyBuffer).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 3);
  assert.equal(metadata.height, 2);
  assert.equal(metadata.orientation, undefined);
});

test('HTTP server downloads vault files as attachments', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/download/file?path=${encodeURIComponent('test.md')}`);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.match(String(response.headers['content-disposition']), /attachment; filename="test\.md"/);
  assert.match(response.body, /Hello from test vault/);
});

test('HTTP server serves uploaded PDFs inline for readonly previews', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const pdfContent = Buffer.from('%PDF-1.7\nreadonly preview\n');
  const uploadResponse = await httpRequest(`${app.baseUrl}/api/file/upload`, {
    body: pdfContent,
    headers: {
      'Content-Type': 'application/pdf',
      'X-CollabMD-File-Path': encodeURIComponent('uploads/brief.pdf'),
    },
    method: 'POST',
  });

  assert.equal(uploadResponse.statusCode, 201);

  const previewResponse = await httpRequest(`${app.baseUrl}/api/download/file?path=${encodeURIComponent('uploads/brief.pdf')}`);
  assert.equal(previewResponse.statusCode, 200);
  assert.equal(previewResponse.headers['content-type'], 'application/pdf');
  assert.match(String(previewResponse.headers['content-disposition']), /inline; filename="brief\.pdf"/);
  assert.deepEqual(previewResponse.bodyBuffer, pdfContent);
});

test('HTTP server rejects downloads that exceed configured limits', async (t) => {
  const app = await startTestServer({
    maxDownloadFileBytes: 8,
  });
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/download/file?path=${encodeURIComponent('test.md')}`);

  assert.equal(response.statusCode, 413);
  assert.match(response.body, /too large/i);
});

test('HTTP server downloads directories as zip archives and excludes ignored entries', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  await mkdir(join(app.vaultDir, 'docs', 'empty-dir'), { recursive: true });
  await mkdir(join(app.vaultDir, 'docs', '.git'), { recursive: true });
  await writeFile(join(app.vaultDir, 'docs', 'guide.md'), '# Guide\n', 'utf-8');
  await writeFile(join(app.vaultDir, 'docs', '.git', 'config'), 'secret', 'utf-8');
  await writeFile(join(app.vaultDir, 'docs', '.hidden.md'), '# Hidden\n', 'utf-8');

  const response = await httpRequest(`${app.baseUrl}/api/download/directory?path=${encodeURIComponent('docs')}`);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.match(String(response.headers['content-disposition']), /attachment; filename="docs\.zip"/);
  assert.equal(response.bodyBuffer[0], 0x50);
  assert.equal(response.bodyBuffer[1], 0x4b);

  const entries = listZipEntryNames(response.bodyBuffer);
  assert.deepEqual(entries, [
    'docs/empty-dir/',
    'docs/guide.md',
  ]);
});

test('HTTP server rejects directory archives that exceed configured entry limits', async (t) => {
  const app = await startTestServer({
    maxArchiveEntries: 1,
  });
  t.after(() => app.close());

  await mkdir(join(app.vaultDir, 'docs'), { recursive: true });
  await writeFile(join(app.vaultDir, 'docs', 'one.md'), '# One\n', 'utf-8');
  await writeFile(join(app.vaultDir, 'docs', 'two.md'), '# Two\n', 'utf-8');

  const response = await httpRequest(`${app.baseUrl}/api/download/directory?path=${encodeURIComponent('docs')}`);

  assert.equal(response.statusCode, 413);
  assert.match(response.body, /exceeds 1 entries/);
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
    body: await createImageBuffer('png'),
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

  const corruptRasterResponse = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    headers: {
      'Content-Type': 'image/png',
      'X-CollabMD-Source-Path': encodeURIComponent('test.md'),
    },
    method: 'POST',
  });
  assert.equal(corruptRasterResponse.statusCode, 400);
  assert.match(corruptRasterResponse.body, /Failed to convert image to WebP/);

  const oversizedPng = await sharp({
    create: {
      background: { alpha: 1, b: 42, g: 23, r: 15 },
      channels: 4,
      height: 7000,
      width: 7000,
    },
  }).png().toBuffer();
  const oversizedRasterResponse = await httpRequest(`${app.baseUrl}/api/attachments`, {
    body: oversizedPng,
    headers: {
      'Content-Type': 'image/png',
      'X-CollabMD-Source-Path': encodeURIComponent('test.md'),
    },
    method: 'POST',
  });
  assert.equal(oversizedRasterResponse.statusCode, 400);
  assert.match(oversizedRasterResponse.body, /Image dimensions exceed limit/);
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
  assert.match(uploadBody.markdown, /!\[diagram résumé\]\(\.\.\/assets\/diagram-r-sum-[^)]+\.svg\)/);
  assert.match(uploadBody.path, /^assets\/diagram-r-sum-[^/]+\.svg$/);

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

test('HTTP server reads and writes .dsl files through /api/file', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const createResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'workspace.dsl',
      content: 'workspace "Example" {\n  model { }\n}\n',
    }),
  });
  assert.equal(createResponse.statusCode, 201);

  const readResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('workspace.dsl')}`);
  assert.equal(readResponse.statusCode, 200);
  assert.match(readResponse.body, /workspace \\"Example\\"/);

  const updateResponse = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'workspace.dsl',
      content: 'workspace "Updated" {\n  model { }\n}\n',
    }),
  });
  assert.equal(updateResponse.statusCode, 200);

  const updatedReadResponse = await httpRequest(`${app.baseUrl}/api/file?path=${encodeURIComponent('workspace.dsl')}`);
  assert.equal(updatedReadResponse.statusCode, 200);
  assert.match(updatedReadResponse.body, /workspace \\"Updated\\"/);
});

test('HTTP server syncs and proxies Structurizr through the authenticated app route', async (t) => {
  const structurizrStub = await startStructurizrStub();
  t.after(() => structurizrStub.close());

  const app = await startTestServer({
    basePath: '/collab',
    structurizr: {
      serverUrl: structurizrStub.url,
    },
  });
  t.after(() => app.close());

  const source = 'workspace "Example" {\n  model { }\n}\n';
  await writeFile(join(app.vaultDir, 'workspace.dsl'), 'authoritative\n', 'utf8');
  const syncResponse = await httpRequest(`${app.appBaseUrl}/api/structurizr/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'workspace.dsl',
      source,
    }),
  });
  assert.equal(syncResponse.statusCode, 200);
  assert.equal(JSON.parse(syncResponse.body).ok, true);
  assert.equal(await readFile(join(app.vaultDir, '.collabmd/structurizr/workspace.dsl'), 'utf8'), source);
  assert.equal(await readFile(join(app.vaultDir, 'workspace.dsl'), 'utf8'), 'authoritative\n');

  const viewerResponse = await httpRequest(`${app.appBaseUrl}/workspace/1/diagrams#Context`);
  assert.equal(viewerResponse.statusCode, 200);
  assert.match(viewerResponse.body, /\/collab\/static\/app\.js/);
  assert.match(viewerResponse.body, /\/collab\/workspace\/1\/diagrams#Context/);
  assert.match(viewerResponse.body, /href="\/collab\/api\/structurizr\/embed\.css"/);

  const embedStylesheetResponse = await httpRequest(`${app.appBaseUrl}/api/structurizr/embed.css`);
  assert.equal(embedStylesheetResponse.statusCode, 200);
  assert.match(embedStylesheetResponse.body, /#diagram-viewport/);
  assert.deepEqual(structurizrStub.requests, ['/api/workspace/1', '/workspace/1/diagrams']);
});

test('HTTP server serves and stores Structurizr thumbnails through the app route', async (t) => {
  const structurizrStub = await startStructurizrStub();
  t.after(() => structurizrStub.close());

  const app = await startTestServer({
    structurizr: {
      serverUrl: structurizrStub.url,
    },
  });
  t.after(() => app.close());

  const missingResponse = await httpRequest(`${app.baseUrl}/workspace/1/images/Context-thumbnail.png`);
  assert.equal(missingResponse.statusCode, 200);
  assert.deepEqual(missingResponse.bodyBuffer, structurizrStub.fallbackThumbnail);

  const rejectedPutResponse = await httpRequest(`${app.baseUrl}/workspace/1/images/diagram.png`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: 'not-a-thumbnail',
  });
  assert.equal(rejectedPutResponse.statusCode, 405);

  const thumbnail = Buffer.from('generated-thumbnail');
  const putResponse = await httpRequest(`${app.baseUrl}/workspace/1/images/Context-thumbnail.png`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: thumbnail,
  });
  assert.equal(putResponse.statusCode, 200);

  const readResponse = await httpRequest(`${app.baseUrl}/workspace/1/images/Context-thumbnail.png`);
  assert.equal(readResponse.statusCode, 200);
  assert.deepEqual(readResponse.bodyBuffer, thumbnail);
  assert.deepEqual(structurizrStub.requests, [
    '/workspace/1/images/Context-thumbnail.png',
    '/static/img/thumbnail-not-available.png',
    '/workspace/1/images/Context-thumbnail.png',
    '/workspace/1/images/Context-thumbnail.png',
  ]);
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

test('HTTP server exports DOCX downloads from snapshot HTML', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/export/docx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filePath: 'README.md',
      html: '<!DOCTYPE html><html><body><main><h1>Exported</h1><p>From test</p></main></body></html>',
      title: 'README',
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(
    response.headers['content-type'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.match(String(response.headers['content-disposition']), /attachment; filename="README\.docx"/);
  assert.equal(response.bodyBuffer[0], 0x50);
  assert.equal(response.bodyBuffer[1], 0x4b);
});

test('HTTP server rejects DOCX snapshots with remote images', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());
  const response = await httpRequest(`${app.baseUrl}/api/export/docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: 'README.md', html: '<img src="http://127.0.0.1/private.png">' }),
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /images must be embedded data URLs/);
});

test('HTTP server rejects oversized DOCX export payloads', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const hugeHtml = `<html><body>${'x'.repeat(34_000_000)}</body></html>`;
  const response = await httpRequest(`${app.baseUrl}/api/export/docx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filePath: 'README.md',
      html: hugeHtml,
    }),
  });

  assert.equal(response.statusCode, 413);
  assert.match(response.body, /Request body too large/);
});
