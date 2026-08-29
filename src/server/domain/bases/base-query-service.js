import {
  buildColumns,
  collectEvaluatedPropertyIds,
  findView,
  normalizeBaseDefinition,
} from './base-definition.js';
import {
  compareValues,
  createEvaluationRootContext,
  evaluateFilterNode,
  getPropertyValue,
  serializeBaseValue,
} from './base-expression-runtime.js';
import { BaseIndexSnapshotStore } from './base-index-snapshot-store.js';
import {
  buildAvailableProperties,
  collectDistinctPropertyValues,
  createPropertyCatalogSnapshot,
  inferValueType,
} from './base-query-metadata.js';
import { buildQueryResultPayload, rowMatchesSearch } from './base-query-results.js';
import { transformBaseSource } from './base-transform.js';

export { serializeBaseDefinition } from './base-definition.js';

const BASE_QUERY_ROW_CHUNK_SIZE = 50;

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function buildSortChain(activeView) {
  const entries = [];
  (activeView.sort ?? []).forEach((sortConfig) => {
    if (
      sortConfig?.property
      && !entries.some((entry) => entry.property === sortConfig.property)
    ) {
      entries.push(sortConfig);
    }
  });
  return entries;
}

function sortRows(rows, sortChain = []) {
  if (!Array.isArray(sortChain) || sortChain.length === 0) {
    return rows;
  }

  return rows.slice().sort((left, right) => {
    for (const sortConfig of sortChain) {
      const delta = compareValues(left.rawCells[sortConfig.property], right.rawCells[sortConfig.property]);
      if (delta !== 0) {
        return sortConfig.direction === 'desc' ? -delta : delta;
      }
    }

    return String(left.file.path ?? '').localeCompare(String(right.file.path ?? ''));
  });
}

function compareRowsBySortChain(left, right, sortChain = []) {
  for (const sortConfig of sortChain) {
    const delta = compareValues(left.rawCells[sortConfig.property], right.rawCells[sortConfig.property]);
    if (delta !== 0) {
      return sortConfig.direction === 'desc' ? -delta : delta;
    }
  }

  return String(left.file.path ?? '').localeCompare(String(right.file.path ?? ''));
}

function insertSortedBounded(rows, row, {
  limit,
  sortChain = [],
}) {
  let insertIndex = rows.findIndex((existingRow) => compareRowsBySortChain(row, existingRow, sortChain) < 0);
  if (insertIndex === -1) {
    insertIndex = rows.length;
  }

  rows.splice(insertIndex, 0, row);
  if (rows.length > limit) {
    rows.pop();
  }
}

function pruneFilterNodeForProperty(filterNode, propertyId = '') {
  if (!propertyId || !filterNode) {
    return filterNode;
  }

  if (typeof filterNode === 'string') {
    const escapedPropertyId = RegExp.escape(String(propertyId));
    const propertyFilterPattern = new RegExp(
      `^!?${escapedPropertyId}(?:\\.(?:contains|startsWith|endsWith|isEmpty)\\(.*\\)|\\s*(?:==|!=|>=|<=|>|<)\\s*.+)$`,
      'u',
    );
    return propertyFilterPattern.test(String(filterNode ?? '').trim()) ? null : filterNode;
  }

  if (Array.isArray(filterNode?.and)) {
    const children = filterNode.and
      .map((child) => pruneFilterNodeForProperty(child, propertyId))
      .filter(Boolean);
    return children.length > 0 ? { and: children } : null;
  }

  if (Array.isArray(filterNode?.or)) {
    const children = filterNode.or
      .map((child) => pruneFilterNodeForProperty(child, propertyId))
      .filter(Boolean);
    return children.length > 0 ? { or: children } : null;
  }

  if (filterNode?.not != null) {
    if (Array.isArray(filterNode.not)) {
      const children = filterNode.not
        .map((child) => pruneFilterNodeForProperty(child, propertyId))
        .filter(Boolean);
      return children.length > 0 ? { not: children } : null;
    }

    const child = pruneFilterNodeForProperty(filterNode.not, propertyId);
    return child ? { not: child } : null;
  }

  return filterNode;
}

export class BaseQueryService {
  constructor({
    maxResultRows = 5_000,
    vaultFileStore,
    workspaceStateProvider = null,
    workspaceStateSynchronizer = null,
  }) {
    this.maxResultRows = maxResultRows;
    this.vaultFileStore = vaultFileStore;
    this.snapshotStore = new BaseIndexSnapshotStore({
      vaultFileStore,
      workspaceStateProvider,
      workspaceStateSynchronizer,
    });
    this.definitionCache = new Map();
    this.propertyCatalogCache = new Map();
  }

  async applyWorkspaceChange(...args) {
    const result = await this.snapshotStore.applyWorkspaceChange(...args);
    const scannedAt = this.snapshotStore.indexSnapshot?.scannedAt;
    if (scannedAt) {
      this.invalidatePropertyCatalogsExcept(scannedAt);
    } else {
      this.propertyCatalogCache.clear();
    }
    return result;
  }

  getCachedDefinition(cacheKey, baseSource) {
    const sourceText = String(baseSource ?? '');
    const existing = this.definitionCache.get(cacheKey);
    if (existing?.source === sourceText) {
      return existing.definition;
    }

    const definition = normalizeBaseDefinition(sourceText);
    this.definitionCache.set(cacheKey, {
      definition,
      source: sourceText,
    });
    if (this.definitionCache.size > 50) {
      const firstKey = this.definitionCache.keys().next().value;
      this.definitionCache.delete(firstKey);
    }
    return definition;
  }

  invalidatePropertyCatalogsExcept(scannedAt = '') {
    Array.from(this.propertyCatalogCache.keys()).forEach((cacheKey) => {
      if (cacheKey !== scannedAt) {
        this.propertyCatalogCache.delete(cacheKey);
      }
    });
  }

  async resolveQueryContext({
    activeFilePath = '',
    basePath = '',
    source = null,
    sourcePath = '',
    view: requestedView = '',
  } = {}) {
    const baseSource = source ?? (basePath ? await this.vaultFileStore.readBaseFile(basePath) : '');
    if (typeof baseSource !== 'string') {
      throw new Error('Base source not found');
    }

    const definition = this.getCachedDefinition(source === null ? `file:${basePath}` : `source:${sourcePath}:${basePath}`, baseSource);
    const snapshot = await this.snapshotStore.ensureIndexSnapshot({
      basePath,
      sourcePath,
    });
    this.invalidatePropertyCatalogsExcept(snapshot?.scannedAt ?? '');

    const thisFilePath = sourcePath || activeFilePath || basePath || '';
    const thisFile = snapshot.rowsByPath.get(thisFilePath)?.file ?? null;
    const activeView = findView(definition, requestedView);
    const columns = buildColumns(definition, activeView);
    const evaluatedPropertyIds = collectEvaluatedPropertyIds(columns, activeView);

    return {
      activeView,
      basePath,
      baseSource,
      columns,
      definition,
      evaluatedPropertyIds,
      snapshot,
      sourcePath,
      thisFile,
    };
  }

  async collectCandidateRows({
    activeView,
    astCache = new Map(),
    columns = [],
    definition,
    evaluatedPropertyIds,
    limit = null,
    maxRows = this.maxResultRows,
    snapshot,
    sortChain = [],
    search = '',
    thisFile,
  }) {
    const rows = [];
    const effectiveMaxRows = Number.isInteger(maxRows) && maxRows > 0 ? maxRows : Infinity;
    const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : Infinity;
    const canBoundDuringCollection = Number.isFinite(Math.min(effectiveLimit, effectiveMaxRows))
      && sortChain.length > 0
      && !activeView.groupBy?.property
      && (activeView.summaries?.length ?? 0) === 0;
    const hardLimit = Math.min(effectiveLimit, effectiveMaxRows);

    const filePaths = snapshot.filePaths ?? [];
    for (let chunkStart = 0; chunkStart < filePaths.length; chunkStart += BASE_QUERY_ROW_CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + BASE_QUERY_ROW_CHUNK_SIZE, filePaths.length);
      for (let index = chunkStart; index < chunkEnd; index += 1) {
        const filePath = filePaths[index];
        const row = snapshot.rowsByPath.get(filePath);
        if (!row) {
          continue;
        }

        const rowContext = this.createRowQueryContext({
          astCache,
          definition,
          row,
          snapshot,
          thisFile,
        });
        if (!evaluateFilterNode(definition.filters, rowContext) || !evaluateFilterNode(activeView.filters, rowContext)) {
          continue;
        }

        const rawCells = {};
        evaluatedPropertyIds.forEach((propertyId) => {
          rawCells[propertyId] = getPropertyValue(propertyId, row, definition, snapshot, thisFile, rowContext);
        });

        const candidateRow = {
          file: row.file,
          rawCells,
        };
        if (!rowMatchesSearch(candidateRow, columns, search)) {
          continue;
        }

        if (canBoundDuringCollection) {
          insertSortedBounded(rows, candidateRow, {
            limit: hardLimit,
            sortChain,
          });
          continue;
        }

        rows.push(candidateRow);
      }

      if (chunkEnd < filePaths.length) {
        await yieldToEventLoop();
      }
    }

    return rows;
  }

  createRowQueryContext({
    astCache = new Map(),
    definition,
    row,
    snapshot,
    thisFile,
  }) {
    return createEvaluationRootContext({
      astCache,
      currentRow: row,
      definition,
      snapshot,
      thisFile,
    });
  }

  getPropertyCatalog(snapshot) {
    const cacheKey = snapshot?.scannedAt ?? 'unknown';
    if (!this.propertyCatalogCache.has(cacheKey)) {
      this.propertyCatalogCache.set(cacheKey, createPropertyCatalogSnapshot(snapshot));
    }

    return this.propertyCatalogCache.get(cacheKey);
  }

  inferFormulaValueTypes(definition, rows = []) {
    const valueTypes = {};

    Object.keys(definition.formulas ?? {}).forEach((propertyId) => {
      let inferred = 'unknown';
      for (const row of rows) {
        inferred = inferValueType(row?.rawCells?.[propertyId]);
        if (inferred !== 'unknown') {
          break;
        }
      }
      valueTypes[propertyId] = inferred;
    });

    return valueTypes;
  }

  buildMeta({
    activeView,
    basePath = '',
    columns,
    definition,
    rows,
    snapshot,
  }) {
    const propertyCatalog = this.getPropertyCatalog(snapshot);
    const formulaValueTypes = this.inferFormulaValueTypes(definition, rows);

    return {
      activeViewConfig: {
        filters: activeView.filters ?? null,
        groupBy: activeView.groupBy ?? null,
        order: [...(activeView.order ?? [])],
        sort: (activeView.sort ?? []).map((entry) => ({ ...entry })),
      },
      availableProperties: buildAvailableProperties({
        activeView,
        columns,
        definition,
        formulaValueTypes,
        propertyCatalog,
      }),
      editable: Boolean(basePath),
    };
  }

  async query({
    activeFilePath = '',
    basePath = '',
    includeCsv = false,
    search = '',
    source = null,
    sourcePath = '',
    view: requestedView = '',
  } = {}) {
    const context = await this.resolveQueryContext({
      activeFilePath,
      basePath,
      source,
      sourcePath,
      view: requestedView,
    });

    const astCache = new Map();
    const sortChain = buildSortChain(context.activeView);
    const requestedLimit = Number.isInteger(context.activeView.limit) && context.activeView.limit > 0
      ? context.activeView.limit
      : null;
    let rows = await this.collectCandidateRows({
      ...context,
      astCache,
      limit: requestedLimit,
      maxRows: this.maxResultRows,
      search,
      sortChain,
    });
    rows = sortRows(rows, sortChain);

    if (requestedLimit != null) {
      rows = rows.slice(0, Math.min(requestedLimit, this.maxResultRows));
    } else if (Number.isInteger(this.maxResultRows) && this.maxResultRows > 0) {
      rows = rows.slice(0, this.maxResultRows);
    }

    const payload = buildQueryResultPayload({
      activeView: context.activeView,
      columns: context.columns,
      definition: context.definition,
      includeCsv,
      rows,
      snapshot: context.snapshot,
      thisFile: context.thisFile,
    });

    return {
      columns: context.columns,
      definition: context.definition,
      meta: this.buildMeta({
        activeView: context.activeView,
        basePath,
        columns: context.columns,
        definition: context.definition,
        rows,
        snapshot: context.snapshot,
      }),
      ...payload,
      view: {
        ...context.activeView,
        supported: context.activeView.supported,
      },
      views: context.definition.views.map((view) => ({
        id: view.id,
        name: view.name,
        supported: view.supported,
        type: view.type,
      })),
    };
  }

  async propertyValues({
    activeFilePath = '',
    basePath = '',
    propertyId = '',
    query = '',
    source = null,
    sourcePath = '',
    view: requestedView = '',
  } = {}) {
    if (!propertyId) {
      throw new Error('Missing propertyId');
    }

    const context = await this.resolveQueryContext({
      activeFilePath,
      basePath,
      source,
      sourcePath,
      view: requestedView,
    });
    const propertyValueContext = {
      ...context,
      activeView: {
        ...context.activeView,
        filters: pruneFilterNodeForProperty(context.activeView?.filters, propertyId),
      },
      definition: {
        ...context.definition,
        filters: pruneFilterNodeForProperty(context.definition?.filters, propertyId),
      },
    };
    const astCache = new Map();
    const rows = await this.collectCandidateRows({
      ...propertyValueContext,
      astCache,
      evaluatedPropertyIds: [...new Set([
        ...(context.evaluatedPropertyIds ?? []),
        propertyId,
      ])],
    });
    const values = collectDistinctPropertyValues(rows, propertyId, query).map((entry) => ({
      count: entry.count,
      text: entry.text,
      value: serializeBaseValue(entry.value, {
        snapshot: context.snapshot,
        sourcePath: context.thisFile?.path ?? '',
      }),
    }));

    return {
      ok: true,
      propertyId,
      values,
    };
  }

  async transform({
    activeFilePath = '',
    basePath = '',
    mutation = null,
    source = null,
    sourcePath = '',
    view = '',
  } = {}) {
    if (!basePath) {
      throw new Error('Only .base files can be transformed');
    }

    const baseSource = source ?? await this.vaultFileStore.readBaseFile(basePath);
    if (typeof baseSource !== 'string') {
      throw new Error('Base source not found');
    }

    const nextSource = transformBaseSource(baseSource, mutation);
    const result = await this.query({
      activeFilePath,
      basePath,
      source: nextSource,
      sourcePath,
      view,
    });

    return {
      meta: result.meta,
      result,
      source: nextSource,
    };
  }
}
