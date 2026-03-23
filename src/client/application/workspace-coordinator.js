import { FileOpenLifecycle } from './file-open-lifecycle.js';
import { WorkspaceChromeController } from './workspace-chrome-controller.js';

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
    getLineWrappingEnabled,
    getLocalUser,
    getStoredUserName,
    getTheme,
    isDrawioFile,
    isExcalidrawFile,
    isImageFile,
    isMermaidFile,
    isPlantUmlFile,
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
    onRenderExcalidrawPreview,
    onRenderDrawioPreview,
    onRenderImagePreview,
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
    this.getLineWrappingEnabled = getLineWrappingEnabled;
    this.getLocalUser = getLocalUser;
    this.getStoredUserName = getStoredUserName;
    this.getTheme = getTheme;
    this.isDrawioFile = isDrawioFile ?? (() => false);
    this.isExcalidrawFile = isExcalidrawFile ?? (() => false);
    this.isImageFile = isImageFile ?? (() => false);
    this.isMermaidFile = isMermaidFile ?? (() => false);
    this.isPlantUmlFile = isPlantUmlFile ?? (() => false);
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
    this.onRenderExcalidrawPreview = onRenderExcalidrawPreview;
    this.onSyncWrapToggle = onSyncWrapToggle;
    this.onUpdateActiveFile = onUpdateActiveFile;
    this.onUpdateCurrentFile = onUpdateCurrentFile;
    this.onUpdateLobbyCurrentFile = onUpdateLobbyCurrentFile;
    this.onUpdateVisibleChrome = onUpdateVisibleChrome;
    this.renderPresence = renderPresence;
    this.shouldUseDrawioPreview = shouldUseDrawioPreview ?? (() => true);
    this.stateStore = stateStore;
    this.session = null;
    this.lifecycle = new FileOpenLifecycle({
      attachEditorScroller,
      createEditorSession,
      loadEditorSessionClass: () => this.loadEditorSessionClassPort(),
      scrollContainerForSession,
    });
    this.chromeController = new WorkspaceChromeController({
      beginDocumentLoad,
      getDisplayName,
      loadBacklinks,
      onBeforeFileOpen,
      onRenderDrawioPreview,
      onFileOpenError,
      onFileOpenReady,
      onRenderExcalidrawPreview,
      onRenderImagePreview,
      onSyncWrapToggle,
      onUpdateActiveFile,
      onUpdateCurrentFile,
      onUpdateLobbyCurrentFile,
      onUpdateVisibleChrome,
      onViewModeReset,
      renderPresence,
      showEditorLoading,
      stateStore,
    });
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
      filePath: this.stateStore.get('currentFilePath'),
      loadToken,
      ...data,
    });
  }

  cleanupSession() {
    this.session?.destroy();
    this.session = null;
    this.lifecycle.clearSessionScroller();
    this.cleanupAfterSessionDestroy();
  }

  async openFile(filePath, { drawioMode = null } = {}) {
    if (!this.isTabActive()) {
      return;
    }

    const isDrawio = this.isDrawioFile(filePath) && drawioMode !== 'text' && this.shouldUseDrawioPreview(filePath);
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isImage = this.isImageFile(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);

    if (filePath === this.stateStore.get('currentFilePath') && (this.session || isDrawio || isExcalidraw || isImage)) {
      this.onUpdateActiveFile(filePath);
      this.onUpdateLobbyCurrentFile(filePath);
      return;
    }

    const loadToken = this.stateStore.nextSessionLoadToken();
    const openStartedAt = performance.now();

    this.cleanupSession();
    const chromeState = this.chromeController.prepareForFileOpen(filePath, {
      resetConnectionState: !isDrawio && !isExcalidraw && !isImage,
    });
    this.reportFileOpenMetric('open_started', loadToken, { filePath });

    if (isDrawio || isExcalidraw || isImage) {
      this.onSessionAssigned?.(null);

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        return;
      }

      this.chromeController.markFileOpenReady(null);
      this.chromeController.finalizeFileOpen({
        filePath,
        isDrawio,
        isExcalidraw,
        isImage,
        session: null,
        supportsBacklinks: chromeState.supportsBacklinks,
      });
      return;
    }

    const session = await this.lifecycle.createSession({
      filePath,
      getFileList: this.getFileList,
      lineWrappingEnabled: this.getLineWrappingEnabled(),
      localUser: this.getLocalUser(),
      onAwarenessChange: (users) => this.onFileAwarenessChange(users),
      onConnectionChange: (state) => this.onConnectionChange(state),
      onCommentsChange: (threads) => this.onCommentsChange?.(threads),
      onContentChange: () => {
        if (isExcalidraw) {
          return;
        }

        this.onContentChange({
          isMermaid,
          isPlantUml,
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
      let fileOpenReady = false;
      let fileOpenFinalized = false;
      let liveSyncComplete = false;

      const readySession = async (reason) => {
        if (fileOpenReady || loadToken !== this.stateStore.get('sessionLoadToken')) {
          return;
        }

        fileOpenReady = true;
        this.lifecycle.attachSessionScroller(session);
        session.applyTheme(this.getTheme());
        this.chromeController.markFileOpenReady(session);
        this.reportFileOpenMetric('editor_ready', loadToken, { reason });
        session.requestMeasure();
        await this.waitForNextPaint();

        if (fileOpenFinalized || loadToken !== this.stateStore.get('sessionLoadToken')) {
          return;
        }

        fileOpenFinalized = true;
        this.chromeController.finalizeFileOpen({
          filePath,
          isExcalidraw,
          session,
          supportsBacklinks: chromeState.supportsBacklinks,
        });
      };

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

      const initializePromise = session.initialize(filePath);
      const liveSyncPromise = (async () => {
        await initializePromise;

        if (loadToken !== this.stateStore.get('sessionLoadToken')) {
          return false;
        }

        await session.waitForInitialSync(null);
        if (loadToken !== this.stateStore.get('sessionLoadToken')) {
          return false;
        }

        liveSyncComplete = true;
        session.activateCollaborativeView?.();
        this.lifecycle.attachSessionScroller(session);
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
          || loadToken !== this.stateStore.get('sessionLoadToken')
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
          || loadToken !== this.stateStore.get('sessionLoadToken')
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

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        session.destroy();
        return;
      }

      await Promise.all([liveSyncPromise, bootstrapVisibilityPromise]);

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        session.destroy();
        return;
      }

      if (!fileOpenReady) {
        session.ensureInitialContent?.();
        await readySession('post-initialize');
      }
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      this.lifecycle.clearSessionScroller();
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        return;
      }

      this.chromeController.handleFileOpenError();
    }
  }
}
