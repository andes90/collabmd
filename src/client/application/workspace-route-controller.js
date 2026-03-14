export class WorkspaceRouteController {
  constructor({
    backlinksPanel,
    clearInitialFileBootstrap,
    closeSidebarOnMobile,
    elements,
    excalidrawEmbed,
    fileExplorer,
    getIsTabActive,
    getSessionLoadToken,
    gitDiffView,
    gitPanel,
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
    showGitDiff,
    syncMainChrome,
    videoEmbed,
    workspaceCoordinator,
    layoutController,
  }) {
    this.backlinksPanel = backlinksPanel;
    this.clearInitialFileBootstrap = clearInitialFileBootstrap;
    this.closeSidebarOnMobile = closeSidebarOnMobile;
    this.elements = elements;
    this.excalidrawEmbed = excalidrawEmbed;
    this.fileExplorer = fileExplorer;
    this.getIsTabActive = getIsTabActive;
    this.getSessionLoadToken = getSessionLoadToken;
    this.gitDiffView = gitDiffView;
    this.gitPanel = gitPanel;
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
    this.showGitDiff = showGitDiff;
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

    this.setSidebarTab('files');
    await this.openFile(route.filePath);
  }

  showEmptyState() {
    this.gitDiffView.hide();
    this.workspaceCoordinator.cleanupSession();
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
    this.setSessionLoadToken(this.getSessionLoadToken() + 1);
    this.clearInitialFileBootstrap();
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

  async openFile(filePath) {
    this.gitPanel.setSelection();
    this.gitDiffView.hide();
    this.syncMainChrome({ mode: 'editor' });
    await this.workspaceCoordinator.openFile(filePath);
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
    this.previewRenderer.setHydrationPaused(false);
    this.excalidrawEmbed.setHydrationPaused(false);
    this.videoEmbed?.detachForCommit();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
  }
}
