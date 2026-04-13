export class BrowserPreferencesPort {
  constructor({
    chatNotificationsKey,
    lineWrappingKey,
    preferredViewKey,
    sidebarVisibleKey,
    userNameKey,
    storage = globalThis.localStorage,
  }) {
    this.chatNotificationsKey = chatNotificationsKey;
    this.lineWrappingKey = lineWrappingKey;
    this.preferredViewKey = preferredViewKey;
    this.sidebarVisibleKey = sidebarVisibleKey;
    this.storage = storage;
    this.userNameKey = userNameKey;
  }

  getUserName() {
    try {
      return this.storage.getItem(this.userNameKey) || '';
    } catch {
      return '';
    }
  }

  setUserName(name) {
    try {
      this.storage.setItem(this.userNameKey, name);
    } catch {
      // Ignore storage errors.
    }
  }

  getLineWrappingEnabled() {
    try {
      return this.storage.getItem(this.lineWrappingKey) !== 'false';
    } catch {
      return true;
    }
  }

  setLineWrappingEnabled(enabled) {
    try {
      this.storage.setItem(this.lineWrappingKey, String(enabled));
    } catch {
      // Ignore storage errors.
    }
  }

  getSidebarVisible() {
    try {
      return this.storage.getItem(this.sidebarVisibleKey);
    } catch {
      return null;
    }
  }

  setSidebarVisible(showSidebar) {
    try {
      this.storage.setItem(this.sidebarVisibleKey, showSidebar ? 'true' : 'false');
    } catch {
      // Ignore storage errors.
    }
  }

  getPreferredView() {
    try {
      const view = this.storage.getItem(this.preferredViewKey);
      if (view === 'split' || view === 'editor' || view === 'preview') {
        return view;
      }
    } catch {
      // Ignore storage errors.
    }
    return null;
  }

  setPreferredView(view) {
    try {
      this.storage.setItem(this.preferredViewKey, view);
    } catch {
      // Ignore storage errors.
    }
  }

  getChatNotificationsEnabled() {
    try {
      return this.storage.getItem(this.chatNotificationsKey) === 'true';
    } catch {
      return false;
    }
  }

  setChatNotificationsEnabled(enabled) {
    try {
      this.storage.setItem(this.chatNotificationsKey, String(enabled));
    } catch {
      // Ignore storage errors.
    }
  }
}
