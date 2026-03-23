import {
  COMMENT_BODY_MAX_LENGTH,
  normalizeCommentQuoteForComparison,
} from '../../../domain/comment-threads.js';
import { renderCommentMarkdownToHtml } from '../comment-markdown-renderer.js';

export { COMMENT_BODY_MAX_LENGTH };

export const COMMENT_CARD_OFFSET = 14;
export const COMMENT_CARD_WIDTH = 520;
export const COMMENT_SELECTION_REVEAL_DELAY_MS = 150;
export const COMMENT_SELECTION_CHIP_GAP = 12;
export const COMMENT_CONTROL_SLOT_HEIGHT = 36;
export const COMMENT_PREVIEW_BADGE_MIN_WIDTH = 28;
export const COMMENT_PREVIEW_RAIL_SLOT_HEIGHT = 30;
export const COMMENT_PREVIEW_RAIL_MIN_WIDTH = 400;
export const COMMENT_PREVIEW_RAIL_BREAKPOINT = 769;
export const COMMENT_REACTION_PRESET_EMOJIS = Object.freeze(['👍', '❤️', '🎉', '👀', '🚀']);
export const COMMENT_REACTION_MORE_EMOJIS = Object.freeze(['😂', '🔥', '✅', '🙏', '💡', '🤔', '👏', '😄', '🎯', '🙌']);

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

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
  container.innerHTML = renderCommentMarkdownToHtml(body);
  return container;
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
