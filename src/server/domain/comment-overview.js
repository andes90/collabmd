const COMMENT_OVERVIEW_PREVIEW_MAX_LENGTH = 140;
const asFiniteNumber = (value) => (Number.isFinite(value) ? value : null);
const asString = (value) => (typeof value === 'string' ? value : '');

function summarizeCommentMarkdown(value, maxLength = COMMENT_OVERVIEW_PREVIEW_MAX_LENGTH) {
  const normalized = String(value ?? '').replace(/\r\n?/gu, '\n').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function getLatestMessage(messages = []) {
  return messages.reduce((latest, message) => (
    !latest || (asFiniteNumber(message?.createdAt) ?? 0) >= (asFiniteNumber(latest?.createdAt) ?? 0)
      ? message
      : latest
  ), null);
}

function createThreadSummary(thread) {
  if (!thread || asFiniteNumber(thread.resolvedAt) !== null) {
    return null;
  }

  const id = asString(thread.id);
  const anchorKind = asString(thread.anchorKind) || 'line';
  const isDiagramElementAnchor = anchorKind === 'diagram-element';
  const anchorStartLine = asFiniteNumber(thread.anchorStartLine);
  const anchorEndLine = asFiniteNumber(thread.anchorEndLine);
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  if (
    !id
    || messages.length === 0
    || (!isDiagramElementAnchor && (anchorStartLine === null || anchorEndLine === null))
  ) {
    return null;
  }

  const latestMessage = getLatestMessage(messages);
  const latestActivityAt = asFiniteNumber(latestMessage?.createdAt)
    ?? asFiniteNumber(thread.createdAt)
    ?? 0;

  return {
    anchor: {
      ...(isDiagramElementAnchor
        ? {}
        : {
          endLine: Math.max(anchorEndLine, anchorStartLine),
          startLine: Math.max(anchorStartLine, 1),
        }),
      kind: anchorKind,
      quote: asString(thread.anchorQuote) || (isDiagramElementAnchor ? 'Diagram element' : ''),
    },
    createdAt: asFiniteNumber(thread.createdAt) ?? latestActivityAt,
    createdByColor: asString(thread.createdByColor),
    createdByName: asString(thread.createdByName),
    id,
    latestActivityAt,
    latestMessage: latestMessage
      ? {
        bodyPreview: summarizeCommentMarkdown(latestMessage.body),
        createdAt: asFiniteNumber(latestMessage.createdAt) ?? latestActivityAt,
        userColor: asString(latestMessage.userColor),
        userName: asString(latestMessage.userName) || 'Anonymous',
      }
      : null,
    messageCount: messages.length,
  };
}

export function createCommentOverview(entries = [], {
  generatedAt = Date.now(),
} = {}) {
  const files = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const filePath = asString(entry?.filePath);
      const threads = (Array.isArray(entry?.threads) ? entry.threads : [])
        .map((thread) => createThreadSummary(thread))
        .filter(Boolean)
        .sort((left, right) => (
          right.latestActivityAt - left.latestActivityAt
            || left.anchor.startLine - right.anchor.startLine
            || left.id.localeCompare(right.id)
        ));

      if (!filePath || threads.length === 0) {
        return null;
      }

      return {
        filePath,
        latestActivityAt: threads[0].latestActivityAt,
        threadCount: threads.length,
        threads,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.latestActivityAt - left.latestActivityAt
        || left.filePath.localeCompare(right.filePath, undefined, { sensitivity: 'base' })
    ));

  return {
    files,
    generatedAt,
    totalThreadCount: files.reduce((total, file) => total + file.threadCount, 0),
  };
}
