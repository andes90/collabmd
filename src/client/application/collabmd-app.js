import { PreviewRenderer } from './preview-renderer.js';
import { USER_NAME_MAX_LENGTH, normalizeUserName } from '../domain/room.js';
import { resolveWikiTarget } from '../domain/vault-utils.js';
import { EditorSession } from '../infrastructure/editor-session.js';
import { LobbyPresence } from '../infrastructure/lobby-presence.js';
import { getFileFromHash, navigateToFile } from '../infrastructure/runtime-config.js';
import { BacklinksPanel } from '../presentation/backlinks-panel.js';
import { ExcalidrawEmbedController } from '../presentation/excalidraw-embed-controller.js';
import { FileExplorerController } from '../presentation/file-explorer-controller.js';
import { LayoutController } from '../presentation/layout-controller.js';
import { OutlineController } from '../presentation/outline-controller.js';
import { QuickSwitcherController } from '../presentation/quick-switcher-controller.js';
import { ScrollSyncController } from '../presentation/scroll-sync-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';

export class CollabMdApp {
  constructor() {
    this.elements = {
      currentUserName: document.getElementById('currentUserName'),
      displayNameCancel: document.getElementById('displayNameCancel'),
      displayNameDialog: document.getElementById('displayNameDialog'),
      displayNameForm: document.getElementById('displayNameForm'),
      displayNameInput: document.getElementById('displayNameInput'),
      editNameButton: document.getElementById('editNameBtn'),
      editorContainer: document.getElementById('editorContainer'),
      editorPage: document.getElementById('editor-page'),
      lineInfo: document.getElementById('lineInfo'),
      previewContent: document.getElementById('previewContent'),
      previewContainer: document.getElementById('previewContainer'),
      shareButton: document.getElementById('shareBtn'),
      toastContainer: document.getElementById('toastContainer'),
      toggleWrapButton: document.getElementById('toggleWrapBtn'),
      userAvatars: document.getElementById('userAvatars'),
      userCount: document.getElementById('userCount'),
      wrapToggleLabel: document.getElementById('wrapToggleLabel'),
      activeFileName: document.getElementById('activeFileName'),
      sidebarToggle: document.getElementById('sidebarToggle'),
      sidebarClose: document.getElementById('sidebarClose'),
      sidebar: document.getElementById('sidebar'),
      emptyState: document.getElementById('emptyState'),
      backlinksPanel: document.getElementById('backlinksPanel'),
    };

    this.session = null;
    this.currentFilePath = null;
    this.globalUsers = [];
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.sessionLoadToken = 0;
    this.connectionHelpShown = false;
    this.userNameStorageKey = 'collabmd-user-name';
    this.lineWrappingStorageKey = 'collabmd-editor-line-wrap';
    this.sidebarVisibleKey = 'collabmd-sidebar-visible';
    this.followedUserClientId = null;
    this.followedCursorSignature = '';

    this.lobby = new LobbyPresence({
      preferredUserName: this.getStoredUserName(),
      onChange: (users) => this.updateGlobalUsers(users),
    });

    this.toastController = new ToastController(this.elements.toastContainer);
    this.quickSwitcher = new QuickSwitcherController({
      getFileList: () => this.fileExplorer.flatFiles,
      onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
    });
    this.fileExplorer = new FileExplorerController({
      onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
      onFileDelete: () => navigateToFile(null),
    });
    this.outlineController = new OutlineController({
      onNavigateToHeading: ({ sourceLine }) => {
        if (!Number.isFinite(sourceLine)) return;
        this.scrollSyncController.suspendSync(250);
        this.session?.scrollToLine(sourceLine, 0);
      },
    });
    this.previewRenderer = new PreviewRenderer({
      getContent: () => this.session?.getText() ?? '',
      getFileList: () => this.fileExplorer.flatFiles,
      onRenderComplete: () => {
        requestAnimationFrame(() => {
          this.scrollSyncController.invalidatePreviewBlocks();
          this.scrollSyncController.syncPreviewToEditor();
          this.excalidrawEmbed.processEmbeds(this.elements.previewContent);
        });
      },
      onWikiLinkClick: (target) => this.handleWikiLinkClick(target),
      outlineController: this.outlineController,
      previewElement: this.elements.previewContent,
    });
    this.themeController = new ThemeController({
      onChange: (theme) => this.handleThemeChange(theme),
    });
    this.layoutController = new LayoutController({
      onMeasureEditor: () => this.session?.requestMeasure(),
    });
    this.scrollSyncController = new ScrollSyncController({
      getEditorLineNumber: () => this.session?.getTopVisibleLineNumber(0.35) ?? 1,
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      scrollEditorToLine: (lineNumber, viewportRatio) => this.session?.scrollToLine(lineNumber, viewportRatio),
    });
    this.backlinksPanel = new BacklinksPanel({
      panelElement: this.elements.backlinksPanel,
      onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
    });
    this.excalidrawEmbed = new ExcalidrawEmbedController({
      getTheme: () => this.themeController.getTheme(),
      toastController: this.toastController,
    });
    this._backlinkRefreshTimer = null;
  }

  initialize() {
    this.themeController.initialize();
    this.previewRenderer.applyTheme(this.themeController.getTheme());
    this.outlineController.initialize();
    this.layoutController.initialize();
    this.scrollSyncController.initialize();
    this.fileExplorer.initialize();
    this.syncCurrentUserName();
    this.syncWrapToggle();
    this.bindEvents();
    this.restoreSidebarState();

    // Connect to the global presence lobby
    this.lobby.connect();

    window.addEventListener('hashchange', () => this.handleHashChange());
    window.addEventListener('resize', this.createResizeHandler());

    this.fileExplorer.refresh().then(() => {
      this.handleHashChange();
    });
  }

  bindEvents() {
    this.elements.shareButton?.addEventListener('click', () => {
      void this.copyCurrentLink();
    });

    this.elements.editNameButton?.addEventListener('click', () => {
      this.openDisplayNameDialog();
    });

    this.elements.displayNameCancel?.addEventListener('click', () => {
      this.elements.displayNameDialog?.close();
    });

    this.elements.displayNameForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handleDisplayNameSubmit();
    });

    this.elements.toggleWrapButton?.addEventListener('click', () => {
      this.toggleLineWrapping();
    });

    this.elements.sidebarToggle?.addEventListener('click', () => {
      this.toggleSidebar();
    });

    this.elements.sidebarClose?.addEventListener('click', () => {
      this.closeSidebarOnMobile();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.quickSwitcher.toggle();
      }
    });
  }

  createResizeHandler() {
    let resizeTimer = null;
    return () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.session?.requestMeasure();
        this.scrollSyncController.invalidatePreviewBlocks();
        this.scrollSyncController.syncPreviewToEditor();
      }, 100);
    };
  }

  async handleHashChange() {
    const filePath = getFileFromHash();

    if (!filePath) {
      this.showEmptyState();
      return;
    }

    await this.openFile(filePath);
  }

  showEmptyState() {
    this.sessionLoadToken += 1;
    this.cleanupSession();
    this.currentFilePath = null;
    this.lobby.setCurrentFile(null);
    this.fileExplorer.setActiveFile(null);

    this.elements.emptyState?.classList.remove('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.previewContent.innerHTML = '';

    // Re-render global presence (users are still visible on the empty state)
    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();

    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = 'CollabMD';
    }
  }

  async openFile(filePath) {
    const loadToken = this.sessionLoadToken + 1;
    this.sessionLoadToken = loadToken;

    this.cleanupSession();
    this.layoutController.reset();
    this.connectionHelpShown = false;
    this.connectionState = { status: 'connecting', unreachable: false };
    this.currentFilePath = filePath;
    this.lobby.setCurrentFile(filePath);

    this.fileExplorer.setActiveFile(filePath);

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.remove('hidden');

    const displayName = filePath.split('/').pop().replace(/\.md$/i, '');
    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = displayName;
    }

    this.showEditorLoading();
    this.renderPresence();

    const session = new EditorSession({
      editorContainer: this.elements.editorContainer,
      lineWrappingEnabled: this.getStoredLineWrapping(),
      initialTheme: this.themeController.getTheme(),
      lineInfoElement: this.elements.lineInfo,
      onAwarenessChange: (users) => this.updateFileAwareness(users),
      onConnectionChange: (state) => this.handleConnectionChange(state),
      onContentChange: () => {
        this.previewRenderer.queueRender();
        this.scheduleBacklinkRefresh();
      },
      preferredUserName: this.getStoredUserName(),
      localUser: this.lobby.getLocalUser(),
      getFileList: () => this.fileExplorer.flatFiles,
    });

    this.session = session;

    try {
      await session.initialize(filePath);

      if (loadToken !== this.sessionLoadToken) {
        session.destroy();
        return;
      }

      this.scrollSyncController.attachEditorScroller(session.getScrollContainer());
      session.applyTheme(this.themeController.getTheme());
      this.syncWrapToggle();
      this.previewRenderer.queueRender();
      this.backlinksPanel.load(filePath);
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      this.scrollSyncController.attachEditorScroller(null);
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.sessionLoadToken) return;

      this.showEditorLoadError();
      this.syncWrapToggle();
      this.toastController.show('Failed to initialize editor');
    }
  }

  cleanupSession() {
    this.session?.destroy();
    this.session = null;
    this.scrollSyncController.attachEditorScroller(null);
    this.outlineController.cleanup();
    // Keep followedUserClientId — follow persists across file switches
    this.followedCursorSignature = '';
    clearTimeout(this._backlinkRefreshTimer);
  }

  handleWikiLinkClick(target) {
    const files = this.fileExplorer.flatFiles;
    const match = resolveWikiTarget(target, files);

    if (match) {
      navigateToFile(match);
    } else {
      const normalizedPath = this.normalizeNewWikiFilePath(target);
      if (!normalizedPath) {
        this.toastController.show('Cannot create an empty wiki-link target');
        return;
      }
      this.createAndOpenFile(normalizedPath, target);
    }
  }

  normalizeNewWikiFilePath(target) {
    const normalized = String(target ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/');

    if (!normalized) {
      return null;
    }

    return normalized.endsWith('.md') ? normalized : `${normalized}.md`;
  }

  async createAndOpenFile(filePath, displayName) {
    try {
      const response = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: `# ${displayName}\n\n` }),
      });
      const data = await response.json();
      if (data.ok) {
        await this.fileExplorer.refresh();
        navigateToFile(filePath);
        this.toastController.show(`Created ${displayName}`);
      } else {
        this.toastController.show(data.error || 'Failed to create file');
      }
    } catch (error) {
      this.toastController.show(`Failed to create file: ${error.message}`);
    }
  }

  // Sidebar

  handleFileSelection(filePath, { closeSidebarOnMobile = false } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }
    navigateToFile(filePath);
  }

  isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  closeSidebarOnMobile() {
    const sidebar = this.elements.sidebar;
    if (!sidebar || !this.isMobileViewport()) return;
    if (sidebar.classList.contains('collapsed')) return;

    sidebar.classList.add('collapsed');
    try {
      localStorage.setItem(this.sidebarVisibleKey, 'false');
    } catch {
      // Ignore storage errors in private browsing modes.
    }
  }

  toggleSidebar() {
    const sidebar = this.elements.sidebar;
    if (!sidebar) return;
    const isHidden = sidebar.classList.toggle('collapsed');
    localStorage.setItem(this.sidebarVisibleKey, isHidden ? 'false' : 'true');
  }

  restoreSidebarState() {
    const sidebar = this.elements.sidebar;
    if (!sidebar) return;

    const isMobile = this.isMobileViewport();

    let showSidebar = true;
    try {
      const stored = localStorage.getItem(this.sidebarVisibleKey);
      if (stored === 'true') {
        showSidebar = true;
      } else if (stored === 'false') {
        showSidebar = false;
      } else if (isMobile) {
        // Default to a collapsed drawer on mobile so toolbar controls remain usable.
        showSidebar = false;
      }
    } catch {
      if (isMobile) {
        showSidebar = false;
      }
    }

    sidebar.classList.toggle('collapsed', !showSidebar);
  }

  // Line wrapping

  toggleLineWrapping() {
    const currentState = this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
    const nextState = !currentState;

    this.session?.setLineWrapping(nextState);
    this.storeLineWrapping(nextState);
    this.syncWrapToggle(nextState);
    this.session?.requestMeasure();
    this.scrollSyncController.syncPreviewToEditor();
  }

  // Theme

  handleThemeChange(theme) {
    this.previewRenderer.applyTheme(theme);
    this.previewRenderer.queueRender();
    this.session?.applyTheme(theme);
    this.excalidrawEmbed.updateTheme(theme);
  }

  // Connection

  handleConnectionChange(state) {
    this.connectionState = state;
    this.renderPresence();

    if (state.firstConnection) {
      this.toastController.show('Connected');
    }

    if (state.unreachable && !this.connectionHelpShown) {
      this.connectionHelpShown = true;
      this.toastController.show(`Cannot reach server at ${state.wsBaseUrl}`, 6000);
    }
  }

  // Presence — global (lobby) + per-file awareness

  /** Called by the lobby whenever the global user list changes. */
  updateGlobalUsers(users) {
    this.globalUsers = users;
    this.syncFollowedUser();
    this.renderAvatars();
    this.renderPresence();
    this.syncCurrentUserName();
  }

  /** Called by the per-file EditorSession awareness (cursor data only). */
  updateFileAwareness(_users) {
    // Cursor positions from the file-level awareness are used by followUserCursor.
    // Re-check the followed user whenever cursors update.
    this.syncFollowedUser();
  }

  renderPresence() {
    const badge = this.elements.userCount;
    if (!badge) return;

    if (this.connectionState.status === 'connected') {
      badge.textContent = `${this.globalUsers.length} online`;
      badge.style.opacity = '1';
      return;
    }

    if (this.connectionState.status === 'connecting') {
      badge.textContent = this.connectionState.unreachable ? 'Unreachable' : 'Connecting...';
      badge.style.opacity = '0.6';
      return;
    }

    badge.textContent = 'Offline';
    badge.style.opacity = '0.6';
  }

  renderAvatars() {
    const avatars = this.elements.userAvatars;
    if (!avatars) return;

    avatars.innerHTML = '';
    const visibleUsers = [...this.globalUsers];
    const followedIndex = visibleUsers.findIndex((u) => u.clientId === this.followedUserClientId);
    if (followedIndex > 0) {
      const [followed] = visibleUsers.splice(followedIndex, 1);
      visibleUsers.unshift(followed);
    }

    visibleUsers.slice(0, 5).forEach((user) => {
      const avatar = document.createElement(user.isLocal ? 'div' : 'button');
      avatar.className = 'user-avatar';
      avatar.style.backgroundColor = user.color;
      avatar.textContent = user.name.charAt(0).toUpperCase();
      avatar.classList.toggle('is-following', user.clientId === this.followedUserClientId);

      // Show which file the user is in, and whether they're on the same file
      const sameFile = user.currentFile && user.currentFile === this.currentFilePath;
      const fileLabel = user.currentFile
        ? user.currentFile.replace(/\.md$/i, '').split('/').pop()
        : 'No file';

      if (user.isLocal) {
        avatar.title = `${user.name} (you) — ${fileLabel}`;
      } else {
        avatar.type = 'button';
        avatar.classList.add('user-avatar-button');
        if (!sameFile) {
          avatar.classList.add('different-file');
        }
        avatar.title = user.clientId === this.followedUserClientId
          ? `Stop following ${user.name}`
          : sameFile
            ? `Follow ${user.name}`
            : `Follow ${user.name} — ${fileLabel}`;
        avatar.addEventListener('click', () => this.toggleFollowUser(user.clientId));
      }

      avatars.appendChild(avatar);
    });

    if (visibleUsers.length > 5) {
      const overflow = document.createElement('div');
      overflow.className = 'user-avatar';
      overflow.style.backgroundColor = 'var(--color-surface-dynamic)';
      overflow.style.color = 'var(--color-text-muted)';
      overflow.textContent = `+${visibleUsers.length - 5}`;
      avatars.appendChild(overflow);
    }
  }

  // Follow user

  toggleFollowUser(clientId) {
    if (!clientId) return;

    if (this.followedUserClientId === clientId) {
      this.stopFollowingUser();
      return;
    }

    const user = this.globalUsers.find((u) => u.clientId === clientId && !u.isLocal);
    if (!user) return;

    this.followedUserClientId = clientId;
    this.followedCursorSignature = '';
    this.renderAvatars();

    // If the followed user is on a different file, navigate there first
    if (user.currentFile && user.currentFile !== this.currentFilePath) {
      navigateToFile(user.currentFile);
      this.toastController.show(`Following ${user.name} — switching to ${user.currentFile.replace(/\.md$/i, '').split('/').pop()}`);
      return;
    }

    // Same file — scroll to their cursor
    requestAnimationFrame(() => {
      if (this.followedUserClientId === clientId) {
        this.followUserCursor(user, { force: true });
      }
    });

    this.toastController.show(`Following ${user.name}`);
  }

  stopFollowingUser(showToast = true) {
    if (!this.followedUserClientId) return;
    const name = this.globalUsers.find((u) => u.clientId === this.followedUserClientId)?.name ?? 'collaborator';
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
    this.renderAvatars();
    if (showToast) this.toastController.show(`Stopped following ${name}`);
  }

  syncFollowedUser() {
    if (!this.followedUserClientId) return;
    const user = this.globalUsers.find((u) => u.clientId === this.followedUserClientId);
    if (!user || user.isLocal) {
      this.stopFollowingUser(false);
      return;
    }

    // If the followed user switched to a different file, follow them there
    if (user.currentFile && user.currentFile !== this.currentFilePath) {
      navigateToFile(user.currentFile);
      this.toastController.show(`${user.name} switched to ${user.currentFile.replace(/\.md$/i, '').split('/').pop()}`);
      return;
    }

    // Same file — scroll to their cursor
    this.followUserCursor(user);
  }

  followUserCursor(user, { force = false } = {}) {
    // The lobby user has a different clientId from the per-file awareness.
    // Use peerId to find the matching per-file awareness entry.
    const fileClientId = this._resolveFileClientId(user.peerId);
    const liveCursor = fileClientId != null ? this.session?.getUserCursor(fileClientId) : null;
    const cursorHead = liveCursor?.cursorHead ?? null;
    const cursorLine = liveCursor?.cursorLine ?? null;
    const cursorAnchor = liveCursor?.cursorAnchor ?? null;

    if (!user || cursorHead == null || cursorLine == null) {
      this.followedCursorSignature = '';
      return;
    }

    const nextSig = `${user.clientId}:${cursorAnchor}:${cursorHead}`;
    if (!force && nextSig === this.followedCursorSignature) return;

    const didScroll = (fileClientId != null && this.session?.scrollToUserCursor(fileClientId, 'center'))
      || this.session?.scrollToPosition(cursorHead, 'center')
      || this.session?.scrollToLine(cursorLine);
    if (didScroll) this.followedCursorSignature = nextSig;
  }

  /**
   * Given a peerId from the lobby, find the matching clientId in the
   * current per-file EditorSession awareness.
   */
  _resolveFileClientId(peerId) {
    if (!peerId || !this.session?.awareness) return null;
    for (const [clientId, state] of this.session.awareness.getStates()) {
      if (state.user?.peerId === peerId) return clientId;
    }
    return null;
  }

  // Display name dialog

  openDisplayNameDialog() {
    const dialog = this.elements.displayNameDialog;
    const input = this.elements.displayNameInput;
    if (!dialog || !input) return;

    input.value = this.getCurrentUserName();
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  handleDisplayNameSubmit() {
    const input = this.elements.displayNameInput;
    const dialog = this.elements.displayNameDialog;
    if (!input || !dialog || !this.session) return;

    const normalizedName = this.session.setUserName(input.value);
    if (!normalizedName) {
      input.focus();
      this.toastController.show(`Name must be 1-${USER_NAME_MAX_LENGTH} characters`);
      return;
    }

    this.storeUserName(normalizedName);
    this.lobby.setUserName(normalizedName);
    this.syncCurrentUserName();
    dialog.close();
    this.toastController.show(`Display name: ${normalizedName}`);
  }

  // Share

  async copyCurrentLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.toastController.show('Link copied');
    } catch {
      this.toastController.show('Failed to copy link');
    }
  }

  // User name storage

  getCurrentUser() {
    return this.globalUsers.find((u) => u.isLocal)
      ?? this.session?.getLocalUser()
      ?? this.lobby?.getLocalUser()
      ?? null;
  }

  getCurrentUserName() {
    return this.getCurrentUser()?.name ?? this.getStoredUserName() ?? '';
  }

  getStoredUserName() {
    try { return localStorage.getItem(this.userNameStorageKey) || ''; } catch { return ''; }
  }

  storeUserName(name) {
    try { localStorage.setItem(this.userNameStorageKey, name); } catch { /* ignore */ }
  }

  syncCurrentUserName() {
    const el = this.elements.currentUserName;
    if (!el) return;
    const name = this.getCurrentUserName();
    el.textContent = name || 'Set name';
    el.classList.toggle('has-name', Boolean(name));
  }

  // Line wrapping storage

  getStoredLineWrapping() {
    try { return localStorage.getItem(this.lineWrappingStorageKey) !== 'false'; } catch { return true; }
  }

  storeLineWrapping(enabled) {
    try { localStorage.setItem(this.lineWrappingStorageKey, String(enabled)); } catch { /* ignore */ }
  }

  syncWrapToggle(state) {
    const enabled = state ?? this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
    const label = this.elements.wrapToggleLabel;
    const button = this.elements.toggleWrapButton;
    if (label) label.textContent = enabled ? 'Wrap on' : 'Wrap off';
    if (button) button.setAttribute('aria-label', enabled ? 'Disable line wrap' : 'Enable line wrap');
  }

  // Backlinks

  /**
   * Schedule a debounced backlinks refresh.
   * Called on every content change — the server index updates on persist
   * (500ms debounce), so we wait a bit longer before re-fetching.
   */
  scheduleBacklinkRefresh() {
    clearTimeout(this._backlinkRefreshTimer);
    this._backlinkRefreshTimer = setTimeout(() => {
      if (this.currentFilePath) {
        this.backlinksPanel.load(this.currentFilePath);
      }
    }, 2000);
  }

  // Editor loading states

  showEditorLoading() {
    if (!this.elements.editorContainer) return;
    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <div class="loading-spinner"></div>
        <span class="loading-text">Loading file...</span>
      </div>`;
  }

  showEditorLoadError() {
    if (!this.elements.editorContainer) return;
    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <span class="loading-text">Failed to load file</span>
      </div>`;
  }
}
