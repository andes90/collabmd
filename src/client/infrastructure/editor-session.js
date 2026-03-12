import * as Y from 'yjs';

import { CommentThreadStore } from './comment-thread-store.js';
import { EditorCollaborationClient } from './editor-collaboration-client.js';
import { EditorViewAdapter } from './editor-view-adapter.js';

export class EditorSession {
  constructor({
    editorContainer,
    lineWrappingEnabled = true,
    initialTheme,
    lineInfoElement,
    onAwarenessChange,
    onConnectionChange,
    onCommentsChange,
    onContentChange,
    preferredUserName,
    localUser,
    getFileList,
  }) {
    this.onAwarenessChange = onAwarenessChange;
    this.onCommentsChange = onCommentsChange;
    this.onContentChange = onContentChange;
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
      onDocChanged: () => {
        this.emitContentChange();
      },
      onViewportChanged: (viewport) => {
        this.collaborationClient.setLocalViewport(viewport);
      },
    });
    this.commentThreadStore = new CommentThreadStore({
      getDoc: () => this.collaborationClient.ydoc,
      getEditorState: () => this.viewAdapter.getState(),
      getLocalUser: () => this.collaborationClient.getLocalUser(),
      onCommentsChange: (threads) => this.onCommentsChange?.(threads),
    });
  }

  async initialize(filePath) {
    this.hasDeliveredContent = false;
    this.lastDeliveredContent = null;
    const collaborationBindings = await this.collaborationClient.initialize(filePath);

    this.viewAdapter.initialize({
      awareness: collaborationBindings.awareness,
      filePath,
      undoManager: collaborationBindings.undoManager,
      ytext: collaborationBindings.ytext,
    });
    this.commentThreadStore.bind({
      commentThreads: collaborationBindings.commentThreads,
      ydoc: collaborationBindings.ydoc,
      ytext: collaborationBindings.ytext,
    });
    this.onAwarenessChange?.(this.collaborationClient.collectUsers((cursor) => this.resolveAwarenessCursor(cursor)));
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

  applyTheme(theme) {
    this.viewAdapter.applyTheme(theme);
  }

  getText() {
    return this.collaborationClient.getText() || this.viewAdapter.getText();
  }

  getScrollContainer() {
    return this.viewAdapter.getScrollContainer();
  }

  getTopVisibleLineNumber(viewportRatio = 0) {
    return this.viewAdapter.getTopVisibleLineNumber(viewportRatio);
  }

  getLocalUser() {
    return this.collaborationClient.getLocalUser();
  }

  get awareness() {
    return this.collaborationClient.awareness;
  }

  get provider() {
    return this.collaborationClient.provider;
  }

  get ydoc() {
    return this.collaborationClient.ydoc;
  }

  get ytext() {
    return this.collaborationClient.ytext;
  }

  getCurrentSelectionLineRange() {
    return this.viewAdapter.getCurrentSelectionLineRange();
  }

  getCommentThreads() {
    return this.commentThreadStore.getCommentThreads();
  }

  createCommentThread(payload) {
    return this.commentThreadStore.createCommentThread(payload);
  }

  replyToCommentThread(threadId, body) {
    return this.commentThreadStore.replyToCommentThread(threadId, body);
  }

  deleteCommentThread(threadId) {
    return this.commentThreadStore.deleteCommentThread(threadId);
  }

  isLineWrappingEnabled() {
    return this.viewAdapter.isLineWrappingEnabled();
  }

  setLineWrapping(enabled) {
    return this.viewAdapter.setLineWrapping(enabled);
  }

  scrollToLine(lineNumber, viewportRatio = 0) {
    return this.viewAdapter.scrollToLine(lineNumber, viewportRatio);
  }

  getUserCursor(clientId) {
    return this.collaborationClient.getUserCursor(
      clientId,
      (cursor) => this.resolveAwarenessCursor(cursor),
    );
  }

  getUserViewport(clientId) {
    return this.collaborationClient.getUserViewport(clientId);
  }

  scrollToPosition(position, alignment = 'center') {
    return this.viewAdapter.scrollToPosition(position, alignment);
  }

  scrollToUserViewport(clientId) {
    const viewport = this.getUserViewport(clientId);
    if (!viewport) {
      return false;
    }

    return this.scrollToLine(viewport.topLine, viewport.viewportRatio);
  }

  scrollToUserCursor(clientId, alignment = 'center') {
    const cursor = this.getUserCursor(clientId);
    if (!cursor) {
      return false;
    }

    return this.scrollToPosition(cursor.cursorHead, alignment)
      || this.scrollToLine(cursor.cursorLine);
  }

  setUserName(name) {
    return this.collaborationClient.setUserName(name);
  }

  requestMeasure() {
    this.viewAdapter.requestMeasure();
  }

  applyMarkdownToolbarAction(action) {
    return this.viewAdapter.applyMarkdownToolbarAction(action);
  }

  waitForInitialSync(timeoutMs = 1500) {
    return this.collaborationClient.waitForInitialSync(timeoutMs);
  }

  destroy() {
    this.commentThreadStore.unbind();
    this.hasDeliveredContent = false;
    this.lastDeliveredContent = null;
    this.collaborationClient.destroy();
    this.viewAdapter.destroy();
  }

  resolveAwarenessCursor(cursor) {
    const ydoc = this.collaborationClient.ydoc;
    const ytext = this.collaborationClient.ytext;
    const state = this.viewAdapter.getState();
    if (!cursor?.anchor || !cursor?.head || !ydoc || !state || !ytext) {
      return null;
    }

    const anchor = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, ydoc);
    const head = Y.createAbsolutePositionFromRelativePosition(cursor.head, ydoc);
    if (!anchor || !head || anchor.type !== ytext || head.type !== ytext) {
      return null;
    }

    const line = state.doc.lineAt(head.index);
    return {
      cursorAnchor: anchor.index,
      cursorHead: head.index,
      cursorLine: line.number,
    };
  }
}
