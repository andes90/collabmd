import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureDrawioViewerLoaded } from '../../src/client/presentation/drawio-viewer.js';

test('draw.io viewer removes failed scripts and retries from the configured host', async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  });
  globalThis.window = { __COLLABMD_CONFIG__: { drawioBaseUrl: 'https://drawio.example/diagrams' } };
  const scripts = [];
  globalThis.document = {
    head: { append: (script) => scripts.push(script) },
    createElement() {
      return Object.assign(new EventTarget(), { dataset: {}, remove() { this.removed = true; } });
    },
  };

  const firstLoad = ensureDrawioViewerLoaded();
  const parallelLoad = ensureDrawioViewerLoaded();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://drawio.example/diagrams/js/viewer-static.min.js');
  scripts[0].dispatchEvent(new Event('error'));
  await Promise.all([assert.rejects(firstLoad, /Failed to load/u), assert.rejects(parallelLoad, /Failed to load/u)]);
  assert.equal(scripts[0].removed, true);

  const secondLoad = ensureDrawioViewerLoaded();
  scripts[1].dispatchEvent(new Event('load'));
  await assert.rejects(secondLoad, /did not initialize/u);
  assert.equal(scripts[1].removed, true);

  window.__COLLABMD_CONFIG__.drawioBaseUrl = 'https://embed.diagrams.net';
  const thirdLoad = ensureDrawioViewerLoaded();
  assert.equal(scripts[2].src, 'https://viewer.diagrams.net/js/viewer-static.min.js');
  window.GraphViewer = { processElements() {} };
  scripts[2].dispatchEvent(new Event('load'));
  assert.equal(await thirdLoad, window.GraphViewer);
});
