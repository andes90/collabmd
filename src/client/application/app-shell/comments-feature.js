import {
  getVaultFileKind,
  supportsCommentsForFilePath,
} from '../../../domain/file-kind.js';

export const commentsFeature = {
  createCommentThread(payload) {
    const threadId = this.session?.createCommentThread(payload);
    if (threadId) {
      this.scheduleCommentOverviewRefresh();
    }
    return threadId;
  },

  replyToCommentThread(threadId, body) {
    const messageId = this.session?.replyToCommentThread(threadId, body);
    if (messageId) {
      this.scheduleCommentOverviewRefresh();
    }
    return messageId;
  },

  resolveCommentThread(threadId) {
    const didResolve = this.session?.deleteCommentThread(threadId);
    if (didResolve) {
      this.scheduleCommentOverviewRefresh();
    }
    return didResolve;
  },

  getCommentFileKind(filePath = this.currentFilePath) {
    return getVaultFileKind(filePath) || 'markdown';
  },

  syncCommentChrome(filePath = this.currentFilePath) {
    const supported = supportsCommentsForFilePath(filePath) && !this.isExcalidrawFile(filePath);
    if (supported && globalThis.document) {
      this._deferredCollabStylesPromise ??= import('../../styles/deferred-collab.css');
    }
    this.commentUi.setCurrentFile(filePath, {
      fileKind: this.getCommentFileKind(filePath),
      supported,
    });
    this.handleCommentThreadsChange(this.session?.getCommentThreads?.() ?? []);
    this.handleCommentSelectionChange(this.session?.getCurrentSelectionCommentAnchor?.() ?? null);
  },

  handleCommentSelectionChange(anchor) {
    this.commentUi.setSelectionAnchor(anchor);
  },

  handleCommentThreadsChange(threads = []) {
    this.commentUi.setThreads(threads);
    this.focusPendingCommentOverviewThread();
  },

  handleCommentEditorContentChange() {
    this.commentUi.handleEditorContentChange();
  },

  refreshCommentUiLayout() {
    this.commentUi.refreshLayout();
  },

  scheduleCommentOverviewRefresh({ delayMs = 900 } = {}) {
    clearTimeout(this._commentOverviewRefreshTimer);
    this._commentOverviewRefreshTimer = setTimeout(() => {
      this._commentOverviewRefreshTimer = null;
      this._commentOverviewStale = false;
      void this.commentsOverview?.refresh?.();
    }, delayMs);
  },

  handleCommentOverviewWorkspaceTreeChange() {
    this._commentOverviewStale = true;
    if (this.activeSidebarTab === 'comments') {
      this.scheduleCommentOverviewRefresh({ delayMs: 0 });
    }
  },

  refreshCommentOverviewForSidebarOpen() {
    this._commentOverviewStale = false;
    if (globalThis.document) {
      this._deferredCollabStylesPromise ??= import('../../styles/deferred-collab.css');
    }
    void this.commentsOverview?.refresh?.();
  },

  async openCommentOverviewThread({ anchor = null, filePath, threadId } = {}) {
    if (!filePath || !threadId) {
      return;
    }

    const isDiagram = getVaultFileKind(filePath) === 'excalidraw';
    const line = Number.isFinite(anchor?.startLine) ? anchor.startLine : null;
    if (!isDiagram) {
      this._pendingCommentOverviewFocus = {
        attempts: 0,
        filePath,
        line,
        threadId,
      };
    }
    this.setSidebarTab('comments');
    this.setSidebarVisibility(true);
    this.workspaceRouteController?.preserveSidebarTabForNextFileRoute?.(filePath);
    this.navigation.navigateToFile(filePath, isDiagram ? undefined : { line });

    if (this.currentFilePath !== filePath || !this.session) {
      await this.workspaceRouteController.openFile(filePath);
    }

    this.setSidebarTab('comments');
    this.setSidebarVisibility(true);
    if (isDiagram) {
      this.excalidrawEmbed?.openCommentThread?.(filePath, threadId);
      this.closeSidebarOnMobile?.();
      return;
    }

    this.focusPendingCommentOverviewThread();
    this.closeSidebarOnMobile?.();
  },

  focusPendingCommentOverviewThread() {
    const pending = this._pendingCommentOverviewFocus;
    if (!pending || pending.filePath !== this.currentFilePath) {
      return false;
    }

    if (Number.isFinite(pending.line)) {
      this.session?.scrollToLine?.(pending.line, 0.2);
    }

    const didFocus = this.commentUi.openThreadFromOverview?.(pending.threadId);
    if (didFocus) {
      this._pendingCommentOverviewFocus = null;
      this.setSidebarTab('comments');
      return true;
    }

    if (pending.attempts >= 8) {
      this._pendingCommentOverviewFocus = null;
      return false;
    }

    pending.attempts += 1;
    clearTimeout(this._commentOverviewFocusTimer);
    this._commentOverviewFocusTimer = setTimeout(() => {
      this._commentOverviewFocusTimer = null;
      this.focusPendingCommentOverviewThread();
    }, 120);
    return false;
  },
};
