const MAX_RECENT_FILES = 20;
const VIEW_MODES = new Set(['editor', 'preview', 'split']);
const KEYS = {
  cursorNames: 'collabmd-editor-cursor-names',
  fileTreeShowExtensions: 'collabmd-file-tree-show-extensions',
  lineWrapping: 'collabmd-editor-line-wrap',
  recentFiles: 'collabmd-recent-files',
  sidebarVisible: 'collabmd-sidebar-visible',
  userName: 'collabmd-user-name',
  viewMode: 'collabmd-editor-view-mode',
  vimMode: 'collabmd-editor-vim-mode',
};

export class BrowserPreferencesPort {
  constructor({ storage = globalThis.localStorage } = {}) {
    this.storage = storage;
  }

  _read(key, fallback = null) {
    try { return this.storage.getItem(key) ?? fallback; } catch { return fallback; }
  }

  _write(key, value) {
    try { this.storage.setItem(key, value); } catch { /* Ignore storage errors. */ }
  }

  getUserName() { return this._read(KEYS.userName, '') || ''; }
  setUserName(name) { this._write(KEYS.userName, name); }
  getSidebarVisible() { return this._read(KEYS.sidebarVisible); }
  setSidebarVisible(show) { this._write(KEYS.sidebarVisible, String(Boolean(show))); }

  getViewMode() {
    const value = this._read(KEYS.viewMode);
    return VIEW_MODES.has(value) ? value : null;
  }

  setViewMode(view) {
    if (VIEW_MODES.has(view)) this._write(KEYS.viewMode, view);
  }

  getRecentFiles() {
    try {
      const files = JSON.parse(this._read(KEYS.recentFiles, '[]'));
      return Array.isArray(files) ? [...new Set(files.filter((p) => typeof p === 'string' && p))] : [];
    } catch {
      return [];
    }
  }

  recordRecentFile(filePath) {
    if (!filePath) return;
    const recent = [filePath, ...this.getRecentFiles().filter((p) => p !== filePath)];
    this._write(KEYS.recentFiles, JSON.stringify(recent.slice(0, MAX_RECENT_FILES)));
  }
}

for (const [name, key, defaultValue, coerce] of [
  ['FileTreeShowExtensions', KEYS.fileTreeShowExtensions, false, true],
  ['LineWrappingEnabled', KEYS.lineWrapping, true, false],
  ['CursorNamesVisible', KEYS.cursorNames, true, false],
  ['VimModeEnabled', KEYS.vimMode, false, false],
]) {
  BrowserPreferencesPort.prototype[`get${name}`] = function () {
    const raw = this._read(key);
    return defaultValue ? raw !== 'false' : raw === 'true';
  };
  BrowserPreferencesPort.prototype[`set${name}`] = function (value) {
    this._write(key, String(coerce ? Boolean(value) : value));
  };
}
