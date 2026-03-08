const INLINE_PLACEHOLDERS = Object.freeze({
  bold: 'bold text',
  code: 'code',
  italic: 'emphasis',
  strikethrough: 'struck text',
});

const LINK_LABEL_PLACEHOLDER = 'link text';
const LINK_URL_PLACEHOLDER = 'https://';
const IMAGE_ALT_PLACEHOLDER = 'alt text';
const IMAGE_URL_PLACEHOLDER = 'https://';
const CODE_BLOCK_PLACEHOLDER = 'code';
const TABLE_HEADERS = Object.freeze(['Column 1', 'Column 2']);
const TABLE_CELL_PLACEHOLDER = 'Value';

function normalizeRange(range, textLength) {
  const from = Math.max(0, Math.min(range.from, range.to, textLength));
  const to = Math.max(0, Math.min(Math.max(range.from, range.to), textLength));
  return { from, to };
}

function isLineStart(text, position) {
  return position === 0 || text[position - 1] === '\n';
}

function findLineStart(text, position) {
  if (position <= 0) {
    return 0;
  }

  const index = text.lastIndexOf('\n', position - 1);
  return index < 0 ? 0 : index + 1;
}

function findLineEnd(text, position) {
  const index = text.indexOf('\n', position);
  return index < 0 ? text.length : index;
}

function getLineSelection(text, range) {
  const { from } = range;
  let { to } = range;
  if (to > from && isLineStart(text, to)) {
    to -= 1;
  }

  return {
    from: findLineStart(text, from),
    to: findLineEnd(text, Math.max(from, to)),
  };
}

function wrapInline(text, range, token, placeholder) {
  const selected = text.slice(range.from, range.to);
  if (selected.length > 0) {
    return {
      anchor: range.from + token.length,
      from: range.from,
      head: range.from + token.length + selected.length,
      insert: `${token}${selected}${token}`,
      to: range.to,
    };
  }

  return {
    anchor: range.from + token.length,
    from: range.from,
    head: range.from + token.length + placeholder.length,
    insert: `${token}${placeholder}${token}`,
    to: range.to,
  };
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value.trim());
}

function formatLink(text, range) {
  const selected = text.slice(range.from, range.to);
  if (selected.length > 0 && looksLikeUrl(selected)) {
    return {
      anchor: range.from + 1,
      from: range.from,
      head: range.from + 1 + LINK_LABEL_PLACEHOLDER.length,
      insert: `[${LINK_LABEL_PLACEHOLDER}](${selected})`,
      to: range.to,
    };
  }

  if (selected.length > 0) {
    const prefix = `[${selected}](`;
    return {
      anchor: range.from + prefix.length,
      from: range.from,
      head: range.from + prefix.length + LINK_URL_PLACEHOLDER.length,
      insert: `${prefix}${LINK_URL_PLACEHOLDER})`,
      to: range.to,
    };
  }

  return {
    anchor: range.from + 1,
    from: range.from,
    head: range.from + 1 + LINK_LABEL_PLACEHOLDER.length,
    insert: `[${LINK_LABEL_PLACEHOLDER}](${LINK_URL_PLACEHOLDER})`,
    to: range.to,
  };
}

function formatImage(text, range) {
  const selected = text.slice(range.from, range.to);
  if (selected.length > 0 && looksLikeUrl(selected)) {
    return {
      anchor: range.from + 2,
      from: range.from,
      head: range.from + 2 + IMAGE_ALT_PLACEHOLDER.length,
      insert: `![${IMAGE_ALT_PLACEHOLDER}](${selected})`,
      to: range.to,
    };
  }

  if (selected.length > 0) {
    const prefix = `![${selected}](`;
    return {
      anchor: range.from + prefix.length,
      from: range.from,
      head: range.from + prefix.length + IMAGE_URL_PLACEHOLDER.length,
      insert: `${prefix}${IMAGE_URL_PLACEHOLDER})`,
      to: range.to,
    };
  }

  return {
    anchor: range.from + 2,
    from: range.from,
    head: range.from + 2 + IMAGE_ALT_PLACEHOLDER.length,
    insert: `![${IMAGE_ALT_PLACEHOLDER}](${IMAGE_URL_PLACEHOLDER})`,
    to: range.to,
  };
}

function prefixSelectedLines(text, range, prefixFactory, matcher) {
  const lineRange = getLineSelection(text, range);
  const block = text.slice(lineRange.from, lineRange.to);
  const lines = block.split('\n');
  const matchesPrefix = (line) => matcher.test(line);
  const shouldUnprefix = lines.every((line) => line.trim().length === 0 || matchesPrefix(line));
  let visibleLineIndex = 0;

  const nextLines = lines.map((line) => {
    if (line.trim().length === 0) {
      return line;
    }

    if (shouldUnprefix) {
      return matchesPrefix(line) ? line.replace(matcher, '') : line;
    }

    const prefix = prefixFactory(visibleLineIndex);
    visibleLineIndex += 1;
    return `${prefix}${line}`;
  });

  return {
    anchor: lineRange.from,
    from: lineRange.from,
    head: lineRange.from + nextLines.join('\n').length,
    insert: nextLines.join('\n'),
    to: lineRange.to,
  };
}

function formatHeading(text, range) {
  return prefixSelectedLines(text, range, () => '## ', /^#{1,6}\s+/);
}

function formatBulletList(text, range) {
  return prefixSelectedLines(text, range, () => '- ', /^[-*+]\s+/);
}

function formatQuote(text, range) {
  return prefixSelectedLines(text, range, () => '> ', /^>\s+/);
}

function formatTaskList(text, range) {
  return prefixSelectedLines(text, range, () => '- [ ] ', /^-\s\[(?: |x|X)\]\s+/);
}

function formatNumberedList(text, range) {
  const lineRange = getLineSelection(text, range);
  const block = text.slice(lineRange.from, lineRange.to);
  const lines = block.split('\n');
  const shouldUnprefix = lines.every((line) => line.trim().length === 0 || /^\d+\.\s+/.test(line));
  let counter = 1;

  const nextLines = lines.map((line) => {
    if (line.trim().length === 0) {
      return line;
    }

    if (shouldUnprefix) {
      return line.replace(/^\d+\.\s+/, '');
    }

    const nextLine = `${counter}. ${line}`;
    counter += 1;
    return nextLine;
  });

  return {
    anchor: lineRange.from,
    from: lineRange.from,
    head: lineRange.from + nextLines.join('\n').length,
    insert: nextLines.join('\n'),
    to: lineRange.to,
  };
}

function unwrapCodeFence(block) {
  const normalized = block.replace(/\r\n/g, '\n');
  const match = normalized.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (!match) {
    return null;
  }

  return match[1];
}

function formatCodeBlock(text, range) {
  const selected = text.slice(range.from, range.to);
  if (selected.length > 0) {
    const unwrapped = unwrapCodeFence(selected);
    if (unwrapped !== null) {
      return {
        anchor: range.from,
        from: range.from,
        head: range.from + unwrapped.length,
        insert: unwrapped,
        to: range.to,
      };
    }

    return {
      anchor: range.from + 4,
      from: range.from,
      head: range.from + 4 + selected.length,
      insert: `\`\`\`\n${selected}\n\`\`\``,
      to: range.to,
    };
  }

  return {
    anchor: range.from + 4,
    from: range.from,
    head: range.from + 4 + CODE_BLOCK_PLACEHOLDER.length,
    insert: `\`\`\`\n${CODE_BLOCK_PLACEHOLDER}\n\`\`\``,
    to: range.to,
  };
}

function insertBlock(text, range, block, selectionStartOffset, selectionLength = 0) {
  const needsLeadingBreak = range.from > 0 && text[range.from - 1] !== '\n';
  const needsTrailingBreak = range.to < text.length && text[range.to] !== '\n';
  const prefix = needsLeadingBreak ? '\n' : '';
  const suffix = needsTrailingBreak ? '\n' : '';
  const insert = `${prefix}${block}${suffix}`;
  const anchor = range.from + prefix.length + selectionStartOffset;

  return {
    anchor,
    from: range.from,
    head: anchor + selectionLength,
    insert,
    to: range.to,
  };
}

function createTableTemplate(selectedText = '') {
  const firstCell = selectedText.trim() || TABLE_CELL_PLACEHOLDER;
  return [
    `| ${TABLE_HEADERS.join(' | ')} |`,
    '| --- | --- |',
    `| ${firstCell} | ${TABLE_CELL_PLACEHOLDER} |`,
  ].join('\n');
}

function formatTable(text, range) {
  const selected = text.slice(range.from, range.to);
  const table = createTableTemplate(selected);
  return insertBlock(text, range, table, 2, TABLE_HEADERS[0].length);
}

function formatHorizontalRule(text, range) {
  return insertBlock(text, range, '---', 4, 0);
}

export function createMarkdownToolbarEdit(documentText, selectionRange, action) {
  const text = String(documentText ?? '');
  const range = normalizeRange(selectionRange, text.length);

  switch (action) {
    case 'bold':
      return wrapInline(text, range, '**', INLINE_PLACEHOLDERS.bold);
    case 'italic':
      return wrapInline(text, range, '_', INLINE_PLACEHOLDERS.italic);
    case 'strikethrough':
      return wrapInline(text, range, '~~', INLINE_PLACEHOLDERS.strikethrough);
    case 'code':
      return wrapInline(text, range, '`', INLINE_PLACEHOLDERS.code);
    case 'link':
      return formatLink(text, range);
    case 'image':
      return formatImage(text, range);
    case 'heading':
      return formatHeading(text, range);
    case 'quote':
      return formatQuote(text, range);
    case 'bullet-list':
      return formatBulletList(text, range);
    case 'numbered-list':
      return formatNumberedList(text, range);
    case 'task-list':
      return formatTaskList(text, range);
    case 'code-block':
      return formatCodeBlock(text, range);
    case 'table':
      return formatTable(text, range);
    case 'horizontal-rule':
      return formatHorizontalRule(text, range);
    default:
      return null;
  }
}
