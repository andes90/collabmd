import { PreviewRenderer } from './preview-renderer.js';
import { USER_NAME_MAX_LENGTH, normalizeUserName } from '../domain/room.js';
import { resolveWikiTarget } from '../domain/vault-utils.js';
import { LOBBY_CHAT_MESSAGE_MAX_LENGTH, LobbyPresence } from '../infrastructure/lobby-presence.js';
import { getFileFromHash, navigateToFile } from '../infrastructure/runtime-config.js';
import { TabActivityLock } from '../infrastructure/tab-activity-lock.js';
import { BacklinksPanel } from '../presentation/backlinks-panel.js';
import { CommentsPanel } from '../presentation/comments-panel.js';
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
      commentSelectionButton: document.getElementById('commentSelectionBtn'),
      chatContainer: document.getElementById('chatContainer'),
      chatEmptyState: document.getElementById('chatEmptyState'),
      chatForm: document.getElementById('chatForm'),
      chatInput: document.getElementById('chatInput'),
      chatMessages: document.getElementById('chatMessages'),
      chatNotificationButton: document.getElementById('chatNotificationBtn'),
      chatPanel: document.getElementById('chatPanel'),
      chatStatus: document.getElementById('chatStatus'),
      chatToggleBadge: document.getElementById('chatToggleBadge'),
      chatToggleButton: document.getElementById('chatToggleBtn'),
      displayNameCancel: document.getElementById('displayNameCancel'),
      displayNameCopy: document.getElementById('displayNameCopy'),
      displayNameDialog: document.getElementById('displayNameDialog'),
      displayNameForm: document.getElementById('displayNameForm'),
      displayNameInput: document.getElementById('displayNameInput'),
      displayNameSubmit: document.getElementById('displayNameSubmit'),
      displayNameTitle: document.getElementById('displayNameTitle'),
      editNameButton: document.getElementById('editNameBtn'),
      editorContainer: document.getElementById('editorContainer'),
      editorPage: document.getElementById('editor-page'),
      lineInfo: document.getElementById('lineInfo'),
      previewContent: document.getElementById('previewContent'),
      previewContainer: document.getElementById('previewContainer'),
      commentsPanel: document.getElementById('commentsPanel'),
      commentsToggle: document.getElementById('commentsToggle'),
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
      outlineToggle: document.getElementById('outlineToggle'),
      tabLockCopy: document.getElementById('tabLockCopy'),
      tabLockOverlay: document.getElementById('tabLockOverlay'),
      tabLockTakeoverButton: document.getElementById('tabLockTakeoverBtn'),
      tabLockTitle: document.getElementById('tabLockTitle'),
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
    this.chatMessages = [];
    this.chatMessageIds = new Set();
    this.chatUnreadCount = 0;
    this.chatIsOpen = false;
    this.chatInitialSyncComplete = false;
    this.chatNotificationsPreferenceKey = 'collabmd-chat-notifications-enabled';
    this.chatNotificationsEnabled = this.getStoredChatNotificationsEnabled();
    this.chatNotificationPermission = this.getNotificationPermission();
    this.chatTimeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    this.editorSessionModulePromise = null;
    this.commentThreads = [];
    this.isTabActive = false;
    this.fileExplorerReady = false;
    this.fileExplorerReadyPromise = Promise.resolve();

    this.lobby = new LobbyPresence({
      preferredUserName: this.getStoredUserName(),
      onChange: (users) => this.updateGlobalUsers(users),
      onChatChange: (messages, meta) => this.updateChatMessages(messages, meta),
    });

    this.toastController = new ToastController(this.elements.toastContainer);
    this.quickSwitcher = new QuickSwitcherController({
      getFileList: () => this.fileExplorer.flatFiles,
      onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
    });
    this.fileExplorer = new FileExplorerController({
      onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
      onFileDelete: () => navigateToFile(null),
      toastController: this.toastController,
    });
    this.outlineController = new OutlineController({
      onNavigateToHeading: ({ sourceLine }) => {
        if (!Number.isFinite(sourceLine)) return;
        this.scrollSyncController.suspendSync(250);
        this.session?.scrollToLine(sourceLine, 0);
      },
    });
    this.previewRenderer = new PreviewRenderer({
      getContent: () => this.getPreviewSource(),
      getFileList: () => this.fileExplorer.flatFiles,
      onBeforeRenderCommit: () => {
        this.excalidrawEmbed.detachForCommit();
      },
      onAfterRenderCommit: (_previewElement, stats) => {
        this.excalidrawEmbed.reconcileEmbeds(this.elements.previewContent, {
          isLargeDocument: stats.isLargeDocument,
        });
        this.excalidrawEmbed.syncLayout();
        this.scrollSyncController.setLargeDocumentMode(stats.isLargeDocument);
        this.commentsPanel.decoratePreviewAnchors();
        this.schedulePreviewLayoutSync({ delayMs: 0 });
      },
      onRenderComplete: () => {
        this.excalidrawEmbed.syncLayout();
        this.commentsPanel.decoratePreviewAnchors();
        this.schedulePreviewLayoutSync({ delayMs: 0 });
      },
      outlineController: this.outlineController,
      previewContainer: this.elements.previewContainer,
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
      onEditorScrollActivityChange: (isActive) => this.handleEditorScrollActivityChange(isActive),
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      scrollEditorToLine: (lineNumber, viewportRatio) => this.session?.scrollToLine(lineNumber, viewportRatio),
    });
    this.backlinksPanel = new BacklinksPanel({
      panelElement: this.elements.backlinksPanel,
      onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
    });
    this.commentsPanel = new CommentsPanel({
      onCreateThread: (payload) => this.handleCommentThreadCreate(payload),
      onNavigateToLine: (lineNumber) => this.navigateToCommentLine(lineNumber),
      onReplyToThread: (threadId, body) => this.handleCommentReply(threadId, body),
      onResolveThread: (threadId, resolved) => this.handleCommentResolution(threadId, resolved),
      panelElement: this.elements.commentsPanel,
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      toggleButton: this.elements.commentsToggle,
    });
    this.excalidrawEmbed = new ExcalidrawEmbedController({
      getTheme: () => this.themeController.getTheme(),
      getLocalUser: () => this.lobby.getLocalUser(),
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      toastController: this.toastController,
    });
    this._backlinkRefreshTimer = null;
    this._hasPromptedForDisplayName = false;
    this._previewHydrationPaused = false;
    this._pendingPreviewLayoutSync = false;
    this._previewLayoutResizeObserver = null;
    this._previewLayoutSyncTimer = null;
    this.tabActivityLock = new TabActivityLock({
      onActivated: ({ takeover }) => this.handleTabActivated({ takeover }),
      onBlocked: () => this.handleTabBlocked({ reason: 'active-elsewhere' }),
      onStolen: () => this.handleTabBlocked({ reason: 'taken-over' }),
    });

    if (this.chatNotificationPermission !== 'granted') {
      this.chatNotificationsEnabled = false;
    }
  }

  isExcalidrawFile(filePath) {
    return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.excalidraw');
  }

  isPlantUmlFile(filePath) {
    return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.puml');
  }

  createPlantUmlPreviewDocument(source = '') {
    const text = String(source ?? '');
    const longestFence = Math.max(...(text.match(/`+/g)?.map((fence) => fence.length) ?? [0]));
    const fence = '`'.repeat(Math.max(3, longestFence + 1));
    return `${fence}plantuml\n${text}\n${fence}`;
  }

  getPreviewSource() {
    const source = this.session?.getText() ?? '';
    if (this.isPlantUmlFile(this.currentFilePath)) {
      return this.createPlantUmlPreviewDocument(source);
    }

    return source;
  }

  getDisplayName(filePath) {
    return String(filePath ?? '')
      .split('/')
      .pop()
      .replace(/\.(?:md|markdown|mdx|excalidraw|puml)$/i, '');
  }

  resetPreviewMode() {
    this.elements.previewContent?.classList.remove('is-excalidraw-file-preview');
    this.elements.previewContent?.classList.remove('is-plantuml-file-preview');
  }

  syncFileChrome(filePath) {
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    this.elements.outlineToggle?.classList.toggle('hidden', isExcalidraw || isPlantUml);
    this.elements.commentsToggle?.classList.toggle('hidden', isExcalidraw || isPlantUml);
    this.elements.commentSelectionButton?.classList.toggle('hidden', isExcalidraw || isPlantUml);
    this.elements.previewContent?.classList.toggle('is-plantuml-file-preview', isPlantUml);

    if (isExcalidraw) {
      this.layoutController.setView('preview');
      this.outlineController.close();
      this.backlinksPanel.clear();
      return;
    }

    if (isPlantUml) {
      this.outlineController.close();
      this.backlinksPanel.clear();
    }
  }

  renderExcalidrawFilePreview(filePath) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-excalidraw-file-preview');
    previewElement.replaceChildren();

    const placeholder = document.createElement('div');
    placeholder.className = 'excalidraw-embed-placeholder';
    placeholder.dataset.embedKey = `${filePath}#file-preview`;
    placeholder.dataset.embedLabel = this.getDisplayName(filePath);
    placeholder.dataset.embedTarget = filePath;
    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Loading Excalidraw preview…';
    placeholder.appendChild(loadingShell);
    previewElement.appendChild(placeholder);

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.excalidrawEmbed.reconcileEmbeds(previewElement, { isLargeDocument: false });
    this.excalidrawEmbed.hydrateVisibleEmbeds();
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  initialize() {
    this.themeController.initialize();
    this.previewRenderer.applyTheme(this.themeController.getTheme());
    this.outlineController.initialize();
    this.layoutController.initialize();
    this.scrollSyncController.initialize();
    this.fileExplorer.initialize();
    this.initializePreviewLayoutObserver();
    this.syncCurrentUserName();
    this.syncWrapToggle();
    this.syncChatNotificationButton();
    this.renderChat();
    this.elements.chatInput?.setAttribute('maxlength', String(LOBBY_CHAT_MESSAGE_MAX_LENGTH));
    this.bindEvents();
    this.restoreSidebarState();
    this.tabActivityLock.initialize();
    this.tabActivityLock.tryActivate();

    window.addEventListener('hashchange', () => this.handleHashChange());
    window.addEventListener('resize', this.createResizeHandler());

    this.fileExplorerReadyPromise = this.fileExplorer.refresh().then(() => {
      this.fileExplorerReady = true;
      if (this.isTabActive) {
        return this.handleHashChange();
      }
      return undefined;
    });

  }

  bindEvents() {
    this.elements.chatToggleButton?.addEventListener('click', () => {
      this.toggleChatPanel();
    });

    this.elements.chatForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handleChatSubmit();
    });

    this.elements.chatNotificationButton?.addEventListener('click', () => {
      void this.handleChatNotificationToggle();
    });

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

    this.elements.tabLockTakeoverButton?.addEventListener('click', () => {
      this.handleTabTakeover();
    });

    this.elements.toggleWrapButton?.addEventListener('click', () => {
      this.toggleLineWrapping();
    });

    this.elements.commentSelectionButton?.addEventListener('click', () => {
      this.startCommentFromEditorSelection();
    });

    this.elements.previewContent?.addEventListener('click', (event) => {
      const wikiLink = event.target.closest('a.wiki-link[data-wiki-target]');
      if (!wikiLink) {
        return;
      }

      event.preventDefault();
      this.handleWikiLinkClick(wikiLink.dataset.wikiTarget);
    });

    this.elements.sidebarToggle?.addEventListener('click', () => {
      this.toggleSidebar();
    });

    this.elements.sidebarClose?.addEventListener('click', () => {
      this.closeSidebarOnMobile();
    });

    document.addEventListener('pointerdown', (event) => {
      if (!this.chatIsOpen) {
        return;
      }

      if (this.elements.chatContainer?.contains(event.target)) {
        return;
      }

      this.closeChatPanel();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.chatIsOpen) {
        this.closeChatPanel();
        return;
      }

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
        this.schedulePreviewLayoutSync({ delayMs: 0 });
      }, 100);
    };
  }

  initializePreviewLayoutObserver() {
    if (typeof ResizeObserver !== 'function' || !this.elements.previewContent) {
      return;
    }

    this._previewLayoutResizeObserver?.disconnect();
    this._previewLayoutResizeObserver = new ResizeObserver(() => {
      this.schedulePreviewLayoutSync();
    });
    this._previewLayoutResizeObserver.observe(this.elements.previewContent);
  }

  schedulePreviewLayoutSync({ delayMs = 120 } = {}) {
    if (this._previewHydrationPaused) {
      this._pendingPreviewLayoutSync = true;
      return;
    }

    clearTimeout(this._previewLayoutSyncTimer);

    this._previewLayoutSyncTimer = setTimeout(() => {
      this._previewLayoutSyncTimer = null;

      if (!this.session || !this.elements.previewContent) {
        return;
      }

      if (this.elements.previewContent.dataset.renderPhase === 'shell') {
        return;
      }

      if (this._previewHydrationPaused) {
        this._pendingPreviewLayoutSync = true;
        return;
      }

      this.excalidrawEmbed.syncLayout();
      this.scrollSyncController.invalidatePreviewBlocks();
      this.scrollSyncController.warmPreviewBlocks({
        onReady: () => {
          if (!this.session) {
            return;
          }

          this.scrollSyncController.realignAfterLayoutChange();
          this.outlineController.scheduleActiveHeadingUpdate();
        },
      });
    }, delayMs);
  }

  handleEditorScrollActivityChange(isActive) {
    this._previewHydrationPaused = Boolean(isActive);
    this.previewRenderer.setHydrationPaused(this._previewHydrationPaused);
    this.excalidrawEmbed.setHydrationPaused(this._previewHydrationPaused);

    if (this._previewHydrationPaused) {
      clearTimeout(this._previewLayoutSyncTimer);
      this._previewLayoutSyncTimer = null;
      this._pendingPreviewLayoutSync = true;
      return;
    }

    if (this._pendingPreviewLayoutSync) {
      this._pendingPreviewLayoutSync = false;
      this.schedulePreviewLayoutSync({ delayMs: 0 });
    }
  }

  async handleHashChange() {
    if (!this.isTabActive) {
      return;
    }

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
    this.resetPreviewMode();
    this.elements.outlineToggle?.classList.remove('hidden');
    this.elements.commentsToggle?.classList.add('hidden');
    this.elements.commentSelectionButton?.classList.add('hidden');
    this.currentFilePath = null;
    this.lobby.setCurrentFile(null);
    this.fileExplorer.setActiveFile(null);

    this.elements.emptyState?.classList.remove('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.previewContent.innerHTML = '';
    this.elements.previewContent.dataset.renderPhase = 'ready';
    clearTimeout(this._previewLayoutSyncTimer);
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this.previewRenderer.setHydrationPaused(false);
    this.excalidrawEmbed.setHydrationPaused(false);
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();

    // Re-render global presence (users are still visible on the empty state)
    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
    this.updateCommentThreads([]);
    this.commentsPanel.setCurrentFile(null, { supported: false });

    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = 'CollabMD';
    }
  }

  loadEditorSessionClass() {
    if (!this.editorSessionModulePromise) {
      this.editorSessionModulePromise = import('../infrastructure/editor-session.js')
        .then((module) => module.EditorSession);
    }

    return this.editorSessionModulePromise;
  }

  async openFile(filePath) {
    if (!this.isTabActive) {
      return;
    }

    // Re-dispatching the same hash can otherwise tear down and recreate the
    // active Yjs session for the same file, which opens a reconnect window
    // where multiple same-tab sessions briefly overlap.
    if (filePath === this.currentFilePath && this.session) {
      this.fileExplorer.setActiveFile(filePath);
      this.lobby.setCurrentFile(filePath);
      return;
    }

    const loadToken = this.sessionLoadToken + 1;
    this.sessionLoadToken = loadToken;
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    const supportsComments = !isExcalidraw && !isPlantUml;

    this.cleanupSession();
    this.layoutController.reset();
    this.resetPreviewMode();
    this.connectionHelpShown = false;
    this.connectionState = { status: 'connecting', unreachable: false };
    this.currentFilePath = filePath;
    this.lobby.setCurrentFile(filePath);

    this.fileExplorer.setActiveFile(filePath);
    this.syncFileChrome(filePath);
    this.commentsPanel.setCurrentFile(filePath, { supported: supportsComments });
    this.updateCommentThreads([]);

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.remove('hidden');

    const displayName = this.getDisplayName(filePath);
    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = displayName;
    }

    this.showEditorLoading();
    this.previewRenderer.beginDocumentLoad();
    this.renderPresence();

    const EditorSession = await this.loadEditorSessionClass();
    const session = new EditorSession({
      editorContainer: this.elements.editorContainer,
      lineWrappingEnabled: this.getStoredLineWrapping(),
      initialTheme: this.themeController.getTheme(),
      lineInfoElement: this.elements.lineInfo,
      onAwarenessChange: (users) => this.updateFileAwareness(users),
      onConnectionChange: (state) => this.handleConnectionChange(state),
      onCommentsChange: (threads) => this.updateCommentThreads(threads),
      onContentChange: () => {
        if (isExcalidraw) {
          return;
        }

        this.previewRenderer.queueRender();
        if (this.commentThreads.length > 0) {
          this.updateCommentThreads(this.session?.getCommentThreads() ?? []);
        }
        if (!isPlantUml) {
          this.scheduleBacklinkRefresh();
        }
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
      if (isExcalidraw) {
        this.renderExcalidrawFilePreview(filePath);
      }
      this.syncWrapToggle();
      this.updateCommentThreads(session.getCommentThreads());
      if (isExcalidraw || isPlantUml) {
        this.backlinksPanel.clear();
      } else {
        this.backlinksPanel.load(filePath);
      }
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
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.outlineController.cleanup();
    // Keep followedUserClientId — follow persists across file switches
    this.followedCursorSignature = '';
    clearTimeout(this._backlinkRefreshTimer);
    clearTimeout(this._previewLayoutSyncTimer);
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this.previewRenderer.setHydrationPaused(false);
    this.excalidrawEmbed.setHydrationPaused(false);
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

  supportsComments(filePath = this.currentFilePath) {
    return Boolean(filePath) && !this.isExcalidrawFile(filePath) && !this.isPlantUmlFile(filePath);
  }

  startCommentFromEditorSelection() {
    if (!this.session || !this.supportsComments()) {
      return;
    }

    const range = this.session.getCurrentSelectionLineRange();
    if (!range) {
      this.toastController.show('Cannot anchor a comment without an editor selection');
      return;
    }

    if (this.layoutController.currentView === 'preview' || this.isMobileViewport()) {
      this.layoutController.setView('preview');
    } else if (this.layoutController.currentView === 'editor') {
      this.layoutController.setView('split');
    }

    this.commentsPanel.openComposerForRange(range);
  }

  navigateToCommentLine(lineNumber) {
    if (!Number.isFinite(lineNumber)) {
      return;
    }

    if (this.layoutController.currentView === 'preview' || this.isMobileViewport()) {
      this.layoutController.setView('split');
    }

    this.scrollSyncController.suspendSync(250);
    this.session?.scrollToLine(lineNumber, 0.2);
  }

  handleCommentThreadCreate(payload) {
    const threadId = this.session?.createCommentThread(payload);
    if (!threadId) {
      this.toastController.show('Comment cannot be empty');
    }

    return threadId;
  }

  handleCommentReply(threadId, body) {
    const messageId = this.session?.replyToCommentThread(threadId, body);
    if (!messageId) {
      this.toastController.show('Reply cannot be empty');
    }

    return messageId;
  }

  handleCommentResolution(threadId, resolved) {
    if (!resolved) {
      return false;
    }

    const didUpdate = this.session?.deleteCommentThread(threadId);
    if (!didUpdate) {
      this.toastController.show('Failed to resolve comment');
      return false;
    }

    return true;
  }

  updateCommentThreads(threads = []) {
    this.commentThreads = Array.isArray(threads) ? threads : [];
    this.commentsPanel.setThreads(this.commentThreads);
  }

  // Theme

  handleThemeChange(theme) {
    this.previewRenderer.applyTheme(theme);
    if (!this.isExcalidrawFile(this.currentFilePath)) {
      this.previewRenderer.queueRender();
    }
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

  // Chat

  updateChatMessages(messages, { initial = false } = {}) {
    const previousIds = new Set(this.chatMessageIds);
    const localPeerId = this.lobby.getLocalUser()?.peerId ?? null;

    this.chatMessages = messages;
    this.chatMessageIds = new Set(messages.map((message) => message.id));

    if (!this.chatInitialSyncComplete) {
      if (initial) {
        this.chatInitialSyncComplete = true;
      }

      this.renderChat();
      return;
    }

    const newRemoteMessages = messages.filter((message) => (
      !previousIds.has(message.id)
      && message.peerId
      && message.peerId !== localPeerId
    ));

    if (this.chatIsOpen) {
      this.chatUnreadCount = 0;
    } else if (newRemoteMessages.length > 0) {
      this.chatUnreadCount += newRemoteMessages.length;
    }

    for (const message of newRemoteMessages) {
      this.maybeNotifyChatMessage(message);
    }

    this.renderChat();
  }

  toggleChatPanel() {
    if (this.chatIsOpen) {
      this.closeChatPanel();
      return;
    }

    this.openChatPanel();
  }

  openChatPanel() {
    this.chatIsOpen = true;
    this.chatUnreadCount = 0;
    this.renderChat();
    requestAnimationFrame(() => {
      this.elements.chatInput?.focus();
      this.scrollChatToBottom();
    });
  }

  closeChatPanel() {
    if (!this.chatIsOpen) {
      return;
    }

    this.chatIsOpen = false;
    this.renderChat();
  }

  handleChatSubmit() {
    if (!this.isTabActive) {
      return;
    }

    const input = this.elements.chatInput;
    if (!input) {
      return;
    }

    const sentMessage = this.lobby.sendChatMessage(input.value);
    if (!sentMessage) {
      input.focus();
      return;
    }

    input.value = '';
    if (!this.chatIsOpen) {
      this.openChatPanel();
      return;
    }

    this.renderChat();
  }

  renderChat() {
    this.elements.chatContainer?.classList.toggle('is-open', this.chatIsOpen);
    this.elements.chatPanel?.classList.toggle('hidden', !this.chatIsOpen);

    this.syncChatToggleButton();
    this.syncChatNotificationButton();

    const list = this.elements.chatMessages;
    const emptyState = this.elements.chatEmptyState;

    if (this.elements.chatStatus) {
      this.elements.chatStatus.textContent = this.chatInitialSyncComplete
        ? `${this.globalUsers.length} online`
        : 'Syncing...';
    }

    if (!list) {
      return;
    }

    list.replaceChildren();

    if (this.chatMessages.length === 0) {
      emptyState?.classList.remove('hidden');
      list.classList.add('hidden');
      return;
    }

    emptyState?.classList.add('hidden');
    list.classList.remove('hidden');

    const fragment = document.createDocumentFragment();
    this.chatMessages.forEach((message) => {
      fragment.appendChild(this.createChatMessageElement(message));
    });
    list.appendChild(fragment);

    if (this.chatIsOpen) {
      this.scrollChatToBottom();
    }
  }

  createChatMessageElement(message) {
    const item = document.createElement('article');
    const isLocal = message.peerId === this.lobby.getLocalUser()?.peerId;
    item.className = 'chat-message';
    item.classList.toggle('is-local', isLocal);

    const avatar = document.createElement('div');
    avatar.className = 'chat-message-avatar';
    avatar.style.backgroundColor = message.userColor || 'var(--color-primary)';
    avatar.textContent = (message.userName || '?').charAt(0).toUpperCase();
    avatar.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'chat-message-body';

    const meta = document.createElement('div');
    meta.className = 'chat-message-meta';

    const author = document.createElement('span');
    author.className = 'chat-message-author';
    author.textContent = isLocal ? `${message.userName} (you)` : message.userName;

    const time = document.createElement('span');
    time.className = 'chat-message-time';
    time.textContent = this.formatChatTimestamp(message.createdAt);

    meta.append(author, time);

    const fileLabel = this.getChatMessageFileLabel(message.filePath);
    if (fileLabel) {
      const file = document.createElement('span');
      file.className = 'chat-message-file';
      file.textContent = fileLabel;
      meta.append(file);
    }

    const text = document.createElement('p');
    text.className = 'chat-message-text';
    text.textContent = message.text;

    body.append(meta, text);
    item.append(avatar, body);
    return item;
  }

  scrollChatToBottom() {
    const list = this.elements.chatMessages;
    if (!list) {
      return;
    }

    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }

  formatChatTimestamp(value) {
    if (!Number.isFinite(value)) {
      return '';
    }

    try {
      return this.chatTimeFormatter.format(new Date(value));
    } catch {
      return '';
    }
  }

  getChatMessageFileLabel(filePath) {
    if (!filePath) {
      return '';
    }

    return this.getDisplayName(filePath);
  }

  syncChatToggleButton() {
    const button = this.elements.chatToggleButton;
    const badge = this.elements.chatToggleBadge;
    if (!button) {
      return;
    }

    button.classList.toggle('is-active', this.chatIsOpen);
    button.setAttribute('aria-expanded', String(this.chatIsOpen));
    button.title = this.chatUnreadCount > 0
      ? `Team chat (${this.chatUnreadCount} unread)`
      : 'Team chat';

    if (!badge) {
      return;
    }

    const hasUnread = this.chatUnreadCount > 0;
    badge.classList.toggle('hidden', !hasUnread);
    badge.textContent = this.chatUnreadCount > 9 ? '9+' : String(this.chatUnreadCount);
  }

  getNotificationPermission() {
    if (typeof Notification !== 'function') {
      return 'unsupported';
    }

    return Notification.permission;
  }

  syncChatNotificationButton() {
    const button = this.elements.chatNotificationButton;
    if (!button) {
      return;
    }

    const permission = this.getNotificationPermission();
    this.chatNotificationPermission = permission;

    let label = 'Enable alerts';
    let title = 'Enable browser notifications for new chat messages';
    let pressed = false;

    if (permission === 'unsupported') {
      label = 'No alerts';
      title = 'Browser notifications are unavailable here';
    } else if (permission === 'denied') {
      label = 'Alerts blocked';
      title = 'Browser notifications are blocked for this site';
    } else if (permission === 'granted') {
      pressed = this.chatNotificationsEnabled;
      label = pressed ? 'Alerts on' : 'Alerts off';
      title = pressed
        ? 'Disable browser notifications for chat'
        : 'Enable browser notifications for chat';
    }

    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-pressed', String(pressed));
    button.classList.toggle('is-enabled', pressed);
    button.classList.toggle('is-blocked', permission === 'denied');
  }

  async handleChatNotificationToggle() {
    const permission = this.getNotificationPermission();
    this.chatNotificationPermission = permission;

    if (permission === 'unsupported') {
      this.toastController.show('Browser notifications are unavailable here');
      this.syncChatNotificationButton();
      return;
    }

    if (permission === 'denied') {
      this.chatNotificationsEnabled = false;
      this.storeChatNotificationsEnabled(false);
      this.toastController.show('Browser notifications are blocked for this site');
      this.syncChatNotificationButton();
      return;
    }

    if (permission === 'default') {
      const nextPermission = await Notification.requestPermission();
      this.chatNotificationPermission = nextPermission;

      if (nextPermission !== 'granted') {
        this.chatNotificationsEnabled = false;
        this.storeChatNotificationsEnabled(false);
        this.toastController.show(
          nextPermission === 'denied'
            ? 'Browser notifications were blocked'
            : 'Notification permission was dismissed',
        );
        this.syncChatNotificationButton();
        return;
      }

      this.chatNotificationsEnabled = true;
      this.storeChatNotificationsEnabled(true);
      this.toastController.show('Chat alerts enabled');
      this.syncChatNotificationButton();
      return;
    }

    this.chatNotificationsEnabled = !this.chatNotificationsEnabled;
    this.storeChatNotificationsEnabled(this.chatNotificationsEnabled);
    this.toastController.show(this.chatNotificationsEnabled ? 'Chat alerts enabled' : 'Chat alerts disabled');
    this.syncChatNotificationButton();
  }

  maybeNotifyChatMessage(message) {
    if (!this.chatInitialSyncComplete) {
      return;
    }

    if (!this.chatNotificationsEnabled || this.getNotificationPermission() !== 'granted') {
      return;
    }

    if (!document.hidden) {
      return;
    }

    const title = `CollabMD chat • ${message.userName}`;
    const fileLabel = this.getChatMessageFileLabel(message.filePath);
    const body = fileLabel ? `${fileLabel}: ${message.text}` : message.text;

    try {
      const notification = new Notification(title, {
        body,
        tag: `collabmd-chat-${message.id}`,
      });

      notification.addEventListener('click', () => {
        window.focus?.();
        if (message.filePath) {
          navigateToFile(message.filePath);
        }
        notification.close?.();
      });

      setTimeout(() => {
        notification.close?.();
      }, 6000);
    } catch {
      // Ignore notification delivery failures.
    }
  }

  // Presence — global (lobby) + per-file awareness

  /** Called by the lobby whenever the global user list changes. */
  updateGlobalUsers(users) {
    this.globalUsers = users;
    this.syncFollowedUser();
    this.renderAvatars();
    this.renderChat();
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
    const localIndex = visibleUsers.findIndex((u) => u.isLocal);
    if (localIndex > 0) {
      const [localUser] = visibleUsers.splice(localIndex, 1);
      visibleUsers.unshift(localUser);
    }

    const followedIndex = visibleUsers.findIndex((u) => !u.isLocal && u.clientId === this.followedUserClientId);
    const followedInsertIndex = visibleUsers[0]?.isLocal ? 1 : 0;
    if (followedIndex > followedInsertIndex) {
      const [followed] = visibleUsers.splice(followedIndex, 1);
      visibleUsers.splice(followedInsertIndex, 0, followed);
    }

    visibleUsers.slice(0, 5).forEach((user) => {
      const avatar = document.createElement(user.isLocal ? 'div' : 'button');
      avatar.className = 'user-avatar';
      avatar.classList.toggle('is-local', user.isLocal);
      avatar.style.backgroundColor = user.color;
      avatar.classList.toggle('is-following', user.clientId === this.followedUserClientId);

      const initial = document.createElement('span');
      initial.className = 'user-avatar-initial';
      initial.textContent = user.name.charAt(0).toUpperCase();
      avatar.appendChild(initial);

      // Show which file the user is in, and whether they're on the same file
      const sameFile = user.currentFile && user.currentFile === this.currentFilePath;
      const fileLabel = user.currentFile
        ? this.getDisplayName(user.currentFile)
        : 'No file';

      if (user.isLocal) {
        const selfLabel = document.createElement('span');
        selfLabel.className = 'user-avatar-self-label';
        selfLabel.textContent = 'You';
        avatar.appendChild(selfLabel);
        avatar.title = `${user.name} (you) — ${fileLabel}`;
        avatar.setAttribute('role', 'img');
        avatar.setAttribute('aria-label', `${user.name} (you) — ${fileLabel}`);
      } else {
        avatar.type = 'button';
        avatar.classList.add('user-avatar-button');
        if (!sameFile) {
          avatar.classList.add('different-file');
        }
        const avatarLabel = user.clientId === this.followedUserClientId
          ? `Stop following ${user.name}`
          : sameFile
            ? `Follow ${user.name}`
            : `Follow ${user.name} — ${fileLabel}`;
        avatar.title = avatarLabel;
        avatar.setAttribute('aria-label', avatarLabel);
        avatar.addEventListener('click', () => this.toggleFollowUser(user.clientId));
      }

      avatars.appendChild(avatar);
    });

    if (visibleUsers.length > 5) {
      const overflow = document.createElement('div');
      overflow.className = 'user-avatar';
      overflow.style.backgroundColor = 'var(--color-surface-dynamic)';
      overflow.style.color = 'var(--color-text-muted)';
      const overflowLabel = document.createElement('span');
      overflowLabel.className = 'user-avatar-initial';
      overflowLabel.textContent = `+${visibleUsers.length - 5}`;
      overflow.appendChild(overflowLabel);
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
      this.toastController.show(`Following ${user.name} — switching to ${this.getDisplayName(user.currentFile)}`);
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

  openDisplayNameDialog({ mode = 'edit' } = {}) {
    if (!this.isTabActive) {
      return;
    }

    const dialog = this.elements.displayNameDialog;
    const input = this.elements.displayNameInput;
    const title = this.elements.displayNameTitle;
    const copy = this.elements.displayNameCopy;
    const cancel = this.elements.displayNameCancel;
    const submit = this.elements.displayNameSubmit;
    if (!dialog || !input) return;

    const isOnboarding = mode === 'onboarding';
    if (title) {
      title.textContent = isOnboarding ? 'Choose your display name' : 'Update display name';
    }
    if (copy) {
      copy.textContent = isOnboarding
        ? 'Pick a name collaborators will see. You can skip for now and continue as a guest.'
        : 'Your name will be visible to everyone editing this vault.';
    }
    if (cancel) {
      cancel.textContent = isOnboarding ? 'Skip for now' : 'Cancel';
    }
    if (submit) {
      submit.textContent = isOnboarding ? 'Continue' : 'Save name';
    }

    input.value = isOnboarding ? '' : this.getCurrentUserName();
    if (dialog.open) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  promptForDisplayNameIfNeeded() {
    if (!this.isTabActive || this._hasPromptedForDisplayName || this.getStoredUserName()) {
      return;
    }

    this._hasPromptedForDisplayName = true;
    requestAnimationFrame(() => {
      this.openDisplayNameDialog({ mode: 'onboarding' });
    });
  }

  handleDisplayNameSubmit() {
    const input = this.elements.displayNameInput;
    const dialog = this.elements.displayNameDialog;
    if (!input || !dialog) return;

    const normalizedName = this.session
      ? this.session.setUserName(input.value)
      : normalizeUserName(input.value);
    if (!normalizedName) {
      input.focus();
      this.toastController.show(`Name must be 1-${USER_NAME_MAX_LENGTH} characters`);
      return;
    }

    this.storeUserName(normalizedName);
    this.lobby.setUserName(normalizedName);
    this.excalidrawEmbed.updateLocalUser(this.lobby.getLocalUser());
    this.syncCurrentUserName();
    this.renderChat();
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

  getStoredChatNotificationsEnabled() {
    try { return localStorage.getItem(this.chatNotificationsPreferenceKey) === 'true'; } catch { return false; }
  }

  storeChatNotificationsEnabled(enabled) {
    try { localStorage.setItem(this.chatNotificationsPreferenceKey, String(enabled)); } catch { /* ignore */ }
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

  handleTabTakeover() {
    this.tabActivityLock.tryActivate({ takeover: true });
  }

  handleTabActivated({ takeover = false } = {}) {
    const wasInactive = !this.isTabActive;
    this.isTabActive = true;
    this.hideTabLockOverlay();

    if (!this.lobby.provider) {
      this.lobby.connect();
    }

    if (wasInactive) {
      if (this.fileExplorerReady) {
        void this.handleHashChange();
      }
      this.promptForDisplayNameIfNeeded();
    }

    if (takeover) {
      this.toastController.show('This tab is now active');
    }
  }

  handleTabBlocked({ reason } = {}) {
    const wasActive = this.isTabActive;
    this.isTabActive = false;
    if (this.elements.displayNameDialog?.open) {
      this.elements.displayNameDialog.close();
    }
    this.lobby.disconnect();
    this.globalUsers = [];
    this.chatMessages = [];
    this.chatMessageIds.clear();
    this.chatUnreadCount = 0;
    this.chatInitialSyncComplete = false;
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.showEmptyState();
    this.renderChat();
    this.showTabLockOverlay({ reason });

    if (wasActive && reason === 'taken-over') {
      this.toastController.show('Another tab took over this session');
    }
  }

  showTabLockOverlay({ reason } = {}) {
    const overlay = this.elements.tabLockOverlay;
    const title = this.elements.tabLockTitle;
    const copy = this.elements.tabLockCopy;
    if (!overlay) return;

    if (title) {
      title.textContent = reason === 'taken-over'
        ? 'This tab is no longer active'
        : 'This vault is active in another tab';
    }

    if (copy) {
      copy.textContent = reason === 'taken-over'
        ? 'Another tab took over the live session. This tab is now disconnected until you explicitly take over here again.'
        : 'To avoid duplicate presence and chat, only one tab can stay connected at a time. Use the other tab, or take over the session here.';
    }

    overlay.classList.remove('hidden');
  }

  hideTabLockOverlay() {
    this.elements.tabLockOverlay?.classList.add('hidden');
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
      if (
        this.currentFilePath
        && !this.isExcalidrawFile(this.currentFilePath)
        && !this.isPlantUmlFile(this.currentFilePath)
      ) {
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
