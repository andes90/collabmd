import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractAssetPath } from './helpers/asset-path.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clientDistDir = resolve(rootDir, 'dist/client');

test('client build emits hashed entry assets and bundled preview runtimes', async () => {
  const indexHtml = await readFile(resolve(clientDistDir, 'index.html'), 'utf8');
  const mainAssetPath = extractAssetPath(indexHtml, /src="\.\/(assets\/[^"]+\.js)"/, 'main bundle');
  const mainStylesheetPath = extractAssetPath(indexHtml, /href="\.\/(assets\/[^"]+-[A-Za-z0-9_-]{8,}\.css)"/, 'main stylesheet');
  const assetFileNames = await readdir(resolve(clientDistDir, 'assets'));
  const jsAssetPaths = assetFileNames
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => resolve(clientDistDir, 'assets', fileName));
  const workerBundle = await Promise.all(jsAssetPaths.map(async (assetPath) => ({
    assetPath,
    content: await readFile(assetPath, 'utf8'),
  })));
  const workerReference = workerBundle
    .map(({ content }) => content.match(/\bpreview-render-worker-[A-Za-z0-9_-]+\.js\b/u)?.[0] || null)
    .find(Boolean);
  const pdfiumWasmReference = assetFileNames
    .find((fileName) => /^pdfium-[A-Za-z0-9_-]+\.wasm$/u.test(fileName));
  const embedPdfWorker = workerBundle
    .find(({ content }) => content.includes('Initializing PDF engine'));

  assert.ok(workerReference, 'expected built JS assets to reference hashed preview worker');
  assert.ok(embedPdfWorker, 'expected build to emit the EmbedPDF runtime');
  assert.ok(pdfiumWasmReference, 'expected build to emit PDFium WASM');
  await access(resolve(clientDistDir, mainAssetPath), fsConstants.R_OK);
  await access(resolve(clientDistDir, 'assets', workerReference), fsConstants.R_OK);
  await access(resolve(clientDistDir, 'assets', pdfiumWasmReference), fsConstants.R_OK);
  await access(resolve(clientDistDir, mainStylesheetPath), fsConstants.R_OK);
  assert.match(indexHtml, /defer[^>]*src="\.\/app-config\.js"|src="\.\/app-config\.js"[^>]*defer/);
  assert.doesNotMatch(indexHtml, /markdown-it-[^"]+\.js/);
  assert.equal(
    [...indexHtml.matchAll(/href="\.\/assets\/[^"]+\.css"/g)].length,
    1,
    'expected a single render-blocking stylesheet',
  );
  assert.doesNotMatch(indexHtml, /assets\/vendor\/highlight\/github-dark\.min\.css/);
  assert.doesNotMatch(indexHtml, /main-entry\.js/);
});

test('excalidraw build references the lazy Mermaid-to-Excalidraw converter', async () => {
  const excalidrawHtml = await readFile(resolve(clientDistDir, 'excalidraw-editor.html'), 'utf8');
  const excalidrawJsPath = extractAssetPath(
    excalidrawHtml,
    /src="\.\/(assets\/[^"]+\.js)"/,
    'Excalidraw script',
  );
  const excalidrawBundle = await readFile(resolve(clientDistDir, excalidrawJsPath), 'utf8');
  const excalidrawCssPath = extractAssetPath(
    excalidrawHtml,
    /href="\.\/(assets\/excalidrawEditor-[^"]+\.css)"/,
    'Excalidraw stylesheet',
  );

  await access(resolve(clientDistDir, excalidrawCssPath), fsConstants.R_OK);
  assert.match(excalidrawHtml, /src="\.\/app-config\.js"/);
  assert.doesNotMatch(excalidrawHtml, /excalidraw-editor-entry\.js/);
  assert.doesNotMatch(excalidrawBundle, /excalidraw-mermaid-stub/i);
  assert.match(excalidrawHtml, /(?:mermaid(?:\.core)?-)[A-Za-z0-9_-]+\.js/u);
});
