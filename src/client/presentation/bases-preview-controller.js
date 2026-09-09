import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';
import { escapeHtml } from '../domain/vault-utils.js';
import { buttonClassNames } from './components/ui/button.js';
import { inputClassNames } from './components/ui/class-names.js';
import { segmentedButtonClassNames, segmentedControlClassNames } from './components/ui/segmented-control.js';
import { downloadBlob, parseDownloadFileName } from '../browser-utils.js';

function createShellKey() {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `base-${id}`;
}

function replaceChildrenFromHtml(target, html) {
  const markup = String(html ?? '');
  if (typeof DOMParser === 'function' && typeof target?.replaceChildren === 'function') {
    const parsed = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
    target.replaceChildren(...parsed.body.childNodes);
    return;
  }

  // Node tests use lightweight DOM doubles without parsing APIs.
  Reflect.set(target, 'innerHTML', markup);
}

function insertAfterFromHtml(target, html) {
  if (typeof DOMParser !== 'function' || typeof target?.after !== 'function') {
    return;
  }
  const parsed = new DOMParser().parseFromString(`<body>${String(html ?? '')}</body>`, 'text/html');
  target.after(...parsed.body.childNodes);
}

function looksLikeHexColor(value = '') {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(String(value ?? '').trim());
}

function looksLikeExternalImageUrl(value = '') {
  return /^https?:\/\/.+\.(?:png|jpe?g|webp|gif|svg)(?:[?#].*)?$/iu.test(String(value ?? '').trim());
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function createEmptyFilterGroup(conjunction = 'and') {
  return {
    children: [],
    conjunction,
    type: 'group',
  };
}

function getCardImageCell(view, columns, row) {
  const preferred = view.image
    || columns.find((column) => ['cover', 'image'].includes(String(column.id ?? '').toLowerCase()))?.id
    || null;
  return preferred ? row.cells[preferred] ?? null : null;
}

function formatCellText(cell) {
  return String(cell?.text ?? '');
}

function createAttachmentUrl(path = '') {
  return resolveApiUrl(`/attachment?path=${encodeURIComponent(path)}`);
}

function getImageUrlFromCell(cell = {}) {
  if (cell?.type === 'image' && cell.path) {
    return createAttachmentUrl(cell.path);
  }

  if (cell?.type === 'link') {
    if (cell.external && looksLikeExternalImageUrl(cell.url)) {
      return cell.url;
    }
    if (cell.path && isImageAttachmentFilePath(cell.path)) {
      return createAttachmentUrl(cell.path);
    }
  }

  const text = formatCellText(cell);
  if (looksLikeExternalImageUrl(text)) {
    return text;
  }
  if (isImageAttachmentFilePath(text)) {
    return createAttachmentUrl(text);
  }

  return '';
}

function renderValue(cell = {}) {
  const type = cell?.type || 'string';
  if (type === 'empty') {
    return '<span class="bases-value bases-value-empty">—</span>';
  }
  if (type === 'boolean') {
    return `<span class="bases-value bases-value-boolean">${cell.value ? 'True' : 'False'}</span>`;
  }
  if (type === 'image' && cell.path) {
    return `<img class="bases-inline-image" src="${escapeHtml(createAttachmentUrl(cell.path))}" alt="${escapeHtml(formatCellText(cell))}">`;
  }
  if (type === 'list') {
    return `<span class="bases-value-list">${(cell.items ?? []).map((item) => `<span class="bases-value-pill">${renderValue(item)}</span>`).join('')}</span>`;
  }
  if (type === 'link') {
    if (cell.external && cell.url) {
      return `<a class="bases-link" href="${escapeHtml(cell.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(formatCellText(cell))}</a>`;
    }
    if (cell.path) {
      return `<button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact', pill: true, extra: ['bases-link', 'bases-link-button'] }))}" data-base-open-file="${escapeHtml(cell.path)}">${escapeHtml(formatCellText(cell))}</button>`;
    }
  }
  if (type === 'file' && cell.path) {
    return `<button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact', pill: true, extra: ['bases-link', 'bases-link-button'] }))}" data-base-open-file="${escapeHtml(cell.path)}">${escapeHtml(formatCellText(cell))}</button>`;
  }

  const text = formatCellText(cell);
  return `<span class="bases-value">${escapeHtml(text)}</span>`;
}

function renderRowValue(column, row) {
  const cell = row?.cells?.[column.id] ?? null;
  if (
    row?.path
    && cell
    && cell.type !== 'empty'
    && (column.id === 'file.name' || column.id === 'file.basename')
  ) {
    return `<button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact', pill: true, extra: ['bases-link', 'bases-link-button'] }))}" data-base-open-file="${escapeHtml(row.path)}">${escapeHtml(formatCellText(cell))}</button>`;
  }

  return renderValue(cell);
}

function renderSummaryBar(summaries = []) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return '';
  }
  return `<div class="bases-summaries">${summaries.map((summary) => (
    `<div class="bases-summary"><span class="bases-summary-label">${escapeHtml(summary.label)}</span><span class="bases-summary-value">${escapeHtml(formatCellText(summary.value))}</span></div>`
  )).join('')}</div>`;
}

function renderTable(columns, groups) {
  return groups.map((group) => (
    `<section class="bases-group"><header class="bases-group-header"><h3>${escapeHtml(group.label)}</h3>${renderSummaryBar(group.summaries)}</header><div class="bases-table-shell"><table class="bases-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${(group.rows ?? []).map((row) => `<tr>${columns.map((column) => `<td>${renderRowValue(column, row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`
  )).join('');
}

function renderList(columns, groups) {
  return groups.map((group) => (
    `<section class="bases-group"><header class="bases-group-header"><h3>${escapeHtml(group.label)}</h3>${renderSummaryBar(group.summaries)}</header><ul class="bases-list">${(group.rows ?? []).map((row) => (
      `<li class="bases-list-item">${columns.map((column) => {
        const cell = row.cells[column.id];
        if (!cell || cell.type === 'empty') {
          return '';
        }
        return `<span class="bases-list-field"><strong>${escapeHtml(column.label)}:</strong> ${renderRowValue(column, row)}</span>`;
      }).join('')}</li>`
    )).join('')}</ul></section>`
  )).join('');
}

function renderCards(columns, groups, view) {
  return groups.map((group) => (
    `<section class="bases-group"><header class="bases-group-header"><h3>${escapeHtml(group.label)}</h3>${renderSummaryBar(group.summaries)}</header><div class="bases-cards">${(group.rows ?? []).map((row) => {
      const imageCell = getCardImageCell(view, columns, row);
      const imageText = formatCellText(imageCell);
      let mediaHtml = '';
      if (looksLikeHexColor(imageText)) {
        mediaHtml = `<div class="bases-card-media bases-card-media-color" style="--bases-card-swatch:${escapeHtml(imageText)}"></div>`;
      } else {
        const url = getImageUrlFromCell(imageCell);
        if (url) {
          mediaHtml = `<img class="bases-card-media" src="${escapeHtml(url)}" alt="${escapeHtml(imageText)}">`;
        }
      }

      return `<article class="bases-card">${mediaHtml}<div class="bases-card-body">${columns.map((column) => {
        const cell = row.cells[column.id];
        if (!cell || cell.type === 'empty') {
          return '';
        }
        return `<div class="bases-card-field"><div class="bases-card-label">${escapeHtml(column.label)}</div><div class="bases-card-value">${renderRowValue(column, row)}</div></div>`;
      }).join('')}</div></article>`;
    }).join('')}</div></section>`
  )).join('');
}

function renderViewBody(result) {
  if (!result.view.supported) {
    return `<div class="bases-unsupported">CollabMD parsed this view but does not render the <code>${escapeHtml(result.view.type)}</code> layout yet.</div>`;
  }

  switch (result.view.type) {
    case 'cards':
      return renderCards(result.columns, result.groups, result.view);
    case 'list':
      return renderList(result.columns, result.groups);
    case 'table':
    default:
      return renderTable(result.columns, result.groups);
  }
}

function renderViewTabs(result) {
  return (result.views ?? []).map((view) => (
    `<button type="button" class="${escapeHtml(segmentedButtonClassNames({ active: view.id === result.view.id, extra: 'bases-view-tab' }))}" data-base-view="${escapeHtml(view.id)}">${escapeHtml(view.name)}</button>`
  )).join('');
}

function getMeta(result) {
  return result?.meta ?? {};
}

function getAvailableProperties(result) {
  return getMeta(result).availableProperties ?? [];
}

function getVisiblePropertyIds(result) {
  const explicitOrder = getMeta(result).activeViewConfig?.order;
  if (Array.isArray(explicitOrder) && explicitOrder.length > 0) {
    return [...explicitOrder];
  }

  return Array.isArray(result?.columns)
    ? result.columns.map((column) => column.id).filter(Boolean)
    : [];
}

function findPropertyMeta(result, propertyId = '') {
  return getAvailableProperties(result).find((entry) => entry.id === propertyId) ?? null;
}

function getPropertyFilterOperators(result, propertyId = '') {
  return findPropertyMeta(result, propertyId)?.filterOperators
    ?? ['is', 'is not', 'contains', 'does not contain', 'is empty', 'is not empty'];
}

function getEditableViewConfig(result) {
  const config = getMeta(result).activeViewConfig ?? {};
  return {
    filters: config.filters ?? null,
    groupBy: config.groupBy ?? null,
    order: Array.isArray(config.order) ? [...config.order] : [],
    sort: Array.isArray(config.sort) ? config.sort.map((entry) => ({ ...entry })) : [],
  };
}

function isStandaloneBaseEntry(entry) {
  return Boolean(
    entry?.payload?.path
    && entry?.payload?.sourcePath
    && entry.payload.path === entry.payload.sourcePath,
  );
}

function buildToolbarButton(label, panel, entry, result) {
  const active = entry.ui?.openPanel === panel;
  const editable = Boolean(getMeta(result).editable);
  return `<button type="button" class="${escapeHtml(buttonClassNames({ variant: active ? 'primary' : 'secondary', pill: true, extra: ['bases-toolbar-btn', active ? 'is-active' : ''] }))}" data-base-panel="${escapeHtml(panel)}"${editable ? '' : ' disabled'}>${escapeHtml(label)}</button>`;
}

function pruneFilterGroupByProperty(group, propertyId = '') {
  if (!group || group.type !== 'group' || !propertyId) {
    return group;
  }

  const children = (group.children ?? []).flatMap((child) => {
    if (child?.type === 'group') {
      const nextGroup = pruneFilterGroupByProperty(child, propertyId);
      return nextGroup ? [nextGroup] : [];
    }

    return child?.propertyId === propertyId ? [] : [child];
  });

  return {
    ...group,
    children,
  };
}

function createPropertyValuesCacheKey(entry, propertyId = '', result = entry?.result) {
  const rawFilters = getMeta(result).activeViewConfig?.filters ?? null;
  const parsedFilters = parseFilterNode(rawFilters);
  const cacheFilters = propertyId && parsedFilters
    ? compileFilterGroup(pruneFilterGroupByProperty(parsedFilters, propertyId), result)
    : rawFilters;
  return JSON.stringify({
    filters: cacheFilters,
    path: entry?.payload?.path ?? '',
    source: entry?.payload?.source ?? null,
    sourcePath: entry?.payload?.sourcePath ?? '',
    view: result?.view?.id ?? entry?.payload?.view ?? '',
  });
}

function getCachedPropertyValueOptions(entry, propertyId = '', result = entry?.result) {
  const cachedEntry = entry?.propertyValueOptions?.get(propertyId) ?? null;
  if (!cachedEntry) {
    return [];
  }

  return cachedEntry.cacheKey === createPropertyValuesCacheKey(entry, propertyId, result)
    ? (cachedEntry.values ?? [])
    : [];
}

function renderActionButtons(result, entry) {
  return [
    buildToolbarButton('Sort', 'sort', entry, result),
    buildToolbarButton('Filter', 'filter', entry, result),
    buildToolbarButton('Properties', 'properties', entry, result),
  ].join('');
}

function createSelectOptions(result, {
  allowBlank = false,
  selected = '',
} = {}) {
  const options = [];
  if (allowBlank) {
    options.push(`<option value=""${selected ? '' : ' selected'}>Property</option>`);
  }

  getAvailableProperties(result).forEach((property) => {
    options.push(`<option value="${escapeHtml(property.id)}"${property.id === selected ? ' selected' : ''}>${escapeHtml(property.label)}</option>`);
  });
  return options.join('');
}

function renderSortPanel(result) {
  const viewConfig = getEditableViewConfig(result);
  const groupDirections = findPropertyMeta(result, viewConfig.groupBy?.property)?.sortDirections
    ?? [
      { id: 'asc', label: 'A → Z' },
      { id: 'desc', label: 'Z → A' },
    ];
  const sorts = viewConfig.sort ?? [];

  return `
    <section class="bases-panel-card">
      <div class="bases-panel-section">
        <div class="bases-panel-title">Group by</div>
        <div class="bases-sort-row">
          <select class="${escapeHtml(inputClassNames({ extra: 'bases-select bases-sort-property' }))}" data-base-group-by-property aria-label="Group by property">
            ${createSelectOptions(result, { allowBlank: true, selected: viewConfig.groupBy?.property ?? '' })}
          </select>
          <select class="${escapeHtml(inputClassNames({ extra: 'bases-select bases-sort-direction' }))}" data-base-group-by-direction aria-label="Group direction"${viewConfig.groupBy?.property ? '' : ' disabled'}>
            ${groupDirections.map((direction) => `<option value="${escapeHtml(direction.id)}"${direction.id === (viewConfig.groupBy?.direction ?? 'asc') ? ' selected' : ''}>${escapeHtml(direction.label)}</option>`).join('')}
          </select>
          <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-clear-group-by${viewConfig.groupBy?.property ? '' : ' disabled'}>Clear</button>
        </div>
      </div>
      <div class="bases-panel-section">
        <div class="bases-panel-title">Sort by</div>
        <div class="bases-sort-list">
          ${sorts.map((sortConfig, index) => {
    const propertyMeta = findPropertyMeta(result, sortConfig.property);
    const directions = propertyMeta?.sortDirections ?? [
      { id: 'asc', label: 'A → Z' },
      { id: 'desc', label: 'Z → A' },
    ];
    return `
              <div class="bases-sort-row">
                <select class="${escapeHtml(inputClassNames({ extra: 'bases-select bases-sort-property' }))}" data-base-sort-property="${index}" aria-label="Sort rule ${index + 1} property">
                  ${createSelectOptions(result, { selected: sortConfig.property })}
                </select>
                <select class="${escapeHtml(inputClassNames({ extra: 'bases-select bases-sort-direction' }))}" data-base-sort-direction="${index}" aria-label="Sort rule ${index + 1} direction">
                  ${directions.map((direction) => `<option value="${escapeHtml(direction.id)}"${direction.id === sortConfig.direction ? ' selected' : ''}>${escapeHtml(direction.label)}</option>`).join('')}
                </select>
                <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-sort-move="${index}:up" aria-label="Move sort rule ${index + 1} up"${index === 0 ? ' disabled' : ''}>↑</button>
                <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-sort-move="${index}:down" aria-label="Move sort rule ${index + 1} down"${index === sorts.length - 1 ? ' disabled' : ''}>↓</button>
                <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-sort-delete="${index}" aria-label="Delete sort rule ${index + 1}">Delete</button>
              </div>
            `;
  }).join('')}
        </div>
        <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-sort-add>Add sort</button>
      </div>
    </section>
  `;
}

function encodePath(path = []) {
  return path.join('.');
}

function formatFilterPath(path = []) {
  return path.map((index) => index + 1).join('.');
}

function decodePath(value = '') {
  return String(value ?? '')
    .split('.')
    .filter((segment) => segment !== '')
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
}

function escapeExpressionString(value = '') {
  return JSON.stringify(String(value ?? ''));
}

function formatExpressionLiteral(value = '', valueType = 'text', operator = 'is') {
  const normalized = String(value ?? '').trim();
  if (!normalized && operator !== 'is' && operator !== 'is not') {
    return '""';
  }

  if (valueType === 'boolean') {
    return normalized === 'false' ? 'false' : 'true';
  }

  if (valueType === 'number') {
    return Number.isFinite(Number(normalized))
      ? String(Number(normalized))
      : escapeExpressionString(normalized);
  }

  if (valueType === 'date') {
    return escapeExpressionString(normalized);
  }

  return escapeExpressionString(normalized);
}

function compileFilterRule(rule, propertyMeta = null) {
  if (!rule?.propertyId || !rule?.operator) {
    return '';
  }

  const propertyId = rule.propertyId;
  const valueType = propertyMeta?.valueType ?? 'text';

  switch (rule.operator) {
    case 'contains':
      return `${propertyId}.contains(${formatExpressionLiteral(rule.value, valueType, rule.operator)})`;
    case 'does not contain':
      return `!${propertyId}.contains(${formatExpressionLiteral(rule.value, valueType, rule.operator)})`;
    case 'starts with':
      return `${propertyId}.startsWith(${formatExpressionLiteral(rule.value, valueType, rule.operator)})`;
    case 'ends with':
      return `${propertyId}.endsWith(${formatExpressionLiteral(rule.value, valueType, rule.operator)})`;
    case 'is':
      return `${propertyId} == ${formatExpressionLiteral(rule.value, valueType, rule.operator)}`;
    case 'is not':
      return `${propertyId} != ${formatExpressionLiteral(rule.value, valueType, rule.operator)}`;
    case '>':
    case '>=':
    case '<':
    case '<=':
      return `${propertyId} ${rule.operator} ${formatExpressionLiteral(rule.value, valueType, rule.operator)}`;
    case 'is empty':
      return `${propertyId}.isEmpty()`;
    case 'is not empty':
      return `!${propertyId}.isEmpty()`;
    default:
      return '';
  }
}

function compileFilterGroup(group, result) {
  if (!group || group.type !== 'group') {
    return null;
  }

  const compiledChildren = (group.children ?? [])
    .map((child) => {
      if (child?.type === 'group') {
        return compileFilterGroup(child, result);
      }

      const propertyMeta = findPropertyMeta(result, child?.propertyId);
      return compileFilterRule(child, propertyMeta);
    })
    .filter(Boolean);

  if (compiledChildren.length === 0) {
    return null;
  }

  if (group.conjunction === 'not') {
    return {
      not: compiledChildren,
    };
  }

  return {
    [group.conjunction]: compiledChildren,
  };
}

function deserializeExpressionValue(value = '') {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  if (normalized === 'true' || normalized === 'false') {
    return normalized;
  }

  if (normalized === 'null') {
    return '';
  }

  if (/^-?\d+(?:\.\d+)?$/u.test(normalized)) {
    return normalized;
  }

  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith('\'') && normalized.endsWith('\''))) {
    return normalized.slice(1, -1).replace(/\\(["'])/gu, '$1');
  }

  return normalized;
}

function parseFilterRule(expression = '') {
  const text = String(expression ?? '').trim();
  const patterns = [
    [/^!([A-Za-z0-9_.]+)\.isEmpty\(\)$/u, (_, propertyId) => ({ operator: 'is not empty', propertyId, type: 'rule', value: '' })],
    [/^([A-Za-z0-9_.]+)\.isEmpty\(\)$/u, (_, propertyId) => ({ operator: 'is empty', propertyId, type: 'rule', value: '' })],
    [/^!([A-Za-z0-9_.]+)\.contains\((.+)\)$/u, (_, propertyId, value) => ({ operator: 'does not contain', propertyId, type: 'rule', value: deserializeExpressionValue(value) })],
    [/^([A-Za-z0-9_.]+)\.contains\((.+)\)$/u, (_, propertyId, value) => ({ operator: 'contains', propertyId, type: 'rule', value: deserializeExpressionValue(value) })],
    [/^([A-Za-z0-9_.]+)\.startsWith\((.+)\)$/u, (_, propertyId, value) => ({ operator: 'starts with', propertyId, type: 'rule', value: deserializeExpressionValue(value) })],
    [/^([A-Za-z0-9_.]+)\.endsWith\((.+)\)$/u, (_, propertyId, value) => ({ operator: 'ends with', propertyId, type: 'rule', value: deserializeExpressionValue(value) })],
    [/^([A-Za-z0-9_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/u, (_, propertyId, operator, value) => ({
      operator: {
        '!=': 'is not',
        '==': 'is',
        '<': '<',
        '<=': '<=',
        '>': '>',
        '>=': '>=',
      }[operator] ?? operator,
      propertyId,
      type: 'rule',
      value: deserializeExpressionValue(value),
    })],
  ];

  for (const [pattern, build] of patterns) {
    const match = text.match(pattern);
    if (match) {
      return build(...match);
    }
  }

  return null;
}

function parseFilterNode(filterNode) {
  if (!filterNode) {
    return createEmptyFilterGroup('and');
  }

  if (typeof filterNode === 'string') {
    const rule = parseFilterRule(filterNode);
    return rule
      ? {
        children: [rule],
        conjunction: 'and',
        type: 'group',
      }
      : null;
  }

  if (!isPlainObject(filterNode)) {
    return null;
  }

  if (Array.isArray(filterNode.and)) {
    const children = filterNode.and.map((child) => parseFilterNode(child)).flatMap((child) => (
      child?.type === 'group' && child.conjunction === 'and' && child.children?.length === 1 && child.children[0]?.type === 'rule'
        ? child.children
        : [child]
    ));
    return children.every(Boolean)
      ? { children, conjunction: 'and', type: 'group' }
      : null;
  }

  if (Array.isArray(filterNode.or)) {
    const children = filterNode.or.map((child) => parseFilterNode(child)).flatMap((child) => (
      child?.type === 'group' && child.conjunction === 'and' && child.children?.length === 1 && child.children[0]?.type === 'rule'
        ? child.children
        : [child]
    ));
    return children.every(Boolean)
      ? { children, conjunction: 'or', type: 'group' }
      : null;
  }

  if (filterNode.not != null) {
    const notChildren = Array.isArray(filterNode.not)
      ? filterNode.not
      : (() => {
        const parsed = parseFilterNode(filterNode.not);
        if (!parsed) {
          return [];
        }
        return parsed.type === 'group' && parsed.conjunction === 'or'
          ? (parsed.children ?? [])
          : [parsed];
      })();
    const children = notChildren.flatMap((child) => {
      const parsedChild = child?.type ? child : parseFilterNode(child);
      if (!parsedChild) {
        return [null];
      }
      return parsedChild.type === 'group' && parsedChild.conjunction === 'and' && parsedChild.children?.length === 1 && parsedChild.children[0]?.type === 'rule'
        ? parsedChild.children
        : [parsedChild];
    });
    return children.every(Boolean)
      ? { children, conjunction: 'not', type: 'group' }
      : null;
  }

  return null;
}

function serializeRawFilterText(filters) {
  if (!filters) {
    return '';
  }

  return typeof filters === 'string'
    ? filters
    : JSON.stringify(filters, null, 2);
}

function parseRawFilterText(text = '') {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    try {
      return JSON.parse(normalized);
    } catch (error) {
      throw new Error('Invalid advanced filter JSON', { cause: error });
    }
  }

  return normalized;
}

function getNodeAtPath(group, path = []) {
  let current = group;
  for (const index of path) {
    current = current?.children?.[index];
  }
  return current ?? null;
}

function updateNodeAtPath(group, path = [], updater) {
  if (path.length === 0) {
    return updater(group);
  }

  const [head, ...rest] = path;
  return {
    ...group,
    children: (group.children ?? []).map((child, index) => (
      index === head
        ? updateNodeAtPath(child, rest, updater)
        : child
    )),
  };
}

function removeNodeAtPath(group, path = []) {
  if (path.length === 0) {
    return group;
  }

  const parentPath = path.slice(0, -1);
  const removeIndex = path[path.length - 1];
  return updateNodeAtPath(group, parentPath, (node) => ({
    ...node,
    children: (node.children ?? []).filter((_, index) => index !== removeIndex),
  }));
}

function addNodeAtPath(group, path = [], node) {
  return updateNodeAtPath(group, path, (target) => ({
    ...target,
    children: [...(target.children ?? []), node],
  }));
}

function getPropertyOptionsMarkup(result, selected = '') {
  return createSelectOptions(result, { allowBlank: true, selected });
}

function getPropertyValueOptionText(option = {}) {
  return String(option?.text ?? option?.value ?? '').trim();
}

function getBuilderFilterState(entry, result) {
  return entry.ui.builderFilter
    ?? parseFilterNode(getEditableViewConfig(result).filters)
    ?? createEmptyFilterGroup('and');
}

function buildFilterValuePresentation(result, rule, path, entry) {
  const encodedPath = encodePath(path);
  const operators = getPropertyFilterOperators(result, rule.propertyId);
  const suggestionQuery = String(rule.value ?? '').trim().toLowerCase();
  const propertyValueOptions = getCachedPropertyValueOptions(entry, rule.propertyId, result)
    .map((option) => ({
      count: option?.count,
      text: getPropertyValueOptionText(option),
    }))
    .filter((option, index, items) => (
      option.text
      && items.findIndex((candidate) => candidate.text === option.text) === index
    ));
  const hasExactSuggestionMatch = propertyValueOptions.some((option) => (
    option.text.toLowerCase() === suggestionQuery
  ));
  const matchingValueSuggestions = propertyValueOptions.filter((option) => (
    !suggestionQuery || option.text.toLowerCase().includes(suggestionQuery)
  ));
  const valueSuggestions = !suggestionQuery || hasExactSuggestionMatch
    ? propertyValueOptions
    : matchingValueSuggestions.length > 0
      ? matchingValueSuggestions
      : propertyValueOptions;
  const suggestionsEnabled = valueSuggestions.length > 0 && !['is empty', 'is not empty'].includes(rule.operator);
  const suggestionListId = `bases-filter-suggestions-${escapeHtml(entry.key)}-${escapeHtml(encodedPath.replace(/\./g, '-'))}`;
  const valueInputClasses = inputClassNames({
    extra: suggestionsEnabled
      ? 'bases-filter-value bases-filter-value--suggestions'
      : 'bases-filter-value',
  });
  return {
    encodedPath,
    operators,
    suggestionListId,
    suggestionsEnabled,
    valueInputClasses,
    valueSuggestions,
    valueDisabled: ['is empty', 'is not empty'].includes(rule.operator),
  };
}

function renderFilterSuggestionList(presentation, currentValue = '') {
  if (!presentation.suggestionsEnabled) {
    return '';
  }

  return `
    <div class="bases-filter-suggestion-list" id="${presentation.suggestionListId}" role="listbox">
      ${presentation.valueSuggestions.slice(0, 8).map((option) => `
        <button
          type="button"
          class="bases-filter-suggestion"
          data-base-filter-suggestion="${escapeHtml(presentation.encodedPath)}"
          data-base-filter-suggestion-value="${escapeHtml(option.text)}"
          role="option"
          aria-selected="${option.text === String(currentValue ?? '') ? 'true' : 'false'}"
        >
          <span class="bases-filter-suggestion-label">${escapeHtml(option.text)}</span>
          ${option.count == null ? '' : `<span class="bases-filter-suggestion-meta">${escapeHtml(String(option.count))}</span>`}
        </button>
      `).join('')}
    </div>
  `;
}

function renderFilterValueCombobox(result, rule, path, entry) {
  const presentation = buildFilterValuePresentation(result, rule, path, entry);
  const filterLabel = `Filter ${formatFilterPath(path)}`;
  return `
    <div class="bases-filter-value-combobox${presentation.suggestionsEnabled ? ' has-suggestions' : ''}">
      <input class="${escapeHtml(presentation.valueInputClasses)}" type="text" value="${escapeHtml(rule.value ?? '')}" data-base-filter-value="${escapeHtml(presentation.encodedPath)}" aria-label="${filterLabel} value"${presentation.suggestionsEnabled ? ` aria-controls="${presentation.suggestionListId}" aria-haspopup="listbox" aria-autocomplete="list" autocomplete="off"` : ''}${presentation.valueDisabled ? ' disabled' : ''}>
      ${renderFilterSuggestionList(presentation, rule.value ?? '')}
    </div>
  `;
}

function renderFilterRule(result, rule, path, entry) {
  const presentation = buildFilterValuePresentation(result, rule, path, entry);
  const filterLabel = `Filter ${formatFilterPath(path)}`;

  return `
    <div class="bases-filter-row">
      <select class="${escapeHtml(inputClassNames({ extra: 'bases-select bases-filter-property' }))}" data-base-filter-property="${escapeHtml(presentation.encodedPath)}" aria-label="${filterLabel} property">
        ${getPropertyOptionsMarkup(result, rule.propertyId)}
      </select>
      <select class="${escapeHtml(inputClassNames({ extra: 'bases-select bases-filter-operator' }))}" data-base-filter-operator="${escapeHtml(presentation.encodedPath)}" aria-label="${filterLabel} operator">
        ${presentation.operators.map((operator) => `<option value="${escapeHtml(operator)}"${operator === rule.operator ? ' selected' : ''}>${escapeHtml(operator)}</option>`).join('')}
      </select>
      ${renderFilterValueCombobox(result, rule, path, entry)}
      <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-filter-remove="${escapeHtml(presentation.encodedPath)}" aria-label="Delete ${filterLabel.toLowerCase()}">Delete</button>
    </div>
  `;
}

function syncFilterValueCombobox(entry, result, path, { fallbackToFullRender = true } = {}) {
  const shell = findShellElement(entry);
  const panelSlot = shell?.querySelector?.('[data-base-panel-slot]') ?? null;
  const encodedPath = encodePath(path);
  const input = panelSlot?.querySelector?.(`[data-base-filter-value="${encodedPath}"]`) ?? null;
  const combobox = input?.parentElement?.classList?.contains('bases-filter-value-combobox')
    ? input.parentElement
    : null;
  const rule = getNodeAtPath(getBuilderFilterState(entry, result), path);

  if (!input || !combobox || !rule || rule.type !== 'rule' || typeof input.insertAdjacentHTML !== 'function') {
    if (fallbackToFullRender) {
      updateShellPanel(entry, result);
    }
    return false;
  }

  const presentation = buildFilterValuePresentation(result, rule, path, entry);
  combobox.classList.toggle('has-suggestions', presentation.suggestionsEnabled);
  input.className = presentation.valueInputClasses;
  input.disabled = presentation.valueDisabled;
  input.setAttribute('aria-label', `Filter ${formatFilterPath(path)} value`);
  if (input.value !== String(rule.value ?? '')) {
    input.value = String(rule.value ?? '');
  }

  if (presentation.suggestionsEnabled) {
    input.setAttribute('aria-controls', presentation.suggestionListId);
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('autocomplete', 'off');
  } else {
    input.removeAttribute('aria-controls');
    input.removeAttribute('aria-haspopup');
    input.removeAttribute('aria-autocomplete');
    input.removeAttribute('autocomplete');
  }

  const suggestionList = combobox.querySelector('.bases-filter-suggestion-list');
  suggestionList?.remove?.();
  if (presentation.suggestionsEnabled) {
    insertAfterFromHtml(input, renderFilterSuggestionList(presentation, rule.value ?? ''));
  }

  return true;
}

function forEachFilterRule(node, callback, path = []) {
  if (!node) {
    return;
  }

  if (node.type === 'rule') {
    callback(node, path);
    return;
  }

  (node.children ?? []).forEach((child, index) => {
    forEachFilterRule(child, callback, [...path, index]);
  });
}

function renderFilterGroup(result, group, path, entry, { isRoot = false } = {}) {
  const encodedPath = encodePath(path);
  const groupLabel = isRoot ? 'Root filter group' : `Filter group ${formatFilterPath(path)}`;
  return `
    <div class="bases-filter-group"${isRoot ? ' data-base-filter-root' : ''}>
      <div class="bases-filter-group-header">
        <select class="${escapeHtml(inputClassNames({ extra: 'bases-select bases-filter-conjunction' }))}" data-base-filter-conjunction="${escapeHtml(encodedPath)}" aria-label="${groupLabel} condition">
          ${['and', 'or', 'not'].map((conjunction) => `<option value="${conjunction}"${group.conjunction === conjunction ? ' selected' : ''}>${escapeHtml({
    and: 'All the following are true',
    not: 'None of the following are true',
    or: 'Any of the following are true',
  }[conjunction])}</option>`).join('')}
        </select>
        ${isRoot ? '' : `<button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-filter-remove="${escapeHtml(encodedPath)}" aria-label="Delete ${groupLabel.toLowerCase()}">Delete group</button>`}
      </div>
      <div class="bases-filter-children">
        ${(group.children ?? []).map((child, index) => (
    child?.type === 'group'
      ? renderFilterGroup(result, child, [...path, index], entry)
      : renderFilterRule(result, child, [...path, index], entry)
  )).join('')}
      </div>
      <div class="bases-filter-actions-row">
        <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-filter-add-rule="${escapeHtml(encodedPath)}" aria-label="Add filter to ${groupLabel.toLowerCase()}">Add filter</button>
        <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', size: 'compact' }))}" data-base-filter-add-group="${escapeHtml(encodedPath)}" aria-label="Add filter group to ${groupLabel.toLowerCase()}">Add filter group</button>
      </div>
    </div>
  `;
}

function renderFilterPanel(result, entry) {
  const rawFilters = getEditableViewConfig(result).filters;
  const parsed = entry.ui.builderFilter ?? parseFilterNode(rawFilters);
  if (entry.ui.builderFilter == null) {
    entry.ui.builderFilter = parsed;
  }
  const mode = parsed ? (entry.ui.filterMode ?? 'builder') : 'advanced';
  const rawText = entry.ui.rawFilterText ?? serializeRawFilterText(rawFilters);

  return `
    <section class="bases-panel-card">
      <div class="bases-panel-title-row">
        <div class="bases-panel-title">This view</div>
        ${parsed ? `
          <div class="bases-toggle-row">
            <button type="button" class="${escapeHtml(buttonClassNames({ variant: mode === 'builder' ? 'primary' : 'secondary', size: 'compact' }))}" data-base-filter-mode="builder">Builder</button>
            <button type="button" class="${escapeHtml(buttonClassNames({ variant: mode === 'advanced' ? 'primary' : 'secondary', size: 'compact' }))}" data-base-filter-mode="advanced">Advanced</button>
          </div>
        ` : ''}
      </div>
      ${mode === 'advanced'
      ? `
        <label class="bases-filter-advanced-label">
          <span class="bases-panel-title">Filter expression</span>
          <textarea class="${escapeHtml(inputClassNames({ extra: 'bases-filter-advanced' }))}" data-base-filter-advanced>${escapeHtml(rawText)}</textarea>
        </label>
        <div class="bases-filter-actions-row">
          <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'primary', size: 'compact' }))}" data-base-filter-save-advanced>Save filter</button>
        </div>
      `
      : renderFilterGroup(result, parsed ?? createEmptyFilterGroup('and'), [], entry, { isRoot: true })}
    </section>
  `;
}

function renderPropertiesPanel(result, entry) {
  const propertySearch = String(entry.ui.propertySearch ?? '').trim().toLowerCase();
  const visibleIds = new Set(getVisiblePropertyIds(result));
  const properties = getAvailableProperties(result).filter((property) => (
    !propertySearch
    || property.label.toLowerCase().includes(propertySearch)
    || property.id.toLowerCase().includes(propertySearch)
  ));

  return `
    <section class="bases-panel-card">
      <label class="bases-properties-search">
        <input class="${escapeHtml(inputClassNames({ extra: 'bases-properties-search-input' }))}" type="search" value="${escapeHtml(entry.ui.propertySearch ?? '')}" placeholder="Find property" data-base-properties-search>
      </label>
      <div class="bases-properties-list" data-base-properties-list>
        ${properties.map((property) => `
          <label class="bases-property-option">
            <input type="checkbox" data-base-property-toggle="${escapeHtml(property.id)}"${visibleIds.has(property.id) ? ' checked' : ''}>
            <span class="bases-property-option-label">${escapeHtml(property.label)}</span>
            <span class="bases-property-option-meta">${escapeHtml(property.kind)}</span>
          </label>
        `).join('')}
      </div>
    </section>
  `;
}

function capturePanelState(panelSlot) {
  const propertiesList = panelSlot?.querySelector?.('[data-base-properties-list]') ?? null;
  const propertiesSearch = panelSlot?.querySelector?.('[data-base-properties-search]') ?? null;
  const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
  let focusedControl = null;

  if (propertiesSearch && activeElement === propertiesSearch) {
    const selectionStart = typeof propertiesSearch.selectionStart === 'number'
      ? propertiesSearch.selectionStart
      : null;
    const selectionEnd = typeof propertiesSearch.selectionEnd === 'number'
      ? propertiesSearch.selectionEnd
      : selectionStart;
    focusedControl = {
      selectionEnd,
      selectionStart,
      type: 'properties-search',
    };
  } else if (activeElement?.dataset?.baseFilterValue != null) {
    const filterPath = String(activeElement.dataset.baseFilterValue);
    const filterValue = panelSlot?.querySelector?.(`[data-base-filter-value="${filterPath}"]`) ?? null;
    if (filterValue && activeElement === filterValue) {
      const selectionStart = typeof filterValue.selectionStart === 'number'
        ? filterValue.selectionStart
        : null;
      const selectionEnd = typeof filterValue.selectionEnd === 'number'
        ? filterValue.selectionEnd
        : selectionStart;
      focusedControl = {
        path: filterPath,
        selectionEnd,
        selectionStart,
        type: 'filter-value',
      };
    }
  }

  return {
    focusedControl,
    propertiesListScrollTop: propertiesList ? propertiesList.scrollTop : null,
  };
}

function restorePanelState(panelSlot, panelState) {
  if (!panelState) {
    return;
  }

  if (panelState.propertiesListScrollTop != null) {
    const propertiesList = panelSlot?.querySelector?.('[data-base-properties-list]') ?? null;
    if (propertiesList) {
      propertiesList.scrollTop = panelState.propertiesListScrollTop;
    }
  }

  if (panelState.focusedControl?.type === 'properties-search') {
    const propertiesSearch = panelSlot?.querySelector?.('[data-base-properties-search]') ?? null;
    if (propertiesSearch) {
      propertiesSearch.focus?.();
      if (
        typeof propertiesSearch.setSelectionRange === 'function'
        && panelState.focusedControl.selectionStart != null
      ) {
        propertiesSearch.setSelectionRange(
          panelState.focusedControl.selectionStart,
          panelState.focusedControl.selectionEnd ?? panelState.focusedControl.selectionStart,
        );
      }
    }
    return;
  }

  if (panelState.focusedControl?.type === 'filter-value' && panelState.focusedControl.path != null) {
    const filterValue = panelSlot?.querySelector?.(`[data-base-filter-value="${panelState.focusedControl.path}"]`) ?? null;
    if (filterValue) {
      filterValue.focus?.();
      if (
        typeof filterValue.setSelectionRange === 'function'
        && panelState.focusedControl.selectionStart != null
      ) {
        filterValue.setSelectionRange(
          panelState.focusedControl.selectionStart,
          panelState.focusedControl.selectionEnd ?? panelState.focusedControl.selectionStart,
        );
      }
    }
  }
}

function renderPanel(result, entry) {
  if (!entry.ui?.openPanel) {
    return '';
  }

  if (!getMeta(result).editable) {
    return '<section class="bases-panel-card"><div class="bases-readonly-note">Inline base previews are read-only. Open the .base file to edit its sort, filter, and properties.</div></section>';
  }

  switch (entry.ui.openPanel) {
    case 'filter':
      return renderFilterPanel(result, entry);
    case 'properties':
      return renderPropertiesPanel(result, entry);
    case 'sort':
    default:
      return renderSortPanel(result);
  }
}

function renderShellHtml(result, entry) {
  return `
    <section class="bases-shell" data-base-shell-key="${escapeHtml(entry.key)}">
      <header class="bases-toolbar">
        <div class="bases-toolbar-main">
          <div class="${escapeHtml(segmentedControlClassNames({ pill: true, extra: 'bases-tabs' }))}" data-base-tabs>
            ${renderViewTabs(result)}
          </div>
          <div class="bases-meta" data-base-meta>${escapeHtml(String(result.totalRows ?? 0))} results</div>
        </div>
        <div class="bases-toolbar-actions">
          <div class="bases-toolbar-edit-actions" data-base-action-slot>${renderActionButtons(result, entry)}</div>
          <label class="bases-search-shell" aria-label="Search this base">
            <svg class="bases-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m20 20-3.5-3.5"></path>
            </svg>
            <input class="${escapeHtml(inputClassNames({ extra: 'bases-search-input' }))}" type="search" value="${escapeHtml(entry.search)}" placeholder="Search this base" aria-label="Search this base">
          </label>
          <button type="button" class="${escapeHtml(buttonClassNames({ variant: 'secondary', pill: true, extra: 'bases-export-btn' }))}">Export CSV</button>
        </div>
      </header>
      <div class="bases-panels" data-base-panel-slot>${renderPanel(result, entry)}</div>
      <div data-base-summary-slot>${renderSummaryBar(result.summaries)}</div>
      <div class="bases-content" data-base-content>${renderViewBody(result)}</div>
    </section>
  `;
}

function findShellElement(entry) {
  if (!entry?.placeholder?.querySelector) {
    return null;
  }

  return entry.placeholder.querySelector(`[data-base-shell-key="${entry.key}"]`)
    ?? entry.placeholder.querySelector('.bases-shell');
}

function markPlaceholderHydrated(placeholder) {
  if (!placeholder?.classList) {
    return;
  }

  placeholder.classList.add('is-hydrated');
  placeholder.classList.remove('diagram-preview-shell');
}

function updateShellContent(entry, result, {
  actions = true,
  body = true,
  meta = true,
  panel = true,
  summary = true,
  tabs = true,
} = {}) {
  const shell = findShellElement(entry);
  if (!shell?.querySelector) {
    replaceChildrenFromHtml(entry.placeholder, renderShellHtml(result, entry));
    markPlaceholderHydrated(entry.placeholder);
    return;
  }

  const tabsSlot = shell.querySelector('[data-base-tabs]');
  if (tabs && tabsSlot) {
    replaceChildrenFromHtml(tabsSlot, renderViewTabs(result));
  }

  const metaSlot = shell.querySelector('[data-base-meta]');
  if (meta && metaSlot) {
    metaSlot.textContent = `${String(result.totalRows ?? 0)} results`;
  }

  const actionSlot = shell.querySelector('[data-base-action-slot]');
  if (actions && actionSlot) {
    replaceChildrenFromHtml(actionSlot, renderActionButtons(result, entry));
  }

  const panelSlot = shell.querySelector('[data-base-panel-slot]');
  if (panel && panelSlot) {
    const panelState = capturePanelState(panelSlot);
    replaceChildrenFromHtml(panelSlot, renderPanel(result, entry));
    restorePanelState(panelSlot, panelState);
  }

  const summarySlot = shell.querySelector('[data-base-summary-slot]');
  if (summary && summarySlot) {
    replaceChildrenFromHtml(summarySlot, renderSummaryBar(result.summaries));
  }

  const content = shell.querySelector('[data-base-content]');
  if (body && content) {
    replaceChildrenFromHtml(content, renderViewBody(result));
  }

  const input = shell.querySelector('.bases-search-input');
  if (input && input.value !== entry.search) {
    input.value = entry.search;
  }
}

function updateShellPanel(entry, result) {
  updateShellContent(entry, result, {
    actions: false,
    body: false,
    meta: false,
    summary: false,
    tabs: false,
  });
}

export class BasesPreviewController {
  constructor({
    getActiveFilePath = () => '',
    getSession = () => null,
    onOpenFile,
    previewElement,
    replaceBaseSource = null,
    toastController,
    vaultApiClient,
  }) {
    this.getActiveFilePath = getActiveFilePath;
    this.getSession = getSession;
    this.onOpenFile = onOpenFile;
    this.previewElement = previewElement;
    this.replaceBaseSource = replaceBaseSource;
    this.toastController = toastController;
    this.vaultApiClient = vaultApiClient;
    this.entries = new Map();
    this.searchTimers = new Map();

    this.applyFilterSuggestion = (entry, path, nextValue) => {
      void this.updateBuilderFilter(entry, (group) => updateNodeAtPath(group, path, (node) => ({
        ...node,
        value: nextValue,
      })));
    };

    this.persistBuilderFilter = (entry) => {
      const nextGroup = getBuilderFilterState(entry, entry.result);
      entry.ui.builderFilter = nextGroup;
      void this.updateViewConfig(entry, (config) => {
        config.filters = compileFilterGroup(nextGroup, entry.result);
        return config;
      });
    };

    this.handlePointerDown = (event) => {
      const filterSuggestion = event.target.closest('[data-base-filter-suggestion]');
      if (!filterSuggestion) {
        return;
      }

      const shell = event.target.closest('[data-base-shell-key]');
      const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
      if (!entry) {
        return;
      }

      event.preventDefault();
      const path = decodePath(filterSuggestion.dataset.baseFilterSuggestion || '');
      const nextValue = filterSuggestion.dataset.baseFilterSuggestionValue || '';
      this.applyFilterSuggestion(entry, path, nextValue);
    };

    this.handleClick = (event) => {
      const openButton = event.target.closest('[data-base-open-file]');
      if (openButton) {
        event.preventDefault();
        this.onOpenFile?.(openButton.dataset.baseOpenFile || '');
        return;
      }

      const shell = event.target.closest('[data-base-shell-key]');
      const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
      if (!entry) {
        return;
      }

      const tab = event.target.closest('.bases-view-tab');
      if (tab) {
        entry.payload.view = tab.dataset.baseView || '';
        entry.ui.openPanel = '';
        void this.renderEntry(entry);
        return;
      }

      const panelButton = event.target.closest('[data-base-panel]');
      if (panelButton) {
        const panel = panelButton.dataset.basePanel || '';
        entry.ui.openPanel = entry.ui.openPanel === panel ? '' : panel;
        entry.ui.rawFilterText = serializeRawFilterText(getEditableViewConfig(entry.result).filters);
        updateShellPanel(entry, entry.result);
        return;
      }

      const exportButton = event.target.closest('.bases-export-btn');
      if (exportButton) {
        void this.exportEntry(entry);
        return;
      }

      if (event.target.closest('[data-base-sort-add]')) {
        void this.updateViewConfig(entry, (config) => {
          const used = new Set((config.sort ?? []).map((sort) => sort.property));
          const nextProperty = getAvailableProperties(entry.result).find((property) => !used.has(property.id))?.id ?? 'file.name';
          config.sort = [...(config.sort ?? []), { direction: 'asc', property: nextProperty }];
          return config;
        });
        return;
      }

      const sortDelete = event.target.closest('[data-base-sort-delete]');
      if (sortDelete) {
        const index = Number.parseInt(sortDelete.dataset.baseSortDelete || '', 10);
        void this.updateViewConfig(entry, (config) => {
          config.sort = (config.sort ?? []).filter((_, sortIndex) => sortIndex !== index);
          return config;
        });
        return;
      }

      const sortMove = event.target.closest('[data-base-sort-move]');
      if (sortMove) {
        const [indexText, direction] = String(sortMove.dataset.baseSortMove || '').split(':');
        const index = Number.parseInt(indexText, 10);
        void this.updateViewConfig(entry, (config) => {
          const nextSorts = [...(config.sort ?? [])];
          const targetIndex = direction === 'up' ? index - 1 : index + 1;
          if (targetIndex < 0 || targetIndex >= nextSorts.length) {
            return config;
          }
          [nextSorts[index], nextSorts[targetIndex]] = [nextSorts[targetIndex], nextSorts[index]];
          config.sort = nextSorts;
          return config;
        });
        return;
      }

      if (event.target.closest('[data-base-clear-group-by]')) {
        void this.updateViewConfig(entry, (config) => {
          config.groupBy = null;
          return config;
        });
        return;
      }

      const filterModeButton = event.target.closest('[data-base-filter-mode]');
      if (filterModeButton) {
        entry.ui.filterMode = filterModeButton.dataset.baseFilterMode || 'builder';
        if (entry.ui.filterMode === 'advanced') {
          entry.ui.rawFilterText = serializeRawFilterText(getEditableViewConfig(entry.result).filters);
          entry.ui.builderFilter = null;
        }
        updateShellPanel(entry, entry.result);
        return;
      }

      if (event.target.closest('[data-base-filter-save-advanced]')) {
        void this.saveAdvancedFilter(entry);
        return;
      }

      const addFilterRule = event.target.closest('[data-base-filter-add-rule]');
      if (addFilterRule) {
        const path = decodePath(addFilterRule.dataset.baseFilterAddRule || '');
        void this.updateBuilderFilter(entry, (group) => addNodeAtPath(group, path, {
          operator: 'is',
          propertyId: getAvailableProperties(entry.result)[0]?.id ?? 'file.name',
          type: 'rule',
          value: '',
        }));
        return;
      }

      const addFilterGroup = event.target.closest('[data-base-filter-add-group]');
      if (addFilterGroup) {
        const path = decodePath(addFilterGroup.dataset.baseFilterAddGroup || '');
        void this.updateBuilderFilter(entry, (group) => addNodeAtPath(group, path, createEmptyFilterGroup('and')));
        return;
      }

      const removeFilter = event.target.closest('[data-base-filter-remove]');
      if (removeFilter) {
        const path = decodePath(removeFilter.dataset.baseFilterRemove || '');
        void this.updateBuilderFilter(entry, (group) => removeNodeAtPath(group, path));
        return;
      }

      const filterSuggestion = event.target.closest('[data-base-filter-suggestion]');
      if (filterSuggestion) {
        event.preventDefault?.();
        if (event.detail != null && event.detail !== 0) {
          return;
        }
        const path = decodePath(filterSuggestion.dataset.baseFilterSuggestion || '');
        const nextValue = filterSuggestion.dataset.baseFilterSuggestionValue || '';
        this.applyFilterSuggestion(entry, path, nextValue);
      }
    };

    this.handleInput = (event) => {
      const input = event.target.closest('.bases-search-input');
      if (input) {
        const shell = input.closest('[data-base-shell-key]');
        const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
        if (!entry) {
          return;
        }

        entry.search = input.value || '';
        clearTimeout(this.searchTimers.get(entry.key));
        this.searchTimers.set(entry.key, setTimeout(() => {
          entry.payload.search = entry.search;
          void this.renderEntry(entry);
        }, 180));
        return;
      }

      const propertiesSearch = event.target.closest('[data-base-properties-search]');
      if (propertiesSearch) {
        const shell = propertiesSearch.closest('[data-base-shell-key]');
        const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
        if (!entry) {
          return;
        }

        entry.ui.propertySearch = propertiesSearch.value || '';
        updateShellPanel(entry, entry.result);
        return;
      }

      const advancedFilter = event.target.closest('[data-base-filter-advanced]');
      if (advancedFilter) {
        const shell = advancedFilter.closest('[data-base-shell-key]');
        const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
        if (!entry) {
          return;
        }

        entry.ui.rawFilterText = advancedFilter.value || '';
        return;
      }

      const filterValue = event.target.closest('[data-base-filter-value]');
      if (filterValue) {
        const shell = filterValue.closest('[data-base-shell-key]');
        const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
        if (!entry) {
          return;
        }

        const path = decodePath(filterValue.dataset.baseFilterValue || '');
        const parsed = entry.ui.builderFilter
          ?? parseFilterNode(getEditableViewConfig(entry.result).filters)
          ?? createEmptyFilterGroup('and');
        entry.ui.builderFilter = updateNodeAtPath(parsed, path, (node) => ({
          ...node,
          value: filterValue.value || '',
        }));
        syncFilterValueCombobox(entry, entry.result, path);
      }
    };

    this.handleChange = (event) => {
      const shell = event.target.closest('[data-base-shell-key]');
      const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
      if (!entry) {
        return;
      }

      const groupByProperty = event.target.closest('[data-base-group-by-property]');
      if (groupByProperty) {
        void this.updateViewConfig(entry, (config) => {
          config.groupBy = groupByProperty.value
            ? {
              direction: config.groupBy?.direction ?? 'asc',
              property: groupByProperty.value,
            }
            : null;
          return config;
        });
        return;
      }

      const groupByDirection = event.target.closest('[data-base-group-by-direction]');
      if (groupByDirection) {
        void this.updateViewConfig(entry, (config) => {
          config.groupBy = config.groupBy?.property
            ? {
              direction: groupByDirection.value || 'asc',
              property: config.groupBy.property,
            }
            : null;
          return config;
        });
        return;
      }

      const sortProperty = event.target.closest('[data-base-sort-property]');
      if (sortProperty) {
        const index = Number.parseInt(sortProperty.dataset.baseSortProperty || '', 10);
        void this.updateViewConfig(entry, (config) => {
          config.sort = (config.sort ?? []).map((sortConfig, sortIndex) => (
            sortIndex === index
              ? { ...sortConfig, property: sortProperty.value }
              : sortConfig
          ));
          return config;
        });
        return;
      }

      const sortDirection = event.target.closest('[data-base-sort-direction]');
      if (sortDirection) {
        const index = Number.parseInt(sortDirection.dataset.baseSortDirection || '', 10);
        void this.updateViewConfig(entry, (config) => {
          config.sort = (config.sort ?? []).map((sortConfig, sortIndex) => (
            sortIndex === index
              ? { ...sortConfig, direction: sortDirection.value || 'asc' }
              : sortConfig
          ));
          return config;
        });
        return;
      }

      const propertyToggle = event.target.closest('[data-base-property-toggle]');
      if (propertyToggle) {
        const propertyId = propertyToggle.dataset.basePropertyToggle || '';
        void this.updateViewConfig(entry, (config) => {
          const nextOrder = config.order?.length > 0
            ? [...config.order]
            : getVisiblePropertyIds(entry.result);
          const existingIndex = nextOrder.indexOf(propertyId);
          if (propertyToggle.checked && existingIndex === -1) {
            nextOrder.push(propertyId);
          }
          if (!propertyToggle.checked && existingIndex >= 0) {
            nextOrder.splice(existingIndex, 1);
          }
          config.order = nextOrder;
          return config;
        });
        return;
      }

      const filterConjunction = event.target.closest('[data-base-filter-conjunction]');
      if (filterConjunction) {
        const path = decodePath(filterConjunction.dataset.baseFilterConjunction || '');
        void this.updateBuilderFilter(entry, (group) => updateNodeAtPath(group, path, (node) => ({
          ...node,
          conjunction: filterConjunction.value || 'and',
        })));
        return;
      }

      const filterProperty = event.target.closest('[data-base-filter-property]');
      if (filterProperty) {
        const path = decodePath(filterProperty.dataset.baseFilterProperty || '');
        void (async () => {
          await this.updateBuilderFilter(entry, (group) => updateNodeAtPath(group, path, (node) => {
            const nextOperators = getPropertyFilterOperators(entry.result, filterProperty.value);
            const nextOperator = nextOperators[0] ?? 'is';
            return {
              ...node,
              operator: nextOperator,
              propertyId: filterProperty.value,
              value: '',
            };
          }));
          await this.ensurePropertyValues(entry, filterProperty.value);
        })();
        return;
      }

      const filterOperator = event.target.closest('[data-base-filter-operator]');
      if (filterOperator) {
        const path = decodePath(filterOperator.dataset.baseFilterOperator || '');
        void this.updateBuilderFilter(entry, (group) => updateNodeAtPath(group, path, (node) => ({
          ...node,
          operator: filterOperator.value || 'is',
        })));
        return;
      }

      const filterValue = event.target.closest('[data-base-filter-value]');
      if (filterValue) {
        this.persistBuilderFilter(entry);
      }
    };

    this.handleFocusIn = (event) => {
      const filterValue = event.target.closest('[data-base-filter-value]');
      if (!filterValue) {
        return;
      }

      const shell = filterValue.closest('[data-base-shell-key]');
      const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
      if (!entry) {
        return;
      }

      const path = decodePath(filterValue.dataset.baseFilterValue || '');
      const parsed = parseFilterNode(getEditableViewConfig(entry.result).filters);
      const node = parsed ? getNodeAtPath(parsed, path) : null;
      if (node?.propertyId) {
        void this.ensurePropertyValues(entry, node.propertyId);
      }
    };

    this.previewElement?.addEventListener('pointerdown', this.handlePointerDown);
    this.previewElement?.addEventListener('click', this.handleClick);
    this.previewElement?.addEventListener('input', this.handleInput);
    this.previewElement?.addEventListener('change', this.handleChange);
    this.previewElement?.addEventListener('focusin', this.handleFocusIn);
  }

  ensureEntryState(entry) {
    if (!entry.ui) {
      entry.ui = {
        builderFilter: null,
        filterMode: 'builder',
        openPanel: '',
        propertySearch: '',
        rawFilterText: '',
      };
    }

    if (!Object.prototype.hasOwnProperty.call(entry.ui, 'builderFilter')) {
      entry.ui.builderFilter = null;
    }

    if (!entry.propertyValueOptions) {
      entry.propertyValueOptions = new Map();
    }
  }

  destroy() {
    this.previewElement?.removeEventListener('pointerdown', this.handlePointerDown);
    this.previewElement?.removeEventListener('click', this.handleClick);
    this.previewElement?.removeEventListener('input', this.handleInput);
    this.previewElement?.removeEventListener('change', this.handleChange);
    this.previewElement?.removeEventListener('focusin', this.handleFocusIn);
    this.searchTimers.forEach((timer) => clearTimeout(timer));
    this.searchTimers.clear();
    this.entries.clear();
  }

  reconcileEmbeds(previewElement = this.previewElement) {
    if (!previewElement) {
      return;
    }

    Array.from(previewElement.querySelectorAll('.bases-embed-placeholder[data-base-key]')).forEach((placeholder) => {
      const key = placeholder.dataset.baseKey || createShellKey();
      const existing = this.entries.get(key);
      const payload = {
        path: placeholder.dataset.basePath || '',
        search: '',
        source: placeholder.dataset.baseSource || null,
        sourcePath: placeholder.dataset.baseSourcePath || '',
        view: placeholder.dataset.baseView || '',
      };
      const entry = existing ?? {
        key,
        payload,
        placeholder,
        propertyValueOptions: new Map(),
        requestVersion: 0,
        result: null,
        search: '',
        ui: {
          builderFilter: null,
          filterMode: 'builder',
          openPanel: '',
          propertySearch: '',
          rawFilterText: '',
        },
      };
      entry.payload = payload;
      entry.placeholder = placeholder;
      this.entries.set(key, entry);
      void this.renderEntry(entry);
    });
  }

  async renderStandalone({ filePath, renderHost, source = null }) {
    const key = `standalone:${filePath}`;
    const entry = this.entries.get(key) ?? {
      key,
      payload: {
        path: filePath,
        search: '',
        source,
        sourcePath: filePath,
        view: '',
      },
      placeholder: renderHost,
      propertyValueOptions: new Map(),
      requestVersion: 0,
      result: null,
      search: '',
      ui: {
        builderFilter: null,
        filterMode: 'builder',
        openPanel: '',
        propertySearch: '',
        rawFilterText: '',
      },
    };
    entry.placeholder = renderHost;
    entry.payload.path = filePath;
    entry.payload.source = typeof source === 'string' ? source : null;
    entry.payload.sourcePath = filePath;
    this.entries.set(key, entry);
    await this.renderEntry(entry);
  }

  async renderEntry(entry) {
    this.ensureEntryState(entry);
    if (!entry?.placeholder?.isConnected) {
      return;
    }

    const requestVersion = (entry.requestVersion ?? 0) + 1;
    entry.requestVersion = requestVersion;
    const hasShell = Boolean(findShellElement(entry));
    if (!hasShell) {
      replaceChildrenFromHtml(entry.placeholder, '<div class="preview-shell" role="status" aria-live="polite">Loading base…</div>');
    }
    try {
      const response = await this.vaultApiClient.queryBase({
        activeFilePath: this.getActiveFilePath?.() ?? '',
        ...entry.payload,
      });
      if (requestVersion !== entry.requestVersion || !entry?.placeholder?.isConnected) {
        return;
      }
      entry.result = response.result;
      entry.ui.builderFilter = parseFilterNode(getEditableViewConfig(entry.result).filters);
      if (!entry.ui.rawFilterText) {
        entry.ui.rawFilterText = serializeRawFilterText(getEditableViewConfig(entry.result).filters);
      }
      updateShellContent(entry, entry.result);
    } catch (error) {
      if (requestVersion !== entry.requestVersion || !entry?.placeholder?.isConnected) {
        return;
      }
      if (hasShell) {
        const shell = findShellElement(entry);
        const content = shell?.querySelector?.('[data-base-content]') ?? null;
        if (content) {
          replaceChildrenFromHtml(content, `<div class="preview-shell" role="alert">Failed to load base: ${escapeHtml(error.message || 'Unknown error')}</div>`);
          return;
        }
      }
      replaceChildrenFromHtml(entry.placeholder, `<div class="preview-shell" role="alert">Failed to load base: ${escapeHtml(error.message || 'Unknown error')}</div>`);
    }
  }

  async exportEntry(entry) {
    this.ensureEntryState(entry);
    try {
      const response = await this.vaultApiClient.exportBaseCsv({
        activeFilePath: this.getActiveFilePath?.() ?? '',
        ...entry.payload,
      });
      downloadBlob(response.blob, parseDownloadFileName(response.contentDisposition, 'base.csv'), {
        removeDelayMs: 0,
        revokeDelayMs: 0,
      });
    } catch (error) {
      this.toastController?.show?.(error.message || 'Failed to export base CSV');
    }
  }

  async ensurePropertyValues(entry, propertyId = '') {
    this.ensureEntryState(entry);
    if (!propertyId) {
      return;
    }

    const cacheKey = createPropertyValuesCacheKey(entry, propertyId);
    const cachedEntry = entry.propertyValueOptions.get(propertyId) ?? null;
    if (cachedEntry?.cacheKey === cacheKey) {
      return;
    }

    try {
      const response = await this.vaultApiClient.queryBasePropertyValues({
        activeFilePath: this.getActiveFilePath?.() ?? '',
        ...entry.payload,
        propertyId,
      });
      entry.propertyValueOptions.set(propertyId, {
        cacheKey,
        values: response.result?.values ?? [],
      });
      if (entry.result && entry.ui.openPanel === 'filter') {
        let synced = false;
        forEachFilterRule(getBuilderFilterState(entry, entry.result), (rule, path) => {
          if (rule.propertyId === propertyId) {
            synced = syncFilterValueCombobox(entry, entry.result, path, { fallbackToFullRender: false }) || synced;
          }
        });
        if (!synced) {
          updateShellPanel(entry, entry.result);
        }
      }
    } catch {
      entry.propertyValueOptions.set(propertyId, {
        cacheKey,
        values: [],
      });
    }
  }

  async applyTransformedSource(entry, transformed) {
    this.ensureEntryState(entry);
    if (isStandaloneBaseEntry(entry)) {
      entry.payload.source = transformed.source;
      this.replaceBaseSource?.({
        path: entry.payload.path,
        source: transformed.source,
      });
      return;
    }

    await this.vaultApiClient.writeFile({
      content: transformed.source,
      path: entry.payload.path,
    });
    entry.payload.source = null;
  }

  async updateViewConfig(entry, updater) {
    this.ensureEntryState(entry);
    if (!entry?.result || !getMeta(entry.result).editable) {
      return;
    }

    const nextConfig = updater(getEditableViewConfig(entry.result));
    try {
      const response = await this.vaultApiClient.transformBase({
        activeFilePath: this.getActiveFilePath?.() ?? '',
        mutation: {
          config: nextConfig,
          type: 'set-view-config',
          view: entry.result.view.id,
        },
        ...entry.payload,
      });
      const transformed = response.result;
      await this.applyTransformedSource(entry, transformed);
      entry.result = transformed.result;
      entry.ui.rawFilterText = serializeRawFilterText(getEditableViewConfig(entry.result).filters);
      updateShellContent(entry, entry.result);
    } catch (error) {
      this.toastController?.show?.(error.message || 'Failed to update base');
    }
  }

  async updateBuilderFilter(entry, updater) {
    this.ensureEntryState(entry);
    const parsed = entry.ui.builderFilter ?? parseFilterNode(getEditableViewConfig(entry.result).filters) ?? createEmptyFilterGroup('and');
    const nextGroup = updater(parsed);
    entry.ui.builderFilter = nextGroup;
    await this.updateViewConfig(entry, (config) => {
      config.filters = compileFilterGroup(nextGroup, entry.result);
      return config;
    });
  }

  async saveAdvancedFilter(entry) {
    this.ensureEntryState(entry);
    try {
      const parsed = parseRawFilterText(entry.ui.rawFilterText ?? '');
      entry.ui.builderFilter = parseFilterNode(parsed);
      await this.updateViewConfig(entry, (config) => {
        config.filters = parsed;
        return config;
      });
    } catch (error) {
      this.toastController?.show?.(error.message || 'Invalid advanced filter');
    }
  }
}
