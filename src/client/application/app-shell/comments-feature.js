import { getVaultFileKind, supportsCommentsForFilePath } from '../../../domain/file-kind.js';

export const commentsFeature = {
  getCommentFileKind(filePath = this.currentFilePath) {
    return getVaultFileKind(filePath) || 'markdown';
  },

  syncCommentChrome(filePath = this.currentFilePath) {
    const supported = supportsCommentsForFilePath(filePath) && !this.isExcalidrawFile(filePath);
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
  },

  handleCommentEditorContentChange() {
    this.commentUi.handleEditorContentChange();
  },

  refreshCommentUiLayout() {
    this.commentUi.refreshLayout();
  },
};
