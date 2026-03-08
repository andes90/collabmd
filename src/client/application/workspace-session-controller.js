import {
  isMarkdownFilePath,
  supportsBacklinksForFilePath,
  supportsCommentsForFilePath,
} from '../../domain/file-kind.js';

export class WorkspaceSessionController {
  constructor(app) {
    this.app = app;
    this.editorSessionModulePromise = null;
  }

  loadEditorSessionClass() {
    if (!this.editorSessionModulePromise) {
      this.editorSessionModulePromise = import('../infrastructure/editor-session.js')
        .then((module) => module.EditorSession);
    }

    return this.editorSessionModulePromise;
  }

  showEmptyState() {
    const app = this.app;

    app.sessionLoadToken += 1;
    this.cleanupSession();
    app.resetPreviewMode();
    app.elements.outlineToggle?.classList.remove('hidden');
    app.elements.commentsToggle?.classList.add('hidden');
    app.elements.commentSelectionButton?.classList.add('hidden');
    app.elements.markdownToolbar?.classList.add('hidden');
    app.currentFilePath = null;
    app.lobby.setCurrentFile(null);
    app.fileExplorer.setActiveFile(null);

    app.elements.emptyState?.classList.remove('hidden');
    app.elements.editorPage?.classList.add('hidden');
    app.elements.previewContent.innerHTML = '';
    app.elements.previewContent.dataset.renderPhase = 'ready';
    clearTimeout(app._previewLayoutSyncTimer);
    app._pendingPreviewLayoutSync = false;
    app._previewHydrationPaused = false;
    app.previewRenderer.setHydrationPaused(false);
    app.excalidrawEmbed.setHydrationPaused(false);
    app.scrollSyncController.setLargeDocumentMode(false);
    app.scrollSyncController.invalidatePreviewBlocks();

    app.renderAvatars();
    app.renderPresence();
    app.backlinksPanel.clear();
    app.updateCommentThreads([]);
    app.commentsPanel.setCurrentFile(null, { supported: false });

    if (app.elements.activeFileName) {
      app.elements.activeFileName.textContent = 'CollabMD';
    }
  }

  async openFile(filePath) {
    const app = this.app;
    if (!app.isTabActive) {
      return;
    }

    if (filePath === app.currentFilePath && app.session) {
      app.fileExplorer.setActiveFile(filePath);
      app.lobby.setCurrentFile(filePath);
      return;
    }

    const loadToken = app.sessionLoadToken + 1;
    app.sessionLoadToken = loadToken;
    const isExcalidraw = app.isExcalidrawFile(filePath);
    const isMermaid = app.isMermaidFile(filePath);
    const isPlantUml = app.isPlantUmlFile(filePath);
    const supportsComments = supportsCommentsForFilePath(filePath);

    this.cleanupSession();
    app.layoutController.reset();
    app.resetPreviewMode();
    app.connectionHelpShown = false;
    app.connectionState = { status: 'connecting', unreachable: false };
    app.currentFilePath = filePath;
    app.lobby.setCurrentFile(filePath);

    app.fileExplorer.setActiveFile(filePath);
    app.syncFileChrome(filePath);
    app.commentsPanel.setCurrentFile(filePath, { supported: supportsComments });
    app.updateCommentThreads([]);

    app.elements.emptyState?.classList.add('hidden');
    app.elements.editorPage?.classList.remove('hidden');
    app.elements.markdownToolbar?.classList.toggle('hidden', !isMarkdownFilePath(filePath));

    const displayName = app.getDisplayName(filePath);
    if (app.elements.activeFileName) {
      app.elements.activeFileName.textContent = displayName;
    }

    app.showEditorLoading();
    app.previewRenderer.beginDocumentLoad();
    app.renderPresence();

    const EditorSession = await this.loadEditorSessionClass();
    const session = new EditorSession({
      editorContainer: app.elements.editorContainer,
      lineWrappingEnabled: app.getStoredLineWrapping(),
      initialTheme: app.themeController.getTheme(),
      lineInfoElement: app.elements.lineInfo,
      onAwarenessChange: (users) => app.updateFileAwareness(users),
      onConnectionChange: (state) => app.handleConnectionChange(state),
      onCommentsChange: (threads) => app.updateCommentThreads(threads),
      onContentChange: () => {
        if (isExcalidraw) {
          return;
        }

        app.previewRenderer.queueRender();
        if (app.commentThreads.length > 0) {
          app.updateCommentThreads(app.session?.getCommentThreads() ?? []);
        }
        if (!isMermaid && !isPlantUml) {
          app.scheduleBacklinkRefresh();
        }
      },
      preferredUserName: app.getStoredUserName(),
      localUser: app.lobby.getLocalUser(),
      getFileList: () => app.fileExplorer.flatFiles,
    });

    app.session = session;

    try {
      await session.initialize(filePath);

      if (loadToken !== app.sessionLoadToken) {
        session.destroy();
        return;
      }

      app.scrollSyncController.attachEditorScroller(session.getScrollContainer());
      session.applyTheme(app.themeController.getTheme());
      if (isExcalidraw) {
        app.renderExcalidrawFilePreview(filePath);
      }
      app.syncWrapToggle();
      app.updateCommentThreads(session.getCommentThreads());
      if (supportsBacklinksForFilePath(filePath)) {
        app.backlinksPanel.load(filePath);
      } else {
        app.backlinksPanel.clear();
      }
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      app.scrollSyncController.attachEditorScroller(null);
      if (app.session === session) {
        app.session = null;
      }

      if (loadToken !== app.sessionLoadToken) {
        return;
      }

      app.showEditorLoadError();
      app.syncWrapToggle();
      app.toastController.show('Failed to initialize editor');
    }
  }

  cleanupSession() {
    const app = this.app;

    app.session?.destroy();
    app.session = null;
    app.scrollSyncController.attachEditorScroller(null);
    app.scrollSyncController.setLargeDocumentMode(false);
    app.scrollSyncController.invalidatePreviewBlocks();
    app.outlineController.cleanup();
    app.followedCursorSignature = '';
    clearTimeout(app._backlinkRefreshTimer);
    clearTimeout(app._previewLayoutSyncTimer);
    app._pendingPreviewLayoutSync = false;
    app._previewHydrationPaused = false;
    app.previewRenderer.setHydrationPaused(false);
    app.excalidrawEmbed.setHydrationPaused(false);
  }
}
