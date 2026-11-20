import { dump as dumpYaml } from 'js-yaml';

import {
  findView,
  isPlainObject,
  normalizeBaseDefinition,
  normalizeRawDefinitionForWrite,
  parseBaseSource,
} from './base-definition.js';

function serializeSort(sort = []) {
  return sort
    .filter((entry) => entry?.property)
    .map((entry) => ({
      direction: String(entry.direction ?? 'asc').toUpperCase(),
      property: entry.property,
    }));
}

export function transformBaseSource(source = '', mutation = {}) {
  const mutationType = String(mutation?.type ?? '');
  if (mutationType !== 'set-view-config') {
    throw new Error(`Unsupported base mutation: ${mutationType || 'unknown'}`);
  }

  const definition = normalizeBaseDefinition(source);
  const parsedSource = parseBaseSource(source);
  const rawDefinition = normalizeRawDefinitionForWrite({
    raw: isPlainObject(parsedSource) ? parsedSource : {},
  });

  const activeView = findView(definition, mutation.view ?? '');
  const viewIndex = definition.views.findIndex((view) => view.id === activeView.id);
  if (viewIndex < 0) {
    throw new Error('Base view not found');
  }

  if (!Array.isArray(rawDefinition.views) || rawDefinition.views.length === 0) {
    rawDefinition.views = [{ name: 'Table', type: 'table' }];
  }

  const nextView = isPlainObject(rawDefinition.views[viewIndex]) ? { ...rawDefinition.views[viewIndex] } : {};
  const nextConfig = isPlainObject(mutation.config) ? mutation.config : {};

  if (Object.hasOwn(nextConfig, 'order')) {
    nextView.order = Array.isArray(nextConfig.order)
      ? nextConfig.order.filter((entry) => typeof entry === 'string' && entry.trim())
      : [];
  }

  if (Object.hasOwn(nextConfig, 'sort')) {
    const sort = serializeSort(nextConfig.sort);
    if (sort.length > 0) {
      nextView.sort = sort;
    } else {
      delete nextView.sort;
      delete nextView.sorts;
    }
  }

  if (Object.hasOwn(nextConfig, 'groupBy')) {
    if (nextConfig.groupBy?.property) {
      nextView.groupBy = {
        direction: String(nextConfig.groupBy.direction ?? 'asc').toUpperCase(),
        property: nextConfig.groupBy.property,
      };
    } else {
      delete nextView.groupBy;
      delete nextView.group_by;
    }
  }

  if (Object.hasOwn(nextConfig, 'filters')) {
    if (nextConfig.filters == null || nextConfig.filters === '') {
      delete nextView.filters;
    } else {
      nextView.filters = nextConfig.filters;
    }
  }

  rawDefinition.views[viewIndex] = nextView;
  return `${dumpYaml(normalizeRawDefinitionForWrite(rawDefinition), { lineWidth: -1, noRefs: true }).trim()}\n`;
}
