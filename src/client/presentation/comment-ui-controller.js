import {
  COMMENT_BODY_MAX_LENGTH,
  normalizeCommentQuoteForComparison,
} from '../../domain/comment-threads.js';
import { renderCommentMarkdownToHtml } from './comment-markdown-renderer.js';

const COMMENT_CARD_OFFSET = 14;
const COMMENT_CARD_WIDTH = 520;
const COMMENT_SELECTION_REVEAL_DELAY_MS = 150;
const COMMENT_SELECTION_CHIP_GAP = 12;
const COMMENT_CONTROL_SLOT_HEIGHT = 36;
const COMMENT_PREVIEW_RAIL_SLOT_HEIGHT = 30;
const COMMENT_PREVIEW_RAIL_MIN_WIDTH = 400;
const COMMENT_PREVIEW_RAIL_BREAKPOINT = 769;
const COMMENT_REACTION_PRESET_EMOJIS = Object.freeze(['👍', '❤️', '🎉', '👀', '🚀']);
const COMMENT_REACTION_MORE_EMOJIS = Object.freeze(['😂', '🔥', '✅', '🙏', '💡', '🤔', '👏', '😄', '🎯', '🙌']);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sortThreads(threads = []) {
  return [...threads].sort((left, right) => (
    (left.anchor?.startLine ?? 0) - (right.anchor?.startLine ?? 0)
      || left.createdAt - right.createdAt
  ));
}

function getAnchorKind(anchor) {
  return anchor?.anchorKind || anchor?.kind || 'line';
}

function isTextSelectionAnchor(anchor) {
  return getAnchorKind(anchor) === 'text'
    && Number.isFinite(anchor?.startIndex)
    && Number.isFinite(anchor?.endIndex)
    && anchor.endIndex > anchor.startIndex;
}

function areAnchorsEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return getAnchorKind(left) === getAnchorKind(right)
    && (left.startIndex ?? null) === (right.startIndex ?? null)
    && (left.endIndex ?? null) === (right.endIndex ?? null)
    && (left.startLine ?? null) === (right.startLine ?? null)
    && (left.endLine ?? null) === (right.endLine ?? null)
    && (left.anchorQuote ?? left.quote ?? '') === (right.anchorQuote ?? right.quote ?? '');
}

function formatAnchorLabel(anchor) {
  if (!anchor) {
    return 'No source anchor';
  }

  if ((anchor.kind || anchor.anchorKind) === 'text' && anchor.quote) {
    return anchor.startLine === anchor.endLine
      ? `Line ${anchor.startLine}`
      : `Lines ${anchor.startLine}-${anchor.endLine}`;
  }

  return anchor.startLine === anchor.endLine
    ? `Line ${anchor.startLine}`
    : `Lines ${anchor.startLine}-${anchor.endLine}`;
}

function getAnchorGroupKey(anchor = {}) {
  return [
    anchor.kind || anchor.anchorKind || 'line',
    anchor.startLine ?? 0,
    anchor.endLine ?? 0,
    anchor.quote || '',
  ].join('::');
}

function isLeafSourceBlock(element) {
  return element && !element.querySelector('[data-source-line]');
}

function parseLineNumber(value) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getLatestMessage(messages = []) {
  return messages.reduce((latest, message) => {
    if (!latest) {
      return message;
    }

    return (message?.createdAt ?? 0) >= (latest?.createdAt ?? 0)
      ? message
      : latest;
  }, null);
}

function getLatestGroupMessage(group) {
  return group?.threads?.reduce((latest, thread) => {
    const next = getLatestMessage(thread?.messages ?? []);
    if (!next) {
      return latest;
    }

    return (next.createdAt ?? 0) >= (latest?.createdAt ?? 0)
      ? next
      : latest;
  }, null);
}

function createRenderedCommentBody(body, className = 'comment-markdown') {
  const container = document.createElement('div');
  container.className = className;
  container.innerHTML = renderCommentMarkdownToHtml(body);
  return container;
}

function hasLocalReaction(reaction, localUserId) {
  return Boolean(localUserId && reaction?.users?.some((user) => user?.userId === localUserId));
}

function formatReactionCount(reaction) {
  return String(Array.isArray(reaction?.users) ? reaction.users.length : 0);
}

function isReactionPickerOpen(reactionPicker, threadId, messageId) {
  return reactionPicker?.threadId === threadId && reactionPicker?.messageId === messageId;
}

function getReactionPickerBounds(card) {
  const picker = card?.querySelector?.('.comment-reaction-picker');
  const wrap = picker?.closest?.('.comment-reaction-picker-wrap');
  const scroll = card?.querySelector?.('.comment-card-scroll');
  if (!(picker instanceof HTMLElement) || !(wrap instanceof HTMLElement) || !(scroll instanceof HTMLElement)) {
    return null;
  }

  return { picker, scroll, wrap };
}

function overlapsAnchorRange(element, anchor) {
  const startLine = parseLineNumber(element?.getAttribute?.('data-source-line'));
  const endLine = parseLineNumber(element?.getAttribute?.('data-source-line-end')) ?? startLine;
  if (!startLine || !endLine || !anchor) {
    return false;
  }

  return anchor.startLine <= endLine && anchor.endLine >= startLine;
}

function createNormalizedTextIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let normalized = '';
  const map = [];
  let lastWasWhitespace = true;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent || '';
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const isWhitespace = /\s/.test(char);
      if (isWhitespace) {
        if (lastWasWhitespace) {
          continue;
        }

        normalized += ' ';
        map.push({ node, offset: index });
        lastWasWhitespace = true;
        continue;
      }

      normalized += char;
      map.push({ node, offset: index });
      lastWasWhitespace = false;
    }
  }

  while (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }

  return { map, normalized };
}

function findUniqueQuoteRange(root, quote) {
  const normalizedQuote = normalizeCommentQuoteForComparison(quote);
  if (!root || !normalizedQuote) {
    return null;
  }

  const index = createNormalizedTextIndex(root);
  if (!index.normalized) {
    return null;
  }

  const matchIndex = index.normalized.indexOf(normalizedQuote);
  if (matchIndex < 0) {
    return null;
  }
  if (index.normalized.indexOf(normalizedQuote, matchIndex + 1) >= 0) {
    return null;
  }

  const start = index.map[matchIndex];
  const end = index.map[matchIndex + normalizedQuote.length - 1];
  if (!start || !end) {
    return null;
  }

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function toRelativeRect(rect, containerRect) {
  return {
    bottom: rect.bottom - containerRect.top,
    height: rect.height,
    left: rect.left - containerRect.left,
    right: rect.right - containerRect.left,
    top: rect.top - containerRect.top,
    width: rect.width,
  };
}

function createRectFromRects(rects = []) {
  if (!Array.isArray(rects) || rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function pointIntersectsRect(x, y, rect) {
  if (!rect) {
    return false;
  }

  return x >= rect.left
    && x <= rect.right
    && y >= rect.top
    && y <= rect.bottom;
}

function normalizeGroupKeys(keys = []) {
  return [...new Set(keys.filter(Boolean))].sort();
}

function serializeGroupKeys(keys = []) {
  return normalizeGroupKeys(keys).join(' ');
}

function createCommentMarkerContent(count) {
  const fragment = document.createDocumentFragment();

  const icon = document.createElement('span');
  icon.className = 'comment-marker-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4.75A1.75 1.75 0 0 1 4.75 3h6.5A1.75 1.75 0 0 1 13 4.75v4.5A1.75 1.75 0 0 1 11.25 11H8.9L6.5 13v-2H4.75A1.75 1.75 0 0 1 3 9.25v-4.5Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
    </svg>
  `;
  fragment.appendChild(icon);

  if (count > 1) {
    const countBadge = document.createElement('span');
    countBadge.className = 'comment-marker-count';
    countBadge.textContent = String(count);
    fragment.appendChild(countBadge);
  }

  return fragment;
}

export class CommentUiController {
  constructor({
    commentSelectionButton,
    commentsDrawer,
    commentsDrawerEmpty,
    commentsDrawerList,
    commentsToggleButton,
    editorContainer,
    onWillOpenDrawer,
    onCreateThread,
    onNavigateToLine,
    onReplyToThread,
    onToggleReaction,
    onResolveThread,
    previewContainer,
    previewElement,
  }) {
    this.commentSelectionButton = commentSelectionButton;
    this.commentsDrawer = commentsDrawer;
    this.commentsDrawerEmpty = commentsDrawerEmpty;
    this.commentsDrawerList = commentsDrawerList;
    this.commentsToggleButton = commentsToggleButton;
    this.editorContainer = editorContainer;
    this.onWillOpenDrawer = onWillOpenDrawer;
    this.onCreateThread = onCreateThread;
    this.onNavigateToLine = onNavigateToLine;
    this.onReplyToThread = onReplyToThread;
    this.onToggleReaction = onToggleReaction;
    this.onResolveThread = onResolveThread;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;

    this.currentFile = null;
    this.fileKind = 'markdown';
    this.supported = false;
    this.drawerOpen = false;
    this.threads = [];
    this.selectionAnchor = null;
    this.pendingSelectionAnchor = null;
    this.committedSelectionAnchor = null;
    this.selectionRevealTimer = 0;
    this.pointerSelecting = false;
    this.session = null;
    this.activeCard = null;
    this.hoveredEditorGroupKeys = [];
    this.hoveredEditorGroupKeysSignature = '';
    this.hoveredPreviewGroupKeys = [];
    this.hoveredPreviewGroupKeysSignature = '';
    this.previewHoverRegions = [];
    this.lastPreviewPointerPosition = null;
    this.editorLayer = null;
    this.previewLayer = null;
    this.previewHighlightLayer = null;
    this.cardRoot = null;
    this.pendingCardFocusElement = null;
    this.reactionPicker = null;
    this.layoutFrame = 0;
    this.timeFormatter = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
    });
    this.handleEditorScroll = () => this.scheduleLayoutRefresh();
    this.handlePreviewScroll = () => this.scheduleLayoutRefresh();
    this.handleWindowResize = () => this.scheduleLayoutRefresh();
    this.handlePreviewPointerMove = (event) => {
      this.lastPreviewPointerPosition = { x: event.clientX, y: event.clientY };
      this.updateHoveredPreviewGroups(this.getPreviewGroupKeysAtPoint(event.clientX, event.clientY));
    };
    this.handlePreviewPointerLeave = () => {
      this.lastPreviewPointerPosition = null;
      this.updateHoveredPreviewGroups([]);
    };
    this.handlePreviewFocusIn = (event) => {
      this.updateHoveredPreviewGroups(this.getPreviewGroupKeysForTarget(event.target));
    };
    this.handlePreviewFocusOut = (event) => {
      this.updateHoveredPreviewGroups(this.getPreviewGroupKeysForTarget(event.relatedTarget));
    };
    this.handleCommentSelectionButtonPointerDown = (event) => {
      event.preventDefault();
    };
    this.handleEditorPointerDown = (event) => {
      if (event.button !== 0 || !this.supported || !this.session) {
        return;
      }
      if (!event.target?.closest?.('.cm-editor') || event.target?.closest?.('.comment-editor-layer')) {
        return;
      }

      this.pointerSelecting = true;
      this.clearSelectionRevealTimer();
      if (this.committedSelectionAnchor) {
        this.committedSelectionAnchor = null;
        this.scheduleLayoutRefresh();
      }
    };
    this.handleDocumentPointerUp = () => {
      if (!this.pointerSelecting) {
        return;
      }

      requestAnimationFrame(() => {
        const anchor = this.supported ? (this.session?.getCurrentSelectionCommentAnchor?.() ?? null) : null;
        this.pointerSelecting = false;
        this.selectionAnchor = anchor;
        this.renderToolbar();
        this.pendingSelectionAnchor = isTextSelectionAnchor(anchor) ? anchor : null;
        this.clearSelectionRevealTimer();
        this.committedSelectionAnchor = (
          isTextSelectionAnchor(anchor) && this.activeCard?.mode !== 'create'
        ) ? anchor : null;
        this.scheduleLayoutRefresh();
      });
    };
    this.handleEditorFocusOut = (event) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node
        && (
          this.editorContainer?.contains(nextTarget)
          || this.cardRoot?.contains(nextTarget)
          || this.commentSelectionButton?.contains(nextTarget)
        )
      ) {
        return;
      }

      this.clearSelectionRevealTimer();
      this.pendingSelectionAnchor = null;
      this.committedSelectionAnchor = null;
      this.scheduleLayoutRefresh();
    };
    this.handleDocumentPointerDown = (event) => {
      const target = event.target;

      if (this.activeCard && this.cardRoot) {
        if (this.cardRoot.contains(target)) {
          return;
        }
        this.closeCard();
      }

      if (!this.drawerOpen) {
        return;
      }

      if (
        target instanceof Node
        && (
          this.commentsDrawer?.contains(target)
          || this.commentsToggleButton?.contains(target)
        )
      ) {
        return;
      }

      this.closeDrawer();
    };
    this.handleDocumentKeyDown = (event) => {
      if (event.key === 'Escape' && this.reactionPicker) {
        this.reactionPicker = null;
        this.renderCard();
        return;
      }
      if (event.key === 'Escape' && this.activeCard) {
        this.closeCard();
      }
      if (event.key === 'Escape' && this.committedSelectionAnchor) {
        this.clearSelectionRevealTimer();
        this.pendingSelectionAnchor = null;
        this.committedSelectionAnchor = null;
        this.scheduleLayoutRefresh();
      }
    };

    this.commentSelectionButton?.addEventListener('pointerdown', this.handleCommentSelectionButtonPointerDown);
    this.commentSelectionButton?.addEventListener('click', () => {
      this.openComposerForSelection('toolbar');
    });
    this.commentsToggleButton?.addEventListener('click', () => {
      this.setDrawerOpen(!this.drawerOpen);
    });
    this.previewContainer?.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
    this.previewElement?.addEventListener('pointermove', this.handlePreviewPointerMove, { passive: true });
    this.previewElement?.addEventListener('pointerleave', this.handlePreviewPointerLeave);
    this.previewElement?.addEventListener('focusin', this.handlePreviewFocusIn);
    this.previewElement?.addEventListener('focusout', this.handlePreviewFocusOut);
    this.editorContainer?.addEventListener('pointerdown', this.handleEditorPointerDown);
    this.editorContainer?.addEventListener('focusout', this.handleEditorFocusOut);
    window.addEventListener('resize', this.handleWindowResize);
    document.addEventListener('pointerup', this.handleDocumentPointerUp);
    document.addEventListener('pointercancel', this.handleDocumentPointerUp);
    document.addEventListener('pointerdown', this.handleDocumentPointerDown);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
  }

  destroy() {
    if (this.layoutFrame) {
      cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = 0;
    }
    this.attachSession(null);
    this.previewContainer?.removeEventListener('scroll', this.handlePreviewScroll);
    this.previewElement?.removeEventListener('pointermove', this.handlePreviewPointerMove);
    this.previewElement?.removeEventListener('pointerleave', this.handlePreviewPointerLeave);
    this.previewElement?.removeEventListener('focusin', this.handlePreviewFocusIn);
    this.previewElement?.removeEventListener('focusout', this.handlePreviewFocusOut);
    this.commentSelectionButton?.removeEventListener('pointerdown', this.handleCommentSelectionButtonPointerDown);
    this.editorContainer?.removeEventListener('pointerdown', this.handleEditorPointerDown);
    this.editorContainer?.removeEventListener('focusout', this.handleEditorFocusOut);
    window.removeEventListener('resize', this.handleWindowResize);
    document.removeEventListener('pointerup', this.handleDocumentPointerUp);
    document.removeEventListener('pointercancel', this.handleDocumentPointerUp);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    this.previewHoverRegions = [];
    this.cardRoot?.remove();
    this.editorLayer?.remove();
    this.previewLayer?.remove();
    this.pendingCardFocusElement = null;
  }

  attachSession(session) {
    this.session?.getScrollContainer?.()?.removeEventListener('scroll', this.handleEditorScroll);
    this.session = session;
    this.selectionAnchor = session?.getCurrentSelectionCommentAnchor?.() ?? null;
    this.pendingSelectionAnchor = null;
    this.committedSelectionAnchor = null;
    this.reactionPicker = null;
    this.clearSelectionRevealTimer();
    this.pointerSelecting = false;
    session?.getScrollContainer?.()?.addEventListener('scroll', this.handleEditorScroll, { passive: true });
    this.render();
  }

  setCurrentFile(filePath, { fileKind = 'markdown', supported = false } = {}) {
    const didChangeFile = this.currentFile !== filePath;
    this.currentFile = filePath;
    this.fileKind = fileKind;
    this.supported = Boolean(filePath && supported);
    if (didChangeFile) {
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
      this.reactionPicker = null;
    }
    if (!this.supported) {
      this.drawerOpen = false;
      this.activeCard = null;
      this.threads = [];
      this.selectionAnchor = null;
      this.pendingSelectionAnchor = null;
      this.committedSelectionAnchor = null;
      this.clearSelectionRevealTimer();
      this.pointerSelecting = false;
      this.updateHoveredEditorGroups([]);
      this.updateHoveredPreviewGroups([]);
      this.previewHoverRegions = [];
      this.lastPreviewPointerPosition = null;
      this.reactionPicker = null;
    }
    this.render();
  }

  setSelectionAnchor(anchor) {
    this.selectionAnchor = this.supported ? anchor : null;
    if (!this.supported || !this.selectionAnchor) {
      this.pendingSelectionAnchor = null;
      this.committedSelectionAnchor = null;
      this.clearSelectionRevealTimer();
      this.renderToolbar();
      this.scheduleLayoutRefresh();
      return;
    }

    if (!isTextSelectionAnchor(this.selectionAnchor)) {
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

  handleEditorContentChange() {
    if (this.activeCard?.mode === 'create') {
      return;
    }

    this.clearSelectionRevealTimer();
    this.pendingSelectionAnchor = null;
    this.committedSelectionAnchor = null;
    this.scheduleLayoutRefresh();
  }

  setThreads(threads = []) {
    this.threads = sortThreads(threads);
    if (
      this.activeCard?.mode === 'group'
      && !this.getThreadGroups().some((group) => group.key === this.activeCard.groupKey)
    ) {
      this.activeCard = null;
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

  setDrawerOpen(nextState) {
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

  closeDrawer() {
    this.setDrawerOpen(false);
  }

  refreshLayout() {
    this.renderEditorLayer();
    this.renderPreviewLayer();
    this.repositionActiveCard();
  }

  scheduleLayoutRefresh() {
    if (this.layoutFrame) {
      return;
    }

    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0;
      this.refreshLayout();
    });
  }

  render() {
    this.renderToolbar();
    this.renderDrawer();
    this.renderCard();
    this.scheduleLayoutRefresh();
  }

  renderToolbar() {
    const totalCount = this.threads.length;
    const showControls = this.supported && Boolean(this.session);
    this.commentSelectionButton?.classList.toggle('hidden', !showControls);
    this.commentsToggleButton?.classList.toggle('hidden', !this.supported);
    if (this.commentSelectionButton) {
      this.commentSelectionButton.disabled = !this.selectionAnchor;
    }
    if (this.commentsToggleButton) {
      this.commentsToggleButton.classList.toggle('active', this.drawerOpen);
      this.commentsToggleButton.setAttribute('aria-expanded', String(this.drawerOpen));
      const label = totalCount > 0 ? `Comments ${totalCount}` : 'Comments';
      const labelElement = this.commentsToggleButton.querySelector('.ui-action-label');
      if (labelElement) {
        labelElement.textContent = label;
      } else {
        this.commentsToggleButton.textContent = label;
      }
    }
  }

  renderDrawer() {
    if (!this.commentsDrawer || !this.commentsDrawerList) {
      return;
    }

    this.commentsDrawer.classList.toggle('hidden', !this.supported || !this.drawerOpen);
    this.commentsDrawerList.replaceChildren();
    const groups = this.getThreadGroups();
    this.commentsDrawerEmpty?.classList.toggle('hidden', groups.length > 0);
    if (!this.supported || groups.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    groups.forEach((group) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui-record-surface comments-drawer-item';
      button.classList.toggle('is-active', this.activeCard?.groupKey === group.key);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
      });
      button.addEventListener('click', () => {
        this.openThreadGroup(group, {
          anchor: group.anchor,
          origin: 'drawer',
          sourceRect: button.getBoundingClientRect(),
        });
      });

      const header = document.createElement('div');
      header.className = 'ui-record-header comments-drawer-item-header';

      const title = document.createElement('span');
      title.className = 'comments-drawer-item-title';
      title.textContent = formatAnchorLabel(group.anchor);

      const count = document.createElement('span');
      count.className = 'ui-pill-badge ui-pill-badge--count ui-pill-badge--accent comments-drawer-item-count';
      count.textContent = String(group.threads.length);

      header.append(title, count);

      const quote = document.createElement('p');
      quote.className = 'comments-drawer-item-quote';
      quote.textContent = group.anchor.quote || group.anchor.excerpt || 'Source anchored comment';

      const latestMessage = getLatestGroupMessage(group);
      const preview = createRenderedCommentBody(
        latestMessage?.body || '',
        'comment-markdown comments-drawer-item-preview',
      );

      const footer = document.createElement('div');
      footer.className = 'ui-record-meta comments-drawer-item-footer';
      const countLabel = document.createElement('span');
      countLabel.textContent = `${group.threads.length} thread${group.threads.length === 1 ? '' : 's'}`;

      const updatedLabel = document.createElement('span');
      updatedLabel.className = 'comments-drawer-item-updated';
      updatedLabel.textContent = latestMessage
        ? `${latestMessage.userName} • ${this.formatTimestamp(latestMessage.createdAt)}`
        : '';

      footer.append(countLabel, updatedLabel);

      button.append(header, quote, preview, footer);
      fragment.appendChild(button);
    });

    this.commentsDrawerList.appendChild(fragment);
  }

  ensureEditorLayer() {
    if (this.editorLayer?.isConnected && this.editorLayer.parentElement === this.editorContainer) {
      return this.editorLayer;
    }

    const layer = document.createElement('div');
    layer.className = 'comment-editor-layer';
    this.editorContainer?.appendChild(layer);
    this.editorLayer = layer;
    return layer;
  }

  renderEditorLayer() {
    const layer = this.ensureEditorLayer();
    layer.replaceChildren();

    if (!this.supported || !this.session) {
      return;
    }

    const containerRect = this.editorContainer?.getBoundingClientRect?.();
    if (!containerRect) {
      return;
    }

    const groups = this.getThreadGroups();
    const occupiedTops = [];
    groups.forEach((group) => {
      const rect = this.session.getCommentAnchorClientRect?.(group.anchor);
      if (!rect) {
        return;
      }

      const relativeRect = toRelativeRect(rect, containerRect);
      if (relativeRect.bottom < 0 || relativeRect.top > containerRect.height) {
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui-state-marker ui-state-marker--comment comment-editor-badge';
      button.dataset.count = String(group.threads.length);
      const isActive = this.activeCard?.groupKey === group.key;
      const isHovered = this.hoveredEditorGroupKeys.includes(group.key);
      button.classList.toggle('is-active', isActive);
      button.classList.toggle('is-hovered', isHovered);
      button.classList.toggle('is-passive', !isActive && !isHovered);
      button.setAttribute('aria-label', `${group.threads.length} comment thread${group.threads.length === 1 ? '' : 's'}`);
      button.appendChild(createCommentMarkerContent(group.threads.length));
      const top = Math.max(relativeRect.top, 8);
      button.style.top = `${top}px`;
      button.style.left = `${Math.max(containerRect.width - 36, 8)}px`;
      button.title = `${group.threads.length} comment${group.threads.length === 1 ? '' : 's'}`;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
      });
      button.addEventListener('pointerenter', () => {
        this.updateHoveredEditorGroups([group.key]);
      });
      button.addEventListener('pointerleave', () => {
        this.updateHoveredEditorGroups([]);
      });
      button.addEventListener('focusin', () => {
        this.updateHoveredEditorGroups([group.key]);
      });
      button.addEventListener('focusout', () => {
        this.updateHoveredEditorGroups([]);
      });
      button.addEventListener('click', () => {
        this.openThreadGroup(group, {
          anchor: group.anchor,
          origin: 'editor',
          sourceRect: rect,
        });
      });
      layer.appendChild(button);
      occupiedTops.push(top);
    });

    if (!this.committedSelectionAnchor || this.activeCard?.mode === 'create') {
      return;
    }

    const rect = this.session.getCommentAnchorClientRect?.(this.committedSelectionAnchor);
    const chipRect = this.session.getSelectionChipClientRect?.(this.committedSelectionAnchor) ?? rect;
    if (!chipRect) {
      return;
    }

    const relativeRect = toRelativeRect(chipRect, containerRect);
    if (relativeRect.bottom < 0 || relativeRect.top > containerRect.height) {
      return;
    }

    let chipTop = clamp(relativeRect.top, 8, Math.max(containerRect.height - COMMENT_CONTROL_SLOT_HEIGHT, 8));
    while (occupiedTops.some((top) => Math.abs(top - chipTop) < (COMMENT_CONTROL_SLOT_HEIGHT - 4))) {
      chipTop = clamp(
        chipTop + COMMENT_CONTROL_SLOT_HEIGHT,
        8,
        Math.max(containerRect.height - COMMENT_CONTROL_SLOT_HEIGHT, 8),
      );
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-selection-pill ui-selection-pill--comment comment-selection-chip';
    button.textContent = 'Comment';
    button.style.top = `${chipTop}px`;
    button.style.right = `${COMMENT_SELECTION_CHIP_GAP}px`;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openComposerForSelection('editor', button.getBoundingClientRect());
    });
    layer.appendChild(button);
  }

  ensurePreviewLayer() {
    if (this.previewLayer?.isConnected && this.previewLayer.parentElement === this.previewElement) {
      return this.previewLayer;
    }

    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'comment-preview-highlights';
    const markerLayer = document.createElement('div');
    markerLayer.className = 'comment-preview-layer';
    this.previewElement?.append(highlightLayer, markerLayer);
    this.previewHighlightLayer = highlightLayer;
    this.previewLayer = markerLayer;
    return markerLayer;
  }

  renderPreviewLayer() {
    this.ensurePreviewLayer();
    this.previewLayer?.replaceChildren();
    this.previewHighlightLayer?.replaceChildren();

    if (!this.supported || !this.previewElement) {
      this.previewHoverRegions = [];
      return;
    }

    const previewRect = this.previewElement.getBoundingClientRect();
    const groups = this.getThreadGroups();
    const occupiedTops = [];
    const hoverRegions = [];
    const showPassiveMarkers = this.shouldRenderPassivePreviewMarkers();
    groups.forEach((group) => {
      const target = this.resolvePreviewTarget(group.anchor);
      if (!target?.bubbleRect) {
        return;
      }

      hoverRegions.push({
        key: group.key,
        rects: target.hoverRects?.length > 0 ? target.hoverRects : [target.bubbleRect],
      });

      const isActive = this.activeCard?.groupKey === group.key;
      const isHovered = this.hoveredPreviewGroupKeys.includes(group.key);
      const isEmphasized = isActive || isHovered;

      target.highlightRects?.forEach((rect) => {
        const highlight = document.createElement('div');
        highlight.className = 'comment-preview-highlight';
        highlight.classList.toggle('is-active', isActive);
        highlight.classList.toggle('is-hovered', isHovered);
        highlight.classList.toggle('is-passive', !isEmphasized);
        highlight.style.left = `${rect.left - previewRect.left}px`;
        highlight.style.top = `${rect.top - previewRect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        this.previewHighlightLayer?.appendChild(highlight);
      });

      if (!showPassiveMarkers && !isEmphasized) {
        return;
      }

      const bubble = document.createElement('button');
      bubble.type = 'button';
      bubble.className = 'ui-state-marker ui-state-marker--comment comment-preview-badge';
      bubble.dataset.commentPreviewGroupKeys = group.key;
      bubble.classList.toggle('is-active', isActive);
      bubble.classList.toggle('is-hovered', isHovered);
      bubble.classList.toggle('is-passive', !isEmphasized);
      bubble.setAttribute('aria-label', `${group.threads.length} comment thread${group.threads.length === 1 ? '' : 's'}`);
      bubble.appendChild(createCommentMarkerContent(group.threads.length));
      let bubbleTop = clamp(
        target.bubbleRect.top - previewRect.top,
        6,
        Math.max(this.previewElement.clientHeight - COMMENT_PREVIEW_RAIL_SLOT_HEIGHT, 6),
      );
      while (occupiedTops.some((top) => Math.abs(top - bubbleTop) < (COMMENT_PREVIEW_RAIL_SLOT_HEIGHT - 4))) {
        bubbleTop = clamp(
          bubbleTop + COMMENT_PREVIEW_RAIL_SLOT_HEIGHT,
          6,
          Math.max(this.previewElement.clientHeight - COMMENT_PREVIEW_RAIL_SLOT_HEIGHT, 6),
        );
      }
      bubble.style.top = `${bubbleTop}px`;
      bubble.title = `${group.threads.length} comment${group.threads.length === 1 ? '' : 's'}`;
      bubble.addEventListener('pointerdown', (event) => {
        event.preventDefault();
      });
      bubble.addEventListener('click', () => {
        this.openThreadGroup(group, {
          anchor: group.anchor,
          origin: 'preview',
          sourceRect: bubble.getBoundingClientRect(),
        });
      });
      this.previewLayer?.appendChild(bubble);
      occupiedTops.push(bubbleTop);
    });

    this.previewHoverRegions = hoverRegions;
    if (this.lastPreviewPointerPosition) {
      this.updateHoveredPreviewGroups(
        this.getPreviewGroupKeysAtPoint(this.lastPreviewPointerPosition.x, this.lastPreviewPointerPosition.y),
      );
    }
  }

  resolvePreviewTarget(anchor) {
    if (!this.previewElement || !anchor) {
      return null;
    }

    const diagramShell = Array.from(this.previewElement.querySelectorAll('.mermaid-shell, .plantuml-shell'))
      .find((element) => overlapsAnchorRange(element, anchor));
    if (diagramShell) {
      return {
        bubbleRect: diagramShell.getBoundingClientRect(),
        highlightRects: [],
        hoverRects: [diagramShell.getBoundingClientRect()],
      };
    }

    const candidates = Array.from(this.previewElement.querySelectorAll('[data-source-line]'))
      .filter((element) => isLeafSourceBlock(element) && overlapsAnchorRange(element, anchor));

    if (anchor.kind === 'text' && anchor.quote) {
      const matches = candidates
        .map((element) => ({ element, range: findUniqueQuoteRange(element, anchor.quote) }))
        .filter((candidate) => candidate.range);
      if (matches.length === 1) {
        const rects = Array.from(matches[0].range.getClientRects());
        const bubbleRect = createRectFromRects(rects) || matches[0].element.getBoundingClientRect();
        return {
          bubbleRect,
          highlightRects: rects,
          hoverRects: rects,
        };
      }
    }

    const fallback = candidates[0];
    if (!fallback) {
      return null;
    }

    return {
      bubbleRect: fallback.getBoundingClientRect(),
      highlightRects: [],
      hoverRects: [fallback.getBoundingClientRect()],
    };
  }

  ensureCardRoot() {
    if (this.cardRoot?.isConnected && this.cardRoot.parentElement === document.body) {
      return this.cardRoot;
    }

    const root = document.createElement('div');
    root.className = 'comment-card-root hidden';
    document.body.appendChild(root);
    this.cardRoot = root;
    return root;
  }

  openComposerForSelection(origin = 'editor', sourceRect = null) {
    const anchor = this.session?.getCurrentSelectionCommentAnchor?.();
    if (!anchor) {
      return;
    }

    this.selectionAnchor = anchor;
    this.reactionPicker = null;
    const nextOrigin = origin === 'editor' && sourceRect ? 'editor-chip' : origin;
    const nextSourceRect = sourceRect ?? (origin === 'toolbar'
      ? this.commentSelectionButton?.getBoundingClientRect?.()
      : this.session?.getCommentAnchorClientRect?.(anchor));
    this.activeCard = {
      anchor,
      mode: 'create',
      origin: nextOrigin,
      replyThreadId: null,
      sourceRect: nextSourceRect,
    };
    this.render();
  }

  openThreadGroup(group, { anchor, origin, sourceRect }) {
    this.reactionPicker = null;
    this.activeCard = {
      anchor,
      groupKey: group.key,
      mode: 'group',
      origin,
      replyThreadId: null,
      sourceRect,
    };
    this.renderDrawer();
    this.renderCard();
  }

  closeCard() {
    this.activeCard = null;
    this.pendingCardFocusElement = null;
    this.reactionPicker = null;
    this.renderCard();
    this.scheduleLayoutRefresh();
  }

  getThreadGroups() {
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

  updateCardSourceRect() {
    if (!this.activeCard) {
      return null;
    }

    if (this.activeCard.origin === 'editor') {
      return this.session?.getCommentAnchorClientRect?.(this.activeCard.anchor) ?? this.activeCard.sourceRect;
    }
    if (this.activeCard.origin === 'editor-chip') {
      return this.activeCard.sourceRect;
    }
    if (this.activeCard.origin === 'preview') {
      return this.resolvePreviewTarget(this.activeCard.anchor)?.bubbleRect ?? this.activeCard.sourceRect;
    }
    if (this.activeCard.origin === 'toolbar') {
      return this.commentSelectionButton?.getBoundingClientRect?.() ?? this.activeCard.sourceRect;
    }

    return this.activeCard.sourceRect;
  }

  renderCard() {
    const root = this.ensureCardRoot();
    root.replaceChildren();
    root.classList.toggle('hidden', !this.activeCard);
    if (!this.activeCard) {
      this.pendingCardFocusElement = null;
      root.style.visibility = '';
      return;
    }

    this.pendingCardFocusElement = null;

    const card = document.createElement('section');
    card.className = 'comment-card';
    card.addEventListener('click', (event) => {
      if (
        !this.reactionPicker
        || event.target?.closest?.('.comment-reaction-picker-wrap')
      ) {
        return;
      }

      this.reactionPicker = null;
      requestAnimationFrame(() => {
        if (this.activeCard) {
          this.renderCard();
        }
      });
    });

    const header = document.createElement('div');
    header.className = 'ui-record-header comment-card-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'comment-card-title-wrap';

    const title = document.createElement('h3');
    title.className = 'comment-card-title';
    title.textContent = this.activeCard.mode === 'create' ? 'New comment' : 'Comment threads';

    const meta = document.createElement('p');
    meta.className = 'comment-card-meta';
    meta.textContent = formatAnchorLabel(this.activeCard.anchor);

    titleWrap.append(title, meta);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ui-button ui-button--compact btn btn-ghost ui-pill-button ui-action-pill comment-card-close';
    closeButton.setAttribute('aria-label', 'Close comments');
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => this.closeCard());

    header.append(titleWrap, closeButton);
    card.appendChild(header);

    const content = document.createElement('div');
    content.className = 'comment-card-scroll';

    if (this.activeCard.anchor?.quote) {
      const quote = document.createElement('p');
      quote.className = 'comment-card-quote';
      quote.textContent = this.activeCard.anchor.quote;
      content.appendChild(quote);
    }

    if (this.activeCard.mode === 'create') {
      content.appendChild(this.createComposer());
    } else {
      const group = this.getThreadGroups().find((entry) => entry.key === this.activeCard.groupKey);
      if (!group) {
        this.closeCard();
        return;
      }

      group.threads.forEach((thread) => {
        content.appendChild(this.createThreadElement(thread));
      });
    }

    root.style.visibility = 'hidden';
    card.appendChild(content);
    root.appendChild(card);
    this.updateReactionPickerPosition(card);
    this.positionCard(card);
    root.style.visibility = '';
    this.flushPendingCardFocus();
    this.scheduleLayoutRefresh();
  }

  getPreviewGroupKeysForTarget(target) {
    if (!(target instanceof Node)) {
      return [];
    }

    const keyCarrier = target.closest?.('[data-comment-preview-group-keys]');
    return serializeGroupKeys(
      String(keyCarrier?.dataset?.commentPreviewGroupKeys ?? '')
        .split(/\s+/)
        .filter(Boolean),
    ).split(' ').filter(Boolean);
  }

  getPreviewGroupKeysAtPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return [];
    }

    const targetAtPoint = document.elementFromPoint(x, y);
    const targetKeys = this.getPreviewGroupKeysForTarget(targetAtPoint);
    if (targetKeys.length > 0) {
      return targetKeys;
    }

    const matchingKeys = this.previewHoverRegions
      .filter((region) => region.rects.some((rect) => pointIntersectsRect(x, y, rect)))
      .map((region) => region.key);
    return normalizeGroupKeys(matchingKeys);
  }

  updateHoveredPreviewGroups(nextKeys = []) {
    const normalizedKeys = normalizeGroupKeys(nextKeys);
    const signature = normalizedKeys.join(' ');
    if (signature === this.hoveredPreviewGroupKeysSignature) {
      return;
    }

    this.hoveredPreviewGroupKeys = normalizedKeys;
    this.hoveredPreviewGroupKeysSignature = signature;
    this.scheduleLayoutRefresh();
  }

  updateHoveredEditorGroups(nextKeys = []) {
    const normalizedKeys = normalizeGroupKeys(nextKeys);
    const signature = normalizedKeys.join(' ');
    if (signature === this.hoveredEditorGroupKeysSignature) {
      return;
    }

    this.hoveredEditorGroupKeys = normalizedKeys;
    this.hoveredEditorGroupKeysSignature = signature;
    this.scheduleLayoutRefresh();
  }

  syncHoveredPreviewGroupsFromTarget(target) {
    this.updateHoveredPreviewGroups(this.getPreviewGroupKeysForTarget(target));
  }

  shouldRenderPassivePreviewMarkers() {
    const previewWidth = this.previewContainer?.clientWidth ?? this.previewElement?.clientWidth ?? 0;
    return window.innerWidth >= COMMENT_PREVIEW_RAIL_BREAKPOINT && previewWidth >= COMMENT_PREVIEW_RAIL_MIN_WIDTH;
  }

  updateReactionPickerPosition(card) {
    const bounds = getReactionPickerBounds(card);
    if (!bounds) {
      return;
    }

    const { picker, scroll, wrap } = bounds;
    picker.classList.remove('is-upward');
    picker.style.maxHeight = '';

    const wrapRect = wrap.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    const safeViewportTop = 12;
    const safeViewportBottom = window.innerHeight - 12;
    const lowerBoundary = Math.min(scrollRect.bottom, safeViewportBottom);
    const upperBoundary = Math.max(scrollRect.top, safeViewportTop);
    const availableBelow = Math.max(lowerBoundary - wrapRect.bottom - 8, 0);
    const availableAbove = Math.max(wrapRect.top - upperBoundary - 8, 0);
    const shouldOpenUpward = pickerRect.height > availableBelow && availableAbove > availableBelow;
    const maxHeight = Math.max((shouldOpenUpward ? availableAbove : availableBelow), 120);

    picker.classList.toggle('is-upward', shouldOpenUpward);
    picker.style.maxHeight = `${maxHeight}px`;
  }

  repositionActiveCard() {
    const card = this.cardRoot?.firstElementChild;
    if (!card || !this.activeCard) {
      if (this.cardRoot) {
        this.cardRoot.style.visibility = '';
      }
      return;
    }

    this.positionCard(card);
    this.cardRoot.style.visibility = '';
    this.flushPendingCardFocus();
  }

  createComposer() {
    const form = document.createElement('form');
    form.className = 'comment-card-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'input comment-card-input';
    textarea.rows = 4;
    textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
    textarea.placeholder = 'Add context, feedback, or a question...';

    const actions = document.createElement('div');
    actions.className = 'ui-record-actions comment-card-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ui-button btn btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.closeCard());

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'ui-button btn btn-primary';
    submit.textContent = 'Post comment';

    actions.append(cancel, submit);
    form.append(textarea, actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const threadId = await this.onCreateThread?.({
        anchor: this.activeCard?.anchor,
        body: textarea.value,
      });
      if (!threadId) {
        textarea.focus();
        return;
      }

      this.closeCard();
    });

    this.pendingCardFocusElement = textarea;
    return form;
  }

  createThreadElement(thread) {
    const article = document.createElement('article');
    article.className = 'comment-thread-card';

    const header = document.createElement('div');
    header.className = 'ui-record-header comment-thread-card-header';

    const heading = document.createElement('div');
    heading.className = 'comment-thread-card-heading';

    const author = document.createElement('span');
    author.className = 'comment-thread-card-author';
    author.textContent = thread.createdByName;

    const time = document.createElement('span');
    time.className = 'comment-thread-card-time';
    time.textContent = this.formatTimestamp(thread.createdAt);

    const actions = document.createElement('div');
    actions.className = 'ui-record-actions comment-thread-card-actions';

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'ui-button ui-button--compact btn btn-ghost ui-pill-button ui-action-pill comment-thread-card-action';
    jump.textContent = 'Jump';
    jump.addEventListener('click', () => this.onNavigateToLine?.(thread.anchor?.startLine ?? 1));

    const reply = document.createElement('button');
    reply.type = 'button';
    reply.className = 'ui-button ui-button--compact btn btn-ghost ui-pill-button ui-action-pill comment-thread-card-action';
    const isReplying = this.activeCard?.replyThreadId === thread.id;
    reply.classList.toggle('is-active', isReplying);
    reply.textContent = 'Reply';
    reply.setAttribute('aria-pressed', String(isReplying));
    reply.setAttribute('aria-label', isReplying ? 'Cancel reply' : 'Reply to thread');
    reply.title = isReplying ? 'Cancel reply' : 'Reply to thread';
    reply.addEventListener('click', () => {
      this.activeCard = {
        ...this.activeCard,
        replyThreadId: isReplying ? null : thread.id,
      };
      this.renderCard();
    });

    const resolve = document.createElement('button');
    resolve.type = 'button';
    resolve.className = 'ui-button ui-button--compact btn btn-ghost ui-pill-button ui-action-pill comment-thread-card-action is-danger';
    resolve.textContent = 'Resolve';
    resolve.addEventListener('click', async () => {
      await this.onResolveThread?.(thread.id);
    });

    actions.append(jump, reply, resolve);
    heading.append(author, time);
    header.append(heading, actions);

    article.append(header);

    thread.messages.forEach((message) => {
      article.appendChild(this.createMessageElement(thread, message));
    });

    if (this.activeCard?.replyThreadId === thread.id) {
      article.appendChild(this.createReplyComposer(thread));
    }

    return article;
  }

  createMessageElement(thread, message) {
    const container = document.createElement('div');
    container.className = 'comment-message-card';

    const meta = document.createElement('div');
    meta.className = 'ui-record-meta comment-message-card-meta';

    const author = document.createElement('span');
    author.className = 'comment-message-card-author';
    author.textContent = message.userName;

    const time = document.createElement('span');
    time.className = 'comment-message-card-time';
    time.textContent = this.formatTimestamp(message.createdAt);

    const renderedBody = createRenderedCommentBody(
      message.body,
      'comment-message-card-body comment-markdown',
    );

    meta.append(author, time);
    container.append(meta, renderedBody);
    container.appendChild(this.createReactionBar(thread, message));
    return container;
  }

  createReactionBar(thread, message) {
    const localUserId = this.session?.getLocalUser?.()?.userId ?? '';
    const wrap = document.createElement('div');
    wrap.className = 'comment-reaction-bar';

    const existingReactionEmojis = new Set((message.reactions ?? []).map((reaction) => reaction.emoji));

    const chips = document.createElement('div');
    chips.className = 'comment-reaction-chips';

    (message.reactions ?? []).forEach((reaction) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ui-chip-button ui-chip-button--comment comment-reaction-chip';
      chip.classList.toggle('is-active', hasLocalReaction(reaction, localUserId));
      chip.setAttribute('aria-pressed', String(hasLocalReaction(reaction, localUserId)));
      chip.title = reaction.users?.map((user) => user.userName).join(', ') || reaction.emoji;

      const emoji = document.createElement('span');
      emoji.className = 'comment-reaction-chip-emoji';
      emoji.textContent = reaction.emoji;

      const count = document.createElement('span');
      count.className = 'comment-reaction-chip-count';
      count.textContent = formatReactionCount(reaction);

      chip.append(emoji, count);
      chip.addEventListener('click', async () => {
        await this.onToggleReaction?.(thread.id, message.id, reaction.emoji);
      });
      chips.appendChild(chip);
    });

    const actions = document.createElement('div');
    actions.className = 'comment-reaction-actions';

    COMMENT_REACTION_PRESET_EMOJIS
      .filter((emoji) => !existingReactionEmojis.has(emoji))
      .forEach((emoji) => {
        actions.appendChild(this.createQuickReactionButton(thread, message, emoji));
      });

    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'comment-reaction-picker-wrap';

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'ui-chip-button ui-chip-button--comment comment-reaction-more-trigger';
    moreButton.dataset.reactionPickerToggle = 'true';
    moreButton.setAttribute('aria-expanded', String(
      isReactionPickerOpen(this.reactionPicker, thread.id, message.id),
    ));
    moreButton.textContent = 'More';
    moreButton.addEventListener('click', () => {
      const isOpen = isReactionPickerOpen(this.reactionPicker, thread.id, message.id);
      this.reactionPicker = isOpen
        ? null
        : {
          messageId: message.id,
          threadId: thread.id,
        };
      this.renderCard();
    });

    pickerWrap.appendChild(moreButton);

    if (isReactionPickerOpen(this.reactionPicker, thread.id, message.id)) {
      pickerWrap.appendChild(this.createReactionPicker(thread, message));
    }

    actions.appendChild(pickerWrap);
    wrap.append(chips, actions);
    return wrap;
  }

  createQuickReactionButton(thread, message, emoji) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-icon-chip ui-icon-chip--comment comment-reaction-quick-add';
    button.textContent = emoji;
    button.title = `React with ${emoji}`;
    button.addEventListener('click', async () => {
      await this.onToggleReaction?.(thread.id, message.id, emoji);
    });
    return button;
  }

  createReactionPicker(thread, message) {
    const picker = document.createElement('div');
    picker.className = 'comment-reaction-picker';
    const moreGrid = document.createElement('div');
    moreGrid.className = 'comment-reaction-picker-grid';
    COMMENT_REACTION_MORE_EMOJIS.forEach((emoji) => {
      moreGrid.appendChild(this.createReactionPickerButton(thread, message, emoji));
    });
    picker.appendChild(moreGrid);

    return picker;
  }

  createReactionPickerButton(thread, message, emoji) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-icon-chip ui-icon-chip--comment comment-reaction-picker-btn';
    button.textContent = emoji;
    button.title = `React with ${emoji}`;
    button.addEventListener('click', async () => {
      const didToggle = await this.onToggleReaction?.(thread.id, message.id, emoji);
      if (didToggle) {
        this.reactionPicker = null;
        this.renderCard();
      }
    });
    return button;
  }

  createReplyComposer(thread) {
    const form = document.createElement('form');
    form.className = 'comment-reply-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'input comment-card-input';
    textarea.rows = 3;
    textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
    textarea.placeholder = 'Reply to thread...';

    const actions = document.createElement('div');
    actions.className = 'ui-record-actions comment-card-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ui-button btn btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.activeCard = {
        ...this.activeCard,
        replyThreadId: null,
      };
      this.renderCard();
    });

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'ui-button btn btn-primary';
    submit.textContent = 'Reply';

    actions.append(cancel, submit);
    form.append(textarea, actions);
    this.pendingCardFocusElement = textarea;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const messageId = await this.onReplyToThread?.(thread.id, textarea.value);
      if (!messageId) {
        textarea.focus();
        return;
      }

      this.activeCard = {
        ...this.activeCard,
        replyThreadId: null,
      };
      this.renderCard();
    });

    return form;
  }

  positionCard(card) {
    const sourceRect = this.updateCardSourceRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const cardRect = card.getBoundingClientRect();
    const fallbackLeft = clamp((viewportWidth - cardRect.width) / 2, 16, viewportWidth - cardRect.width - 16);
    const fallbackTop = clamp((viewportHeight - cardRect.height) / 4, 16, viewportHeight - cardRect.height - 16);

    let left = fallbackLeft;
    let top = fallbackTop;

    if (sourceRect) {
      left = clamp(
        sourceRect.left,
        16,
        viewportWidth - Math.min(cardRect.width, COMMENT_CARD_WIDTH) - 16,
      );
      top = sourceRect.bottom + COMMENT_CARD_OFFSET;
      if (top + cardRect.height > viewportHeight - 16) {
        top = Math.max(sourceRect.top - cardRect.height - COMMENT_CARD_OFFSET, 16);
      }
    }

    this.cardRoot.style.left = `${left}px`;
    this.cardRoot.style.top = `${top}px`;
    this.cardRoot.style.width = `${Math.min(Math.max(cardRect.width, COMMENT_CARD_WIDTH), viewportWidth - 32)}px`;
  }

  formatTimestamp(value) {
    if (!Number.isFinite(value)) {
      return '';
    }

    try {
      return this.timeFormatter.format(new Date(value));
    } catch {
      return '';
    }
  }

  flushPendingCardFocus() {
    const element = this.pendingCardFocusElement;
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      this.pendingCardFocusElement = null;
      return;
    }

    this.pendingCardFocusElement = null;
    const focusElement = () => {
      if (!element.isConnected) {
        return;
      }

      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && this.editorContainer?.contains(activeElement)) {
        activeElement.blur();
      }

      element.focus({ preventScroll: true });
    };

    focusElement();
    if (document.activeElement === element) {
      return;
    }

    requestAnimationFrame(() => {
      focusElement();
      if (document.activeElement !== element) {
        setTimeout(() => {
          focusElement();
        }, 50);
      }
    });
  }

  clearSelectionRevealTimer() {
    if (!this.selectionRevealTimer) {
      return;
    }

    clearTimeout(this.selectionRevealTimer);
    this.selectionRevealTimer = 0;
  }

  scheduleSelectionReveal(anchor) {
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
}
