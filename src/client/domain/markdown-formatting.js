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
const VIDEO_LABEL_PLACEHOLDER = 'Video';
const VIDEO_URL_PLACEHOLDER = 'https://';
const CODE_BLOCK_PLACEHOLDER = 'code';
const TABLE_HEADERS = Object.freeze(['Column 1', 'Column 2']);
const TABLE_CELL_PLACEHOLDER = 'Value';
const BLOCK_PREFIX_PATTERNS = Object.freeze({
  heading: /^#{1,6}\s+/,
  quote: /^>\s+/,
  bulletList: /^[-*+]\s+/,
  numberedList: /^\d+\.\s+/,
  taskList: /^-\s\[(?: |x|X)\]\s+/,
});
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
  if (
    selected.length > (token.length * 2)
    && selected.startsWith(token)
    && selected.endsWith(token)
  ) {
    const unwrapped = selected.slice(token.length, selected.length - token.length);
    return {
      anchor: range.from,
      from: range.from,
      head: range.from + unwrapped.length,
      insert: unwrapped,
      to: range.to,
    };
  }

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

function formatVideo(text, range) {
  const selected = text.slice(range.from, range.to);

  if (selected.length > 0 && looksLikeUrl(selected)) {
    return {
      anchor: range.from + 2,
      from: range.from,
      head: range.from + 2 + VIDEO_LABEL_PLACEHOLDER.length,
      insert: `![${VIDEO_LABEL_PLACEHOLDER}](${selected})`,
      to: range.to,
    };
  }

  if (selected.length > 0) {
    const prefix = `![${selected}](`;
    return {
      anchor: range.from + prefix.length,
      from: range.from,
      head: range.from + prefix.length + VIDEO_URL_PLACEHOLDER.length,
      insert: `${prefix}${VIDEO_URL_PLACEHOLDER})`,
      to: range.to,
    };
  }

  return {
    anchor: range.from + 2,
    from: range.from,
    head: range.from + 2 + VIDEO_LABEL_PLACEHOLDER.length,
    insert: `![${VIDEO_LABEL_PLACEHOLDER}](${VIDEO_URL_PLACEHOLDER})`,
    to: range.to,
  };
}

function stripSupportedBlockPrefix(line) {
  if (BLOCK_PREFIX_PATTERNS.taskList.test(line)) {
    return line.replace(BLOCK_PREFIX_PATTERNS.taskList, '');
  }

  if (BLOCK_PREFIX_PATTERNS.numberedList.test(line)) {
    return line.replace(BLOCK_PREFIX_PATTERNS.numberedList, '');
  }

  if (BLOCK_PREFIX_PATTERNS.bulletList.test(line)) {
    return line.replace(BLOCK_PREFIX_PATTERNS.bulletList, '');
  }

  if (BLOCK_PREFIX_PATTERNS.quote.test(line)) {
    return line.replace(BLOCK_PREFIX_PATTERNS.quote, '');
  }

  if (BLOCK_PREFIX_PATTERNS.heading.test(line)) {
    return line.replace(BLOCK_PREFIX_PATTERNS.heading, '');
  }

  return line;
}

function matchesBlockAction(line, action) {
  switch (action) {
    case 'paragraph':
      return !(
        BLOCK_PREFIX_PATTERNS.taskList.test(line)
        || BLOCK_PREFIX_PATTERNS.numberedList.test(line)
        || BLOCK_PREFIX_PATTERNS.bulletList.test(line)
        || BLOCK_PREFIX_PATTERNS.quote.test(line)
        || BLOCK_PREFIX_PATTERNS.heading.test(line)
      );
    case 'heading-1':
      return /^#\s+/.test(line);
    case 'heading-2':
      return /^##\s+/.test(line);
    case 'heading-3':
      return /^###\s+/.test(line);
    case 'heading-4':
      return /^####\s+/.test(line);
    case 'heading-5':
      return /^#####\s+/.test(line);
    case 'heading-6':
      return /^######\s+/.test(line);
    case 'quote':
      return BLOCK_PREFIX_PATTERNS.quote.test(line);
    case 'bullet-list':
      return BLOCK_PREFIX_PATTERNS.bulletList.test(line) && !BLOCK_PREFIX_PATTERNS.taskList.test(line);
    case 'numbered-list':
      return BLOCK_PREFIX_PATTERNS.numberedList.test(line);
    case 'task-list':
      return BLOCK_PREFIX_PATTERNS.taskList.test(line);
    default:
      return false;
  }
}

function prefixForBlockAction(action, index) {
  switch (action) {
    case 'heading-1':
      return '# ';
    case 'heading-2':
      return '## ';
    case 'heading-3':
      return '### ';
    case 'heading-4':
      return '#### ';
    case 'heading-5':
      return '##### ';
    case 'heading-6':
      return '###### ';
    case 'quote':
      return '> ';
    case 'bullet-list':
      return '- ';
    case 'numbered-list':
      return `${index + 1}. `;
    case 'task-list':
      return '- [ ] ';
    default:
      return '';
  }
}

function normalizeBlockLines(text, range, action) {
  const lineRange = getLineSelection(text, range);
  const block = text.slice(lineRange.from, lineRange.to);
  const lines = block.split('\n');
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const shouldResetToParagraph = action !== 'paragraph'
    && nonEmptyLines.length > 0
    && nonEmptyLines.every((line) => matchesBlockAction(line, action));
  const targetAction = shouldResetToParagraph ? 'paragraph' : action;
  let visibleLineIndex = 0;

  const nextLines = lines.map((line) => {
    if (line.trim().length === 0) {
      return line;
    }

    const normalizedLine = stripSupportedBlockPrefix(line);
    if (targetAction === 'paragraph') {
      return normalizedLine;
    }

    const prefix = prefixForBlockAction(targetAction, visibleLineIndex);
    visibleLineIndex += 1;
    return `${prefix}${normalizedLine}`;
  });

  return {
    anchor: lineRange.from,
    from: lineRange.from,
    head: lineRange.from + nextLines.join('\n').length,
    insert: nextLines.join('\n'),
    to: lineRange.to,
  };
}

function formatHeading(text, range, level) {
  return normalizeBlockLines(text, range, `heading-${level}`);
}

function formatBulletList(text, range) {
  return normalizeBlockLines(text, range, 'bullet-list');
}

function formatQuote(text, range) {
  return normalizeBlockLines(text, range, 'quote');
}

function formatTaskList(text, range) {
  return normalizeBlockLines(text, range, 'task-list');
}

function formatNumberedList(text, range) {
  return normalizeBlockLines(text, range, 'numbered-list');
}

function formatParagraph(text, range) {
  const lineRange = getLineSelection(text, range);
  const block = text.slice(lineRange.from, lineRange.to);
  const unwrapped = unwrapCodeFence(block);
  if (unwrapped !== null) {
    return {
      anchor: lineRange.from,
      from: lineRange.from,
      head: lineRange.from + unwrapped.length,
      insert: unwrapped,
      to: lineRange.to,
    };
  }

  return normalizeBlockLines(text, range, 'paragraph');
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
  let edit = null;

  switch (action) {
    case 'bold':
      edit = wrapInline(text, range, '**', INLINE_PLACEHOLDERS.bold);
      break;
    case 'italic':
      edit = wrapInline(text, range, '_', INLINE_PLACEHOLDERS.italic);
      break;
    case 'strikethrough':
      edit = wrapInline(text, range, '~~', INLINE_PLACEHOLDERS.strikethrough);
      break;
    case 'code':
      edit = wrapInline(text, range, '`', INLINE_PLACEHOLDERS.code);
      break;
    case 'link':
      edit = formatLink(text, range);
      break;
    case 'image':
      edit = formatImage(text, range);
      break;
    case 'video':
      edit = formatVideo(text, range);
      break;
    case 'paragraph':
      edit = formatParagraph(text, range);
      break;
    case 'heading':
      edit = formatHeading(text, range, 2);
      break;
    case 'heading-1':
      edit = formatHeading(text, range, 1);
      break;
    case 'heading-2':
      edit = formatHeading(text, range, 2);
      break;
    case 'heading-3':
      edit = formatHeading(text, range, 3);
      break;
    case 'heading-4':
      edit = formatHeading(text, range, 4);
      break;
    case 'heading-5':
      edit = formatHeading(text, range, 5);
      break;
    case 'heading-6':
      edit = formatHeading(text, range, 6);
      break;
    case 'quote':
      edit = formatQuote(text, range);
      break;
    case 'bullet-list':
      edit = formatBulletList(text, range);
      break;
    case 'numbered-list':
      edit = formatNumberedList(text, range);
      break;
    case 'task-list':
      edit = formatTaskList(text, range);
      break;
    case 'code-block':
      edit = formatCodeBlock(text, range);
      break;
    case 'table':
      edit = formatTable(text, range);
      break;
    case 'horizontal-rule':
      edit = formatHorizontalRule(text, range);
      break;
    default:
      return null;
  }

  if (!edit) {
    return null;
  }

  return text.slice(edit.from, edit.to) === edit.insert ? null : edit;
}
