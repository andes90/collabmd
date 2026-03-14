import { PreviewRenderer } from '../application/preview-renderer.js';
import { WorkspaceRouteController } from '../application/workspace-route-controller.js';
import { WikiLinkFileController } from '../application/wiki-link-file-controller.js';
import { WorkspacePreviewController } from '../application/workspace-preview-controller.js';
import { WorkspaceCoordinator } from '../application/workspace-coordinator.js';
import { WorkspaceStateStore } from '../application/workspace-state-store.js';
import { bindAppShellElements } from '../application/app-shell-elements.js';
import { chatFeature } from '../application/app-shell/chat-feature.js';
import { commentsFeature } from '../application/app-shell/comments-feature.js';
import { gitFeature } from '../application/app-shell/git-feature.js';
import { presenceFeature } from '../application/app-shell/presence-feature.js';
import { uiFeature } from '../application/app-shell/ui-feature.js';
import { workspaceFeature } from '../application/app-shell/workspace-feature.js';
import { LOBBY_CHAT_MESSAGE_MAX_LENGTH, LobbyPresence } from '../infrastructure/lobby-presence.js';
import { BrowserNavigationPort } from '../infrastructure/browser-navigation-port.js';
import { BrowserNotificationPort } from '../infrastructure/browser-notification-port.js';
import { BrowserPreferencesPort } from '../infrastructure/browser-preferences-port.js';
import { getRuntimeConfig } from '../infrastructure/runtime-config.js';
import { TabActivityLock } from '../infrastructure/tab-activity-lock.js';
import { vaultApiClient } from '../infrastructure/vault-api-client.js';
import { BacklinksPanel } from '../presentation/backlinks-panel.js';
import { CommentUiController } from '../presentation/comment-ui-controller.js';
import { ExcalidrawEmbedController } from '../presentation/excalidraw-embed-controller.js';
import { FileExplorerController } from '../presentation/file-explorer-controller.js';
import { GitDiffViewController } from '../presentation/git-diff-view-controller.js';
import { GitPanelController } from '../presentation/git-panel-controller.js';
import { LayoutController } from '../presentation/layout-controller.js';
import { OutlineController } from '../presentation/outline-controller.js';
import { ScrollSyncController } from '../presentation/scroll-sync-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';
import { VideoEmbedController } from '../presentation/video-embed-controller.js';

const APP_SHELL_FEATURES = Object.freeze({
  chat: chatFeature,
  comments: commentsFeature,
  git: gitFeature,
  presence: presenceFeature,
  ui: uiFeature,
  workspace: workspaceFeature,
});

function installAppShellFeatures(appShell) {
  const featureMethodOwners = {};

  Object.entries(APP_SHELL_FEATURES).forEach(([featureName, feature]) => {
    Object.entries(feature).forEach(([methodName, method]) => {
      if (typeof method !== 'function') {
        return;
      }

      if (Object.hasOwn(featureMethodOwners, methodName)) {
        throw new Error(
          `CollabMdAppShell feature method "${methodName}" is declared by both "${featureMethodOwners[methodName]}" and "${featureName}".`,
        );
      }

      if (methodName in appShell) {
        throw new Error(
          `CollabMdAppShell feature method "${methodName}" conflicts with an existing app shell member.`,
        );
      }

      Object.defineProperty(appShell, methodName, {
        configurable: true,
        enumerable: false,
        value: method.bind(appShell),
        writable: false,
      });
      featureMethodOwners[methodName] = featureName;
    });
  });

  Object.defineProperty(appShell, 'featureMethodOwners', {
    configurable: false,
    enumerable: false,
    value: Object.freeze(featureMethodOwners),
    writable: false,
  });
}

export class CollabMdAppShell {
  constructor() {
    installAppShellFeatures(this);
    this.elements = bindAppShellElements(document);
    this.runtimeConfig = getRuntimeConfig();
    this.stateStore = new WorkspaceStateStore();
    this.navigation = new BrowserNavigationPort();
    this.preferences = new BrowserPreferencesPort({
      chatNotificationsKey: 'collabmd-chat-notifications-enabled',
      lineWrappingKey: 'collabmd-editor-line-wrap',
      sidebarVisibleKey: 'collabmd-sidebar-visible',
      userNameKey: 'collabmd-user-name',
    });
    this.notifications = new BrowserNotificationPort();
    this.vaultApiClient = vaultApiClient;
    this._session = null;
    this._hasPromptedForDisplayName = false;
    this._backlinkRefreshTimer = null;
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this._previewLayoutResizeObserver = null;
    this._previewLayoutSyncTimer = null;
    this.pendingGitResetPath = null;
    this.chatTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    this.chatNotificationsEnabled = this.preferences.getChatNotificationsEnabled();
    this.chatNotificationPermission = this.notifications.getPermission();
    this.lobbyChatMessageMaxLength = LOBBY_CHAT_MESSAGE_MAX_LENGTH;
    this.quickSwitcher = null;
    this.quickSwitcherModulePromise = null;
    this.fileExplorerReadyPromise = Promise.resolve();
    this.mobileBreakpointQuery = window.matchMedia('(max-width: 768px)');

    this.lobby = new LobbyPresence({
      preferredUserName: this.getStoredUserName(),
      onChange: (users) => this.updateGlobalUsers(users),
      onChatChange: (messages, meta) => this.updateChatMessages(messages, meta),
      onWorkspaceEvent: (event) => {
        void this.handleIncomingWorkspaceEvent(event);
      },
    });

    this.toastController = new ToastController(this.elements.toastContainer);
    this.chatToastController = new ToastController(this.elements.chatToastContainer);
    this.fileExplorer = new FileExplorerController({
      onFileDelete: () => this.navigation.navigateToFile(null),
      onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
      toastController: this.toastController,
    });
    this.gitPanel = new GitPanelController({
      enabled: this.runtimeConfig.gitEnabled !== false,
      onCommitStaged: () => this.openGitCommitDialog(),
      onPullBranch: () => this.pullGitBranch(),
      onPushBranch: () => this.pushGitBranch(),
      onRepoChange: (isGitRepo, status) => this.handleGitRepoChange(isGitRepo, status),
      onResetFile: (filePath, { scope }) => this.openGitResetDialog(filePath, { scope }),
      onSelectDiff: (filePath, { scope }) => this.handleGitDiffSelection(filePath, { closeSidebarOnMobile: true, scope }),
      onStageFile: (filePath, { scope }) => this.stageGitFile(filePath, { scope }),
      onUnstageFile: (filePath, { scope }) => this.unstageGitFile(filePath, { scope }),
      onViewAllDiff: () => this.handleGitDiffSelection(null, { closeSidebarOnMobile: true, scope: 'all' }),
      searchInput: this.elements.gitSearchInput,
      toastController: this.toastController,
    });
    this.outlineController = new OutlineController({
      mobileBreakpointQuery: this.mobileBreakpointQuery,
      onNavigateToHeading: ({ sourceLine }) => {
        if (!Number.isFinite(sourceLine)) return;
        this.scrollSyncController.suspendSync(250);
        this.session?.scrollToLine(sourceLine, 0);
      },
    });
    this.videoEmbed = new VideoEmbedController({
      previewElement: this.elements.previewContent,
    });
    this.previewRenderer = new PreviewRenderer({
      getContent: () => this.getPreviewSource(),
      getFileList: () => this.fileExplorer.flatFiles,
      onAfterRenderCommit: (_previewElement, stats) => {
        this.videoEmbed.reconcileEmbeds(this.elements.previewContent);
        this.videoEmbed.syncLayout();
        this.excalidrawEmbed.reconcileEmbeds(this.elements.previewContent, { isLargeDocument: stats.isLargeDocument });
        this.excalidrawEmbed.syncLayout();
        this.scrollSyncController.setLargeDocumentMode(stats.isLargeDocument);
        this.schedulePreviewLayoutSync({ delayMs: 0 });
        this.refreshCommentUiLayout();
      },
      onBeforeRenderCommit: () => {
        this.videoEmbed.detachForCommit();
        this.excalidrawEmbed.detachForCommit();
      },
      onRenderComplete: () => {
        this.videoEmbed.syncLayout();
        this.excalidrawEmbed.syncLayout();
        this.schedulePreviewLayoutSync({ delayMs: 0 });
        this.refreshCommentUiLayout();
      },
      outlineController: this.outlineController,
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
    });
    this.themeController = new ThemeController({ onChange: (theme) => this.handleThemeChange(theme) });
    this.layoutController = new LayoutController({
      mobileBreakpointQuery: this.mobileBreakpointQuery,
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
      onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
      panelElement: this.elements.backlinksPanel,
    });
    this.excalidrawEmbed = new ExcalidrawEmbedController({
      getLocalUser: () => this.lobby.getLocalUser(),
      getTheme: () => this.themeController.getTheme(),
      onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      toastController: this.toastController,
    });
    this.commentUi = new CommentUiController({
      commentSelectionButton: this.elements.commentSelectionButton,
      commentsDrawer: this.elements.commentsDrawer,
      commentsDrawerEmpty: this.elements.commentsDrawerEmpty,
      commentsDrawerList: this.elements.commentsDrawerList,
      commentsToggleButton: this.elements.commentsToggleButton,
      editorContainer: this.elements.editorContainer,
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      onCreateThread: ({ anchor, body }) => this.session?.createCommentThread({ anchor, body }),
      onNavigateToLine: (lineNumber) => {
        this.scrollSyncController.suspendSync(250);
        this.session?.scrollToLine(lineNumber, 0.2);
      },
      onReplyToThread: (threadId, body) => this.session?.replyToCommentThread(threadId, body),
      onResolveThread: (threadId) => this.session?.deleteCommentThread(threadId),
    });
    this.workspacePreviewController = new WorkspacePreviewController({
      backlinksPanel: this.backlinksPanel,
      elements: this.elements,
      excalidrawEmbed: this.excalidrawEmbed,
      getDisplayName: (filePath) => this.getDisplayName(filePath),
      getSession: () => this.session,
      isExcalidrawFile: (filePath) => this.isExcalidrawFile(filePath),
      isMermaidFile: (filePath) => this.isMermaidFile(filePath),
      isPlantUmlFile: (filePath) => this.isPlantUmlFile(filePath),
      layoutController: this.layoutController,
      outlineController: this.outlineController,
      previewRenderer: this.previewRenderer,
      schedulePreviewLayoutSync: (options) => this.schedulePreviewLayoutSync(options),
      scrollSyncController: this.scrollSyncController,
      videoEmbed: this.videoEmbed,
    });
    this.wikiLinkFileController = new WikiLinkFileController({
      getFileList: () => this.fileExplorer.flatFiles,
      navigation: this.navigation,
      refreshExplorer: () => this.fileExplorer.refresh(),
      toastController: this.toastController,
      vaultApiClient: this.vaultApiClient,
    });
    this.gitDiffView = new GitDiffViewController({
      onCommitStaged: () => this.openGitCommitDialog(),
      onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
      onStageFile: (filePath, { scope }) => this.stageGitFile(filePath, { scope }),
      onUnstageFile: (filePath, { scope }) => this.unstageGitFile(filePath, { scope }),
      toastController: this.toastController,
    });
    this.tabActivityLock = new TabActivityLock({
      onActivated: ({ takeover }) => this.handleTabActivated({ takeover }),
      onBlocked: () => this.handleTabBlocked({ reason: 'active-elsewhere' }),
      onStolen: () => this.handleTabBlocked({ reason: 'taken-over' }),
    });
    this.workspaceCoordinator = new WorkspaceCoordinator({
      attachEditorScroller: (scroller) => this.scrollSyncController.attachEditorScroller(scroller),
      beginDocumentLoad: () => this.previewRenderer.beginDocumentLoad(),
      cleanupAfterSessionDestroy: () => {
        this.scrollSyncController.setLargeDocumentMode(false);
        this.scrollSyncController.invalidatePreviewBlocks();
        this.outlineController.cleanup();
        this.followedCursorSignature = '';
        clearTimeout(this._backlinkRefreshTimer);
      },
      createEditorSession: (EditorSession, options) => new EditorSession({
        editorContainer: this.elements.editorContainer,
        getFileList: options.getFileList,
        initialTheme: options.theme,
        lineInfoElement: this.elements.lineInfo,
        lineWrappingEnabled: options.lineWrappingEnabled,
        localUser: options.localUser,
        onAwarenessChange: options.onAwarenessChange,
        onCommentsChange: options.onCommentsChange,
        onConnectionChange: options.onConnectionChange,
        onContentChange: options.onContentChange,
        onSelectionChange: options.onSelectionChange,
        preferredUserName: options.preferredUserName,
      }),
      getDisplayName: (filePath) => this.getDisplayName(filePath),
      getFileList: () => this.fileExplorer.flatFiles,
      getLineWrappingEnabled: () => this.getStoredLineWrapping(),
      getLocalUser: () => this.lobby.getLocalUser(),
      getStoredUserName: () => this.getStoredUserName(),
      getTheme: () => this.themeController.getTheme(),
      isExcalidrawFile: (filePath) => this.isExcalidrawFile(filePath),
      isMermaidFile: (filePath) => this.isMermaidFile(filePath),
      isPlantUmlFile: (filePath) => this.isPlantUmlFile(filePath),
      isTabActive: () => this.isTabActive,
      loadEditorSessionClass: () => this.loadEditorSessionClass(),
      loadBacklinks: (filePath) => this.backlinksPanel.load(filePath),
      onBeforeFileOpen: () => {
        this.session = null;
        this.commentUi.attachSession(null);
        this.layoutController.reset();
        this.resetPreviewMode();
        this.elements.emptyState?.classList.add('hidden');
        this.elements.editorPage?.classList.remove('hidden');
        this.elements.diffPage?.classList.add('hidden');
        this.clearInitialFileBootstrap();
      },
      onConnectionChange: (state) => this.handleConnectionChange(state),
      onContentChange: ({ isMermaid, isPlantUml }) => {
        this.handleCommentEditorContentChange();
        this.previewRenderer.queueRender();
        if (!isMermaid && !isPlantUml) {
          this.scheduleBacklinkRefresh();
        }
      },
      onCommentsChange: (threads) => this.handleCommentThreadsChange(threads),
      onFileAwarenessChange: (users) => this.updateFileAwareness(users),
      onFileOpenError: () => {
        this.showEditorLoadError();
        this.syncWrapToggle();
        this.toastController.show('Failed to initialize editor');
      },
      onFileOpenReady: () => {
        this.hideEditorLoading();
      },
      onSelectionChange: (anchor) => this.handleCommentSelectionChange(anchor),
      onSessionAssigned: (session) => {
        this.session = session;
        this.commentUi.attachSession(session);
      },
      onRenderExcalidrawPreview: (filePath) => this.renderExcalidrawFilePreview(filePath),
      onSyncWrapToggle: () => this.syncWrapToggle(),
      onUpdateActiveFile: (filePath) => this.fileExplorer.setActiveFile(filePath),
      onUpdateCurrentFile: (filePath) => {
        this.currentFilePath = filePath;
      },
      onUpdateLobbyCurrentFile: (filePath) => this.lobby.setCurrentFile(filePath),
      onUpdateVisibleChrome: (filePath, { displayName }) => {
        this.syncFileChrome(filePath);
        this.syncCommentChrome(filePath);
        if (this.elements.activeFileName) {
          this.elements.activeFileName.textContent = displayName;
        }
      },
      onViewModeReset: () => this.resetPreviewMode(),
      renderPresence: () => this.renderPresence(),
      scrollContainerForSession: (session) => session.getScrollContainer(),
      showEditorLoading: () => this.showEditorLoading(),
      stateStore: this.stateStore,
    });
    this.workspaceRouteController = new WorkspaceRouteController({
      backlinksPanel: this.backlinksPanel,
      clearInitialFileBootstrap: () => this.clearInitialFileBootstrap(),
      closeSidebarOnMobile: () => this.closeSidebarOnMobile(),
      elements: this.elements,
      excalidrawEmbed: this.excalidrawEmbed,
      fileExplorer: this.fileExplorer,
      getIsTabActive: () => this.isTabActive,
      getSessionLoadToken: () => this.sessionLoadToken,
      gitDiffView: this.gitDiffView,
      gitPanel: this.gitPanel,
      layoutController: this.layoutController,
      lobby: this.lobby,
      navigation: this.navigation,
      previewRenderer: this.previewRenderer,
      renderAvatars: () => this.renderAvatars(),
      renderPresence: () => this.renderPresence(),
      resetPreviewMode: () => this.resetPreviewMode(),
      scrollSyncController: this.scrollSyncController,
      setCurrentFilePath: (value) => {
        this.currentFilePath = value;
        if (!value) {
          this.commentUi.setCurrentFile(null, { supported: false });
          this.handleCommentThreadsChange([]);
          this.handleCommentSelectionChange(null);
        }
      },
      setSession: (value) => {
        this.session = value;
        this.commentUi.attachSession(value);
      },
      setSessionLoadToken: (value) => {
        this.sessionLoadToken = value;
      },
      setSidebarTab: (value) => this.setSidebarTab(value),
      showGitDiff: (route) => this.showGitDiff(route),
      syncMainChrome: (payload) => this.syncMainChrome(payload),
      videoEmbed: this.videoEmbed,
      workspaceCoordinator: this.workspaceCoordinator,
    });

    if (this.chatNotificationPermission !== 'granted') {
      this.chatNotificationsEnabled = false;
    }
  }

  get session() { return this._session; }
  set session(value) { this._session = value; }
  get currentFilePath() { return this.stateStore.get('currentFilePath'); }
  set currentFilePath(value) { this.stateStore.set('currentFilePath', value); }
  get globalUsers() { return this.stateStore.get('globalUsers'); }
  set globalUsers(value) { this.stateStore.set('globalUsers', value); }
  get connectionState() { return this.stateStore.get('connectionState'); }
  set connectionState(value) { this.stateStore.set('connectionState', value); }
  get sessionLoadToken() { return this.stateStore.get('sessionLoadToken'); }
  set sessionLoadToken(value) { this.stateStore.set('sessionLoadToken', value); }
  get connectionHelpShown() { return this.stateStore.get('connectionHelpShown'); }
  set connectionHelpShown(value) { this.stateStore.set('connectionHelpShown', value); }
  get chatMessages() { return this.stateStore.get('chatMessages'); }
  set chatMessages(value) { this.stateStore.set('chatMessages', value); }
  get chatMessageIds() { return this.stateStore.get('chatMessageIds'); }
  set chatMessageIds(value) { this.stateStore.set('chatMessageIds', value); }
  get chatUnreadCount() { return this.stateStore.get('chatUnreadCount'); }
  set chatUnreadCount(value) { this.stateStore.set('chatUnreadCount', value); }
  get chatIsOpen() { return this.stateStore.get('chatIsOpen'); }
  set chatIsOpen(value) { this.stateStore.set('chatIsOpen', value); }
  get chatInitialSyncComplete() { return this.stateStore.get('chatInitialSyncComplete'); }
  set chatInitialSyncComplete(value) { this.stateStore.set('chatInitialSyncComplete', value); }
  get isTabActive() { return this.stateStore.get('isTabActive'); }
  set isTabActive(value) { this.stateStore.set('isTabActive', value); }
  get fileExplorerReady() { return this.stateStore.get('fileExplorerReady'); }
  set fileExplorerReady(value) { this.stateStore.set('fileExplorerReady', value); }
  get gitRepoAvailable() { return this.stateStore.get('gitRepoAvailable'); }
  set gitRepoAvailable(value) { this.stateStore.set('gitRepoAvailable', value); }
  get activeSidebarTab() { return this.stateStore.get('activeSidebarTab'); }
  set activeSidebarTab(value) { this.stateStore.set('activeSidebarTab', value); }
  get followedUserClientId() { return this.stateStore.get('followedUserClientId'); }
  set followedUserClientId(value) { this.stateStore.set('followedUserClientId', value); }
  get followedCursorSignature() { return this.stateStore.get('followedCursorSignature'); }
  set followedCursorSignature(value) { this.stateStore.set('followedCursorSignature', value); }

  loadEditorSessionClass() {
    if (!this._editorSessionModulePromise) {
      this._editorSessionModulePromise = import('../infrastructure/editor-session.js')
        .then((module) => module.EditorSession);
    }

    return this._editorSessionModulePromise;
  }

  scheduleEditorSessionPrewarm({ timeout = 1500 } = {}) {
    if (this._editorSessionModulePromise || this._editorSessionPrewarmHandle) {
      return;
    }

    const runPrewarm = () => {
      this._editorSessionPrewarmHandle = null;
      void this.loadEditorSessionClass();
    };

    if (typeof window.requestIdleCallback === 'function') {
      this._editorSessionPrewarmHandle = window.requestIdleCallback(runPrewarm, { timeout });
      return;
    }

    this._editorSessionPrewarmHandle = window.setTimeout(runPrewarm, 0);
  }

  async ensureQuickSwitcher() {
    if (this.quickSwitcher) {
      return this.quickSwitcher;
    }

    if (!this.quickSwitcherModulePromise) {
      this.quickSwitcherModulePromise = import('../presentation/quick-switcher-controller.js')
        .then((module) => module.QuickSwitcherController);
    }

    const QuickSwitcherController = await this.quickSwitcherModulePromise;
    if (!this.quickSwitcher) {
      this.quickSwitcher = new QuickSwitcherController({
        getFileList: () => this.fileExplorer.flatFiles,
        onFileSelect: (filePath) => this.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
      });
    }

    return this.quickSwitcher;
  }

  async toggleQuickSwitcher() {
    const quickSwitcher = await this.ensureQuickSwitcher();
    quickSwitcher.toggle();
  }
}
