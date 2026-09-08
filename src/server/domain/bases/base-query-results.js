import {
  compareValues,
  createEvaluationRootContext,
  evaluateExpression,
  serializeBaseValue,
  toDisplayText,
  valuesEqual,
} from './base-expression-runtime.js';

function summarizeValues(values = [], summary, definition, snapshot, thisFile) {
  const meaningfulValues = values.filter((value) => value != null && value !== '');
  switch (summary.type) {
    case 'average': {
      const numbers = meaningfulValues.map(Number).filter(Number.isFinite);
      return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    }
    case 'checked':
      return values.filter(Boolean).length;
    case 'custom': {
      const context = createEvaluationRootContext({
        astCache: new Map(),
        currentRow: {
          file: thisFile,
          noteProperties: thisFile?.properties ?? {},
        },
        definition,
        identifierResolver: (name) => (name === 'values' ? values : undefined),
        snapshot,
        thisFile,
      });
      return evaluateExpression(summary.formula, context);
    }
    case 'earliest':
      return meaningfulValues.reduce((acc, value) => (acc == null || compareValues(value, acc) < 0 ? value : acc), null);
    case 'empty':
      return values.filter((value) => value == null || value === '').length;
    case 'filled':
      return meaningfulValues.length;
    case 'latest':
      return meaningfulValues.reduce((acc, value) => (acc == null || compareValues(value, acc) > 0 ? value : acc), null);
    case 'max':
      return meaningfulValues.reduce((acc, value) => (acc == null || compareValues(value, acc) > 0 ? value : acc), null);
    case 'median': {
      const numbers = meaningfulValues.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
      if (numbers.length === 0) return null;
      const middle = Math.floor(numbers.length / 2);
      return numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle];
    }
    case 'min':
      return meaningfulValues.reduce((acc, value) => (acc == null || compareValues(value, acc) < 0 ? value : acc), null);
    case 'range': {
      const sorted = meaningfulValues.slice().sort(compareValues);
      if (sorted.length === 0) return null;
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (first instanceof Date && last instanceof Date) {
        return last.getTime() - first.getTime();
      }
      return Number(last ?? 0) - Number(first ?? 0);
    }
    case 'stddev': {
      const numbers = meaningfulValues.map(Number).filter(Number.isFinite);
      if (numbers.length === 0) return null;
      const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      const variance = numbers.reduce((sum, value) => sum + ((value - average) ** 2), 0) / numbers.length;
      return Math.sqrt(variance);
    }
    case 'sum':
      return meaningfulValues.map(Number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
    case 'unchecked':
      return values.filter((value) => value === false || value == null).length;
    case 'unique': {
      const uniqueValues = [];
      meaningfulValues.forEach((value) => {
        if (!uniqueValues.some((entry) => valuesEqual(entry, value))) {
          uniqueValues.push(value);
        }
      });
      return uniqueValues.length;
    }
    default:
      return null;
  }
}

function createSummaryPayload(columns, rows, summaries, definition, snapshot, thisFile) {
  return summaries.map((summary) => {
    const column = columns.find((entry) => entry.id === summary.property);
    const values = rows.map((row) => row.rawCells[summary.property]);
    const value = summarizeValues(values, summary, definition, snapshot, thisFile);
    return {
      id: summary.id,
      label: summary.label,
      property: summary.property,
      propertyLabel: column?.label ?? summary.property,
      value: serializeBaseValue(value, {
        snapshot,
        sourcePath: thisFile?.path ?? '',
      }),
    };
  });
}

function createCsv(rows, columns) {
  const escapeCell = (value) => {
    let text = toDisplayText(value);
    // CSV quoting alone does not prevent spreadsheets from evaluating formulas.
    if (typeof value !== 'number' && /^[\s\p{Cc}]*[=+@-]|^[\t\r\n]/u.test(text)) {
      text = `'${text}`;
    }
    if (/[,"\r\n]/u.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [
    columns.map((column) => escapeCell(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => escapeCell(row.rawCells[column.id])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function rowMatchesSearch(row, columns, query) {
  const normalizedQuery = String(query ?? '').trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = columns
    .map((column) => toDisplayText(row.rawCells[column.id]))
    .join('\n')
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

export function buildQueryResultPayload({
  activeView,
  columns,
  definition,
  includeCsv = false,
  rows,
  snapshot,
  thisFile,
}) {
  const groupsByKey = new Map();
  if (activeView.groupBy?.property) {
    rows.forEach((row) => {
      const groupValue = row.rawCells[activeView.groupBy.property];
      const groupKey = toDisplayText(groupValue) || 'Empty';
      const entry = groupsByKey.get(groupKey) ?? {
        key: groupKey,
        label: groupKey,
        rawValue: groupValue,
        rows: [],
        value: serializeBaseValue(groupValue, {
          rowFilePath: row.file.path,
          snapshot,
          sourcePath: thisFile?.path ?? '',
        }),
      };
      entry.rows.push(row);
      groupsByKey.set(groupKey, entry);
    });
  } else {
    groupsByKey.set('All', {
      key: 'All',
      label: 'All',
      rows,
      value: serializeBaseValue(null),
    });
  }

  const serializedRows = rows.map((row) => ({
    cells: columns.reduce((acc, column) => {
      acc[column.id] = serializeBaseValue(row.rawCells[column.id], {
        rowFilePath: row.file.path,
        snapshot,
        sourcePath: thisFile?.path ?? '',
      });
      return acc;
    }, {}),
    file: serializeBaseValue(row.file, {
      rowFilePath: row.file.path,
      snapshot,
      sourcePath: thisFile?.path ?? '',
    }),
    path: row.file.path,
  }));
  const rowsByPath = new Map(serializedRows.map((row) => [row.path, row]));

  let groups = Array.from(groupsByKey.values());
  if (activeView.groupBy?.explicitDirection) {
    groups = groups.sort((left, right) => {
      const delta = compareValues(left.rawValue, right.rawValue);
      return activeView.groupBy.direction === 'desc' ? -delta : delta;
    });
  }

  groups = groups.map((group) => ({
    key: group.key,
    label: group.label,
    summaries: createSummaryPayload(columns, group.rows, activeView.summaries, definition, snapshot, thisFile),
    value: group.value,
    rows: group.rows.map((row) => rowsByPath.get(row.file.path)),
  }));

  return {
    ...(includeCsv ? { csv: createCsv(rows, columns) } : {}),
    groups,
    rows: serializedRows,
    summaries: createSummaryPayload(columns, rows, activeView.summaries, definition, snapshot, thisFile),
    thisFile: serializeBaseValue(thisFile, {
      snapshot,
      sourcePath: thisFile?.path ?? '',
    }),
    totalRows: rows.length,
  };
}
