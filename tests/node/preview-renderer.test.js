import test from 'node:test';
import assert from 'node:assert/strict';

import { PreviewRenderer } from '../../src/client/application/preview-renderer.js';

function createPreviewElement() {
  return {
    addEventListener() {},
    removeEventListener() {},
    dataset: {},
  };
}

test('PreviewRenderer skips compile while the preview pane is hidden', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = {
    body: { classList: { add() {}, contains: () => false, remove() {} } },
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };

  try {
    const renderer = new PreviewRenderer({
      getContent: () => '# Hello',
      getFileList: () => [],
      getPreviewVisible: () => false,
      getSourceFilePath: () => 'note.md',
      outlineController: { refresh() {} },
      previewElement: createPreviewElement(),
    });

    renderer.queueRender();

    assert.equal(renderer.previewRenderStale, true);
    assert.equal(renderer.pendingRenderVersion, 0);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
