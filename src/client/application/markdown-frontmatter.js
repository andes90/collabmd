import yaml from 'js-yaml';

import { escapeHtml, resolveWikiTarget } from '../domain/vault-utils.js';

export { extractYamlFrontmatter } from '../../domain/yaml-frontmatter.js';

const TAG_KEYS = new Set(['tag', 'tags']);
const ALIAS_KEYS = new Set(['alias', 'aliases']);
const URL_PATTERN = /^https?:\/\/\S+$/i;
const WIKI_LINK_PATTERN = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ICON_ATTRS = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const TYPE_ICONS = {
  bool: `<svg ${ICON_ATTRS}><polyline points="20 6 9 17 4 12"/></svg>`,
  date: `<svg ${ICON_ATTRS}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  empty: `<svg ${ICON_ATTRS}><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  link: `<svg ${ICON_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  list: `<svg ${ICON_ATTRS}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  number: `<svg ${ICON_ATTRS}><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
  object: `<svg ${ICON_ATTRS}><path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2"/><path d="M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2"/></svg>`,
  tags: `<svg ${ICON_ATTRS}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  text: `<svg ${ICON_ATTRS}><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
  wikilink: `<svg ${ICON_ATTRS}><path d="M9 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/><path d="M15 6h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4"/></svg>`,
};

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isScalarValue(value) {
  return (
    value == null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || value instanceof Date
  );
}

function isDateOnly(date) {
  return (
    date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0
  );
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());

  if (isDateOnly(date)) {
    return `${year}-${month}-${day}`;
  }

  const hours = pad2(date.getUTCHours());
  const minutes = pad2(date.getUTCMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function detectScalarType(key, value) {
  if (value == null || value === '') {
    return 'empty';
  }

  if (value instanceof Date) {
    return 'date';
  }

  if (typeof value === 'boolean') {
    return 'bool';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'string') {
    if (DATE_ONLY_PATTERN.test(value.trim())) {
      return 'date';
    }
    if (URL_PATTERN.test(value.trim())) {
      return 'link';
    }
    if (WIKI_LINK_PATTERN.test(value.trim())) {
      return 'wikilink';
    }
    if (key && TAG_KEYS.has(key.toLowerCase())) {
      return 'tags';
    }
    return 'text';
  }

  return 'text';
}

function renderWikiLinkValue(rawText, ctx) {
  const match = WIKI_LINK_PATTERN.exec(rawText.trim());
  if (!match) {
    return null;
  }

  const target = match[1].trim();
  const display = (match[2] ?? match[1]).trim();
  const fileList = ctx?.fileList ?? [];
  const resolved = resolveWikiTarget(target, fileList);
  const classes = resolved ? 'wiki-link' : 'wiki-link wiki-link-new';
  const title = resolved
    ? display
    : ctx?.wikiLinkAutoCreate
      ? `Create "${target}"`
      : `Missing "${target}"`;

  return `<a class="${classes}" href="#" data-wiki-target="${escapeHtml(target)}" title="${escapeHtml(title)}">${escapeHtml(display)}</a>`;
}

function renderUrlValue(rawText) {
  const href = rawText.trim();
  return `<a class="frontmatter-value-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(href)}</a>`;
}

function renderEmptyValue() {
  return '<span class="frontmatter-value-empty">Empty</span>';
}

function renderScalarMarkup(key, value, ctx) {
  const type = detectScalarType(key, value);

  if (type === 'empty') {
    return { html: renderEmptyValue(), type };
  }

  if (type === 'date') {
    const formatted = value instanceof Date ? formatDate(value) : String(value).trim();
    const datetime = value instanceof Date ? value.toISOString() : formatted;
    return {
      html: `<time class="frontmatter-value-date" datetime="${escapeHtml(datetime)}">${escapeHtml(formatted)}</time>`,
      type,
    };
  }

  if (type === 'bool') {
    const truthy = value === true;
    const label = truthy ? '✓ true' : '✗ false';
    return {
      html: `<span class="frontmatter-value-bool" data-value="${truthy}">${label}</span>`,
      type,
    };
  }

  if (type === 'number') {
    return {
      html: `<span class="frontmatter-value-number">${escapeHtml(String(value))}</span>`,
      type,
    };
  }

  if (type === 'link') {
    return { html: renderUrlValue(String(value)), type };
  }

  if (type === 'wikilink') {
    const wikiHtml = renderWikiLinkValue(String(value), ctx);
    if (wikiHtml) {
      return { html: wikiHtml, type };
    }
  }

  if (type === 'tags') {
    return {
      html: `<span class="frontmatter-value-pill frontmatter-value-tag">#${escapeHtml(String(value))}</span>`,
      type,
    };
  }

  return {
    html: `<span class="frontmatter-value-text">${escapeHtml(String(value))}</span>`,
    type: 'text',
  };
}

function renderArrayMarkup(key, items, ctx) {
  const lowerKey = (key ?? '').toLowerCase();
  const isTagKey = TAG_KEYS.has(lowerKey);
  const isAliasKey = ALIAS_KEYS.has(lowerKey);
  const allScalar = items.every((item) => isScalarValue(item));

  if (!allScalar) {
    return {
      html: `<pre class="frontmatter-value-code"><code>${escapeHtml(serializeComplexValue(items))}</code></pre>`,
      type: 'object',
    };
  }

  if (items.length === 0) {
    return {
      html: `<div class="frontmatter-value-list">${renderEmptyValue()}</div>`,
      type: isTagKey ? 'tags' : isAliasKey ? 'aliases' : 'list',
    };
  }

  const pills = items.map((item) => {
    if (item == null || item === '') {
      return `<span class="frontmatter-value-pill frontmatter-value-pill-empty">Empty</span>`;
    }

    if (isTagKey) {
      return `<span class="frontmatter-value-pill frontmatter-value-tag">#${escapeHtml(formatPillScalar(item))}</span>`;
    }

    if (isAliasKey) {
      return `<span class="frontmatter-value-pill frontmatter-value-alias">${escapeHtml(formatPillScalar(item))}</span>`;
    }

    if (typeof item === 'string') {
      const wikiHtml = WIKI_LINK_PATTERN.test(item.trim())
        ? renderWikiLinkValue(item, ctx)
        : null;
      if (wikiHtml) {
        return wikiHtml;
      }
      if (URL_PATTERN.test(item.trim())) {
        return renderUrlValue(item);
      }
    }

    return `<span class="frontmatter-value-pill">${escapeHtml(formatPillScalar(item))}</span>`;
  }).join('');

  return {
    html: `<div class="frontmatter-value-list">${pills}</div>`,
    type: isTagKey ? 'tags' : isAliasKey ? 'aliases' : 'list',
  };
}

function formatPillScalar(value) {
  if (value instanceof Date) {
    return formatDate(value);
  }
  return String(value);
}

function serializeComplexValue(value) {
  return yaml.dump(value, {
    lineWidth: -1,
    noRefs: true,
  }).trim();
}

function createValueMarkup(key, value, ctx) {
  if (Array.isArray(value)) {
    return renderArrayMarkup(key, value, ctx);
  }

  if (isPlainObject(value)) {
    return {
      html: `<pre class="frontmatter-value-code"><code>${escapeHtml(serializeComplexValue(value))}</code></pre>`,
      type: 'object',
    };
  }

  return renderScalarMarkup(key, value, ctx);
}

function createFrontmatterEntries(data) {
  if (isPlainObject(data)) {
    return Object.entries(data);
  }

  return [['value', data]];
}

function createHiddenSummary(entries) {
  if (entries.length === 0) {
    return 'No properties';
  }

  return `${entries.length} propert${entries.length === 1 ? 'y' : 'ies'} hidden`;
}

function createIconMarkup(type) {
  const svg = TYPE_ICONS[type] ?? TYPE_ICONS.text;
  return `<span class="frontmatter-icon">${svg}</span>`;
}

export function renderFrontmatterBlock(frontmatter, {
  collapsed = false,
  fileList = [],
  interactive = false,
  wikiLinkAutoCreate = true,
} = {}) {
  if (!frontmatter) {
    return '';
  }

  const ctx = { fileList, wikiLinkAutoCreate };
  const entries = createFrontmatterEntries(frontmatter.data);
  const collapsedState = interactive && collapsed;
  const sourceAttributes = ` data-source-line="${frontmatter.startLine}" data-source-line-end="${frontmatter.endLine}"${interactive ? ` data-collapsed="${collapsedState ? 'true' : 'false'}"` : ''}`;
  const bodyId = `frontmatter-body-${frontmatter.startLine}-${frontmatter.endLine}`;
  const emptyState = entries.length === 0
    ? '<div class="frontmatter-empty">No properties</div>'
    : '';
  const items = entries.map(([key, value]) => {
    const { html, type } = createValueMarkup(key, value, ctx);
    return (
      `<div class="frontmatter-property" data-type="${escapeHtml(type)}"><dt class="frontmatter-key">${createIconMarkup(type)}<span class="frontmatter-key-text">${escapeHtml(key)}</span></dt><dd class="frontmatter-value">${html}</dd></div>`
    );
  }).join('');
  const header = interactive
    ? `<div class="frontmatter-header"><div class="frontmatter-label">Properties</div><button type="button" class="frontmatter-toggle" aria-controls="${bodyId}" aria-expanded="${collapsedState ? 'false' : 'true'}">${collapsedState ? 'Show' : 'Hide'}</button></div>`
    : '<div class="frontmatter-label">Properties</div>';
  const summary = interactive
    ? `<div class="frontmatter-summary"${collapsedState ? '' : ' hidden'}>${escapeHtml(createHiddenSummary(entries))}</div>`
    : '';
  const bodyAttributes = ` class="frontmatter-content"${interactive ? ` id="${bodyId}"` : ''}${collapsedState ? ' hidden' : ''}`;

  return `<section class="frontmatter-block"${sourceAttributes}>${header}${summary}<div${bodyAttributes}><dl class="frontmatter-properties">${items}</dl>${emptyState}</div></section>`;
}
