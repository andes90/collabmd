import { parseBaseExpression } from '../../../domain/base-expression.js';
import { isImageAttachmentFilePath } from '../../../domain/file-kind.js';
import { resolveVaultRelativePath } from '../../../domain/vault-paths.js';
import { isPlainObject } from './base-definition.js';

export function createLinkValue(target, {
  display = '',
  exists = false,
  external = false,
  rawTarget = '',
} = {}) {
  return {
    __baseType: 'link',
    display: display ? String(display) : '',
    exists: Boolean(exists),
    external: Boolean(external),
    path: external ? '' : String(target ?? ''),
    rawTarget: String(rawTarget || target || ''),
    url: external ? String(target ?? '') : '',
  };
}

export function dedupeLinkValues(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value?.external
      ? `external:${value.url || value.rawTarget || value.display || ''}`
      : `path:${value.path || value.rawTarget || value.display || ''}`;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createFormulaNamespace(row, evaluationState) {
  return {
    __baseType: 'formula-namespace',
    evaluationState,
    row,
  };
}

function createContextFileValue(fileValue) {
  return fileValue ?? null;
}

function normalizeDuration(duration) {
  const match = String(duration ?? '').trim().match(/^(-?\d+)\s*([smhdw])$/iu);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = {
    d: 86_400_000,
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
    w: 604_800_000,
  }[unit];
  return Number.isFinite(amount) && multiplier ? amount * multiplier : null;
}

const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function getOwnBaseProperty(target, property) {
  const name = String(property ?? '');
  return target != null && !UNSAFE_PROPERTY_NAMES.has(name) && Object.hasOwn(target, name)
    ? target[name]
    : null;
}

function hasFormulaDefinition(definition, propertyId = '') {
  return Boolean(getOwnBaseProperty(definition?.formulas, propertyId));
}

export function parseDateValue(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{8}$/u.test(normalized)) {
    return new Date(`${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}T00:00:00`);
  }

  if (/^\d{8}\d{4}$/u.test(normalized)) {
    return new Date(`${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}T${normalized.slice(8, 10)}:${normalized.slice(10, 12)}:00`);
  }

  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isDateLikeString(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return (
    /^\d{8}(?:\d{4})?$/u.test(normalized)
    || /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(normalized)
  );
}

function coerceDateComparable(value) {
  if (!isDateLikeString(value)) {
    return value;
  }

  return parseDateValue(value) ?? value;
}

function normalizeComparablePair(left, right) {
  if (left instanceof Date || right instanceof Date) {
    return [
      left instanceof Date ? left : coerceDateComparable(left),
      right instanceof Date ? right : coerceDateComparable(right),
    ];
  }

  if (typeof left === 'string' && typeof right === 'string' && isDateLikeString(left) && isDateLikeString(right)) {
    return [
      parseDateValue(left) ?? left,
      parseDateValue(right) ?? right,
    ];
  }

  return [left, right];
}

function formatDateValue(value, format = 'YYYY-MM-DD') {
  const date = parseDateValue(value);
  if (!date) {
    return '';
  }

  const padded = (number) => String(number).padStart(2, '0');
  return String(format ?? 'YYYY-MM-DD')
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, padded(date.getMonth() + 1))
    .replace(/DD/g, padded(date.getDate()))
    .replace(/HH/g, padded(date.getHours()))
    .replace(/mm/g, padded(date.getMinutes()))
    .replace(/ss/g, padded(date.getSeconds()));
}

function toComparableValue(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  return value;
}

export function toDisplayText(value) {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    return formatDateValue(value, 'YYYY-MM-DD HH:mm:ss');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toDisplayText(entry)).join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (value?.__baseType === 'file') {
    return value.path || value.name || '';
  }
  if (value?.__baseType === 'link') {
    return value.display || value.path || value.url || '';
  }
  if (isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object Object]';
    }
  }
  return String(value);
}

export function valuesEqual(left, right) {
  const [normalizedLeft, normalizedRight] = normalizeComparablePair(left, right);

  left = normalizedLeft;
  right = normalizedRight;

  if (left?.__baseType === 'file' && right?.__baseType === 'file') {
    return left.path === right.path;
  }
  if (left?.__baseType === 'link' && right?.__baseType === 'link') {
    return left.url === right.url && left.path === right.path;
  }
  if (left instanceof Date || right instanceof Date) {
    return toComparableValue(left) === toComparableValue(right);
  }
  return left === right;
}

function resolveImageAttachmentPath(value, {
  rowFilePath = '',
  snapshot = null,
  sourcePath = '',
} = {}) {
  const text = String(value ?? '').trim();
  const rowsByPath = snapshot?.rowsByPath;
  if (!text || !rowsByPath) {
    return null;
  }

  const candidates = [];
  const seen = new Set();
  const appendCandidate = (candidate) => {
    const normalized = String(candidate ?? '').trim().replace(/\\/g, '/');
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  if (rowFilePath) {
    appendCandidate(resolveVaultRelativePath(rowFilePath, text));
  }
  if (sourcePath) {
    appendCandidate(resolveVaultRelativePath(sourcePath, text));
  }
  appendCandidate(text);

  return candidates.find((candidate) => (
    isImageAttachmentFilePath(candidate)
    && rowsByPath.has(candidate)
  )) ?? null;
}

export function serializeBaseValue(value, options = {}) {
  if (value == null || value === '') {
    return { text: '', type: 'empty', value: null };
  }
  if (value instanceof Date) {
    return {
      iso: value.toISOString(),
      text: formatDateValue(value, 'YYYY-MM-DD HH:mm:ss'),
      type: 'date',
      value: value.toISOString(),
    };
  }
  if (Array.isArray(value)) {
    return {
      items: value.map((entry) => serializeBaseValue(entry, options)),
      text: toDisplayText(value),
      type: 'list',
      value: value.map((entry) => toDisplayText(entry)),
    };
  }
  if (value?.__baseType === 'file') {
    return {
      path: value.path,
      text: value.path,
      type: 'file',
      value: value.path,
    };
  }
  if (value?.__baseType === 'link') {
    return {
      external: value.external,
      path: value.path,
      text: value.display || value.path || value.url,
      type: 'link',
      url: value.url,
      value: value.display || value.path || value.url,
    };
  }
  if (typeof value === 'boolean') {
    return { text: value ? 'true' : 'false', type: 'boolean', value };
  }
  if (typeof value === 'number') {
    return { text: Number.isFinite(value) ? String(value) : '', type: 'number', value };
  }
  if (typeof value === 'string') {
    const imagePath = resolveImageAttachmentPath(value, options);
    if (imagePath) {
      return {
        path: imagePath,
        text: value,
        type: 'image',
        value: imagePath,
      };
    }
    return { text: value, type: 'string', value };
  }
  return {
    text: toDisplayText(value),
    type: 'object',
    value,
  };
}

export function compareValues(left, right) {
  const [normalizedLeft, normalizedRight] = normalizeComparablePair(left, right);
  left = normalizedLeft;
  right = normalizedRight;

  const comparableLeft = toComparableValue(left);
  const comparableRight = toComparableValue(right);
  if (comparableLeft == null && comparableRight == null) return 0;
  if (comparableLeft == null) return 1;
  if (comparableRight == null) return -1;
  if (typeof comparableLeft === 'number' && typeof comparableRight === 'number') {
    return comparableLeft - comparableRight;
  }
  return String(toDisplayText(comparableLeft)).localeCompare(String(toDisplayText(comparableRight)), undefined, { sensitivity: 'base' });
}

function applyBinaryOperator(operator, left, right) {
  if (operator === '&&') {
    return Boolean(left) && Boolean(right);
  }
  if (operator === '||') {
    return Boolean(left) || Boolean(right);
  }
  if (operator === '==') {
    return valuesEqual(left, right);
  }
  if (operator === '!=') {
    return !valuesEqual(left, right);
  }
  if (operator === '<') {
    return compareValues(left, right) < 0;
  }
  if (operator === '<=') {
    return compareValues(left, right) <= 0;
  }
  if (operator === '>') {
    return compareValues(left, right) > 0;
  }
  if (operator === '>=') {
    return compareValues(left, right) >= 0;
  }
  if (operator === '+') {
    if (left instanceof Date && typeof right === 'string') {
      const duration = normalizeDuration(right);
      return duration == null ? left : new Date(left.getTime() + duration);
    }
    if (typeof left === 'string' || typeof right === 'string') {
      return `${toDisplayText(left)}${toDisplayText(right)}`;
    }
    return Number(left ?? 0) + Number(right ?? 0);
  }
  if (operator === '-') {
    if (left instanceof Date && typeof right === 'string') {
      const duration = normalizeDuration(right);
      return duration == null ? left : new Date(left.getTime() - duration);
    }
    if (left instanceof Date && right instanceof Date) {
      return left.getTime() - right.getTime();
    }
    return Number(left ?? 0) - Number(right ?? 0);
  }
  if (operator === '*') {
    return Number(left ?? 0) * Number(right ?? 0);
  }
  if (operator === '/') {
    return Number(right ?? 0) === 0 ? null : Number(left ?? 0) / Number(right ?? 0);
  }
  if (operator === '%') {
    return Number(right ?? 0) === 0 ? null : Number(left ?? 0) % Number(right ?? 0);
  }

  throw new Error(`Unsupported operator: ${operator}`);
}

function invokeGlobalFunction(name, argNodes, scope, evaluate) {
  if (name === 'if') {
    const condition = evaluate(argNodes[0], scope);
    return condition ? evaluate(argNodes[1], scope) : evaluate(argNodes[2], scope);
  }

  const args = argNodes.map((node) => evaluate(node, scope));
  switch (name) {
    case 'date':
      return parseDateValue(args[0]);
    case 'link': {
      const target = String(args[0] ?? '').trim();
      if (!target) {
        return null;
      }
      const external = /^[a-z]+:/iu.test(target);
      return createLinkValue(target, {
        display: typeof args[1] === 'string' ? args[1] : '',
        exists: external,
        external,
      });
    }
    case 'list':
      return args;
    case 'max':
      return args.flat().reduce((acc, value) => (acc == null || compareValues(value, acc) > 0 ? value : acc), null);
    case 'min':
      return args.flat().reduce((acc, value) => (acc == null || compareValues(value, acc) < 0 ? value : acc), null);
    case 'now':
      return new Date();
    case 'today': {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      return date;
    }
    default:
      throw new Error(`Unknown function: ${name}`);
  }
}

const METHOD_NOT_HANDLED = Symbol('base-method-not-handled');
const NULL_FALSE_METHODS = new Set([
  'contains',
  'containsAll',
  'containsAny',
  'endsWith',
  'hasLink',
  'hasProperty',
  'hasTag',
  'inFolder',
  'linksTo',
  'startsWith',
]);

function normalizeLinkComparablePath(value) {
  if (value?.__baseType === 'file') {
    return value.path;
  }
  if (value?.__baseType === 'link') {
    return value.path;
  }
  return String(value ?? '');
}

function invokeNullMethod(name) {
  if (NULL_FALSE_METHODS.has(name)) {
    return false;
  }
  if (name === 'isEmpty') {
    return true;
  }
  return METHOD_NOT_HANDLED;
}

function invokeArrayMethod(target, name, argNodes, scope, evaluate) {
  switch (name) {
    case 'contains': {
      const needle = evaluate(argNodes[0], scope);
      return target.some((entry) => valuesEqual(entry, needle));
    }
    case 'containsAll':
      return argNodes.every((node) => target.some((entry) => valuesEqual(entry, evaluate(node, scope))));
    case 'containsAny':
      return argNodes.some((node) => target.some((entry) => valuesEqual(entry, evaluate(node, scope))));
    case 'filter': {
      const predicate = argNodes[0];
      return target.filter((value, index) => Boolean(evaluate(predicate, scope.child({ index, value }))));
    }
    case 'flat':
      return target.flat();
    case 'isEmpty':
      return target.length === 0;
    case 'join':
      return target.map((entry) => toDisplayText(entry)).join(String(evaluate(argNodes[0], scope) ?? ''));
    case 'map': {
      const mapper = argNodes[0];
      return target.map((value, index) => evaluate(mapper, scope.child({ index, value })));
    }
    case 'reduce': {
      const reducer = argNodes[0];
      let accumulator = argNodes.length > 1 ? evaluate(argNodes[1], scope) : null;
      target.forEach((value, index) => {
        accumulator = evaluate(reducer, scope.child({ acc: accumulator, index, value }));
      });
      return accumulator;
    }
    case 'reverse':
      return [...target].reverse();
    case 'slice':
      return target.slice(Number(evaluate(argNodes[0], scope) ?? 0), argNodes[1] ? Number(evaluate(argNodes[1], scope)) : undefined);
    case 'sort':
      return [...target].sort(compareValues);
    case 'unique': {
      const uniqueValues = [];
      target.forEach((value) => {
        if (!uniqueValues.some((entry) => valuesEqual(entry, value))) {
          uniqueValues.push(value);
        }
      });
      return uniqueValues;
    }
    default:
      return METHOD_NOT_HANDLED;
  }
}

function invokeStringMethod(target, name, argNodes, scope, evaluate) {
  switch (name) {
    case 'contains':
      return target.toLowerCase().includes(String(evaluate(argNodes[0], scope) ?? '').toLowerCase());
    case 'endsWith':
      return target.endsWith(String(evaluate(argNodes[0], scope) ?? ''));
    case 'isEmpty':
      return target.length === 0;
    case 'lower':
      return target.toLowerCase();
    case 'replace':
      return target.replaceAll(String(evaluate(argNodes[0], scope) ?? ''), String(evaluate(argNodes[1], scope) ?? ''));
    case 'split':
      return target.split(String(evaluate(argNodes[0], scope) ?? ''));
    case 'startsWith':
      return target.startsWith(String(evaluate(argNodes[0], scope) ?? ''));
    case 'title':
      return target.replace(/\b\p{L}/gu, (match) => match.toUpperCase());
    case 'trim':
      return target.trim();
    case 'upper':
      return target.toUpperCase();
    default:
      return METHOD_NOT_HANDLED;
  }
}

function invokeNumberMethod(target, name, argNodes, scope, evaluate) {
  switch (name) {
    case 'ceil':
      return Math.ceil(target);
    case 'floor':
      return Math.floor(target);
    case 'isEmpty':
      return false;
    case 'round': {
      const precision = evaluate(argNodes[0], scope);
      return Number.isFinite(precision)
        ? Number(target.toFixed(Number(precision)))
        : Math.round(target);
    }
    case 'toFixed':
      return target.toFixed(Number(evaluate(argNodes[0], scope) ?? 0));
    default:
      return METHOD_NOT_HANDLED;
  }
}

function invokeDateMethod(target, name, argNodes, scope, evaluate) {
  const asDate = parseDateValue(target);
  if (!asDate) {
    return METHOD_NOT_HANDLED;
  }

  switch (name) {
    case 'format':
      return formatDateValue(asDate, String(evaluate(argNodes[0], scope) ?? 'YYYY-MM-DD'));
    case 'isEmpty':
      return false;
    default:
      return METHOD_NOT_HANDLED;
  }
}

function invokeFileMethod(target, name, argNodes, scope, evaluate) {
  switch (name) {
    case 'asLink': {
      const display = evaluate(argNodes[0], scope);
      return createLinkValue(target.path, {
        display: typeof display === 'string' ? display : '',
        exists: true,
      });
    }
    case 'hasLink': {
      const needlePath = normalizeLinkComparablePath(evaluate(argNodes[0], scope));
      return target.links.some((link) => link.path === needlePath || link.rawTarget === needlePath);
    }
    case 'hasProperty':
      return Object.hasOwn(target.properties, String(evaluate(argNodes[0], scope) ?? ''));
    case 'hasTag':
      return argNodes.some((node) => {
        const value = String(evaluate(node, scope) ?? '').replace(/^#/u, '');
        return target.tags.some((tag) => tag === value || tag.startsWith(`${value}/`));
      });
    case 'inFolder': {
      const folder = String(evaluate(argNodes[0], scope) ?? '').replace(/\/+$/u, '');
      return !folder || target.folder === folder || target.folder.startsWith(`${folder}/`);
    }
    default:
      return METHOD_NOT_HANDLED;
  }
}

function invokeLinkMethod(target, name, argNodes, scope, evaluate, rootContext) {
  switch (name) {
    case 'asFile':
      return target.path ? rootContext.snapshot.rowsByPath.get(target.path)?.file ?? null : null;
    case 'linksTo':
      return target.path === normalizeLinkComparablePath(evaluate(argNodes[0], scope));
    default:
      return METHOD_NOT_HANDLED;
  }
}

function invokeObjectMethod(target, name) {
  switch (name) {
    case 'isEmpty':
      return Object.keys(target).length === 0;
    case 'keys':
      return Object.keys(target);
    case 'values':
      return Object.values(target);
    default:
      return METHOD_NOT_HANDLED;
  }
}

function invokeMethod(target, name, argNodes, scope, evaluate, rootContext) {
  if (target?.__baseType === 'formula-namespace') {
    if (argNodes.length > 0) {
      throw new Error(`Formula namespace property "${name}" is not callable`);
    }
    return rootContext.resolveFormulaValue(name, target.row, target.evaluationState);
  }

  let result = METHOD_NOT_HANDLED;
  if (target == null) {
    result = invokeNullMethod(name);
  } else if (Array.isArray(target)) {
    result = invokeArrayMethod(target, name, argNodes, scope, evaluate);
  } else if (typeof target === 'string') {
    result = invokeStringMethod(target, name, argNodes, scope, evaluate);
  } else if (typeof target === 'number') {
    result = invokeNumberMethod(target, name, argNodes, scope, evaluate);
  } else if (target?.__baseType === 'file') {
    result = invokeFileMethod(target, name, argNodes, scope, evaluate);
  } else if (target?.__baseType === 'link') {
    result = invokeLinkMethod(target, name, argNodes, scope, evaluate, rootContext);
  } else if (isPlainObject(target)) {
    result = invokeObjectMethod(target, name);
  }

  if (result !== METHOD_NOT_HANDLED) {
    return result;
  }

  result = invokeDateMethod(target, name, argNodes, scope, evaluate);
  if (result !== METHOD_NOT_HANDLED) {
    return result;
  }

  throw new Error(`Unsupported method "${name}"`);
}

class ExpressionScope {
  constructor({ locals = {}, parent = null, rootContext }) {
    this.locals = locals;
    this.parent = parent;
    this.rootContext = rootContext;
  }

  child(locals = {}) {
    return new ExpressionScope({
      locals,
      parent: this,
      rootContext: this.rootContext,
    });
  }

  get(name) {
    if (Object.hasOwn(this.locals, name)) {
      return this.locals[name];
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    return this.rootContext.resolveIdentifier(name);
  }
}

function evaluateAst(ast, scope) {
  const rootContext = scope.rootContext;
  const evaluate = (node, nextScope = scope) => evaluateAst(node, nextScope);

  switch (ast?.type) {
    case 'ArrayExpression':
      return ast.elements.map((element) => evaluate(element, scope));
    case 'BinaryExpression':
      return applyBinaryOperator(ast.operator, evaluate(ast.left, scope), evaluate(ast.right, scope));
    case 'CallExpression': {
      if (ast.callee?.type === 'Identifier') {
        return invokeGlobalFunction(ast.callee.name, ast.arguments, scope, evaluate);
      }
      if (ast.callee?.type === 'MemberExpression') {
        const target = evaluate(ast.callee.object, scope);
        const property = ast.callee.computed
          ? evaluate(ast.callee.property, scope)
          : ast.callee.property.name;
        const name = String(property ?? '');
        return UNSAFE_PROPERTY_NAMES.has(name) ? null : invokeMethod(target, name, ast.arguments, scope, evaluate, rootContext);
      }
      throw new Error('Unsupported call target');
    }
    case 'Identifier':
      return scope.get(ast.name);
    case 'Literal':
      return ast.value;
    case 'MemberExpression': {
      const target = evaluate(ast.object, scope);
      const property = String((ast.computed ? evaluate(ast.property, scope) : ast.property.name) ?? '');
      if (UNSAFE_PROPERTY_NAMES.has(property)) return null;
      if (target?.__baseType === 'formula-namespace') {
        return rootContext.resolveFormulaValue(property, target.row, target.evaluationState);
      }
      return getOwnBaseProperty(target, property);
    }
    case 'ObjectExpression':
      return Object.fromEntries(ast.properties
        .filter(({ key }) => !UNSAFE_PROPERTY_NAMES.has(key))
        .map(({ key, value }) => [key, evaluate(value, scope)]));
    case 'UnaryExpression': {
      const value = evaluate(ast.argument, scope);
      return ast.operator === '!' ? !value : -Number(value ?? 0);
    }
    default:
      throw new Error(`Unsupported expression node "${ast?.type}"`);
  }
}

export function evaluateExpression(expressionSource, rootContext, locals = {}) {
  const cache = rootContext.astCache;
  let ast = cache.get(expressionSource);
  if (!ast) {
    ast = parseBaseExpression(expressionSource);
    cache.set(expressionSource, ast);
  }
  const scope = new ExpressionScope({ locals, rootContext });
  return evaluateAst(ast, scope);
}

export function evaluateFilterNode(filterNode, rootContext) {
  if (!filterNode) {
    return true;
  }
  if (typeof filterNode === 'string') {
    return Boolean(evaluateExpression(filterNode, rootContext));
  }
  if (!isPlainObject(filterNode)) {
    return true;
  }

  if (Array.isArray(filterNode.and)) {
    return filterNode.and.every((entry) => evaluateFilterNode(entry, rootContext));
  }
  if (Array.isArray(filterNode.or)) {
    return filterNode.or.some((entry) => evaluateFilterNode(entry, rootContext));
  }
  if (filterNode.not != null) {
    if (Array.isArray(filterNode.not)) {
      return !filterNode.not.some((entry) => evaluateFilterNode(entry, rootContext));
    }
    return !evaluateFilterNode(filterNode.not, rootContext);
  }

  return true;
}

function normalizeFormulaLookupName(name = '') {
  return String(name ?? '').replace(/^formula\./u, '');
}

function resolveFormulaPropertyId(definition, name = '') {
  const formulaName = normalizeFormulaLookupName(name);
  if (!formulaName) {
    return null;
  }

  const precomputedLookup = definition?.formulaLookup;
  if (precomputedLookup instanceof Map) {
    return precomputedLookup.get(formulaName) ?? precomputedLookup.get(`formula.${formulaName}`) ?? null;
  }

  return Object.keys(definition?.formulas ?? {}).find((propertyId) => (
    normalizeFormulaLookupName(propertyId) === formulaName
  )) ?? null;
}

export function createEvaluationRootContext({
  astCache = new Map(),
  currentRow,
  definition,
  evaluationState = null,
  identifierResolver = null,
  snapshot,
  thisFile,
}) {
  const nextEvaluationState = evaluationState ?? {
    cache: new Map(),
    stack: new Set(),
  };

  return {
    astCache,
    currentRow,
    definition,
    evaluationState: nextEvaluationState,
    resolveFormulaValue: (name, row, state = nextEvaluationState) => {
      const formulaPropertyId = resolveFormulaPropertyId(definition, name);
      if (!formulaPropertyId) {
        return null;
      }

      const cacheKey = `${row.file.path}::${formulaPropertyId}`;
      if (state.cache.has(cacheKey)) {
        return state.cache.get(cacheKey);
      }
      if (state.stack.has(cacheKey)) {
        throw new Error(`Circular formula reference: ${formulaPropertyId}`);
      }

      state.stack.add(cacheKey);
      const nextContext = createEvaluationRootContext({
        astCache,
        currentRow: row,
        definition,
        evaluationState: state,
        snapshot,
        thisFile,
      });
      const result = evaluateExpression(definition.formulas[formulaPropertyId].formula, nextContext);
      state.stack.delete(cacheKey);
      state.cache.set(cacheKey, result);
      return result;
    },
    resolveIdentifier: (name) => {
      if (typeof identifierResolver === 'function') {
        const resolved = identifierResolver(name);
        if (resolved !== undefined) {
          return resolved;
        }
      }
      if (name === 'file') {
        return currentRow.file;
      }
      if (name === 'formula') {
        return createFormulaNamespace(currentRow, nextEvaluationState);
      }
      if (name === 'note') {
        return currentRow.noteProperties;
      }
      if (name === 'this') {
        return createContextFileValue(thisFile);
      }
      if (name === 'values') {
        return [];
      }
      if (Object.hasOwn(currentRow.noteProperties, name)) {
        return currentRow.noteProperties[name];
      }
      return null;
    },
    snapshot,
    thisFile,
  };
}

export function getPropertyValue(propertyId, row, definition, snapshot, thisFile, rootContext = null) {
  if (propertyId.startsWith('file.')) {
    return propertyId.split('.').slice(1).reduce(getOwnBaseProperty, row.file);
  }

  if (hasFormulaDefinition(definition, propertyId)) {
    const context = rootContext ?? createEvaluationRootContext({
      currentRow: row,
      definition,
      snapshot,
      thisFile,
    });
    return context.resolveFormulaValue(propertyId, row, context.evaluationState);
  }

  if (propertyId.startsWith('note.')) {
    return getOwnBaseProperty(row.noteProperties, propertyId.slice(5)) ?? null;
  }

  if (hasFormulaDefinition(definition, `formula.${propertyId}`)) {
    const context = rootContext ?? createEvaluationRootContext({
      currentRow: row,
      definition,
      snapshot,
      thisFile,
    });
    return context.resolveFormulaValue(propertyId, row, context.evaluationState);
  }

  return getOwnBaseProperty(row.noteProperties, propertyId) ?? null;
}
