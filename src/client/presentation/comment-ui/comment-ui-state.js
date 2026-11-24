import {
  COMMENT_SELECTION_REVEAL_DELAY_MS,
  areAnchorsEqual,
  getAnchorGroupKey,
  sortThreads,
  isTextSelectionAnchor,
} from './comment-ui-shared.js';

/**
 * @typedef {object} CommentSelectionAnchor
 * @property {'line' | 'text'} [anchorKind]
 * @property {'line' | 'text'} [kind]
 * @property {number} [startLine]
 * @property {number} [endLine]
 * @property {number} [startIndex]
 * @property {number} [endIndex]
 * @property {string} [quote]
 * @property {string} [anchorQuote]
 */

/**
 * @typedef {object} ReactionPickerState
 * @property {string} threadId
 * @property {string} messageId
 */

/**
 * @typedef {object} CommentUiStateContext
 * @property {boolean} supported
 * @property {boolean} drawerOpen
 * @property {boolean} pointerSelecting
 * @property {string | null} currentFile
 * @property {string} fileKind
 * @property {Array<any>} threads
 * @property {CommentSelectionAnchor | null} selectionAnchor
 * @property {CommentSelectionAnchor | null} pendingSelectionAnchor
 * @property {CommentSelectionAnchor | null} committedSelectionAnchor
 * @property {ReactionPickerState | null} reactionPicker
 * @property {number} selectionRevealTimer
 * @property {any} activeCard
 * @property {any} session
 * @property {(keys?: string[]) => void} updateHoveredEditorGroups
 * @property {(keys?: string[]) => void} updateHoveredPreviewGroups
 * @property {() => void} render
 * @property {() => void} renderToolbar
 * @property {() => void} scheduleLayoutRefresh
 * @property {() => void} clearSelectionRevealTimer
 * @property {(anchor: CommentSelectionAnchor) => void} scheduleSelectionReveal
 * @property {() => Array<{ key: string }>} getThreadGroups
 */

/** @this {CommentUiStateContext} */
function attachSession(session) {
  this.session?.getScrollContainer?.()?.removeEventListener('scroll', this.handleEditorScroll);
  this.session = session;
  this.selectionAnchor = session?.getCurrentSelectionCommentAnchor?.() ?? null;
  this.pendingSelectionAnchor = null;
  this.committedSelectionAnchor = null;
  this.previewSelection = null;
  this.reactionPicker = null;
  this.clearSelectionRevealTimer();
  this.pointerSelecting = false;
  session?.getScrollContainer?.()?.addEventListener('scroll', this.handleEditorScroll, { passive: true });
  this.render();
}

/** @this {CommentUiStateContext} */
function setCurrentFile(filePath, { fileKind = 'markdown', supported = false } = {}) {
  const didChangeFile = this.currentFile !== filePath;
  this.currentFile = filePath;
  this.fileKind = fileKind;
  this.supported = Boolean(filePath && supported);
  if (didChangeFile || !this.supported) {
    this.drawerOpen = false;
    this.threads = [];
    this.selectionAnchor = null;
    this.pendingSelectionAnchor = null;
    this.committedSelectionAnchor = null;
    this.clearSelectionRevealTimer();
    this.pointerSelecting = false;
    this.activeCard = null;
    this.updateHoveredEditorGroups([]);
    this.updateHoveredPreviewGroups([]);
    this.previewHoverRegions = [];
    this.lastPreviewPointerPosition = null;
    this.previewSelection = null;
    this.reactionPicker = null;
  }
  this.render();
}

/** @this {CommentUiStateContext} */
function setSelectionAnchor(anchor) {
  this.selectionAnchor = this.supported ? anchor : null;
  if (!this.supported || !this.selectionAnchor || !isTextSelectionAnchor(this.selectionAnchor)) {
    this.pendingSelectionAnchor = null;
    this.committedSelectionAnchor = null;
    this.clearSelectionRevealTimer();
    this.renderToolbar();
    this.scheduleLayoutRefresh();
    return;
  }

  this.pendingSelectionAnchor = this.selectionAnchor;
  if (this.activeCard?.mode === 'create') {
    this.clearSelectionRevealTimer();
    this.renderToolbar();
    this.scheduleLayoutRefresh();
    return;
  }

  if (this.pointerSelecting) {
    this.clearSelectionRevealTimer();
    this.committedSelectionAnchor = null;
    this.renderToolbar();
    this.scheduleLayoutRefresh();
    return;
  }

  if (areAnchorsEqual(this.committedSelectionAnchor, this.selectionAnchor)) {
    this.renderToolbar();
    this.scheduleLayoutRefresh();
    return;
  }

  this.scheduleSelectionReveal(this.selectionAnchor);
  this.renderToolbar();
  this.scheduleLayoutRefresh();
}

/** @this {CommentUiStateContext} */
function handleEditorContentChange() {
  if (this.activeCard?.mode === 'create') {
    return;
  }

  this.clearSelectionRevealTimer();
  this.pendingSelectionAnchor = null;
  this.committedSelectionAnchor = null;
  this.scheduleLayoutRefresh();
}

/** @this {CommentUiStateContext} */
function setThreads(threads = []) {
  this.threads = sortThreads(threads);
  const groups = this.getThreadGroups();
  if (
    this.activeCard?.mode === 'group'
  ) {
    const activeThreadIds = Array.isArray(this.activeCard.groupThreadIds)
      ? this.activeCard.groupThreadIds
      : [];
    const matchingGroup = groups.find((group) => group.key === this.activeCard.groupKey)
      ?? groups.find((group) => (
        group.threads.length === activeThreadIds.length
        && group.threads.every((thread) => activeThreadIds.includes(thread.id))
      ));
    if (!matchingGroup) {
      this.activeCard = null;
    } else {
      this.activeCard = {
        ...this.activeCard,
        anchor: matchingGroup.anchor,
        groupKey: matchingGroup.key,
        groupThreadIds: matchingGroup.threads.map((thread) => thread.id),
      };
      if (
        this.activeCard.replyThreadId
        && !matchingGroup.threads.some((thread) => thread.id === this.activeCard.replyThreadId)
      ) {
        this.activeCard.replyThreadId = null;
      }
    }
  }
  if (
    this.reactionPicker
    && !this.threads.some((thread) => (
      thread.id === this.reactionPicker.threadId
      && thread.messages?.some((message) => message.id === this.reactionPicker.messageId)
    ))
  ) {
    this.reactionPicker = null;
  }
  this.render();
}

/** @this {CommentUiStateContext} */
function setDrawerOpen(nextState) {
  const normalizedState = Boolean(nextState);
  if (normalizedState === this.drawerOpen) {
    return;
  }

  if (normalizedState) {
    this.onWillOpenDrawer?.();
  }

  this.drawerOpen = normalizedState;
  this.render();
}

/** @this {CommentUiStateContext} */
function closeDrawer() {
  this.setDrawerOpen(false);
}

/** @this {CommentUiStateContext} */
function openThreadFromOverview(threadId) {
  if (!threadId || !this.supported) {
    return false;
  }

  const group = this.getThreadGroups().find((candidate) => (
    candidate.threads.some((thread) => thread.id === threadId)
  ));
  if (!group) {
    return false;
  }

  this.onNavigateToLine?.(group.anchor?.startLine ?? 1);
  this.openThreadGroup(group, {
    anchor: group.anchor,
    origin: 'editor',
    sourceRect: this.session?.getCommentAnchorClientRect?.(group.anchor) ?? null,
  });
  return true;
}

/** @this {CommentUiStateContext} */
function getThreadGroups() {
  const groups = new Map();
  this.threads.forEach((thread) => {
    const key = getAnchorGroupKey(thread.anchor);
    const existing = groups.get(key);
    if (existing) {
      existing.threads.push(thread);
      return;
    }

    groups.set(key, {
      anchor: thread.anchor,
      key,
      threads: [thread],
    });
  });

  return Array.from(groups.values()).sort((left, right) => (
    (left.anchor?.startLine ?? 0) - (right.anchor?.startLine ?? 0)
  ));
}

/** @this {CommentUiStateContext} */
function clearSelectionRevealTimer() {
  if (!this.selectionRevealTimer) {
    return;
  }

  clearTimeout(this.selectionRevealTimer);
  this.selectionRevealTimer = 0;
}

/** @this {CommentUiStateContext} */
function scheduleSelectionReveal(anchor) {
  this.clearSelectionRevealTimer();
  this.selectionRevealTimer = window.setTimeout(() => {
    this.selectionRevealTimer = 0;
    if (
      this.pointerSelecting
      || this.activeCard?.mode === 'create'
      || !areAnchorsEqual(this.pendingSelectionAnchor, anchor)
    ) {
      return;
    }

    this.committedSelectionAnchor = anchor;
    this.scheduleLayoutRefresh();
  }, COMMENT_SELECTION_REVEAL_DELAY_MS);
}

export const commentUiStateMethods = {
  attachSession,
  clearSelectionRevealTimer,
  closeDrawer,
  getThreadGroups,
  handleEditorContentChange,
  openThreadFromOverview,
  scheduleSelectionReveal,
  setCurrentFile,
  setDrawerOpen,
  setSelectionAnchor,
  setThreads,
};
