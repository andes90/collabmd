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
      void this.commentsOverview?.refresh?.();
    }, delayMs);
  },

  handleCommentOverviewWorkspaceTreeChange() {
    if (this.activeSidebarTab === 'comments') {
      this.scheduleCommentOverviewRefresh({ delayMs: 0 });
    }
  },

  refreshCommentOverviewForSidebarOpen() {
    if (globalThis.document) {
      this._deferredCollabStylesPromise ??= import('../../styles/deferred-collab.css');
    }
    void this.commentsOverview?.refresh?.();
  },

  openCommentOverviewThread({ anchor = null, filePath, threadId } = {}) {
    if (!filePath || !threadId) return;

    this.clearPendingCommentOverviewFocus();
    this._pendingCommentOverviewFocus = { filePath, threadId };
    this._commentOverviewFocusTimer = setTimeout(() => this.clearPendingCommentOverviewFocus(), 15_000);
    this.setSidebarTab('comments');
    this.setSidebarVisibility(true);
    this.workspaceRouteController?.preserveSidebarTabForNextFileRoute?.(filePath);
    const isDiagram = getVaultFileKind(filePath) === 'excalidraw';
    const line = Number.isFinite(anchor?.startLine) ? anchor.startLine : null;
    const routeChanged = this.navigation.navigateToFile(filePath, isDiagram ? undefined : { line });
    if (!routeChanged) {
      this.workspaceRouteController?.preserveSidebarTabForNextFileRoute?.(null);
      this.focusPendingCommentOverviewThread();
    }
    this.closeSidebarOnMobile?.();
  },

  clearPendingCommentOverviewFocus() {
    clearTimeout(this._commentOverviewFocusTimer);
    this._commentOverviewFocusTimer = null;
    this._pendingCommentOverviewFocus = null;
  },

  handleCommentOverviewRouteChange(filePath) {
    if (this._commentOverviewRefreshTimer != null) {
      clearTimeout(this._commentOverviewRefreshTimer);
      this._commentOverviewRefreshTimer = null;
    }
    if (this._pendingCommentOverviewFocus?.filePath !== filePath) this.clearPendingCommentOverviewFocus();
  },

  focusPendingCommentOverviewThread() {
    const pending = this._pendingCommentOverviewFocus;
    if (!pending || pending.filePath !== this.currentFilePath) return false;

    const focused = getVaultFileKind(pending.filePath) === 'excalidraw'
      ? this.excalidrawEmbed?.openCommentThread?.(pending.filePath, pending.threadId)
      : this.commentUi.openThreadFromOverview?.(pending.threadId);
    if (focused) this.clearPendingCommentOverviewFocus();
    return Boolean(focused);
  },
};
