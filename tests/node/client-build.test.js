import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clientDistDir = resolve(rootDir, 'dist/client');

function extractAssetPath(html, pattern, label) {
  const match = html.match(pattern);
  assert.ok(match, `expected ${label} asset reference`);
  return match[1];
}

test('client build emits hashed entry assets and the main bundle references the emitted preview worker', async () => {
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

  assert.ok(workerReference, 'expected built JS assets to reference hashed preview worker');
  await access(resolve(clientDistDir, mainAssetPath), fsConstants.R_OK);
  await access(resolve(clientDistDir, 'assets', workerReference), fsConstants.R_OK);
  await access(resolve(clientDistDir, mainStylesheetPath), fsConstants.R_OK);
  assert.doesNotMatch(indexHtml, /app-config\.js/);
  assert.doesNotMatch(indexHtml, /assets\/vendor\/highlight\/github-dark\.min\.css/);
  assert.doesNotMatch(indexHtml, /main-entry\.js/);
});

test('excalidraw build references hashed HTML entry assets and omits the disabled mermaid-to-excalidraw payload', async () => {
  const excalidrawHtml = await readFile(resolve(clientDistDir, 'excalidraw-editor.html'), 'utf8');
  const excalidrawJsPath = extractAssetPath(
    excalidrawHtml,
    /src="\.\/(assets\/[^"]+\.js)"/,
    'Excalidraw script',
  );
  const excalidrawBundle = await readFile(resolve(clientDistDir, excalidrawJsPath), 'utf8');
  const excalidrawCssReference = excalidrawBundle.match(/\bexcalidraw-editor-[A-Za-z0-9_-]+\.css\b/u)?.[0] || null;

  assert.ok(excalidrawCssReference, 'expected Excalidraw bundle to reference emitted stylesheet');
  await access(resolve(clientDistDir, 'assets', excalidrawCssReference), fsConstants.R_OK);
  assert.doesNotMatch(excalidrawHtml, /app-config\.js/);
  assert.doesNotMatch(excalidrawHtml, /excalidraw-editor-entry\.js/);
  const importedSpecifiers = [
    ...excalidrawBundle.matchAll(/from"([^"]+)"/g),
    ...excalidrawBundle.matchAll(/import\("([^"]+)"\)/g),
  ].map((match) => match[1]);

  assert.match(excalidrawBundle, /excalidraw-mermaid-stub/i);
  assert.deepEqual(
    importedSpecifiers.filter((specifier) => /(flowchart-elk|mindmap-definition|sequenceDiagram|katex|cytoscape|elk)/i.test(specifier)),
    [],
  );
});
