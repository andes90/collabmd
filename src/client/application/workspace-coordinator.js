import {
  isBaseFilePath,
  isHtmlFilePath,
  isMarkdownFilePath,
  supportsBacklinksForFilePath,
} from '../../domain/file-kind.js';

const BOOTSTRAP_RENDER_DELAY_MS = 150;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class WorkspaceCoordinator {
  constructor({
    attachEditorScroller,
    beginDocumentLoad,
    cleanupAfterSessionDestroy,
    createEditorSession,
    getDisplayName,
    getFileList,
    getVaultFileList = getFileList,
    getLineWrappingEnabled,
    getVimModeEnabled,
    getLocalUser,
    getStoredUserName,
    getTheme,
    isBaseFile,
    isDrawioFile,
    isExcalidrawFile,
    isImageFile,
    isPdfFile,
    isMermaidFile,
    isPlantUmlFile,
    isStructurizrWorkspaceFile,
    isTabActive,
    loadBootstrapContent = null,
    loadEditorSessionClass,
    loadBacklinks,
    onBeforeFileOpen,
    onConnectionChange,
    onContentChange,
    onCommentsChange,
    onFileAwarenessChange,
    onFileOpenError,
    onFileOpenReady,
    onImagePaste,
    onSelectionChange,
    onSessionAssigned = null,
    onFileOpenMetric = null,
    onRenderBasePreview,
    onRenderExcalidrawPreview,
    onRenderDrawioPreview,
    onRenderHtmlPreview,
    onRenderImagePreview,
    onRenderPdfPreview,
    onRenderStructurizrPreview,
    onSyncWrapToggle,
    onUpdateActiveFile,
    onUpdateCurrentFile,
    onUpdateLobbyCurrentFile,
    onUpdateVisibleChrome,
    onViewModeReset,
    renderPresence,
    scrollContainerForSession,
    shouldUseDrawioPreview = null,
    showEditorLoading,
    stateStore,
  }) {
    this.attachEditorScroller = attachEditorScroller;
    this.beginDocumentLoad = beginDocumentLoad;
    this.cleanupAfterSessionDestroy = cleanupAfterSessionDestroy;
    this.createEditorSession = createEditorSession;
    this.getDisplayName = getDisplayName;
    this.getFileList = getFileList;
    this.getVaultFileList = getVaultFileList;
    this.getLineWrappingEnabled = getLineWrappingEnabled;
    this.getVimModeEnabled = getVimModeEnabled ?? (() => false);
    this.getLocalUser = getLocalUser;
    this.getStoredUserName = getStoredUserName;
    this.getTheme = getTheme;
    this.isBaseFile = isBaseFile ?? (() => false);
    this.isDrawioFile = isDrawioFile ?? (() => false);
    this.isExcalidrawFile = isExcalidrawFile ?? (() => false);
    this.isImageFile = isImageFile ?? (() => false);
    this.isPdfFile = isPdfFile ?? (() => false);
    this.isMermaidFile = isMermaidFile ?? (() => false);
    this.isPlantUmlFile = isPlantUmlFile ?? (() => false);
    this.isStructurizrWorkspaceFile = isStructurizrWorkspaceFile ?? (() => false);
    this.isTabActive = isTabActive;
    this.loadBootstrapContent = loadBootstrapContent;
    this.loadEditorSessionClassPort = loadEditorSessionClass;
    this.loadBacklinks = loadBacklinks;
    this.onBeforeFileOpen = onBeforeFileOpen;
    this.onConnectionChange = onConnectionChange;
    this.onContentChange = onContentChange;
    this.onCommentsChange = onCommentsChange;
    this.onFileAwarenessChange = onFileAwarenessChange;
    this.onFileOpenError = onFileOpenError;
    this.onFileOpenReady = onFileOpenReady;
    this.onImagePaste = onImagePaste;
    this.onSelectionChange = onSelectionChange;
    this.onSessionAssigned = onSessionAssigned;
    this.onFileOpenMetric = onFileOpenMetric;
    this.onRenderBasePreview = onRenderBasePreview;
    this.onRenderDrawioPreview = onRenderDrawioPreview;
    this.onRenderExcalidrawPreview = onRenderExcalidrawPreview;
    this.onRenderHtmlPreview = onRenderHtmlPreview;
    this.onRenderImagePreview = onRenderImagePreview;
    this.onRenderPdfPreview = onRenderPdfPreview;
    this.onRenderStructurizrPreview = onRenderStructurizrPreview;
    this.onSyncWrapToggle = onSyncWrapToggle;
    this.onUpdateActiveFile = onUpdateActiveFile;
    this.onUpdateCurrentFile = onUpdateCurrentFile;
    this.onUpdateLobbyCurrentFile = onUpdateLobbyCurrentFile;
    this.onUpdateVisibleChrome = onUpdateVisibleChrome;
    this.onViewModeReset = onViewModeReset;
    this.renderPresence = renderPresence;
    this.scrollContainerForSession = scrollContainerForSession;
    this.shouldUseDrawioPreview = shouldUseDrawioPreview ?? (() => true);
    this.showEditorLoading = showEditorLoading;
    this.stateStore = stateStore;
    this.session = null;
  }

  getSession() {
    return this.session;
  }

  loadEditorSessionClass() {
    return this.loadEditorSessionClassPort();
  }

  waitForNextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }

  reportFileOpenMetric(name, loadToken, data = {}) {
    this.onFileOpenMetric?.(name, {
      filePath: this.stateStore.currentFilePath,
      loadToken,
      ...data,
    });
  }

  cleanupSession() {
    this.session?.destroy();
    this.session = null;
    this.attachEditorScroller(null);
    this.cleanupAfterSessionDestroy();
  }

  prepareForFileOpen(filePath, { drawioMode = null, resetConnectionState = true } = {}) {
    this.onViewModeReset();
    this.onBeforeFileOpen();
    this.stateStore.connectionHelpShown = false;
    if (resetConnectionState) {
      this.stateStore.connectionState = { status: 'connecting', unreachable: false };
    }
    this.stateStore.currentDrawioMode = drawioMode ?? null;
    this.stateStore.currentFilePath = filePath;
    this.onUpdateCurrentFile(filePath);
    this.onUpdateLobbyCurrentFile(filePath);
    this.onUpdateActiveFile(filePath);
    this.onUpdateVisibleChrome(filePath, {
      displayName: this.getDisplayName(filePath),
      drawioMode,
      isMarkdown: isMarkdownFilePath(filePath),
    });
    this.showEditorLoading();
    this.beginDocumentLoad();
    this.renderPresence();

    return { supportsBacklinks: supportsBacklinksForFilePath(filePath) };
  }

  finalizeFileOpen({
    isBase = false,
    isDrawio = false,
    filePath,
    isExcalidraw = false,
    isHtml = false,
    isImage = false,
    isPdf = false,
    supportsBacklinks,
  }) {
    if (isExcalidraw) this.onRenderExcalidrawPreview(filePath);
    if (isBase || isBaseFilePath(filePath)) this.onRenderBasePreview(filePath);
    if (isDrawio) this.onRenderDrawioPreview(filePath);
    if (isHtml) this.onRenderHtmlPreview({ content: this.session?.getText?.() ?? '' });
    if (isImage) this.onRenderImagePreview(filePath);
    if (isPdf) this.onRenderPdfPreview(filePath);
    if (this.isStructurizrWorkspaceFile(filePath)) {
      this.onRenderStructurizrPreview(filePath, {
        source: this.session?.getText?.() ?? '',
      });
    }
    this.onSyncWrapToggle();
    if (supportsBacklinks) this.loadBacklinks(filePath);
  }

  async openFile(filePath, { drawioMode = null } = {}) {
    if (!this.isTabActive()) {
      return false;
    }

    if (!filePath || !this.getVaultFileList().includes(filePath)) {
      this.cleanupSession();
      this.stateStore.sessionLoadToken += 1;
      this.onFileOpenError({ code: 'not-found', filePath });
      return false;
    }

    const normalizedDrawioMode = drawioMode ?? null;
    const currentDrawioMode = this.stateStore.currentDrawioMode ?? null;
    const isDrawio = this.isDrawioFile(filePath) && drawioMode !== 'text' && this.shouldUseDrawioPreview(filePath);
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isBase = this.isBaseFile(filePath);
    const isImage = this.isImageFile(filePath);
    const isPdf = this.isPdfFile(filePath);
    const isHtml = isHtmlFilePath(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    const isStructurizrWorkspace = this.isStructurizrWorkspaceFile(filePath);

    if (
      filePath === this.stateStore.currentFilePath
      && normalizedDrawioMode === currentDrawioMode
      && (this.session || isDrawio || isExcalidraw || isImage || isPdf)
    ) {
      this.onUpdateActiveFile(filePath);
      this.onUpdateLobbyCurrentFile(filePath);
      return true;
    }

    const loadToken = ++this.stateStore.sessionLoadToken;
    const openStartedAt = performance.now();

    this.cleanupSession();
    const chromeState = this.prepareForFileOpen(filePath, {
      drawioMode: normalizedDrawioMode,
      resetConnectionState: !isDrawio && !isExcalidraw && !isImage && !isPdf,
    });
    this.reportFileOpenMetric('open_started', loadToken, { filePath });

    if (isDrawio || isExcalidraw || isImage || isPdf) {
      this.onSessionAssigned?.(null);

      if (loadToken !== this.stateStore.sessionLoadToken) {
        return;
      }

      this.onFileOpenReady(null);
      this.finalizeFileOpen({
        filePath,
        isBase,
        isDrawio,
        isExcalidraw,
        isImage,
        isPdf,
        session: null,
        supportsBacklinks: chromeState.supportsBacklinks,
      });
      return true;
    }
    let fileOpenReady = false;
    let liveSyncComplete = false;
    const bootstrapPromise = this.loadBootstrapContent
      ? (async () => {
        this.reportFileOpenMetric('bootstrap_fetch_started', loadToken);
        try {
          const content = await this.loadBootstrapContent(filePath);
          this.reportFileOpenMetric('bootstrap_fetch_completed', loadToken, {
            found: content !== null,
          });
          return content;
        } catch (error) {
          this.reportFileOpenMetric('bootstrap_fetch_completed', loadToken, {
            error: error.message,
            found: false,
          });
          return null;
        }
      })()
      : Promise.resolve(null);

    const EditorSession = await this.loadEditorSessionClass();
    const session = this.createEditorSession(EditorSession, {
      filePath,
      getFileList: this.getFileList,
      lineWrappingEnabled: this.getLineWrappingEnabled(),
      localUser: this.getLocalUser(),
      vimModeEnabled: this.getVimModeEnabled(),
      onAwarenessChange: (users) => this.onFileAwarenessChange(users),
      onConnectionChange: (state) => this.onConnectionChange(state),
      onCommentsChange: (threads) => this.onCommentsChange?.(threads),
      onContentChange: () => {
        if (isExcalidraw) {
          return;
        }

        this.onContentChange({
          isBase,
          isHtml,
          isMermaid,
          isPlantUml,
          isStructurizrWorkspace,
        });
      },
      onImagePaste: (file) => this.onImagePaste?.(file),
      preferredUserName: this.getStoredUserName(),
      onSelectionChange: (anchor) => this.onSelectionChange?.(anchor),
      theme: this.getTheme(),
    });

    this.session = session;
    this.onSessionAssigned?.(session);

    try {
      let fileOpenFinalized = false;
      const readySession = async (reason) => {
        if (fileOpenReady || loadToken !== this.stateStore.sessionLoadToken) {
          return;
        }

        fileOpenReady = true;
        this.attachEditorScroller(this.scrollContainerForSession(session));
        session.applyTheme(this.getTheme());
        this.onFileOpenReady(session);
        this.reportFileOpenMetric('editor_ready', loadToken, { reason });
        session.requestMeasure();
        await this.waitForNextPaint();

        if (fileOpenFinalized || loadToken !== this.stateStore.sessionLoadToken) {
          return;
        }

        fileOpenFinalized = true;
        this.finalizeFileOpen({
          filePath,
          isBase,
          isExcalidraw,
          isHtml,
          session,
          supportsBacklinks: chromeState.supportsBacklinks,
        });
      };


      const initializePromise = session.initialize(filePath);
      const liveSyncPromise = (async () => {
        await initializePromise;

        if (loadToken !== this.stateStore.sessionLoadToken) {
          return false;
        }

        await session.waitForInitialSync(null);
        if (loadToken !== this.stateStore.sessionLoadToken) {
          return false;
        }

        liveSyncComplete = true;
        session.activateCollaborativeView?.();
        this.attachEditorScroller(this.scrollContainerForSession(session));
        session.applyTheme(this.getTheme());
        this.reportFileOpenMetric('initial_sync_complete', loadToken);
        session.ensureInitialContent?.();
        if (!fileOpenReady) {
          await readySession('live-sync');
        } else {
          session.requestMeasure();
        }
        return true;
      })();

      const bootstrapVisibilityPromise = (async () => {
        const bootstrapContent = await bootstrapPromise;
        if (
          bootstrapContent === null
          || liveSyncComplete
          || fileOpenReady
          || loadToken !== this.stateStore.sessionLoadToken
        ) {
          return false;
        }

        const elapsedMs = performance.now() - openStartedAt;
        const remainingDelayMs = Math.max(0, BOOTSTRAP_RENDER_DELAY_MS - elapsedMs);
        if (remainingDelayMs > 0) {
          const winner = await Promise.race([
            liveSyncPromise.then((didSync) => (didSync ? 'live-sync' : 'stale')),
            delay(remainingDelayMs).then(() => 'timeout'),
          ]);
          if (winner === 'live-sync') {
            return false;
          }
        }

        if (
          liveSyncComplete
          || fileOpenReady
          || loadToken !== this.stateStore.sessionLoadToken
        ) {
          return false;
        }

        const didApplyBootstrap = session.showBootstrapContent({
          content: bootstrapContent,
          filePath,
        });
        if (!didApplyBootstrap && !session.hasBootstrapContent?.()) {
          return false;
        }

        this.reportFileOpenMetric('bootstrap_shown', loadToken);
        await readySession('bootstrap');
        return true;
      })();

      await initializePromise;

      if (loadToken !== this.stateStore.sessionLoadToken) {
        session.destroy();
        return;
      }

      await Promise.all([liveSyncPromise, bootstrapVisibilityPromise]);

      if (loadToken !== this.stateStore.sessionLoadToken) {
        session.destroy();
        return;
      }

      if (!fileOpenReady) {
        session.ensureInitialContent?.();
        await readySession('post-initialize');
      }
      return true;
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      this.attachEditorScroller(null);
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.stateStore.sessionLoadToken) {
        return;
      }

      this.onFileOpenError({ code: 'load-failed', filePath });
      return false;
    }
  }
}
