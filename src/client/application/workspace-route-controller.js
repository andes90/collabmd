import {
  isCanvasFilePath,
  isDrawioFilePath,
  isExcalidrawFilePath,
} from '../../domain/file-kind.js';

export class WorkspaceRouteController {
  constructor(options = {}) {
    Object.assign(this, options);
    this.canvasEmbed = options.canvasEmbed ?? null;
    this.clearStaticPreviewDocument = options.clearStaticPreviewDocument ?? null;
    this.drawioEmbed = options.drawioEmbed ?? { setHydrationPaused() {} };
    this.fileHistoryView = options.fileHistoryView ?? null;
    this.imageLightbox = options.imageLightbox ?? null;
    this.onFileRouteOpened = options.onFileRouteOpened ?? null;
    this.onPendingTextWrites = options.onPendingTextWrites ?? null;
    this.onRouteChange = options.onRouteChange ?? null;
    this.requestPreviewRouteAnchor = options.requestPreviewRouteAnchor ?? null;
    this.getCurrentFilePath = options.getCurrentFilePath ?? (() => (
      this.workspaceCoordinator?.stateStore?.currentFilePath
      ?? this.workspaceCoordinator?.stateStore?.get?.('currentFilePath')
      ?? null
    ));
    this.setSidebarVisibility = options.setSidebarVisibility ?? (() => {});
    this.pendingNewNotePath = null;
    this.pendingTreeRevealPath = null;
    this.preserveSidebarTabRoutePath = null;
  }

  async handleHashChange() {
    if (!this.getIsTabActive()) {
      return;
    }

    const route = this.navigation.getHashRoute();
    const focusNewNote = route.filePath === this.pendingNewNotePath;
    this.pendingNewNotePath = null;
    this.onRouteChange?.(route.type === 'file' ? route.filePath : null);
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
    if (this.getCurrentFilePath() === route.filePath) {
      if (focusNewNote) this.focusCreatedNote();
      this.onFileRouteOpened?.();
    }
  }

  focusCreatedNote() {
    if (this.layoutController.currentView === 'preview') {
      this.layoutController.setView('editor', { persist: false });
    }
    this.workspaceCoordinator.getSession()?.runEditorCommand('cursorDocEnd');
  }

  activateViewState({
    activePage,
    cleanupBeforeToken = false,
    filePath = null,
    hideDiff = true,
    hideHistory = true,
    hideOutlineToggle = null,
    resetLayout = true,
    title = null,
  }) {
    if (hideDiff) this.gitDiffView.hide();
    if (hideHistory) this.fileHistoryView?.hide?.();
    if (cleanupBeforeToken) {
      this.workspaceCoordinator.cleanupSession();
      this.clearStaticPreviewDocument?.();
      this.setSession(null);
      this.setSessionLoadToken(this.getSessionLoadToken() + 1);
      this.clearInitialFileBootstrap();
    } else {
      this.setSessionLoadToken(this.getSessionLoadToken() + 1);
      this.clearInitialFileBootstrap();
      this.clearStaticPreviewDocument?.();
      this.workspaceCoordinator.cleanupSession();
      this.setSession(null);
    }
    this.resetPreviewMode();
    if (resetLayout) this.layoutController.reset();
    this.setCurrentFilePath(filePath);
    this.lobby.setCurrentFile(null);
    this.fileExplorer.setActiveFile(filePath);

    this.setActivePage(activePage);
    this.resetPreviewSurface();

    if (hideOutlineToggle !== null) {
      this.elements.outlineToggle?.classList[hideOutlineToggle ? 'add' : 'remove']('hidden');
    }
    this.elements.markdownToolbar?.classList.add('hidden');

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
    if (title !== null && this.elements.activeFileName) {
      this.elements.activeFileName.textContent = title;
    }
  }

  setActivePage(activePage) {
    this.elements.emptyState?.classList[activePage !== 'empty' ? 'add' : 'remove']('hidden');
    this.elements.editorPage?.classList[activePage !== 'editor' ? 'add' : 'remove']('hidden');
    this.elements.diffPage?.classList[activePage !== 'diff' ? 'add' : 'remove']('hidden');
    this.elements.fileOpenError?.classList[activePage !== 'error' ? 'add' : 'remove']('hidden');
  }

  showFileOpenError({ code, filePath }) {
    this.activateViewState({ activePage: 'error', resetLayout: false });
    this.elements.fileOpenErrorTitle.textContent = code === 'not-found' ? 'File not found' : 'Failed to open file';
    this.elements.fileOpenErrorPath.textContent = filePath || 'The link is missing a file path.';
    this.syncMainChrome({ mode: 'error', title: 'CollabMD' });
    this.elements.exportMenuGroup?.classList.add('hidden');
  }

  showEmptyState() {
    this.activateViewState({
      activePage: 'empty',
      cleanupBeforeToken: true,
      hideOutlineToggle: false,
      resetLayout: false,
      title: 'CollabMD',
    });
  }

  showDiffState() {
    this.activateViewState({
      activePage: 'diff',
      hideDiff: false,
      hideOutlineToggle: true,
    });
  }

  showFileHistoryState(filePath) {
    this.activateViewState({
      activePage: 'diff',
      filePath,
      hideHistory: false,
      hideOutlineToggle: true,
    });
  }

  showPreviewOnlyState(filePath) {
    this.activateViewState({
      activePage: 'editor',
      filePath,
    });
  }

  async openFile(filePath, options = {}) {
    if (!await this.prepareActiveEmbedDisconnect(filePath, options.drawioMode)) return false;
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

  async prepareActiveEmbedDisconnect(nextFilePath = null, nextDrawioMode = null) {
    const activeFilePath = this.getCurrentFilePath();
    const drawioMode = this.workspaceCoordinator.stateStore?.currentDrawioMode ?? null;
    if (!activeFilePath || (activeFilePath === nextFilePath && drawioMode === nextDrawioMode)) return true;
    const session = this.workspaceCoordinator.getSession?.();
    if (session?.prepareDisconnect && !await session.prepareDisconnect()) {
      this.navigation.navigateToFile(activeFilePath, { drawioMode });
      this.onPendingTextWrites?.();
      return false;
    }
    const embed = isCanvasFilePath(activeFilePath)
      ? this.canvasEmbed
      : (isDrawioFilePath(activeFilePath) ? this.drawioEmbed
        : (isExcalidrawFilePath(activeFilePath) ? this.excalidrawEmbed : null));
    if (embed?.prepareFileDisconnect) {
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

  handleFileSelection(filePath, { closeSidebarOnMobile = false, focusNewNote = false, revealInTree = false } = {}) {
    this.pendingNewNotePath = focusNewNote ? filePath : null;
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

    const routeChanged = this.navigation.navigateToFile(filePath);
    if (!routeChanged && focusNewNote) {
      void this.handleHashChange();
    }
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
    this.previewRenderer.resetDocument();
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
