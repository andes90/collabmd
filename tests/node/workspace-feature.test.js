import test from 'node:test';
import assert from 'node:assert/strict';

import { workspaceFeature } from '../../src/client/application/app-shell/workspace-feature.js';

test('workspaceFeature accepts static preview documents that use API path field', () => {
  const app = {
    _staticPreviewDocument: null,
    createDiagramPreviewDocument(language, source) {
      return `${language}:${source}`;
    },
    currentFilePath: 'docs/history.md',
    getStaticPreviewDocument: workspaceFeature.getStaticPreviewDocument,
    isMermaidFile() {
      return false;
    },
    isPlantUmlFile() {
      return false;
    },
    workspacePreviewController: {
      getPreviewSource() {
        return 'live-session-content';
      },
    },
  };

  workspaceFeature.setStaticPreviewDocument.call(app, {
    content: '# Historical snapshot',
    fileKind: 'markdown',
    hash: 'abc1234',
    path: 'docs/history.md',
  });

  assert.deepEqual(app.getStaticPreviewDocument(), {
    content: '# Historical snapshot',
    currentFilePath: 'docs/history.md',
    fileKind: 'markdown',
    filePath: 'docs/history.md',
    hash: 'abc1234',
  });
  assert.equal(workspaceFeature.getPreviewSource.call(app), '# Historical snapshot');
});

test('workspaceFeature matches static preview documents against current workspace path', () => {
  const app = {
    _staticPreviewDocument: null,
    createDiagramPreviewDocument(language, source) {
      return `${language}:${source}`;
    },
    currentFilePath: 'docs/current-name.md',
    getStaticPreviewDocument: workspaceFeature.getStaticPreviewDocument,
    isMermaidFile() {
      return false;
    },
    isPlantUmlFile() {
      return false;
    },
    workspacePreviewController: {
      getPreviewSource() {
        return 'live-session-content';
      },
    },
  };

  workspaceFeature.setStaticPreviewDocument.call(app, {
    content: '# Historical snapshot',
    currentFilePath: 'docs/current-name.md',
    fileKind: 'markdown',
    hash: 'abc1234',
    path: 'docs/old-name.md',
  });

  assert.equal(workspaceFeature.getPreviewSource.call(app), '# Historical snapshot');
});

test('workspaceFeature falls back to live preview source when there is no static preview document', () => {
  const app = {
    _staticPreviewDocument: null,
    currentFilePath: null,
    getStaticPreviewDocument: workspaceFeature.getStaticPreviewDocument,
    isMermaidFile() {
      return false;
    },
    isPlantUmlFile() {
      return false;
    },
    workspacePreviewController: {
      getPreviewSource(filePath) {
        return filePath === null ? 'live-session-content' : 'unexpected';
      },
    },
  };

  assert.equal(workspaceFeature.getPreviewSource.call(app), 'live-session-content');
});
