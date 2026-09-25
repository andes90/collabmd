function readStorage(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

const MAX_RECENT_FILES = 20;
const STORAGE_KEYS = {
  fileTreeShowExtensions: 'collabmd-file-tree-show-extensions',
  lineWrapping: 'collabmd-editor-line-wrap',
  recentFiles: 'collabmd-recent-files',
  vimMode: 'collabmd-editor-vim-mode',
  viewMode: 'collabmd-editor-view-mode',
  sidebarVisible: 'collabmd-sidebar-visible',
  userName: 'collabmd-user-name',
  cursorNames: 'collabmd-editor-cursor-names',
};

export class BrowserPreferencesPort {
  constructor({ storage = globalThis.localStorage } = {}) {
    this.storage = storage;
  }

  getUserName() {
    return readStorage(this.storage, STORAGE_KEYS.userName, '') || '';
  }

  setUserName(name) {
    writeStorage(this.storage, STORAGE_KEYS.userName, name);
  }

  getFileTreeShowExtensions() {
    return readStorage(this.storage, STORAGE_KEYS.fileTreeShowExtensions, null) === 'true';
  }

  setFileTreeShowExtensions(showFileExtensions) {
    writeStorage(this.storage, STORAGE_KEYS.fileTreeShowExtensions, showFileExtensions ? 'true' : 'false');
  }

  getLineWrappingEnabled() {
    return readStorage(this.storage, STORAGE_KEYS.lineWrapping, null) !== 'false';
  }

  setLineWrappingEnabled(enabled) {
    writeStorage(this.storage, STORAGE_KEYS.lineWrapping, String(enabled));
  }

  getCursorNamesVisible() {
    return readStorage(this.storage, STORAGE_KEYS.cursorNames, null) !== 'false';
  }

  setCursorNamesVisible(visible) {
    writeStorage(this.storage, STORAGE_KEYS.cursorNames, String(visible));
  }

  getVimModeEnabled() {
    return readStorage(this.storage, STORAGE_KEYS.vimMode, null) === 'true';
  }

  setVimModeEnabled(enabled) {
    writeStorage(this.storage, STORAGE_KEYS.vimMode, String(enabled));
  }

  getViewMode() {
    const value = readStorage(this.storage, STORAGE_KEYS.viewMode, null);
    if (value === 'editor' || value === 'preview' || value === 'split') {
      return value;
    }
    return null;
  }

  setViewMode(view) {
    if (view === 'editor' || view === 'preview' || view === 'split') {
      writeStorage(this.storage, STORAGE_KEYS.viewMode, view);
    }
  }

  getRecentFiles() {
    const stored = readStorage(this.storage, STORAGE_KEYS.recentFiles, '[]');
    try {
      const recentFiles = JSON.parse(stored);
      return Array.isArray(recentFiles)
        ? [...new Set(recentFiles.filter((filePath) => typeof filePath === 'string' && filePath))]
        : [];
    } catch {
      return [];
    }
  }

  recordRecentFile(filePath) {
    if (!filePath) return;

    const recentFiles = [
      filePath,
      ...this.getRecentFiles().filter((recentFilePath) => recentFilePath !== filePath),
    ];
    writeStorage(this.storage, STORAGE_KEYS.recentFiles, JSON.stringify(recentFiles.slice(0, MAX_RECENT_FILES)));
  }

  getSidebarVisible() {
    return readStorage(this.storage, STORAGE_KEYS.sidebarVisible, null);
  }

  setSidebarVisible(showSidebar) {
    writeStorage(this.storage, STORAGE_KEYS.sidebarVisible, showSidebar ? 'true' : 'false');
  }

}
