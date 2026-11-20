import { isImageAttachmentFilePath } from '../../../domain/file-kind.js';
import { parseDateValue, toDisplayText } from './base-expression-runtime.js';

const FILE_PROPERTY_DEFINITIONS = [
  { id: 'file.name', kind: 'file', label: 'file name', valueType: 'text' },
  { id: 'file.basename', kind: 'file', label: 'file base name', valueType: 'text' },
  { id: 'file.backlinks', kind: 'file', label: 'file backlinks', valueType: 'list' },
  { id: 'file.ctime', kind: 'file', label: 'created time', valueType: 'date' },
  { id: 'file.embeds', kind: 'file', label: 'file embeds', valueType: 'list' },
  { id: 'file.ext', kind: 'file', label: 'file extension', valueType: 'text' },
  { id: 'file.folder', kind: 'file', label: 'folder', valueType: 'text' },
  { id: 'file.links', kind: 'file', label: 'file links', valueType: 'list' },
  { id: 'file.mtime', kind: 'file', label: 'modified time', valueType: 'date' },
  { id: 'file.path', kind: 'file', label: 'file path', valueType: 'text' },
  { id: 'file.size', kind: 'file', label: 'file size', valueType: 'number' },
  { id: 'file.tags', kind: 'file', label: 'file tags', valueType: 'list' },
];

function simplifyType(type) {
  if (!type || type === 'unknown') {
    return 'unknown';
  }

  return type;
}

function mergeTypes(left = 'unknown', right = 'unknown') {
  if (left === 'unknown') {
    return right;
  }
  if (right === 'unknown' || left === right) {
    return left;
  }

  const scalarTypes = new Set(['boolean', 'date', 'number', 'text', 'image', 'link']);
  if (scalarTypes.has(left) && scalarTypes.has(right)) {
    if ((left === 'image' && right === 'text') || (left === 'text' && right === 'image')) {
      return 'image';
    }
    if ((left === 'link' && right === 'text') || (left === 'text' && right === 'link')) {
      return 'link';
    }
    return 'text';
  }

  if (left === 'list' || right === 'list') {
    return 'list';
  }

  return 'unknown';
}

export function inferValueType(value) {
  if (value == null || value === '') {
    return 'unknown';
  }

  if (Array.isArray(value)) {
    return 'list';
  }

  if (value instanceof Date) {
    return 'date';
  }

  if (value?.__baseType === 'link') {
    return 'link';
  }

  if (value?.__baseType === 'file') {
    return 'link';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'string') {
    if (isImageAttachmentFilePath(value)) {
      return 'image';
    }

    if (parseDateValue(value)) {
      return 'date';
    }

    return 'text';
  }

  return 'unknown';
}

function createSortDirections(valueType = 'text') {
  switch (valueType) {
    case 'date':
      return [
        { id: 'asc', label: 'Old to new' },
        { id: 'desc', label: 'New to old' },
      ];
    case 'number':
      return [
        { id: 'asc', label: '0 → 1' },
        { id: 'desc', label: '1 → 0' },
      ];
    default:
      return [
        { id: 'asc', label: 'A → Z' },
        { id: 'desc', label: 'Z → A' },
      ];
  }
}

function createFilterOperators(valueType = 'text') {
  if (valueType === 'boolean') {
    return ['is', 'is not', 'is empty', 'is not empty'];
  }

  if (valueType === 'number' || valueType === 'date') {
    return ['is', 'is not', '>', '>=', '<', '<=', 'is empty', 'is not empty'];
  }

  if (valueType === 'list') {
    return ['contains', 'does not contain', 'is empty', 'is not empty'];
  }

  return ['is', 'is not', 'contains', 'does not contain', 'starts with', 'ends with', 'is empty', 'is not empty'];
}

export function createPropertyCatalogSnapshot(snapshot) {
  const noteProperties = new Map();

  snapshot?.rowsByPath?.forEach((row) => {
    Object.entries(row?.noteProperties ?? {}).forEach(([propertyName, value]) => {
      const propertyId = `note.${propertyName}`;
      const current = noteProperties.get(propertyId) ?? {
        id: propertyId,
        kind: 'note',
        label: propertyName,
        valueType: 'unknown',
      };
      current.valueType = mergeTypes(current.valueType, inferValueType(value));
      noteProperties.set(propertyId, current);
    });
  });

  return {
    fileProperties: FILE_PROPERTY_DEFINITIONS.map((entry) => ({ ...entry })),
    noteProperties: Array.from(noteProperties.values()).sort((left, right) => left.label.localeCompare(right.label)),
  };
}

export function buildAvailableProperties({
  activeView,
  columns = [],
  definition,
  formulaValueTypes = {},
  propertyCatalog,
}) {
  const visibleIds = new Set(
    Array.isArray(activeView?.order) && activeView.order.length > 0
      ? activeView.order
      : columns.map((column) => column.id),
  );
  const baseProperties = [
    ...(propertyCatalog?.fileProperties ?? []),
    ...(propertyCatalog?.noteProperties ?? []),
  ];

  const formulaProperties = Object.values(definition?.formulas ?? {}).map((formula) => ({
    id: formula.id,
    kind: 'formula',
    label: definition?.properties?.[formula.id]?.displayName ?? formula.name,
    valueType: simplifyType(formulaValueTypes[formula.id] ?? 'unknown'),
  }));

  return [...baseProperties, ...formulaProperties]
    .map((property) => {
      const valueType = simplifyType(property.valueType);
      return {
        filterOperators: createFilterOperators(valueType),
        groupable: true,
        id: property.id,
        kind: property.kind,
        label: property.label,
        sortable: true,
        sortDirections: createSortDirections(valueType),
        valueType,
        visible: visibleIds.has(property.id),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function flattenValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenValues(entry));
  }

  if (value == null || value === '') {
    return [];
  }

  return [value];
}

export function collectDistinctPropertyValues(rows = [], propertyId = '', query = '') {
  const counts = new Map();
  const normalizedQuery = String(query ?? '').trim().toLowerCase();

  rows.forEach((row) => {
    flattenValues(row?.rawCells?.[propertyId]).forEach((value) => {
      const text = toDisplayText(value);
      if (!text) {
        return;
      }

      if (normalizedQuery && !text.toLowerCase().includes(normalizedQuery)) {
        return;
      }

      const entry = counts.get(text) ?? {
        count: 0,
        text,
        value,
      };
      entry.count += 1;
      counts.set(text, entry);
    });
  });

  return Array.from(counts.values())
    .sort((left, right) => (
      right.count - left.count
      || left.text.localeCompare(right.text)
    ))
    .slice(0, 100);
}
