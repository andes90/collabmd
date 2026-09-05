import { PdfPreviewController } from '../application/pdf-preview-controller.js';
import { analyzeMarkdownComplexity, isLargeDocumentStats } from '../application/preview-render-profile.js';
import { PreviewRenderer } from '../application/preview-renderer.js';
import { renderWebMcpDiagram } from '../application/webmcp-diagram-renderer.js';
import { ensureQuickSwitcherInstance, toggleQuickSwitcherInstance } from '../application/quick-switcher-loader.js';
import { WorkspaceRouteController } from '../application/workspace-route-controller.js';
import { WikiLinkFileController } from '../application/wiki-link-file-controller.js';
import { WorkspacePreviewController } from '../application/workspace-preview-controller.js';
import { StructurizrPreviewController } from '../application/structurizr-preview-controller.js';
import { WorkspaceCoordinator } from '../application/workspace-coordinator.js';
import { bindAppShellElements } from '../application/app-shell-elements.js';
import { chatFeature } from '../application/app-shell/chat-feature.js';
import { commentsFeature } from '../application/app-shell/comments-feature.js';
import { exportFeature } from '../application/app-shell/export-feature.js';
import { gitFeature } from '../application/app-shell/git-feature.js';
import { presenceFeature } from '../application/app-shell/presence-feature.js';
import { uiFeatureIdentityMethods } from '../application/app-shell/ui-feature-identity.js';
import { uiFeatureShellMethods } from '../application/app-shell/ui-feature-shell.js';
import { uiFeatureSidebarMethods } from '../application/app-shell/ui-feature-sidebar.js';
import { uiFeatureTabActivityMethods } from '../application/app-shell/ui-feature-tab-activity.js';
import { uiFeatureToolbarMethods } from '../application/app-shell/ui-feature-toolbar.js';
import { workspaceFeature } from '../application/app-shell/workspace-feature.js';
import { LOBBY_CHAT_MESSAGE_MAX_LENGTH } from '../domain/lobby-chat.js';
import { agentConnectionApiClient } from '../infrastructure/agent-connection-api-client.js';
import { BrowserPreferencesPort } from '../infrastructure/browser-preferences-port.js';
import { hostedApiClient } from '../infrastructure/hosted-api-client.js';
import { BrowserNotificationPort } from '../infrastructure/browser-notification-port.js';
import { AppVersionMonitor } from '../infrastructure/app-version-monitor.js';
import { gitApiClient } from '../infrastructure/git-api-client.js';
import {
  getActiveVaultId,
  getHashRoute,
  getRuntimeConfig,
  setActiveVaultId,
  navigateToFile,
  navigateToGitCommit,
  navigateToGitDiff,
  navigateToGitFileHistory,
  navigateToGitFilePreview,
  navigateToGitHistory,
} from '../infrastructure/runtime-config.js';
import { TabActivityLock } from '../infrastructure/tab-activity-lock.js';
import { vaultApiClient } from '../infrastructure/vault-api-client.js';
import { WebMcpToolRegistry } from '../infrastructure/webmcp-tool-registry.js';
import { createLazyLobbyPresence, createLazyWorkspaceSyncClient } from './lazy-collab-clients.js';
import { AgentConnectionController } from '../presentation/agent-connection-controller.js';
import { BacklinksPanel } from '../presentation/backlinks-panel.js';
import { HostedWorkspaceGateController } from '../presentation/hosted-workspace-gate-controller.js';
import { TeamSettingsController } from '../presentation/team-settings-controller.js';
import { CommentOverviewController } from '../presentation/comment-overview-controller.js';
import { CommentUiController } from '../presentation/comment-ui-controller.js';
import { FileExplorerController } from '../presentation/file-explorer-controller.js';
import { FileHistoryViewController } from '../presentation/file-history-view-controller.js';
import { BasesPreviewController } from '../presentation/bases-preview-controller.js';
import { DrawioEmbedController } from '../presentation/drawio-embed-controller.js';
import { ExcalidrawEmbedController } from '../presentation/excalidraw-embed-controller.js';
import { GitDiffViewController } from '../presentation/git-diff-view-controller.js';
import { GitPanelController } from '../presentation/git-panel-controller.js';
import { LayoutController } from '../presentation/layout-controller.js';
import { OutlineController } from '../presentation/outline-controller.js';
import { ScrollSyncController } from '../presentation/scroll-sync-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';
import { VideoEmbedController } from '../presentation/video-embed-controller.js';
import { ImageLightboxController } from '../presentation/image-lightbox-controller.js';

const APP_SHELL_FEATURES = [
  chatFeature,
  commentsFeature,
  exportFeature,
  gitFeature,
  presenceFeature,
  {
    ...uiFeatureShellMethods,
    ...uiFeatureSidebarMethods,
    ...uiFeatureIdentityMethods,
    ...uiFeatureToolbarMethods,
    ...uiFeatureTabActivityMethods,
  },
  workspaceFeature,
];

export class CollabMdAppShell {
  constructor() {
    for (const feature of APP_SHELL_FEATURES) {
      for (const [name, method] of Object.entries(feature)) {
        if (!(name in this)) this[name] = method;
      }
    }
    this.elements = bindAppShellElements(document);
    this.runtimeConfig = getRuntimeConfig();
    this.activeSidebarTab = 'files';
    this.chatInitialSyncComplete = false;
    this.chatIsOpen = false;
    this.chatMessageIds = new Set();
    this.chatMessages = [];
    this.chatUnreadCount = 0;
    this.connectionHelpShown = false;
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.currentDrawioMode = null;
    this.currentFilePath = null;
    this.fileExplorerReady = false;
    this.followedCursorSignature = '';
    this.followedUserClientId = null;
    this.gitRepoAvailable = false;
    this.globalUsers = [];
    this.isTabActive = false;
    this.presencePanelOpen = false;
    this.sessionLoadToken = 0;
    this.navigation = {
      getHashRoute,
      navigateToFile: (filePath, options = {}) => {
        const { preserveFollow = false, ...routeOptions } = options;
        if (!preserveFollow && filePath !== this.currentFilePath) {
          this.stopFollowingUser();
        }
        navigateToFile(filePath, routeOptions);
      },
      navigateToGitCommit,
      navigateToGitDiff,
      navigateToGitFileHistory,
      navigateToGitFilePreview,
      navigateToGitHistory,
    };
    this.preferences = new BrowserPreferencesPort({
      fileTreeShowExtensionsKey: 'collabmd-file-tree-show-extensions',
      lineWrappingKey: 'collabmd-editor-line-wrap',
      recentFilesKey: 'collabmd-recent-files',
      vimModeKey: 'collabmd-editor-vim-mode',
      sidebarVisibleKey: 'collabmd-sidebar-visible',
      userNameKey: 'collabmd-user-name',
    });
    this.notifications = new BrowserNotificationPort();
    this.gitApiClient = gitApiClient;
    this.vaultApiClient = vaultApiClient;
    this._session = null;
    this._hasPromptedForDisplayName = false;
    this._basePreviewRenderTimer = null;
    this._backlinkRefreshTimer = null;
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this._previewLayoutResizeObserver = null;
    this._previewLayoutSyncTimer = null;
    this._reloadPromptShown = false;
    this._staticPreviewDocument = null;
    this.pendingGitResetPath = null;
    this.chatTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    this.lobbyChatMessageMaxLength = LOBBY_CHAT_MESSAGE_MAX_LENGTH;
    this.quickSwitcher = null;
    this.quickSwitcherModulePromise = null;
    this.fileExplorerReadyPromise = Promise.resolve();
    this.mobileBreakpointQuery = window.matchMedia('(max-width: 768px)');
    this.pendingWorkspaceRequestIds = new Set();
    this._fileOpenPerf = null;
    this.versionMonitor = new AppVersionMonitor({
      currentBuildId: this.runtimeConfig.build?.id,
      onUpdateAvailable: (payload) => this.promptForVersionReload(payload),
      runtimeConfig: this.runtimeConfig,
    });

    this.lobby = createLazyLobbyPresence({
      preferredUserName: this.getStoredUserName(),
      onChange: (users) => this.updateGlobalUsers(users),
      onChatChange: (messages, meta) => this.updateChatMessages(messages, meta),
    });
    this.workspaceSync = createLazyWorkspaceSyncClient({
      onTreeChange: (tree, metadata = {}) => {
        this.fileExplorer.setTree(tree, metadata);
        this.handleCommentOverviewWorkspaceTreeChange?.();
        this.fileExplorerReady = true;
      },
      onWorkspaceEvent: (event) => {
        void this.handleIncomingWorkspaceEvent(event);
      },
    });

    this.toastController = new ToastController(this.elements.toastContainer);
    this.chatToastController = new ToastController(this.elements.chatToastContainer);
    this.agentConnectionController = new AgentConnectionController({
      apiClient: agentConnectionApiClient,
      closeToolbarMenu: () => this.closeToolbarOverflowMenu(),
      content: this.elements.agentConnectionContent,
      dialog: this.elements.agentConnectionDialog,
      runtimeConfig: this.runtimeConfig,
      toastController: this.toastController,
      trigger: this.elements.connectAgentButton,
    });
    this.teamSettingsController = new TeamSettingsController({
      apiClient: hostedApiClient,
      closeToolbarMenu: () => this.closeToolbarOverflowMenu(),
      content: this.elements.teamSettingsContent,
      dialog: this.elements.teamSettingsDialog,
      toastController: this.toastController,
      trigger: this.elements.teamSettingsButton,
    });
    this.hostedGateController = new HostedWorkspaceGateController({
      apiClient: hostedApiClient,
      appRoot: this.elements.appShell,
      gate: this.elements.hostedGate,
      runtimeConfig: this.runtimeConfig,
      teamSettingsController: this.teamSettingsController,
    });
    const callAgentTool = (...args) => this.vaultApiClient.callAgentTool(...args);
    this.webMcpTools = new WebMcpToolRegistry({
      acknowledgeToolCall: ({ input, name, preparation, result, signal }) => {
        if (
          name !== 'edit_excalidraw'
          || input.path !== this.currentFilePath
        ) {
          return null;
        }
        return this.excalidrawEmbed?.waitForAgentPaint(input.path, result.revision, {
          afterRevision: preparation?.revision,
          signal,
        });
      },
      callTool: (name, input, options) => name === 'render_diagram'
        ? renderWebMcpDiagram(input, {
            callTool: callAgentTool,
            getMermaid: () => this.previewRenderer.mermaidHydrator.ensureMermaid(),
            signal: options?.signal,
          })
        : callAgentTool(name, input, options),
      getActiveContext: () => ({
        activeDiagramPath: this.isExcalidrawFile(this.currentFilePath)
          ? this.currentFilePath
          : null,
        activePath: this.currentFilePath,
      }),
      getIsTabActive: () => this.isTabActive,
      onDidMutate: () => {
        this.toastController.show('Agent-assisted Vault change applied. Review it before committing.');
      },
      prepareToolCall: async ({ input, name, signal }) => {
        if (
          ![
            'edit_excalidraw',
            'inspect_excalidraw',
            'read_document',
            'verify_excalidraw',
          ].includes(name)
          || input.path !== this.currentFilePath
        ) {
          return null;
        }
        const preparation = await this.excalidrawEmbed?.flushPendingAgentWrites(input.path, { signal });
        if (['timeout', 'unavailable'].includes(preparation?.status)) {
          throw new Error('The active Excalidraw editor did not confirm its latest collaboration update');
        }
        return preparation;
      },
    });
    this.fileExplorer = new FileExplorerController({
      mobileBreakpointQuery: this.mobileBreakpointQuery,
      onDirectoryExport: (directoryPath, format) => this.handleDirectoryExportRequest(directoryPath, format),
      onFileDelete: () => this.navigation.navigateToFile(null),
      onFileSelect: (filePath) => this.workspaceRouteController.handleFileSelection(filePath, {
        closeSidebarOnMobile: true,
      }),
      onShowFileExtensionsChange: (showFileExtensions) => {
        this.preferences.setFileTreeShowExtensions(showFileExtensions);
      },
      pendingWorkspaceRequestIds: this.pendingWorkspaceRequestIds,
      showFileExtensions: this.preferences.getFileTreeShowExtensions(),
      toastController: this.toastController,
      vaultClient: this.vaultApiClient,
      // ponytail: reload keeps the file hash, so the same path reopens in the new vault
      vaultSwitcher: {
        activeVaultId: getActiveVaultId(this.runtimeConfig),
        vaults: this.runtimeConfig.vaults ?? [],
        onVaultSelect: (vaultId) => {
          if (!vaultId || vaultId === getActiveVaultId(this.runtimeConfig)) {
            return;
          }
          setActiveVaultId(vaultId);
          window.location.reload();
        },
      },
    });
    this.commentsOverview = new CommentOverviewController({
      onOverviewChange: (_overview, { threadCounts }) => {
        this.fileExplorer.setThreadCounts(threadCounts);
      },
      onThreadSelect: (payload) => this.openCommentOverviewThread(payload),
      panelElement: this.elements.commentOverviewPanel,
      toastController: this.toastController,
      vaultApiClient: this.vaultApiClient,
    });
    this.gitPanel = new GitPanelController({
      enabled: this.runtimeConfig.gitEnabled !== false,
      gitApiClient: this.gitApiClient,
      onCommitStaged: () => this.openGitCommitDialog(),
      onOpenPullBackup: (filePath) => filePath && this.navigation.navigateToFile(filePath),
      onPullBranch: () => this.pullGitBranch(),
      onPushBranch: () => this.pushGitBranch(),
      onRepoChange: (isGitRepo, status) => this.handleGitRepoChange(isGitRepo, status),
      onResetFile: (filePath, { scope }) => this.openGitResetDialog(filePath, { scope }),
      onSelectCommit: (hash, { path }) => this.handleGitCommitSelection(hash, { closeSidebarOnMobile: true, path }),
      onSelectDiff: (filePath, { scope }) => this.handleGitDiffSelection(filePath, { closeSidebarOnMobile: true, scope }),
      onStageAll: () => this.stageAllGitFiles(),
      onStageFile: (filePath, { scope }) => this.stageGitFile(filePath, { scope }),
      onUnstageAll: () => this.unstageAllGitFiles(),
      onUnstageFile: (filePath, { scope }) => this.unstageGitFile(filePath, { scope }),
      onViewAllDiff: () => this.handleGitDiffSelection(null, { closeSidebarOnMobile: true, scope: 'all' }),
      searchInput: this.elements.gitSearchInput,
      toastController: this.toastController,
    });
    this.outlineController = new OutlineController({
      mobileBreakpointQuery: this.mobileBreakpointQuery,
      onNavigateToHeading: ({ headingId, sourceLine }) => {
        const heading = document.getElementById(headingId);
        if (this.elements.previewContent?.contains(heading)) {
          this.unfoldPreviewHeading(heading);
        }
        if (!Number.isFinite(sourceLine)) return;
        this.scrollSyncController.suspendSync(250);
        this.session?.scrollToLine(sourceLine, 0);
      },
      onWillOpen: () => this.commentUi?.closeDrawer(),
    });
    this.videoEmbed = new VideoEmbedController({
      previewElement: this.elements.previewContent,
    });
    this.basesPreview = new BasesPreviewController({
      getActiveFilePath: () => this.currentFilePath,
      getSession: () => this.session,
      onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
      previewElement: this.elements.previewContent,
      replaceBaseSource: ({ path, source }) => {
        if (path && path === this.currentFilePath) {
          this.session?.replaceText?.(source);
        }
      },
      toastController: this.toastController,
      vaultApiClient: this.vaultApiClient,
    });
    this.imageLightbox = new ImageLightboxController({
      previewElement: this.elements.previewContent,
    });
    this.previewRenderer = new PreviewRenderer({
      getContent: () => this.getPreviewSource(),
      getFileList: () => this.fileExplorer.flatDocumentFiles,
      getPreviewVisible: () => (
        Boolean(this._staticPreviewDocument)
        || this.layoutController?.currentView !== 'editor'
      ),
      getTheme: () => this.themeController?.getTheme?.() ?? 'dark',
      getWikiLinkAutoCreate: () => this.runtimeConfig.wikiLinkAutoCreate !== false,
      loadFileSource: async (filePath) => {
        const payload = await this.vaultApiClient.readFile(filePath);
        return String(payload?.content ?? '');
      },
      getSourceFilePath: () => this.currentFilePath,
      onAfterRenderCommit: (_previewElement, stats) => {
        this.recordFileOpenMetric('preview_committed', {
          chars: stats?.chars ?? 0,
          renderVersion: stats?.renderVersion ?? 0,
        });
        this.videoEmbed.reconcileEmbeds(this.elements.previewContent);
        this.basesPreview.reconcileEmbeds(this.elements.previewContent);
        this.drawioEmbed.reconcileEmbeds(this.elements.previewContent);
        this.excalidrawEmbed.reconcileEmbeds(this.elements.previewContent, { isLargeDocument: stats.isLargeDocument });
        this.scrollSyncController.setLargeDocumentMode(stats.isLargeDocument);
        this.syncPreviewHeadingFoldButtons();
        this.syncPreviewHeadingLinkButtons();
        this.applyPendingPreviewRouteAnchor({ behavior: 'auto', clearMissing: true });

        this.schedulePreviewLayoutSync({ delayMs: 0 });
        this.refreshCommentUiLayout();
      },
      onBeforeRenderCommit: () => {
        this.videoEmbed.detachForCommit();
        this.drawioEmbed.detachForCommit();
        this.excalidrawEmbed.detachForCommit();
      },
      onPreviewLayoutChange: () => {
        this.scrollSyncController.invalidatePreviewBlocks();
        this.applyPendingPreviewRouteAnchor({ behavior: 'auto', clearMissing: false });
        this.schedulePreviewLayoutSync({ delayMs: 0 });
        this.refreshCommentUiLayout();
      },
      outlineController: this.outlineController,
      plantUmlRenderClient: this.vaultApiClient,
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      toastController: this.toastController,
    });
    this.themeController = new ThemeController({ onChange: (theme) => this.handleThemeChange(theme) });
    this.layoutController = new LayoutController({
      preferredView: this.preferences.getViewMode() || 'split',
      mobileBreakpointQuery: this.mobileBreakpointQuery,
      onMeasureEditor: () => this.session?.requestMeasure(),
      onPreferredViewChange: (view) => this.preferences.setViewMode(view),
      onViewChange: () => {
        if (!this.currentFilePath && !this._staticPreviewDocument) {
          return;
        }
        this.previewRenderer.queueRender();
      },
      onViewRequest: (view) => this.handleLayoutViewRequest(view),
    });
    this.scrollSyncController = new ScrollSyncController({
      getEditorLineNumber: () => this.session?.getTopVisibleLineNumber(0.35) ?? 1,
      onEditorScrollActivityChange: (isActive) => this.handleEditorScrollActivityChange(isActive),
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      scrollEditorToLine: (lineNumber, viewportRatio) => this.session?.scrollToLine(lineNumber, viewportRatio),
    });
    this.pdfPreview = new PdfPreviewController({
      getTheme: () => this.themeController.getTheme(),
    });
    this.backlinksPanel = new BacklinksPanel({
      headerPanelElement: this.elements.backlinksHeaderPanel,
      inlinePanelElement: this.elements.backlinksInlinePanel,
      loadBacklinks: (filePath, options = {}) => this.vaultApiClient.readBacklinks(filePath, options),
      onBeforeToggle: () => this.scrollSyncController.suspendSync(250),
      onFileSelect: (filePath) => this.workspaceRouteController.handleFileSelection(filePath, {
        closeSidebarOnMobile: true,
      }),
      panelElement: this.elements.backlinksPanel,
    });
    this.excalidrawEmbed = new ExcalidrawEmbedController({
      getLocalUser: () => this.lobby.getLocalUser(),
      getTheme: () => this.themeController.getTheme(),
      onOpenElement: ({ elementId, elementType, filePath } = {}) => {
        if (filePath && elementId) {
          this.navigation.navigateToFile(filePath, { elementId, elementType });
        }
      },
      onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
      onStopFollowing: () => this.stopFollowingUser(),
      onToggleQuickSwitcher: () => {
        void this.toggleQuickSwitcher();
      },
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      toastController: this.toastController,
    });
    this.drawioEmbed = new DrawioEmbedController({
      getLocalUser: () => this.lobby.getLocalUser(),
      getTheme: () => this.themeController.getTheme(),
      onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
      onOpenTextFile: (filePath) => filePath && this.navigation.navigateToFile(filePath, { drawioMode: 'text' }),
      onToggleQuickSwitcher: () => {
        void this.toggleQuickSwitcher();
      },
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      toastController: this.toastController,
      vaultApiClient: this.vaultApiClient,
    });
    this.commentUi = new CommentUiController({
      commentSelectionButton: this.elements.commentSelectionButton,
      commentsDrawer: this.elements.commentsDrawer,
      commentsDrawerEmpty: this.elements.commentsDrawerEmpty,
      commentsDrawerList: this.elements.commentsDrawerList,
      commentsToggleButton: this.elements.commentsToggleButton,
      editorContainer: this.elements.editorContainer,
      onWillOpenDrawer: () => {
        this._deferredCollabStylesPromise ??= import('../styles/deferred-collab.css');
        this.outlineController.close();
      },
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      onCreateThread: ({ anchor, body }) => this.createCommentThread({ anchor, body }),
      onNavigateToLine: (lineNumber) => {
        const session = this.session;
        this.scrollSyncController.suspendSync(250);
        const didScroll = session?.scrollToLine(lineNumber, 0.2);
        if (didScroll) {
          requestAnimationFrame(() => {
            if (this.session !== session) {
              return;
            }

            this.scrollSyncController.suspendSync(0);
            this.scrollSyncController.syncPreviewToEditor();
          });
        }
      },
      onReplyToThread: (threadId, body) => this.replyToCommentThread(threadId, body),
      onToggleReaction: (threadId, messageId, emoji) => this.session?.toggleCommentReaction(threadId, messageId, emoji),
      onResolveThread: (threadId) => this.resolveCommentThread(threadId),
    });
    this.structurizrPreview = new StructurizrPreviewController({
      enabled: this.runtimeConfig.structurizrEnabled === true,
      syncWorkspace: (payload) => this.vaultApiClient.syncStructurizrWorkspace(payload),
    });
    this.workspacePreviewController = new WorkspacePreviewController({
      backlinksPanel: this.backlinksPanel,
      basesPreview: this.basesPreview,
      drawioEmbed: this.drawioEmbed,
      elements: this.elements,
      excalidrawEmbed: this.excalidrawEmbed,
      getDisplayName: (filePath) => this.getDisplayName(filePath),
      getSession: () => this.session,
      isBaseFile: (filePath) => this.isBaseFile(filePath),
      isDrawioFile: (filePath) => this.isDrawioFile(filePath),
      isExcalidrawFile: (filePath) => this.isExcalidrawFile(filePath),
      isImageFile: (filePath) => this.isImageFile(filePath),
      isPdfFile: (filePath) => this.isPdfFile(filePath),
      isMermaidFile: (filePath) => this.isMermaidFile(filePath),
      isPlantUmlFile: (filePath) => this.isPlantUmlFile(filePath),
      layoutController: this.layoutController,
      structurizrPreview: this.structurizrPreview,
      outlineController: this.outlineController,
      pdfPreview: this.pdfPreview,
      previewRenderer: this.previewRenderer,
      schedulePreviewLayoutSync: (options) => this.schedulePreviewLayoutSync(options),
      scrollSyncController: this.scrollSyncController,
      videoEmbed: this.videoEmbed,
    });
    this.wikiLinkFileController = new WikiLinkFileController({
      getFileList: () => this.fileExplorer.flatDocumentFiles,
      navigation: this.navigation,
      refreshExplorer: () => this.fileExplorer.refresh(),
      toastController: this.toastController,
      vaultApiClient: this.vaultApiClient,
      wikiLinkAutoCreate: this.runtimeConfig.wikiLinkAutoCreate !== false,
    });
    this.gitDiffView = new GitDiffViewController({
      getTheme: () => this.themeController.getTheme(),
      gitApiClient: this.gitApiClient,
      onBackToHistory: ({ historyFilePath } = {}) => {
        if (historyFilePath) {
          this.navigation.navigateToGitFileHistory({ filePath: historyFilePath });
          return;
        }
        this.navigation.navigateToGitHistory();
      },
      onCommitStaged: () => this.openGitCommitDialog(),
      onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
      onStageFile: (filePath, { scope }) => this.stageGitFile(filePath, { scope }),
      onUnstageFile: (filePath, { scope }) => this.unstageGitFile(filePath, { scope }),
      toastController: this.toastController,
      vaultApiClient: this.vaultApiClient,
    });
    this.fileHistoryView = new FileHistoryViewController({
      diffRenderer: this.gitDiffView,
      gitApiClient: this.gitApiClient,
      onOpenCommitDiff: (hash, { historyFilePath, path }) => this.handleGitCommitSelection(hash, {
        closeSidebarOnMobile: false,
        historyFilePath,
        path,
      }),
      onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
      onOpenPreview: ({ hash, path, currentFilePath }) => this.handleGitFilePreviewSelection({
        hash,
        path,
        currentFilePath,
      }),
      onOpenWorkspaceDiff: (filePath) => this.handleGitDiffSelection(filePath, {
        closeSidebarOnMobile: false,
        scope: 'all',
      }),
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
        vimModeEnabled: options.vimModeEnabled,
        onImagePaste: options.onImagePaste,
        onAwarenessChange: options.onAwarenessChange,
        onCommentsChange: options.onCommentsChange,
        onConnectionChange: options.onConnectionChange,
        onContentChange: options.onContentChange,
        onSelectionChange: options.onSelectionChange,
        preferredUserName: options.preferredUserName,
      }),
      getDisplayName: (filePath) => this.getDisplayName(filePath),
      getFileList: () => this.fileExplorer.flatDocumentFiles,
      getVaultFileList: () => this.fileExplorer.flatFiles,
      getLineWrappingEnabled: () => this.getStoredLineWrapping(),
      getVimModeEnabled: () => this.getStoredVimMode(),
      getLocalUser: () => this.lobby.getLocalUser(),
      getStoredUserName: () => this.getStoredUserName(),
      getTheme: () => this.themeController.getTheme(),
      isBaseFile: (filePath) => this.isBaseFile(filePath),
      isDrawioFile: (filePath) => this.isDrawioFile(filePath),
      isExcalidrawFile: (filePath) => this.isExcalidrawFile(filePath),
      isImageFile: (filePath) => this.isImageFile(filePath),
      isPdfFile: (filePath) => this.isPdfFile(filePath),
      isMermaidFile: (filePath) => this.isMermaidFile(filePath),
      isPlantUmlFile: (filePath) => this.isPlantUmlFile(filePath),
      isStructurizrWorkspaceFile: (filePath) => this.isStructurizrWorkspaceFile(filePath),
      isTabActive: () => this.isTabActive,
      loadBootstrapContent: async (filePath) => {
        const response = await this.vaultApiClient.readFile(filePath);
        return typeof response?.content === 'string' ? response.content : null;
      },
      loadEditorSessionClass: () => this.loadEditorSessionClass(),
      loadBacklinks: (filePath) => this.backlinksPanel.load(filePath),
      onBeforeFileOpen: () => {
        clearTimeout(this._basePreviewRenderTimer);
        this._basePreviewRenderTimer = null;
        this.connectWorkspaceSync?.();
        this.session = null;
        this.commentUi.attachSession(null);
        this.layoutController.reset();
        this.workspacePreviewController.resetPreviewMode();
        this.elements.emptyState?.classList.add('hidden');
        this.elements.editorPage?.classList.remove('hidden');
        this.elements.diffPage?.classList.add('hidden');
        this.clearInitialFileBootstrap();
      },
      onConnectionChange: (state) => this.handleConnectionChange(state),
      onContentChange: ({ isBase, isHtml, isStructurizrWorkspace }) => {
        void this.webMcpTools.refresh();
        this.handleCommentEditorContentChange();
        if (isHtml) {
          this.workspacePreviewController.renderHtmlFilePreview({
            content: this.session?.getText?.() ?? '',
          });
          return;
        }

        if (isBase) {
          this.scheduleBaseFilePreview(this.currentFilePath, {
            source: this.session?.getText?.() ?? '',
          });
          return;
        }

        if (isStructurizrWorkspace) {
          this.structurizrPreview.queueSync({
            filePath: this.currentFilePath,
            source: this.session?.getText?.() ?? '',
          });
          return;
        }

        const markdownText = this.session?.getText?.() ?? '';
        if (
          !this.preferences.getViewMode()
          && this.layoutController.currentView === 'split'
          && isLargeDocumentStats(analyzeMarkdownComplexity(markdownText))
        ) {
          this.layoutController.setView('editor', { persist: false });
        }

        this.previewRenderer.queueRender();
      },
      onCommentsChange: (threads) => this.handleCommentThreadsChange(threads),
      onFileAwarenessChange: (users) => this.updateFileAwareness(users),
      onFileOpenError: ({ code } = {}) => {
        const notFound = code === 'not-found';
        this.showEditorLoadError(notFound ? 'File not found' : 'Failed to load file');
        this.syncWrapToggle();
        this.toastController.show(notFound ? 'File not found' : 'Failed to initialize editor');
      },
      onFileOpenReady: () => {
        this.hideEditorLoading();
        if (this.currentFilePath) {
          this.preferences.recordRecentFile(this.currentFilePath);
        }
      },
      onSelectionChange: (anchor) => this.handleCommentSelectionChange(anchor),
      onImagePaste: (file) => this.handleEditorImageInsert(file),
      onFileOpenMetric: (name, payload) => this.recordFileOpenMetric(name, payload),
      onSessionAssigned: (session) => {
        this.session = session;
        this.commentUi.attachSession(session);
      },
      onRenderDrawioPreview: (filePath) => this.workspacePreviewController.renderDrawioFilePreview(filePath),
      onRenderBasePreview: (filePath) => this.renderBaseFilePreview(filePath),
      onRenderExcalidrawPreview: (filePath) => this.workspacePreviewController.renderExcalidrawFilePreview(filePath),
      onRenderHtmlPreview: (options) => this.workspacePreviewController.renderHtmlFilePreview(options),
      onRenderImagePreview: (filePath) => this.workspacePreviewController.renderImageFilePreview(filePath),
      onRenderPdfPreview: (filePath) => this.workspacePreviewController.renderPdfFilePreview(filePath),
      onRenderStructurizrPreview: (filePath, options) => this.workspacePreviewController.renderStructurizrFilePreview(filePath, options),
      onSyncWrapToggle: () => this.syncWrapToggle(),
      onUpdateActiveFile: (filePath) => this.fileExplorer.setActiveFile(filePath),
      onUpdateCurrentFile: (filePath) => {
        this.currentFilePath = filePath;
      },
      onUpdateLobbyCurrentFile: (filePath) => this.lobby.setCurrentFile(filePath),
      onUpdateVisibleChrome: (filePath, { displayName }) => {
        this.workspacePreviewController.syncFileChrome(filePath, {
          drawioMode: this.currentDrawioMode,
          preferPreviewForBase: this.isBaseFile(filePath),
        });
        this.syncCommentChrome(filePath);
        this.syncFileHistoryButton({ filePath, mode: 'editor' });
        this.syncReviewFileChangesButton({ filePath, mode: 'editor' });
        if (this.elements.activeFileName) {
          this.elements.activeFileName.textContent = displayName;
        }
      },
      onViewModeReset: () => this.workspacePreviewController.resetPreviewMode(),
      renderPresence: () => this.renderPresence(),
      scrollContainerForSession: (session) => session.getScrollContainer(),
      shouldUseDrawioPreview: () => Boolean(this.runtimeConfig.drawioBaseUrl),
      showEditorLoading: () => this.showEditorLoading(),
      stateStore: this,
    });
    this.workspaceRouteController = new WorkspaceRouteController({
      backlinksPanel: this.backlinksPanel,
      clearInitialFileBootstrap: () => this.clearInitialFileBootstrap(),
      clearStaticPreviewDocument: () => this.clearStaticPreviewDocument(),
      closeSidebarOnMobile: () => this.closeSidebarOnMobile(),
      drawioEmbed: this.drawioEmbed,
      elements: this.elements,
      excalidrawEmbed: this.excalidrawEmbed,
      fileHistoryView: this.fileHistoryView,
      fileExplorer: this.fileExplorer,
      getIsTabActive: () => this.isTabActive,
      getSessionLoadToken: () => this.sessionLoadToken,
      gitDiffView: this.gitDiffView,
      gitPanel: this.gitPanel,
      imageLightbox: this.imageLightbox,
      layoutController: this.layoutController,
      lobby: this.lobby,
      navigation: this.navigation,
      previewRenderer: this.previewRenderer,
      requestPreviewRouteAnchor: (anchorId, filePath) => this.requestPreviewRouteAnchor(anchorId, filePath),
      renderAvatars: () => this.renderAvatars(),
      renderPresence: () => this.renderPresence(),
      resetPreviewMode: () => this.workspacePreviewController.resetPreviewMode(),
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
      setSidebarVisibility: (showSidebar) => this.setSidebarVisibility(showSidebar),
      showGitCommit: (route) => this.showGitCommit(route),
      showGitDiff: (route) => this.showGitDiff(route),
      showGitFileHistory: (route) => this.showGitFileHistory(route),
      showGitFilePreview: (route) => this.showGitFilePreview(route),
      showGitHistory: () => this.showGitHistory(),
      syncMainChrome: (payload) => this.syncMainChrome(payload),
      videoEmbed: this.videoEmbed,
      workspaceCoordinator: this.workspaceCoordinator,
    });

  }

  get session() { return this._session; }
  set session(value) {
    this._session = value;
    void this.webMcpTools?.refresh();
  }

  publishFileOpenPerf() {
    if (typeof window === 'undefined') {
      return;
    }

    window.__COLLABMD_PERF__ ??= {};
    window.__COLLABMD_PERF__.fileOpen = this._fileOpenPerf
      ? {
        ...this._fileOpenPerf,
        details: { ...this._fileOpenPerf.details },
        marks: { ...this._fileOpenPerf.marks },
      }
      : null;
  }

  recordFileOpenMetric(name, payload = {}) {
    if (name === 'open_started') {
      this._fileOpenPerf = {
        details: {
          filePath: payload.filePath || this.currentFilePath || '',
          loadToken: payload.loadToken ?? 0,
        },
        marks: {
          open_started: performance.now(),
        },
      };
      this.publishFileOpenPerf();
      return;
    }

    if (!this._fileOpenPerf) {
      return;
    }

    const metricLoadToken = payload.loadToken ?? this._fileOpenPerf.details.loadToken;
    if (metricLoadToken !== this._fileOpenPerf.details.loadToken) {
      return;
    }

    this._fileOpenPerf.marks[name] = performance.now();
    if (payload.filePath) {
      this._fileOpenPerf.details.filePath = payload.filePath;
    }
    Object.entries(payload).forEach(([key, value]) => {
      if (key === 'filePath' || key === 'loadToken') {
        return;
      }
      this._fileOpenPerf.details[key] = value;
    });
    this.publishFileOpenPerf();
  }

  loadEditorSessionClass() {
    if (!this._editorSessionModulePromise) {
      this._editorSessionModulePromise = import('../infrastructure/editor-session.js')
        .then((module) => module.EditorSession);
    }

    return this._editorSessionModulePromise;
  }


  loadQuickSwitcherController() {
    return Promise.all([
      import('../presentation/quick-switcher-controller.js'),
      import('../styles/features/quick-switcher.css'),
    ]).then(([module]) => module.QuickSwitcherController);
  }


  async ensureQuickSwitcher() {
    return ensureQuickSwitcherInstance(this);
  }

  async toggleQuickSwitcher() {
    return toggleQuickSwitcherInstance(this);
  }
}
