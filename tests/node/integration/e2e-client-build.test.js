import assert from 'node:assert/strict';
import { access, appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import setupClientBuild from '../../e2e/helpers/global-setup.js';
import { extractAssetPath } from '../helpers/asset-path.js';
import { startTestServer } from '../helpers/test-server.js';

test('E2E setup builds and serves a complete private bundle, then removes it', async () => {
  const previousPublicDir = process.env.COLLABMD_E2E_PUBLIC_DIR;
  const previousNodeEnv = process.env.NODE_ENV;
  const teardown = await setupClientBuild();
  const publicDir = process.env.COLLABMD_E2E_PUBLIC_DIR;

  try {
    assert.notEqual(publicDir, resolve(import.meta.dirname, '../../../dist/client'));
    assert.equal(process.env.NODE_ENV, 'test');
    for (const entry of ['index.html', 'drawio-editor.html', 'excalidraw-editor.html', 'export-document.html']) {
      const html = await readFile(resolve(publicDir, entry), 'utf8');
      const asset = extractAssetPath(html, /src="\.\/(assets\/[^"]+\.js)"/, `${entry} script`);
      await access(resolve(publicDir, asset));
    }

    await appendFile(resolve(publicDir, 'index.html'), '\n<!-- private E2E build -->\n');
    const app = await startTestServer();
    try {
      const response = await fetch(app.baseUrl);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /<!-- private E2E build -->/);
      const asset = extractAssetPath(html, /src="\.\/(assets\/[^"]+\.js)"/, 'main script');
      assert.equal((await fetch(`${app.baseUrl}/${asset}`)).status, 200);
    } finally {
      await app.close();
    }
  } finally {
    await teardown();
  }

  await assert.rejects(access(publicDir), { code: 'ENOENT' });
  assert.equal(process.env.COLLABMD_E2E_PUBLIC_DIR, previousPublicDir);
  assert.equal(process.env.NODE_ENV, previousNodeEnv);
});
