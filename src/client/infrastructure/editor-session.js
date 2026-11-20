import * as Y from 'yjs';

import { createEditableContentRevision } from '../../domain/editable-content-revision.js';

import { CommentThreadStore } from './comment-thread-store.js';
import { EditorCollaborationClient } from './editor-collaboration-client.js';
import { EditorViewAdapter } from './editor-view-adapter.js';

export class EditorSession {
  constructor({
    editorContainer,
    lineWrappingEnabled = true,
    vimModeEnabled = false,
    initialTheme,
    lineInfoElement,
    onAwarenessChange,
    onConnectionChange,
    onCommentsChange,
    onContentChange,
    onImagePaste,
    onSelectionChange,
    preferredUserName,
    localUser,
    getFileList,
  }) {
    this.onAwarenessChange = onAwarenessChange;
    this.onCommentsChange = onCommentsChange;
    this.onContentChange = onContentChange;
    this.onSelectionChange = onSelectionChange;
    this.activeFilePath = '';
    this.bootstrapContent = null;
    this.pendingCollaborativeBindings = null;
    this.hasDeliveredContent = false;
    this.lastDeliveredContent = null;

    this.collaborationClient = new EditorCollaborationClient({
      localUser,
      onAwarenessChange: (users) => this.onAwarenessChange?.(users),
      onConnectionChange,
      onInitialSync: () => this.emitContentChange(),
      preferredUserName,
      resolveAwarenessCursor: (cursor) => this.resolveAwarenessCursor(cursor),
    });
    this.viewAdapter = new EditorViewAdapter({
      editorContainer,
      getFileList: getFileList || (() => []),
      initialTheme,
      lineInfoElement,
      lineWrappingEnabled,
      vimModeEnabled,
      onDocChanged: () => this.emitContentChange(),
      onImagePaste,
      onViewportChanged: (viewport) => this.collaborationClient.setLocalViewport(viewport),
      onSelectionChanged: () => this.onSelectionChange?.(this.getCurrentSelectionCommentAnchor()),
    });
    this.commentThreadStore = new CommentThreadStore({
      getDoc: () => this.collaborationClient.ydoc,
      getEditorState: () => this.viewAdapter.getState(),
      getLocalUser: () => this.collaborationClient.getLocalUser(),
      onCommentsChange: (threads) => this.onCommentsChange?.(threads),
    });
  }

  async initialize(filePath) {
    this.activeFilePath = filePath;
    this.hasDeliveredContent = false;
    this.lastDeliveredContent = null;
    const collaborationBindings = await this.collaborationClient.initialize(filePath);
    this.commentThreadStore.bind({
      commentThreads: collaborationBindings.commentThreads,
      ydoc: collaborationBindings.ydoc,
      ytext: collaborationBindings.ytext,
    });

    this.pendingCollaborativeBindings = collaborationBindings;
    if (this.collaborationClient.initialSyncComplete) {
      this.activateCollaborativeView();
    }

    this.onAwarenessChange?.(this.collaborationClient.collectUsers((cursor) => this.resolveAwarenessCursor(cursor)));
  }

  activateCollaborativeView() {
    if (!this.pendingCollaborativeBindings) {
      return false;
    }

    this.viewAdapter.initialize({
      awareness: this.pendingCollaborativeBindings.awareness,
      filePath: this.activeFilePath,
      undoManager: this.pendingCollaborativeBindings.undoManager,
      ytext: this.pendingCollaborativeBindings.ytext,
    });
    this.commentThreadStore.refreshComments();
    this.pendingCollaborativeBindings = null;
    this.bootstrapContent = null;
    return true;
  }

  showBootstrapContent({ content = '', filePath = this.activeFilePath } = {}) {
    if (this.collaborationClient.initialSyncComplete) {
      return false;
    }

    this.activeFilePath = filePath;
    this.bootstrapContent = String(content ?? '');
    this.viewAdapter.initializeProvisional({
      content: this.bootstrapContent,
      filePath: this.activeFilePath,
    });
    this.commentThreadStore.refreshComments();
    return this.emitContentChange();
  }

  hasBootstrapContent() {
    return this.bootstrapContent !== null;
  }

  emitContentChange({ force = false } = {}) {
    const nextContent = this.getText();
    if (!force && this.hasDeliveredContent && nextContent === this.lastDeliveredContent) {
      return false;
    }

    this.hasDeliveredContent = true;
    this.lastDeliveredContent = nextContent;
    this.onContentChange?.();
    return true;
  }

  ensureInitialContent() {
    return this.emitContentChange();
  }

  getText() {
    const text = this.collaborationClient.getText();
    return this.isInitialSyncComplete() ? text : (text || this.viewAdapter.getText());
  }

  get awareness() { return this.collaborationClient.awareness; }
  get provider() { return this.collaborationClient.provider; }
  get ydoc() { return this.collaborationClient.ydoc; }
  get ytext() { return this.collaborationClient.ytext; }

  async getAgentContext() {
    const state = this.viewAdapter.getState();
    if (!this.isInitialSyncComplete() || !state || state.doc.length > 1_000_000) return null;
    const { from, to } = state.selection.main;
    const end = to > from ? to - 1 : to;
    return {
      localRevision: await createEditableContentRevision(state.doc.toString()),
      selection: {
        endLine: state.doc.lineAt(end).number,
        from,
        startLine: state.doc.lineAt(from).number,
        text: state.doc.sliceString(from, Math.min(to, from + 2000)),
        to,
        truncated: to - from > 2000,
      },
    };
  }

  getUserCursor(clientId) {
    return this.collaborationClient.getUserCursor(clientId, (cursor) => this.resolveAwarenessCursor(cursor));
  }

  scrollToUserViewport(clientId) {
    const viewport = this.getUserViewport(clientId);
    return viewport ? this.scrollToLine(viewport.topLine, viewport.viewportRatio) : false;
  }

  scrollToUserCursor(clientId, alignment = 'center') {
    const cursor = this.getUserCursor(clientId);
    return cursor
      ? (this.scrollToPosition(cursor.cursorHead, alignment) || this.scrollToLine(cursor.cursorLine))
      : false;
  }

  applyTextReplacements(replacements) {
    if (!this.collaborationClient.initialSyncComplete) {
      throw new Error('The collaborative document is not synchronized');
    }
    return this.viewAdapter.applyTextReplacements(replacements);
  }

  toggleTaskListItem(lineNumber) {
    return this.collaborationClient.initialSyncComplete
      ? this.viewAdapter.toggleTaskListItem(lineNumber)
      : false;
  }

  isInitialSyncComplete() {
    return this.collaborationClient.initialSyncComplete;
  }

  destroy() {
    this.commentThreadStore.unbind();
    this.activeFilePath = '';
    this.bootstrapContent = null;
    this.pendingCollaborativeBindings = null;
    this.hasDeliveredContent = false;
    this.lastDeliveredContent = null;
    this.collaborationClient.destroy();
    this.viewAdapter.destroy();
  }

  resolveAwarenessCursor(cursor) {
    const { ydoc, ytext } = this.collaborationClient;
    const state = this.viewAdapter.getState();
    if (!cursor?.anchor || !cursor?.head || !ydoc || !state || !ytext) {
      return null;
    }

    const anchor = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, ydoc);
    const head = Y.createAbsolutePositionFromRelativePosition(cursor.head, ydoc);
    if (!anchor || !head || anchor.type !== ytext || head.type !== ytext) {
      return null;
    }

    return {
      cursorAnchor: anchor.index,
      cursorHead: head.index,
      cursorLine: state.doc.lineAt(head.index).number,
    };
  }

  applyMarkdownToolbarAction(...args) { return this.viewAdapter.applyMarkdownToolbarAction(...args); }
  applyTheme(...args) { return this.viewAdapter.applyTheme(...args); }
  flashExternalUpdate(...args) { return this.viewAdapter.flashRemoteRange(...args); }
  formatDocument(...args) { return this.viewAdapter.formatDocument(...args); }
  getCommentAnchorClientRect(...args) { return this.viewAdapter.getAnchorClientRect(...args); }
  getCurrentSelectionCommentAnchor(...args) { return this.viewAdapter.getCurrentSelectionCommentAnchor(...args); }
  getCurrentSelectionLineRange(...args) { return this.viewAdapter.getCurrentSelectionLineRange(...args); }
  getScrollContainer(...args) { return this.viewAdapter.getScrollContainer(...args); }
  getSelectionChipClientRect(...args) { return this.viewAdapter.getSelectionChipClientRect(...args); }
  getTopVisibleLineNumber(...args) { return this.viewAdapter.getTopVisibleLineNumber(...args); }
  insertText(...args) { return this.viewAdapter.insertText(...args); }
  isLineWrappingEnabled(...args) { return this.viewAdapter.isLineWrappingEnabled(...args); }
  isVimModeEnabled(...args) { return this.viewAdapter.isVimModeEnabled(...args); }
  replaceText(...args) { return this.viewAdapter.replaceText(...args); }
  requestMeasure(...args) { return this.viewAdapter.requestMeasure(...args); }
  revealSearchMatch(...args) { return this.viewAdapter.revealSearchMatch(...args); }
  runEditorCommand(...args) { return this.viewAdapter.runEditorCommand(...args); }
  scrollToLine(...args) { return this.viewAdapter.scrollToLine(...args); }
  scrollToPosition(...args) { return this.viewAdapter.scrollToPosition(...args); }
  setLineWrapping(...args) { return this.viewAdapter.setLineWrapping(...args); }
  setVimMode(...args) { return this.viewAdapter.setVimMode(...args); }

  createCommentThread(...args) { return this.commentThreadStore.createCommentThread(...args); }
  deleteCommentThread(...args) { return this.commentThreadStore.deleteCommentThread(...args); }
  getCommentThreads(...args) { return this.commentThreadStore.getCommentThreads(...args); }
  replyToCommentThread(...args) { return this.commentThreadStore.replyToCommentThread(...args); }
  toggleCommentReaction(...args) { return this.commentThreadStore.toggleCommentReaction(...args); }

  getLocalUser(...args) { return this.collaborationClient.getLocalUser(...args); }
  getUserViewport(...args) { return this.collaborationClient.getUserViewport(...args); }
  setUserName(...args) { return this.collaborationClient.setUserName(...args); }
  waitForInitialSync(...args) { return this.collaborationClient.waitForInitialSync(...args); }
}
