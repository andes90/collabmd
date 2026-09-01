import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFileRouteHash,
  getRuntimeConfig,
  getHashRoute,
  isCollabMdHashRoute,
  navigateToGitCommit,
  navigateToGitFileHistory,
  navigateToGitFilePreview,
  navigateToFile,
} from '../../src/client/infrastructure/runtime-config.js';
import { isGitHashRouteType } from '../../src/client/domain/hash-routes.js';


function createWindowStub(hash = '') {
  return {
    __COLLABMD_CONFIG__: {},
    location: {
      hash,
      host: 'localhost',
      origin: 'http://localhost',
      protocol: 'http:',
      search: '',
    },
  };
}

test('runtime-config parses file history and file preview routes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub('#git-file-history=notes%2Ftoday.md');

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.deepEqual(getHashRoute(), {
    filePath: 'notes/today.md',
    type: 'git-file-history',
  });

  globalThis.window.location.hash = '#git-file-preview=docs%2Fold-name.md&current=docs%2Fguide.md&hash=abc1234';
  assert.deepEqual(getHashRoute(), {
    currentFilePath: 'docs/guide.md',
    filePath: 'docs/old-name.md',
    hash: 'abc1234',
    type: 'git-file-preview',
  });

  globalThis.window.location.hash = '#git-commit=abc1234&history=docs%2Fguide.md&path=docs%2Fold-name.md';
  assert.deepEqual(getHashRoute(), {
    hash: 'abc1234',
    historyFilePath: 'docs/guide.md',
    path: 'docs/old-name.md',
    type: 'git-commit',
  });
});

test('runtime-config exposes wiki-link auto-create with a default enabled value', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub();

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.equal(getRuntimeConfig().wikiLinkAutoCreate, true);

  globalThis.window.__COLLABMD_CONFIG__ = { wikiLinkAutoCreate: false };
  assert.equal(getRuntimeConfig().wikiLinkAutoCreate, false);
});

test('runtime-config builds file history and file preview hashes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub();

  t.after(() => {
    globalThis.window = previousWindow;
  });

  navigateToGitFileHistory({ filePath: 'notes/today.md' });
  assert.equal(globalThis.window.location.hash, 'git-file-history=notes%2Ftoday.md');

  navigateToGitFilePreview({
    hash: 'abc1234',
    path: 'docs/old-name.md',
    currentFilePath: 'docs/guide.md',
  });
  assert.equal(
    globalThis.window.location.hash,
    'git-file-preview=docs%2Fold-name.md&current=docs%2Fguide.md&hash=abc1234',
  );

  navigateToGitCommit({
    hash: 'abc1234',
    historyFilePath: 'docs/guide.md',
    path: 'docs/old-name.md',
  });
  assert.equal(
    globalThis.window.location.hash,
    'git-commit=abc1234&history=docs%2Fguide.md&path=docs%2Fold-name.md',
  );
});

test('runtime-config parses and builds drawio text fallback routes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub('#file=diagrams%2Farchitecture.drawio&drawio=text');

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.deepEqual(getHashRoute(), {
    anchor: null,
    column: null,
    drawioMode: 'text',
    filePath: 'diagrams/architecture.drawio',
    line: null,
    matchLength: null,
    type: 'file',
  });

  navigateToFile('diagrams/architecture.drawio', { drawioMode: 'text' });
  assert.equal(globalThis.window.location.hash, 'file=diagrams%2Farchitecture.drawio&drawio=text');
});

test('runtime-config parses and builds file anchor routes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub('#file=MongoDB%2Fmigration-plan.md&anchor=approach-b-pros');

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.deepEqual(getHashRoute(), {
    anchor: 'approach-b-pros',
    column: null,
    drawioMode: null,
    filePath: 'MongoDB/migration-plan.md',
    line: null,
    matchLength: null,
    type: 'file',
  });

  assert.equal(
    createFileRouteHash('MongoDB/migration-plan.md', { anchor: 'approach-b-pros' }),
    'file=MongoDB%2Fmigration-plan.md&anchor=approach-b-pros',
  );

  navigateToFile('MongoDB/migration-plan.md', { anchor: 'approach-b-pros' });
  assert.equal(globalThis.window.location.hash, 'file=MongoDB%2Fmigration-plan.md&anchor=approach-b-pros');
});

test('runtime-config parses and builds Excalidraw element routes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub('#file=diagrams%2Farchitecture.excalidraw&element=node-1&elementType=group');

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.deepEqual(getHashRoute(), {
    anchor: null,
    column: null,
    drawioMode: null,
    elementId: 'node-1',
    elementType: 'group',
    filePath: 'diagrams/architecture.excalidraw',
    line: null,
    matchLength: null,
    type: 'file',
  });

  assert.equal(
    createFileRouteHash('diagrams/architecture.excalidraw', {
      elementId: 'node-1',
      elementType: 'group',
    }),
    'file=diagrams%2Farchitecture.excalidraw&element=node-1&elementType=group',
  );

  navigateToFile('diagrams/architecture.excalidraw', {
    elementId: 'node-1',
    elementType: 'group',
  });
  assert.equal(
    globalThis.window.location.hash,
    'file=diagrams%2Farchitecture.excalidraw&element=node-1&elementType=group',
  );
});

test('runtime-config parses and builds file text match routes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub('#file=docs%2Fguide.md&line=7&column=11&matchLength=6');

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.deepEqual(getHashRoute(), {
    anchor: null,
    column: 11,
    drawioMode: null,
    filePath: 'docs/guide.md',
    line: 7,
    matchLength: 6,
    type: 'file',
  });

  navigateToFile('docs/guide.md', { column: 11, line: 7, matchLength: 6 });
  assert.equal(globalThis.window.location.hash, 'file=docs%2Fguide.md&line=7&column=11&matchLength=6');
});

test('runtime-config distinguishes app-owned hash routes from document fragments', () => {
  assert.equal(isCollabMdHashRoute('#file=README.md'), true);
  assert.equal(isCollabMdHashRoute('#git-diff=README.md'), true);
  assert.equal(isCollabMdHashRoute('#git-history=1'), true);
  assert.equal(isCollabMdHashRoute('#file'), false);
  assert.equal(isCollabMdHashRoute('#git-history'), false);
  assert.equal(isCollabMdHashRoute('#section-a'), false);
  assert.equal(isCollabMdHashRoute('#approach-b-pros'), false);
  assert.equal(isGitHashRouteType('git-diff'), true);
  assert.equal(isGitHashRouteType('git-history'), true);
  assert.equal(isGitHashRouteType('file'), false);
});

