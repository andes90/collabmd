import test from 'node:test';
import assert from 'node:assert/strict';

import { VaultApiClient } from '../../src/client/infrastructure/vault-api-client.js';

function createWindowStub() {
  return {
    __COLLABMD_CONFIG__: { basePath: '/app' },
    location: {
      origin: 'http://localhost:3000',
    },
  };
}

test('VaultApiClient prefixes vault endpoints with the configured base path', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = createWindowStub();
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ options, url });
    return new Response(JSON.stringify({ ok: true, tree: [] }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  });

  const client = new VaultApiClient();

  await client.readTree();
  await client.readFile('notes/today.md');
  await client.createFile({ content: '# Today\n', path: 'notes/today.md' });
  await client.renameFile({ newPath: 'notes/tomorrow.md', oldPath: 'notes/today.md' });
  await client.deleteFile('notes/tomorrow.md');
  await client.createDirectory('notes/archive');
  await client.renameDirectory({ newPath: 'notes/archived', oldPath: 'notes/archive' });
  await client.deleteDirectory('notes/archived');
  await client.deleteDirectory('notes/projects', { recursive: true });
  await client.uploadImageAttachment({
    file: new Blob(['png-bytes'], { type: 'image/png' }),
    fileName: 'résumé screen.png',
    sourcePath: 'notes/hari ini.md',
  });

  assert.deepEqual(
    requests.map(({ options, url }) => ({
      body: options.body instanceof Blob ? '[blob]' : (options.body ? JSON.parse(options.body) : null),
      headers: options.headers ?? null,
      method: options.method ?? 'GET',
      url,
    })),
    [
      { body: null, headers: null, method: 'GET', url: '/app/api/files' },
      { body: null, headers: null, method: 'GET', url: '/app/api/file?path=notes%2Ftoday.md' },
      { body: { content: '# Today\n', path: 'notes/today.md' }, headers: { 'Content-Type': 'application/json' }, method: 'POST', url: '/app/api/file' },
      {
        body: { newPath: 'notes/tomorrow.md', oldPath: 'notes/today.md' },
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
        url: '/app/api/file',
      },
      { body: null, headers: null, method: 'DELETE', url: '/app/api/file?path=notes%2Ftomorrow.md' },
      { body: { path: 'notes/archive' }, headers: { 'Content-Type': 'application/json' }, method: 'POST', url: '/app/api/directory' },
      {
        body: { newPath: 'notes/archived', oldPath: 'notes/archive' },
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
        url: '/app/api/directory',
      },
      { body: null, headers: null, method: 'DELETE', url: '/app/api/directory?path=notes%2Farchived' },
      { body: null, headers: null, method: 'DELETE', url: '/app/api/directory?path=notes%2Fprojects&recursive=1' },
      {
        body: '[blob]',
        headers: {
          'Content-Type': 'image/png',
          'X-CollabMD-File-Name': 'r%C3%A9sum%C3%A9%20screen.png',
          'X-CollabMD-Source-Path': 'notes%2Fhari%20ini.md',
        },
        method: 'POST',
        url: '/app/api/attachments',
      },
    ],
  );
});

test('VaultApiClient surfaces API-provided errors', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;

  globalThis.window = createWindowStub();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'File already exists', ok: false }), {
    headers: { 'Content-Type': 'application/json' },
    status: 409,
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  });

  const client = new VaultApiClient();

  await assert.rejects(
    client.createFile({ content: '', path: 'notes/today.md' }),
    (error) => {
      assert.equal(error.message, 'File already exists');
      assert.equal(error.status, 409);
      assert.deepEqual(error.body, { error: 'File already exists', ok: false });
      return true;
    },
  );
});

test('VaultApiClient includes request ids for write operations when provided', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = createWindowStub();
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ options, url });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  });

  const client = new VaultApiClient();

  await client.createFile({ content: '# Today\n', path: 'notes/today.md', requestId: 'write-1' });
  await client.deleteFile('notes/today.md', { requestId: 'write-2' });
  await client.createDirectory('notes/archive', { requestId: 'write-3' });
  await client.renameDirectory({ newPath: 'notes/archived', oldPath: 'notes/archive', requestId: 'write-4' });
  await client.deleteDirectory('notes/archived', { recursive: true, requestId: 'write-5' });

  assert.deepEqual(
    requests.map(({ options }) => options.headers ?? null),
    [
      { 'Content-Type': 'application/json', 'X-CollabMD-Request-Id': 'write-1' },
      { 'X-CollabMD-Request-Id': 'write-2' },
      { 'Content-Type': 'application/json', 'X-CollabMD-Request-Id': 'write-3' },
      { 'Content-Type': 'application/json', 'X-CollabMD-Request-Id': 'write-4' },
      { 'X-CollabMD-Request-Id': 'write-5' },
    ],
  );
});
