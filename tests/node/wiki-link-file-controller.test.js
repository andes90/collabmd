import test from 'node:test';
import assert from 'node:assert/strict';

import { WikiLinkFileController } from '../../src/client/application/wiki-link-file-controller.js';

function createController(overrides = {}) {
  const events = [];
  const controller = new WikiLinkFileController({
    getFileList: () => overrides.fileList ?? ['README.md', 'notes/roadmap.md'],
    navigation: {
      navigateToFile(filePath, ...options) {
        events.push(['navigate', filePath, ...options]);
      },
    },
    refreshExplorer: async () => {
      events.push(['refresh']);
    },
    toastController: {
      show(message) {
        events.push(['toast', message]);
      },
    },
    vaultApiClient: {
      async createFile(payload) {
        events.push(['create', payload.path, payload.content]);
      },
    },
    ...overrides,
  });

  return { controller, events };
}

test('WikiLinkFileController navigates to existing resolved wiki-link targets', () => {
  const { controller, events } = createController();

  controller.handleWikiLinkClick('README');

  assert.deepEqual(events, [['navigate', 'README.md']]);
});

test('WikiLinkFileController navigates to existing targets when auto-create is disabled', () => {
  const { controller, events } = createController({ wikiLinkAutoCreate: false });

  controller.handleWikiLinkClick('README');

  assert.deepEqual(events, [['navigate', 'README.md']]);
});

test('WikiLinkFileController creates missing targets when auto-create is enabled', async () => {
  const { controller, events } = createController({ fileList: ['README.md'] });

  controller.handleWikiLinkClick('plans/q4');
  await new Promise((resolve) => {
    setImmediate(resolve);
  });

  assert.deepEqual(events, [
    ['create', 'plans/q4.md', '# q4\n\n'],
    ['refresh'],
    ['navigate', 'plans/q4.md'],
  ]);
});

test('WikiLinkFileController leaves missing targets alone when auto-create is disabled', async () => {
  const { controller, events } = createController({
    fileList: ['README.md'],
    wikiLinkAutoCreate: false,
  });

  controller.handleWikiLinkClick('secret/spoilers');
  await new Promise((resolve) => {
    setImmediate(resolve);
  });

  assert.deepEqual(events, [['toast', 'Wiki-link target does not exist']]);
});

test('WikiLinkFileController normalizes and creates new markdown wiki-link targets', async () => {
  const { controller, events } = createController({ fileList: ['README.md'] });

  await controller.createAndOpenFile('plans/q4.md', 'plans/q4');

  assert.deepEqual(events, [
    ['create', 'plans/q4.md', '# q4\n\n'],
    ['refresh'],
    ['navigate', 'plans/q4.md'],
  ]);
});

test('WikiLinkFileController rejects empty or traversal wiki-link targets', () => {
  const { controller } = createController();

  assert.equal(controller.normalizeNewWikiFilePath(''), null);
  assert.equal(controller.normalizeNewWikiFilePath('../escape'), null);
  assert.equal(controller.normalizeNewWikiFilePath('notes/today'), 'notes/today.md');
});

test('wiki-links to headings navigate without creating another file', () => {
  const { controller, events } = createController({ getCurrentFilePath: () => 'README.md' });
  controller.handleWikiLinkClick('roadmap#Project Setup');
  controller.handleWikiLinkClick('#Project Setup');
  assert.deepEqual(events, [
    ['navigate', 'notes/roadmap.md', { anchor: 'project-setup' }],
    ['navigate', 'README.md', { anchor: 'project-setup' }],
  ]);
});
