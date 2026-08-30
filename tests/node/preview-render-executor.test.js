import test from 'node:test';
import assert from 'node:assert/strict';

import { PreviewRenderExecutor } from '../../src/client/application/preview-render-executor.js';

function createFakeWorker() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, payload) {
      listeners.get(type)?.(payload);
    },
    postMessage(payload) {
      this.lastMessage = payload;
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    terminate() {
      this.terminated = true;
    },
  };
}

test('PreviewRenderExecutor falls back to direct compilation when no worker is available', async () => {
  const executor = new PreviewRenderExecutor({
    compilePreviewDocumentLoader: async () => ({
      compilePreviewDocument({ fileList, markdownText }) {
        return {
          html: `<p>${markdownText}</p>`,
          stats: { fileCount: fileList.length },
        };
      },
    }),
    createWorkerFn: () => {
      throw new Error('worker unavailable');
    },
    getFileList: () => ['README.md'],
    getSourceFilePath: () => 'README.md',
  });

  const result = await executor.compile('Hello', 3);

  assert.deepEqual(result, {
    html: '<p>Hello</p>',
    stats: { fileCount: 1 },
  });
});

test('PreviewRenderExecutor compiles through the worker when available', async () => {
  const worker = createFakeWorker();
  const executor = new PreviewRenderExecutor({
    createWorkerFn: () => worker,
    getFileList: () => ['notes/today.md'],
  });

  const resultPromise = executor.compile('# Today', 7, {
    frontmatterCollapsed: true,
    frontmatterInteractive: true,
  });

  assert.deepEqual(worker.lastMessage, {
    attachmentApiPath: '/api/attachment',
    fileList: ['notes/today.md'],
    frontmatterCollapsed: true,
    frontmatterInteractive: true,
    markdownText: '# Today',
    renderVersion: 7,
    sourceFilePath: '',
    wikiLinkAutoCreate: true,
  });

  worker.dispatch('message', {
    data: {
      html: '<h1>Today</h1>',
      renderVersion: 7,
      stats: { headings: 1 },
    },
  });

  const result = await resultPromise;
  assert.deepEqual(result, {
    html: '<h1>Today</h1>',
    stats: { headings: 1 },
  });
});

test('PreviewRenderExecutor forwards disabled wiki-link auto-create to the worker', async () => {
  const worker = createFakeWorker();
  const executor = new PreviewRenderExecutor({
    createWorkerFn: () => worker,
    getFileList: () => ['notes/today.md'],
    getWikiLinkAutoCreate: () => false,
  });

  const resultPromise = executor.compile('# Today', 8);

  assert.equal(worker.lastMessage.wikiLinkAutoCreate, false);

  worker.dispatch('message', {
    data: {
      html: '<h1>Today</h1>',
      renderVersion: 8,
      stats: { headings: 1 },
    },
  });

  await resultPromise;
});

