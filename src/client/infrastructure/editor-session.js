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
      onDocChanged: () => {
        this.emitContentChange();
      },
      onImagePaste,
      onViewportChanged: (viewport) => {
        this.collaborationClient.setLocalViewport(viewport);
      },
      onSelectionChanged: () => {
        this.onSelectionChange?.(this.getCurrentSelectionCommentAnchor());
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

  getCurrentSelectionLineRange() {
    return this.viewAdapter.getCurrentSelectionLineRange();
  }

  getCurrentSelectionCommentAnchor() {
    return this.viewAdapter.getCurrentSelectionCommentAnchor();
  }

  getCommentAnchorClientRect(anchor) {
    return this.viewAdapter.getAnchorClientRect(anchor);
  }

  getSelectionChipClientRect(anchor) {
    return this.viewAdapter.getSelectionChipClientRect(anchor);
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

  toggleCommentReaction(threadId, messageId, emoji) {
    return this.commentThreadStore.toggleCommentReaction(threadId, messageId, emoji);
  }

  deleteCommentThread(threadId) {
    return this.commentThreadStore.deleteCommentThread(threadId);
  }

  isLineWrappingEnabled() {
    return this.viewAdapter.isLineWrappingEnabled();
  }

  isVimModeEnabled() {
    return this.viewAdapter.isVimModeEnabled();
  }

  setVimMode(enabled) {
    return this.viewAdapter.setVimMode(enabled);
  }

  setLineWrapping(enabled) {
    return this.viewAdapter.setLineWrapping(enabled);
  }

  scrollToLine(lineNumber, viewportRatio = 0) {
    return this.viewAdapter.scrollToLine(lineNumber, viewportRatio);
  }

  revealSearchMatch(match) {
    return this.viewAdapter.revealSearchMatch(match);
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

  formatDocument(filePath) {
    return this.viewAdapter.formatDocument(filePath);
  }

  runEditorCommand(commandId) {
    return this.viewAdapter.runEditorCommand(commandId);
  }

  applyMarkdownToolbarAction(action) {
    return this.viewAdapter.applyMarkdownToolbarAction(action);
  }

  insertText(text) {
    return this.viewAdapter.insertText(text);
  }

  applyTextReplacements(replacements) {
    if (!this.collaborationClient.initialSyncComplete) {
      throw new Error('The collaborative document is not synchronized');
    }
    return this.viewAdapter.applyTextReplacements(replacements);
  }

  replaceText(text) {
    return this.viewAdapter.replaceText(text);
  }

  toggleTaskListItem(lineNumber) {
    if (!this.collaborationClient.initialSyncComplete) {
      return false;
    }

    return this.viewAdapter.toggleTaskListItem(lineNumber);
  }

  flashExternalUpdate(range) {
    return this.viewAdapter.flashRemoteRange(range);
  }

  isInitialSyncComplete() {
    return this.collaborationClient.initialSyncComplete;
  }

  waitForInitialSync(timeoutMs = 1500) {
    return this.collaborationClient.waitForInitialSync(timeoutMs);
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
