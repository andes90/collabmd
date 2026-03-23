export class WorkspaceRouteController {
  constructor({
    backlinksPanel,
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
    resetPreviewMode,
    scrollSyncController,
    setSession,
    setSessionLoadToken,
    setSidebarTab,
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
    this.resetPreviewMode = resetPreviewMode;
    this.scrollSyncController = scrollSyncController;
    this.setSession = setSession;
    this.setSessionLoadToken = setSessionLoadToken;
    this.setSidebarTab = setSidebarTab;
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
  }

  async handleHashChange() {
    if (!this.getIsTabActive()) {
      return;
    }

    const route = this.navigation.getHashRoute();
    if (route.type === 'empty') {
      this.gitPanel.setSelection();
      this.showEmptyState();
      this.syncMainChrome({ mode: 'empty', title: 'CollabMD' });
      return;
    }

    if (route.type === 'git-diff') {
      this.setSidebarTab('git');
      await this.showGitDiff(route);
      return;
    }

    if (route.type === 'git-file-history') {
      this.setSidebarTab('files');
      await this.showGitFileHistory(route);
      return;
    }

    if (route.type === 'git-file-preview') {
      this.setSidebarTab('files');
      await this.showGitFilePreview(route);
      return;
    }

    if (route.type === 'git-history') {
      this.setSidebarTab('git');
      await this.showGitHistory();
      return;
    }

    if (route.type === 'git-commit') {
      this.setSidebarTab('git');
      await this.showGitCommit(route);
      return;
    }

    this.setSidebarTab('files');
    await this.openFile(route.filePath, { drawioMode: route.drawioMode || null });
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
    if (this.elements.previewContent) {
      this.elements.previewContent.innerHTML = '';
      this.elements.previewContent.dataset.renderPhase = 'ready';
    }
    this.videoEmbed?.reconcileEmbeds(this.elements.previewContent);
    this.resetPreviewSurface();

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();

    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = 'CollabMD';
    }
  }

  showDiffState() {
    this.fileHistoryView?.hide?.();
    this.setSessionLoadToken(this.getSessionLoadToken() + 1);
    this.clearInitialFileBootstrap();
    this.clearStaticPreviewDocument?.();
    this.workspaceCoordinator.cleanupSession();
    this.setSession(null);
    this.resetPreviewMode();
    this.layoutController.reset();
    this.setCurrentFilePath(null);
    this.lobby.setCurrentFile(null);
    this.fileExplorer.setActiveFile(null);

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.diffPage?.classList.remove('hidden');
    if (this.elements.previewContent) {
      this.elements.previewContent.innerHTML = '';
      this.elements.previewContent.dataset.renderPhase = 'ready';
    }
    this.videoEmbed?.reconcileEmbeds(this.elements.previewContent);
    this.resetPreviewSurface();

    this.elements.outlineToggle?.classList.add('hidden');
    this.elements.markdownToolbar?.classList.add('hidden');

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
  }

  showFileHistoryState(filePath) {
    this.gitDiffView.hide();
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

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.diffPage?.classList.remove('hidden');
    if (this.elements.previewContent) {
      this.elements.previewContent.innerHTML = '';
      this.elements.previewContent.dataset.renderPhase = 'ready';
    }
    this.videoEmbed?.reconcileEmbeds(this.elements.previewContent);
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

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.remove('hidden');
    this.elements.diffPage?.classList.add('hidden');
    if (this.elements.previewContent) {
      this.elements.previewContent.innerHTML = '';
      this.elements.previewContent.dataset.renderPhase = 'ready';
    }
    this.videoEmbed?.reconcileEmbeds(this.elements.previewContent);
    this.resetPreviewSurface();

    this.elements.markdownToolbar?.classList.add('hidden');

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
  }

  async openFile(filePath, options = {}) {
    this.imageLightbox?.close?.();
    this.gitPanel.setSelection();
    this.gitDiffView.hide();
    this.fileHistoryView?.hide?.();
    this.clearStaticPreviewDocument?.();
    this.syncMainChrome({ mode: 'editor' });
    await this.workspaceCoordinator.openFile(filePath, options);
    this.setSession(this.workspaceCoordinator.getSession());
  }

  cleanupSession() {
    this.workspaceCoordinator.cleanupSession();
    this.setSession(this.workspaceCoordinator.getSession());
  }

  handleFileSelection(filePath, { closeSidebarOnMobile = false } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }

    this.navigation.navigateToFile(filePath);
  }

  resetPreviewSurface() {
    this.imageLightbox?.close?.();
    this.previewRenderer.setHydrationPaused(false);
    this.drawioEmbed.setHydrationPaused(false);
    this.excalidrawEmbed.setHydrationPaused(false);
    this.videoEmbed?.detachForCommit();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
  }
}
