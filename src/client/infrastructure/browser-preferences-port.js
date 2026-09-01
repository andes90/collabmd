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

export class BrowserPreferencesPort {
  constructor({
    fileTreeShowExtensionsKey,
    lineWrappingKey,
    recentFilesKey = 'collabmd-recent-files',
    vimModeKey = 'collabmd-editor-vim-mode',
    viewModeKey = 'collabmd-editor-view-mode',
    sidebarVisibleKey,
    userNameKey,
    storage = globalThis.localStorage,
  }) {
    this.fileTreeShowExtensionsKey = fileTreeShowExtensionsKey;
    this.lineWrappingKey = lineWrappingKey;
    this.recentFilesKey = recentFilesKey;
    this.sidebarVisibleKey = sidebarVisibleKey;
    this.storage = storage;
    this.userNameKey = userNameKey;
    this.viewModeKey = viewModeKey;
    this.vimModeKey = vimModeKey;
  }

  getUserName() {
    return readStorage(this.storage, this.userNameKey, '') || '';
  }

  setUserName(name) {
    writeStorage(this.storage, this.userNameKey, name);
  }

  getFileTreeShowExtensions() {
    return readStorage(this.storage, this.fileTreeShowExtensionsKey, null) === 'true';
  }

  setFileTreeShowExtensions(showFileExtensions) {
    writeStorage(this.storage, this.fileTreeShowExtensionsKey, showFileExtensions ? 'true' : 'false');
  }

  getLineWrappingEnabled() {
    return readStorage(this.storage, this.lineWrappingKey, null) !== 'false';
  }

  setLineWrappingEnabled(enabled) {
    writeStorage(this.storage, this.lineWrappingKey, String(enabled));
  }

  getVimModeEnabled() {
    return readStorage(this.storage, this.vimModeKey, null) === 'true';
  }

  setVimModeEnabled(enabled) {
    writeStorage(this.storage, this.vimModeKey, String(enabled));
  }

  getViewMode() {
    const value = readStorage(this.storage, this.viewModeKey, null);
    if (value === 'editor' || value === 'preview' || value === 'split') {
      return value;
    }
    return null;
  }

  setViewMode(view) {
    if (view === 'editor' || view === 'preview' || view === 'split') {
      writeStorage(this.storage, this.viewModeKey, view);
    }
  }

  getRecentFiles() {
    const stored = readStorage(this.storage, this.recentFilesKey, '[]');
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
    writeStorage(this.storage, this.recentFilesKey, JSON.stringify(recentFiles.slice(0, MAX_RECENT_FILES)));
  }

  getSidebarVisible() {
    return readStorage(this.storage, this.sidebarVisibleKey, null);
  }

  setSidebarVisible(showSidebar) {
    writeStorage(this.storage, this.sidebarVisibleKey, showSidebar ? 'true' : 'false');
  }

}
