import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserPreferencesPort } from '../../src/client/infrastructure/browser-preferences-port.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('BrowserPreferencesPort defaults Vim mode to disabled and persists the opt-in', () => {
  const storage = createStorage();
  const preferences = new BrowserPreferencesPort({ storage });

  assert.equal(preferences.getVimModeEnabled(), false);

  preferences.setVimModeEnabled(true);

  assert.equal(preferences.getVimModeEnabled(), true);
});

test('BrowserPreferencesPort stores editor view mode only for known values', () => {
  const storage = createStorage();
  const preferences = new BrowserPreferencesPort({ storage });

  assert.equal(preferences.getViewMode(), null);

  preferences.setViewMode('editor');
  assert.equal(preferences.getViewMode(), 'editor');

  preferences.setViewMode('tabs');
  assert.equal(preferences.getViewMode(), 'editor');
});

test('BrowserPreferencesPort keeps recent files newest-first and bounded', () => {
  const storage = createStorage();
  const preferences = new BrowserPreferencesPort({ storage });

  preferences.recordRecentFile('first.md');
  preferences.recordRecentFile('second.md');
  preferences.recordRecentFile('first.md');

  assert.deepEqual(preferences.getRecentFiles(), ['first.md', 'second.md']);

  for (let index = 0; index < 25; index += 1) {
    preferences.recordRecentFile(`file-${index}.md`);
  }

  assert.equal(preferences.getRecentFiles().length, 20);
  assert.equal(preferences.getRecentFiles()[0], 'file-24.md');
});
