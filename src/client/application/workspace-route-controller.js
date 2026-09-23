export class WorkspaceRouteController {
  constructor({
    backlinksPanel,
    canvasEmbed = null,
    clearInitialFileBootstrap,
    clearStaticPreviewDocument = null,
    closeSidebarOnMobile,
    drawioEmbed,
    elements,
    excalidrawEmbed,
    fileHistoryView = null,
    fileExplorer,
    getIsTabActive,
    getSessionLoadToken,
    gitDiffView,
    gitPanel,
    imageLightbox = null,
    lobby,
    navigation,
    previewRenderer,
    renderAvatars,
    renderPresence,
    requestPreviewRouteAnchor = null,
    resetPreviewMode,
    scrollSyncController,
    setSession,
    setSessionLoadToken,
    setSidebarTab,
    setSidebarVisibility,
    setCurrentFilePath,
    showGitCommit,
    showGitDiff,
    showGitFileHistory,
    showGitFilePreview,
    showGitHistory,
    syncMainChrome,
    videoEmbed,
    workspaceCoordinator,
    layoutController,
  }) {
    this.backlinksPanel = backlinksPanel;
    this.canvasEmbed = canvasEmbed;
    this.clearInitialFileBootstrap = clearInitialFileBootstrap;
    this.clearStaticPreviewDocument = clearStaticPreviewDocument;
    this.closeSidebarOnMobile = closeSidebarOnMobile;
    this.drawioEmbed = drawioEmbed ?? { setHydrationPaused() {} };
    this.elements = elements;
    this.excalidrawEmbed = excalidrawEmbed;
    this.fileHistoryView = fileHistoryView;
    this.fileExplorer = fileExplorer;
    this.getIsTabActive = getIsTabActive;
    this.getSessionLoadToken = getSessionLoadToken;
    this.gitDiffView = gitDiffView;
    this.gitPanel = gitPanel;
    this.imageLightbox = imageLightbox;
    this.lobby = lobby;
    this.navigation = navigation;
    this.previewRenderer = previewRenderer;
    this.renderAvatars = renderAvatars;
    this.renderPresence = renderPresence;
    this.requestPreviewRouteAnchor = requestPreviewRouteAnchor;
    this.resetPreviewMode = resetPreviewMode;
    this.scrollSyncController = scrollSyncController;
    this.setSession = setSession;
    this.setSessionLoadToken = setSessionLoadToken;
    this.setSidebarTab = setSidebarTab;
    this.setSidebarVisibility = setSidebarVisibility ?? (() => {});
    this.setCurrentFilePath = setCurrentFilePath;
    this.showGitCommit = showGitCommit;
    this.showGitDiff = showGitDiff;
    this.showGitFileHistory = showGitFileHistory;
    this.showGitFilePreview = showGitFilePreview;
    this.showGitHistory = showGitHistory;
    this.syncMainChrome = syncMainChrome;
    this.videoEmbed = videoEmbed;
    this.workspaceCoordinator = workspaceCoordinator;
    this.layoutController = layoutController;
    this.pendingTreeRevealPath = null;
    this.preserveSidebarTabRoutePath = null;
  }

  async handleHashChange() {
    if (!this.getIsTabActive()) {
      return;
    }

    const route = this.navigation.getHashRoute();
    const canLeave = route.type === 'file' || await this.prepareActiveEmbedDisconnect();
    if (!canLeave) {
      return;
    }

    if (route.type === 'empty') {
      this.requestPreviewRouteAnchor?.(null);
      this.gitPanel.setSelection();
      this.showEmptyState();
      this.syncMainChrome({ mode: 'empty', title: 'CollabMD' });
      return;
    }

    if (route.type === 'git-diff') {
      this.requestPreviewRouteAnchor?.(null);
      this.setSidebarTab('git');
      await this.showGitDiff(route);
      return;
    }

    if (route.type === 'git-file-history') {
      this.requestPreviewRouteAnchor?.(null);
      this.setSidebarTab('files');
      await this.showGitFileHistory(route);
      return;
    }

    if (route.type === 'git-file-preview') {
      this.requestPreviewRouteAnchor?.(null);
      this.setSidebarTab('files');
      await this.showGitFilePreview(route);
      return;
    }

    if (route.type === 'git-history') {
      this.requestPreviewRouteAnchor?.(null);
      this.setSidebarTab('git');
      await this.showGitHistory();
      return;
    }

    if (route.type === 'git-commit') {
      this.requestPreviewRouteAnchor?.(null);
      this.setSidebarTab('git');
      await this.showGitCommit(route);
      return;
    }

    if (this.preserveSidebarTabRoutePath === route.filePath) {
      this.preserveSidebarTabRoutePath = null;
    } else {
      this.preserveSidebarTabRoutePath = null;
      this.setSidebarTab('files');
    }
    const didOpen = await this.openFile(route.filePath, { drawioMode: route.drawioMode || null });
    if (!didOpen) {
      return;
    }
    this.revealEditorMatch(route);
    if (route.elementId) {
      this.excalidrawEmbed?.openElement(
        route.filePath,
        route.elementId,
        route.elementType,
      );
    }
    this.requestPreviewRouteAnchor?.(route.anchor ?? null, route.filePath);
  }

  showEmptyState() {
    this.gitDiffView.hide();
    this.fileHistoryView?.hide?.();
    this.workspaceCoordinator.cleanupSession();
    this.clearStaticPreviewDocument?.();
    this.setSession(null);
    this.setSessionLoadToken(this.getSessionLoadToken() + 1);
    this.clearInitialFileBootstrap();
    this.resetPreviewMode();
    this.elements.outlineToggle?.classList.remove('hidden');
    this.elements.markdownToolbar?.classList.add('hidden');
    this.setCurrentFilePath(null);
    this.lobby.setCurrentFile(null);
    this.fileExplorer.setActiveFile(null);

    this.elements.emptyState?.classList.remove('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.diffPage?.classList.add('hidden');
    this.resetPreviewSurface();

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();

    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = 'CollabMD';
    }
  }

  prepareGitView(filePath = null) {
    this.setSessionLoadToken(this.getSessionLoadToken() + 1);
    this.clearInitialFileBootstrap();
    this.clearStaticPreviewDocument?.();
    this.workspaceCoordinator.cleanupSession();
    this.setSession(null);
    this.resetPreviewMode();
    this.layoutController.reset();
    this.setCurrentFilePath(filePath);
    this.lobby.setCurrentFile(null);
    this.fileExplorer.setActiveFile(filePath);
  }

  showDiffState() {
    this.fileHistoryView?.hide?.();
    this.prepareGitView();

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.diffPage?.classList.remove('hidden');
    this.resetPreviewSurface();

    this.elements.outlineToggle?.classList.add('hidden');
    this.elements.markdownToolbar?.classList.add('hidden');

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
  }

  showFileHistoryState(filePath) {
    this.gitDiffView.hide();
    this.prepareGitView(filePath);

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.diffPage?.classList.remove('hidden');
    this.resetPreviewSurface();

    this.elements.outlineToggle?.classList.add('hidden');
    this.elements.markdownToolbar?.classList.add('hidden');

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
  }

  showPreviewOnlyState(filePath) {
    this.gitDiffView.hide();
    this.fileHistoryView?.hide?.();
    this.prepareGitView(filePath);

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.remove('hidden');
    this.elements.diffPage?.classList.add('hidden');
    this.resetPreviewSurface();

    this.elements.markdownToolbar?.classList.add('hidden');

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
  }

  async openFile(filePath, options = {}) {
    if (!await this.prepareActiveEmbedDisconnect(filePath)) return false;
    const shouldRevealInTree = this.pendingTreeRevealPath === filePath;
    if (shouldRevealInTree) {
      this.pendingTreeRevealPath = null;
    }

    this.imageLightbox?.close?.();
    this.gitPanel.setSelection();
    this.gitDiffView.hide();
    this.fileHistoryView?.hide?.();
    this.clearStaticPreviewDocument?.();
    this.syncMainChrome({ mode: 'editor' });
    const didOpen = await this.workspaceCoordinator.openFile(filePath, options);
    this.setSession(this.workspaceCoordinator.getSession());
    if (didOpen === false) {
      return false;
    }

    if (shouldRevealInTree) {
      this.revealFileInTree(filePath, { clearSearch: true });
    }

    return true;
  }

  async prepareActiveEmbedDisconnect(nextFilePath = null) {
    const activeFilePath = this.workspaceCoordinator.stateStore?.currentFilePath
      ?? this.workspaceCoordinator.stateStore?.get?.('currentFilePath')
      ?? null;
    if (!activeFilePath || activeFilePath === nextFilePath) return true;
    const embed = this.workspaceCoordinator.isCanvasFile?.(activeFilePath)
      ? this.canvasEmbed
      : (this.workspaceCoordinator.isExcalidrawFile?.(activeFilePath) ? this.excalidrawEmbed : null);
    if (embed) {
      const canLeave = await embed.prepareFileDisconnect(activeFilePath, {
        timeoutMs: 10000,
      });
      if (!canLeave) {
        this.navigation.navigateToFile(activeFilePath);
        return false;
      }
    }

    return true;
  }

  preserveSidebarTabForNextFileRoute(filePath) {
    this.preserveSidebarTabRoutePath = filePath || null;
  }

  cleanupSession() {
    this.workspaceCoordinator.cleanupSession();
    this.setSession(this.workspaceCoordinator.getSession());
  }

  handleFileSelection(filePath, { closeSidebarOnMobile = false, revealInTree = false } = {}) {
    const currentRoute = this.navigation.getHashRoute?.() ?? null;
    const isCanonicalCurrentFileRoute = (
      currentRoute?.type === 'file'
      && currentRoute.filePath === filePath
      && !currentRoute.drawioMode
    );
    if (revealInTree) {
      this.pendingTreeRevealPath = filePath;
      if (isCanonicalCurrentFileRoute) {
        this.pendingTreeRevealPath = null;
        this.revealFileInTree(filePath, { clearSearch: true });
        return;
      }
    }

    if (closeSidebarOnMobile && !revealInTree) {
      this.closeSidebarOnMobile();
    }

    this.navigation.navigateToFile(filePath);
  }

  revealFileInTree(filePath, { clearSearch = false } = {}) {
    this.setSidebarTab('files');
    this.setSidebarVisibility(true);
    this.fileExplorer.revealFile?.(filePath, { clearSearch });
  }

  revealEditorMatch(route = {}) {
    if (!Number.isFinite(route.line)) {
      return false;
    }

    const session = this.workspaceCoordinator.getSession?.();
    return session?.revealSearchMatch?.({
      column: route.column,
      length: route.matchLength,
      line: route.line,
    }) ?? session?.scrollToLine?.(route.line, 0.2) ?? false;
  }

  resetPreviewSurface() {
    if (this.elements.previewContent) {
      this.elements.previewContent.innerHTML = '';
      this.elements.previewContent.dataset.renderPhase = 'ready';
    }
    this.videoEmbed?.reconcileEmbeds(this.elements.previewContent);
    this.imageLightbox?.close?.();
    this.previewRenderer.setHydrationPaused(false);
    this.drawioEmbed.setHydrationPaused(false);
    this.excalidrawEmbed.setHydrationPaused(false);
    this.videoEmbed?.detachForCommit();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
  }
}
