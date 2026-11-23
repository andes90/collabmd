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

  prepareDisconnect() {
    return this.collaborationClient.prepareDisconnect();
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
}

for (const [target, methods] of [
  ['viewAdapter', [
    'applyMarkdownToolbarAction', 'applyTheme', ['flashExternalUpdate', 'flashRemoteRange'],
    'formatDocument', ['getCommentAnchorClientRect', 'getAnchorClientRect'],
    'getCurrentSelectionCommentAnchor', 'getCurrentSelectionLineRange', 'getScrollContainer',
    'getSelectionChipClientRect', 'getTopVisibleLineNumber', 'insertText', 'isLineWrappingEnabled',
    'isVimModeEnabled', 'replaceText', 'requestMeasure', 'revealSearchMatch', 'runEditorCommand',
    'scrollToLine', 'scrollToPosition', 'setLineWrapping', 'setVimMode',
  ]],
  ['commentThreadStore', [
    'createCommentThread', 'deleteCommentThread', 'getCommentThreads',
    'replyToCommentThread', 'toggleCommentReaction',
  ]],
  ['collaborationClient', ['getLocalUser', 'getUserViewport', 'setUserName', 'waitForInitialSync']],
]) {
  for (const entry of methods) {
    const [method, targetMethod] = Array.isArray(entry) ? entry : [entry, entry];
    EditorSession.prototype[method] = function (...args) {
      return this[target][targetMethod](...args);
    };
  }
}
