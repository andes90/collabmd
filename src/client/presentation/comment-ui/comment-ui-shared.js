import {
  COMMENT_BODY_MAX_LENGTH,
  normalizeCommentQuote,
  normalizeCommentQuoteForComparison,
} from '../../../domain/comment-threads.js';
import { clamp } from '../../domain/vault-utils.js';

export { COMMENT_BODY_MAX_LENGTH, clamp };

export const COMMENT_CARD_OFFSET = 14;
export const COMMENT_CARD_WIDTH = 520;
export const COMMENT_SELECTION_REVEAL_DELAY_MS = 150;
export const COMMENT_SELECTION_CHIP_GAP = 12;
export const COMMENT_CONTROL_SLOT_HEIGHT = 36;
export const COMMENT_REACTION_PRESET_EMOJIS = Object.freeze(['👍', '❤️', '🎉', '👀', '🚀']);
export const COMMENT_REACTION_MORE_EMOJIS = Object.freeze(['😂', '🔥', '✅', '🙏', '💡', '🤔', '👏', '😄', '🎯', '🙌']);

export function sortThreads(threads = []) {
  return [...threads].sort((left, right) => (
    (left.anchor?.startLine ?? 0) - (right.anchor?.startLine ?? 0)
      || left.createdAt - right.createdAt
  ));
}

export function getAnchorKind(anchor) {
  return anchor?.anchorKind || anchor?.kind || 'line';
}

export function isTextSelectionAnchor(anchor) {
  return getAnchorKind(anchor) === 'text'
    && Number.isFinite(anchor?.startIndex)
    && Number.isFinite(anchor?.endIndex)
    && anchor.endIndex > anchor.startIndex;
}

export function areAnchorsEqual(left, right) {
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

export function formatAnchorLabel(anchor) {
  if (getAnchorKind(anchor) === 'diagram-element') {
    return 'Diagram element';
  }

  const startLine = Number(anchor?.startLine || 0);
  const endLine = Number(anchor?.endLine || startLine);
  if (!Number.isFinite(startLine) || startLine <= 0) {
    return 'No source anchor';
  }

  return startLine === endLine
    ? `Line ${startLine}`
    : `Lines ${startLine}-${endLine}`;
}

export function getAnchorGroupKey(anchor = {}) {
  return [
    anchor.kind || anchor.anchorKind || 'line',
    anchor.startLine ?? 0,
    anchor.endLine ?? 0,
    anchor.quote || '',
  ].join('::');
}

export function isLeafSourceBlock(element) {
  return element && !element.querySelector('[data-source-line]');
}

export function parseLineNumber(value) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getLatestMessage(messages = []) {
  return messages.reduce((latest, message) => {
    if (!latest) {
      return message;
    }

    return (message?.createdAt ?? 0) >= (latest?.createdAt ?? 0)
      ? message
      : latest;
  }, null);
}

export function getLatestGroupMessage(group) {
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

export function createRenderedCommentBody(body, className = 'comment-markdown') {
  const container = document.createElement('div');
  container.className = className;
  const markdownText = String(body ?? '');
  container.textContent = markdownText;
  void import('../comment-markdown-renderer.js').then(({ renderCommentMarkdownToHtml }) => {
    container.innerHTML = renderCommentMarkdownToHtml(markdownText);
  });
  return container;
}

export function createCommentOverviewThread({
  authorName = 'Anonymous',
  buttonClassName = 'comment-overview-thread',
  footerClassName = 'comment-overview-thread-footer',
  headerClassName = 'comment-overview-thread-header',
  lineClassName = 'comment-overview-thread-line',
  lineLabel = '',
  messageCount = 0,
  previewBody = '',
  previewClassName = 'comment-markdown comment-overview-thread-preview',
  quote = 'Source anchored comment',
  quoteClassName = 'comment-overview-thread-quote',
  timestamp = '',
} = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = buttonClassName;

  const header = document.createElement('div');
  header.className = headerClassName;

  const line = document.createElement('span');
  line.className = lineClassName;
  line.textContent = lineLabel;

  const meta = document.createElement('span');
  meta.className = 'comment-overview-thread-meta';
  meta.textContent = timestamp;
  header.append(line, meta);

  const body = document.createElement('div');
  body.className = 'comment-overview-thread-body';
  const preview = createRenderedCommentBody(previewBody, previewClassName);

  const quoteSection = document.createElement('div');
  quoteSection.className = 'comment-overview-thread-section comment-overview-thread-reference';
  const quoteLabel = document.createElement('span');
  quoteLabel.className = 'comment-overview-thread-section-label';
  quoteLabel.textContent = 'Reference';
  const quoteNode = document.createElement('span');
  quoteNode.className = quoteClassName;
  quoteNode.textContent = quote;
  quoteSection.append(quoteLabel, quoteNode);
  body.append(preview, quoteSection);

  const footer = document.createElement('div');
  footer.className = footerClassName;
  const author = document.createElement('span');
  author.className = 'comment-overview-thread-author';
  author.textContent = authorName;
  const messages = document.createElement('span');
  messages.className = 'comment-overview-thread-message-count';
  messages.textContent = `${messageCount} message${messageCount === 1 ? '' : 's'}`;
  footer.append(author, messages);

  button.append(header, body, footer);
  return button;
}

export function hasLocalReaction(reaction, localUserId) {
  return Boolean(localUserId && reaction?.users?.some((user) => user?.userId === localUserId));
}

export function formatReactionCount(reaction) {
  return String(Array.isArray(reaction?.users) ? reaction.users.length : 0);
}

export function isReactionPickerOpen(reactionPicker, threadId, messageId) {
  return reactionPicker?.threadId === threadId && reactionPicker?.messageId === messageId;
}

export function getReactionPickerBounds(card) {
  const picker = card?.querySelector?.('.comment-reaction-picker');
  const wrap = picker?.closest?.('.comment-reaction-picker-wrap');
  const scroll = card?.querySelector?.('.comment-card-scroll');
  if (!(picker instanceof HTMLElement) || !(wrap instanceof HTMLElement) || !(scroll instanceof HTMLElement)) {
    return null;
  }

  return { picker, scroll, wrap };
}

export function overlapsAnchorRange(element, anchor) {
  const startLine = parseLineNumber(element?.getAttribute?.('data-source-line'));
  const endLine = parseLineNumber(element?.getAttribute?.('data-source-line-end')) ?? startLine;
  if (!startLine || !endLine || !anchor) {
    return false;
  }

  return anchor.startLine <= endLine && anchor.endLine >= startLine;
}

export function createPreviewSelection(selection, previewElement, sourceText = '') {
  if (
    !selection
    || selection.isCollapsed
    || selection.rangeCount === 0
    || !previewElement?.contains(selection.anchorNode)
    || !previewElement.contains(selection.focusNode)
  ) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const selectedText = String(selection.toString()).trim();
  const quote = normalizeCommentQuote(selectedText);
  const endpointElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!quote || endpointElement?.closest?.('.diagram-preview-shell')) {
    return null;
  }

  const blocks = Array.from(previewElement.querySelectorAll('[data-source-line]'))
    .filter((element) => isLeafSourceBlock(element) && range.intersectsNode(element));
  if (blocks.length === 0) {
    return null;
  }

  const sourceLines = String(sourceText).split('\n');
  const startLine = Math.min(Math.max(Math.min(
    ...blocks.map((element) => parseLineNumber(element.getAttribute('data-source-line')) ?? sourceLines.length),
  ), 1), sourceLines.length);
  const endLine = Math.min(Math.max(
    ...blocks.map((element) => (
      parseLineNumber(element.getAttribute('data-source-line-end'))
      ?? parseLineNumber(element.getAttribute('data-source-line'))
      ?? 1
    )),
  ), sourceLines.length);
  const lineStartIndex = sourceLines
    .slice(0, startLine - 1)
    .reduce((index, line) => index + line.length + 1, 0);
  const lineEndIndex = sourceLines
    .slice(startLine - 1, endLine)
    .reduce((index, line, lineIndex) => index + line.length + (lineIndex === 0 ? 0 : 1), lineStartIndex);

  let anchorKind = 'line';
  let startIndex = lineStartIndex;
  let endIndex = lineEndIndex;
  let fallbackToLines = true;
  if (blocks.length === 1) {
    const sourceRange = String(sourceText).slice(lineStartIndex, lineEndIndex);
    const matchIndex = sourceRange.indexOf(selectedText);
    if (matchIndex >= 0 && matchIndex === sourceRange.lastIndexOf(selectedText)) {
      anchorKind = 'text';
      startIndex = lineStartIndex + matchIndex;
      endIndex = startIndex + selectedText.length;
      fallbackToLines = false;
    }
  }

  const lineNumberAt = (index) => String(sourceText).slice(0, index).split('\n').length;
  const anchorStartLine = fallbackToLines ? startLine : lineNumberAt(startIndex);
  const anchorEndLine = fallbackToLines ? endLine : lineNumberAt(Math.max(endIndex - 1, startIndex));
  const rect = createRectFromRects(Array.from(range.getClientRects()))
    || createRectFromRects(blocks.map((element) => element.getBoundingClientRect()));

  return {
    anchor: {
      anchorKind,
      anchorQuote: quote,
      endIndex,
      endLine: anchorEndLine,
      fallbackToLines,
      kind: anchorKind,
      quote,
      startIndex,
      startLine: anchorStartLine,
    },
    range: range.cloneRange(),
    rect,
  };
}

export function createNormalizedTextIndex(root) {
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

export function findUniqueQuoteRange(root, quote) {
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

export function toRelativeRect(rect, containerRect) {
  return {
    bottom: rect.bottom - containerRect.top,
    height: rect.height,
    left: rect.left - containerRect.left,
    right: rect.right - containerRect.left,
    top: rect.top - containerRect.top,
    width: rect.width,
  };
}

export function createRectFromRects(rects = []) {
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

export function pointIntersectsRect(x, y, rect) {
  if (!rect) {
    return false;
  }

  return x >= rect.left
    && x <= rect.right
    && y >= rect.top
    && y <= rect.bottom;
}

export function normalizeGroupKeys(keys = []) {
  return [...new Set(keys.filter(Boolean))].sort();
}

export function serializeGroupKeys(keys = []) {
  return normalizeGroupKeys(keys).join(' ');
}

export function createCommentMarkerContent(count) {
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
