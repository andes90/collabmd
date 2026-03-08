import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('client build emits the preview worker and main bundle references the emitted path', async () => {
  const workerOutputPath = resolve(rootDir, 'public/assets/js/application/preview-render-worker.js');
  const mainBundlePath = resolve(rootDir, 'public/assets/js/main.js');

  await access(workerOutputPath, fsConstants.R_OK);

  const mainBundle = await readFile(mainBundlePath, 'utf8');
  assert.match(
    mainBundle,
    /new URL\("\.\/application\/preview-render-worker\.js",import\.meta\.url\)/,
  );
});

test('excalidraw build does not emit the disabled mermaid-to-excalidraw payload', async () => {
  const excalidrawBundlePath = resolve(rootDir, 'public/assets/js/excalidraw-editor.js');
  const excalidrawLoader = await readFile(excalidrawBundlePath, 'utf8');
  const hashedBundleMatch = excalidrawLoader.match(/import "\.\/(excalidraw-editor-[^"]+\.js)"/);
  const hashedCssMatch = (await readFile(resolve(rootDir, 'public/assets/js/excalidraw-editor.css'), 'utf8'))
    .match(/@import url\("\.\/(excalidraw-editor-[^"]+\.css)"\)/);

  assert.ok(hashedBundleMatch, 'expected excalidraw loader to import hashed entry bundle');
  assert.ok(hashedCssMatch, 'expected excalidraw css loader to import hashed css asset');

  const excalidrawBundle = await readFile(
    resolve(rootDir, 'public/assets/js', hashedBundleMatch[1]),
    'utf8',
  );
  const importedSpecifiers = [
    ...excalidrawBundle.matchAll(/from"([^"]+)"/g),
    ...excalidrawBundle.matchAll(/import\("([^"]+)"\)/g),
  ].map((match) => match[1]);

  assert.doesNotMatch(excalidrawBundle, /mermaid-to-excalidraw/);
  assert.match(excalidrawBundle, /excalidraw-mermaid-stub/i);
  assert.deepEqual(
    importedSpecifiers.filter((specifier) => /(flowchart-elk|mindmap-definition|sequenceDiagram|katex|cytoscape|elk)/i.test(specifier)),
    [],
  );
});
