import * as Y from 'yjs';
import { generateNKeysBetween } from '@excalidraw/fractional-indexing';
import { simpleDiffString } from 'lib0/diff';

export const CANVAS_NODES_KEY = 'canvas-nodes';
export const CANVAS_EDGES_KEY = 'canvas-edges';
export const CANVAS_META_KEY = 'canvas-meta';
export const CANVAS_NODE_ORDER_KEY = 'canvas-node-order';
export const CANVAS_EDGE_ORDER_KEY = 'canvas-edge-order';

function invalid() {
  const error = new Error('Invalid JSON Canvas 1.0 document');
  error.code = 'CANVAS_INVALID';
  return error;
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
}

function requireString(value) {
  if (typeof value !== 'string') throw invalid();
}

function optionalString(value, key, choices = null) {
  if (!Object.hasOwn(value, key)) return;
  requireString(value[key]);
  if (choices && !choices.includes(value[key])) throw invalid();
}

function validateColor(value) {
  if (Object.hasOwn(value, 'color') && !/^(?:[1-6]|#[\da-f]{6})$/i.test(value.color)) throw invalid();
  optionalString(value, 'color');
}

function validateNode(node) {
  requireObject(node);
  requireString(node.id);
  if (!['text', 'file', 'link', 'group'].includes(node.type)) throw invalid();
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isInteger(node[key])) throw invalid();
  }
  validateColor(node);
  if (node.type === 'text') requireString(node.text);
  if (node.type === 'file') {
    requireString(node.file);
    optionalString(node, 'subpath');
    if (Object.hasOwn(node, 'subpath') && !node.subpath.startsWith('#')) throw invalid();
  }
  if (node.type === 'link') requireString(node.url);
  if (node.type === 'group') {
    optionalString(node, 'label');
    optionalString(node, 'background');
    optionalString(node, 'backgroundStyle', ['cover', 'ratio', 'repeat']);
  }
}

function validateEdge(edge) {
  requireObject(edge);
  for (const key of ['id', 'fromNode', 'toNode']) requireString(edge[key]);
  for (const key of ['fromSide', 'toSide']) optionalString(edge, key, ['top', 'right', 'bottom', 'left']);
  for (const key of ['fromEnd', 'toEnd']) optionalString(edge, key, ['none', 'arrow']);
  optionalString(edge, 'label');
  validateColor(edge);
}

export function validateCanvasDocument(value) {
  requireObject(value);
  for (const key of ['nodes', 'edges']) {
    if (Object.hasOwn(value, key) && !Array.isArray(value[key])) throw invalid();
    const ids = new Set();
    for (const item of value[key] ?? []) {
      (key === 'nodes' ? validateNode : validateEdge)(item);
      if (ids.has(item.id)) throw invalid();
      ids.add(item.id);
    }
  }
  const nodeIds = new Set((value.nodes ?? []).map((node) => node.id));
  if ((value.edges ?? []).some((edge) => !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode))) throw invalid();
  return value;
}

export function parseCanvasJson(text) {
  try {
    if (typeof text !== 'string') throw invalid();
    return validateCanvasDocument(JSON.parse(text, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw invalid();
      return value;
    }));
  } catch {
    throw invalid();
  }
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readItem(item) {
  if (!(item instanceof Y.Map)) throw invalid();
  return Object.fromEntries(Array.from(item, ([key, value]) => [
    key, value instanceof Y.Text ? value.toString() : structuredClone(value),
  ]));
}

function updateText(text, value) {
  const { index, remove, insert } = simpleDiffString(text.toString(), value);
  if (remove) text.delete(index, remove);
  if (insert) text.insert(index, insert);
}

function writeProperties(map, value, { textNode = false, replace = false } = {}) {
  if (replace) {
    for (const key of map.keys()) if (!Object.hasOwn(value, key)) map.delete(key);
  }
  for (const [key, next] of Object.entries(value)) {
    const previous = map.get(key);
    if (next === undefined) {
      map.delete(key);
    } else if (textNode && key === 'text') {
      if (previous instanceof Y.Text) updateText(previous, next);
      else map.set(key, new Y.Text(next));
    } else if (!equal(previous, next)) {
      map.set(key, structuredClone(next));
    }
  }
}

function sortedItems(doc, mapKey, orderKey) {
  const order = doc.getMap(orderKey);
  return Array.from(doc.getMap(mapKey), ([id, value]) => {
    const item = readItem(value);
    if (item.id !== id) throw invalid();
    return item;
  }).sort((left, right) => {
    const leftOrder = String(order.get(left.id) ?? '');
    const rightOrder = String(order.get(right.id) ?? '');
    if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function isCanvasRoomDocStructured(doc) {
  return doc?.getMap(CANVAS_META_KEY).get('schemaVersion') === 1;
}

export function buildCanvasRoomDocument(doc) {
  if (!isCanvasRoomDocStructured(doc)) throw invalid();
  const meta = doc.getMap(CANVAS_META_KEY);
  const properties = meta.get('properties');
  const result = properties instanceof Y.Map ? readItem(properties) : {};
  const nodes = sortedItems(doc, CANVAS_NODES_KEY, CANVAS_NODE_ORDER_KEY);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = sortedItems(doc, CANVAS_EDGES_KEY, CANVAS_EDGE_ORDER_KEY).filter((edge) => {
    validateEdge(edge);
    // A concurrent node deletion wins over an edge connected while offline.
    return nodeIds.has(edge.fromNode) && nodeIds.has(edge.toNode);
  });
  if (meta.get('nodesPresent') || nodes.length) result.nodes = nodes;
  if (meta.get('edgesPresent') || edges.length) result.edges = edges;
  return validateCanvasDocument(result);
}

export function serializeCanvasRoomDocument(doc) {
  return serializeCanvasDocument(buildCanvasRoomDocument(doc));
}

export function serializeCanvasDocument(document) {
  validateCanvasDocument(document);
  return JSON.stringify(document, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw invalid();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
      : value;
  }, 2) + '\n';
}

export function replaceCanvasRoomDocument(doc, document) {
  validateCanvasDocument(document);
  const meta = doc.getMap(CANVAS_META_KEY);
  if (meta.get('schemaVersion') !== 1) meta.set('schemaVersion', 1);
  let properties = meta.get('properties');
  if (!(properties instanceof Y.Map)) {
    properties = new Y.Map();
    meta.set('properties', properties);
  }
  writeProperties(properties, Object.fromEntries(Object.entries(document).filter(([key]) => !['nodes', 'edges'].includes(key))), { replace: true });
  for (const [key, mapKey, orderKey] of [
    ['nodes', CANVAS_NODES_KEY, CANVAS_NODE_ORDER_KEY],
    ['edges', CANVAS_EDGES_KEY, CANVAS_EDGE_ORDER_KEY],
  ]) {
    const items = document[key] ?? [];
    const map = doc.getMap(mapKey);
    const order = doc.getMap(orderKey);
    const ids = new Set(items.map((item) => item.id));
    for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    for (const id of order.keys()) if (!ids.has(id)) order.delete(id);
    const indices = generateNKeysBetween(null, null, items.length);
    items.forEach((item, index) => {
      let entry = map.get(item.id);
      if (!(entry instanceof Y.Map)) {
        entry = new Y.Map();
        map.set(item.id, entry);
      }
      writeProperties(entry, item, { replace: true, textNode: key === 'nodes' && item.type === 'text' });
      if (order.get(item.id) !== indices[index]) order.set(item.id, indices[index]);
    });
    const present = Object.hasOwn(document, key);
    if (meta.get(`${key}Present`) !== present) meta.set(`${key}Present`, present);
  }
  return document;
}

function addItem(doc, item, mapKey, orderKey) {
  const map = doc.getMap(mapKey);
  if (map.has(item.id)) throw invalid();
  const order = doc.getMap(orderKey);
  const entries = sortedItems(doc, mapKey, orderKey);
  const lastKey = entries.length ? order.get(entries.at(-1).id) : null;
  const nextKey = generateNKeysBetween(lastKey ?? null, null, 1)[0];
  const value = new Y.Map();
  map.set(item.id, value);
  writeProperties(value, item, { textNode: mapKey === CANVAS_NODES_KEY && item.type === 'text' });
  order.set(item.id, nextKey);
  return true;
}

export function addCanvasNode(doc, node) {
  validateNode(node);
  return addItem(doc, node, CANVAS_NODES_KEY, CANVAS_NODE_ORDER_KEY);
}

export function addCanvasEdge(doc, edge) {
  validateEdge(edge);
  const nodes = doc.getMap(CANVAS_NODES_KEY);
  if (!nodes.has(edge.fromNode) || !nodes.has(edge.toNode)) throw invalid();
  return addItem(doc, edge, CANVAS_EDGES_KEY, CANVAS_EDGE_ORDER_KEY);
}

function updateItem(doc, id, patch, key, validate) {
  const entry = doc.getMap(key).get(id);
  if (!(entry instanceof Y.Map)) return false;
  requireObject(patch);
  const previous = readItem(entry);
  const next = Object.fromEntries(Object.entries({ ...previous, ...patch }).filter(([, value]) => value !== undefined));
  if (next.id !== id) throw invalid();
  validate(next);
  if (equal(previous, next)) return false;
  writeProperties(entry, patch, { textNode: key === CANVAS_NODES_KEY && next.type === 'text' });
  return true;
}

export function updateCanvasNode(doc, id, patch) {
  return updateItem(doc, id, patch, CANVAS_NODES_KEY, validateNode);
}

export function updateCanvasEdge(doc, id, patch) {
  return updateItem(doc, id, patch, CANVAS_EDGES_KEY, (edge) => {
    validateEdge(edge);
    const nodes = doc.getMap(CANVAS_NODES_KEY);
    if (!nodes.has(edge.fromNode) || !nodes.has(edge.toNode)) throw invalid();
  });
}

export function deleteCanvasEdges(doc, ids) {
  let changed = false;
  for (const id of ids) {
    if (!doc.getMap(CANVAS_EDGES_KEY).has(id)) continue;
    doc.getMap(CANVAS_EDGES_KEY).delete(id);
    doc.getMap(CANVAS_EDGE_ORDER_KEY).delete(id);
    changed = true;
  }
  return changed;
}

export function deleteCanvasNodes(doc, ids) {
  let changed = false;
  const removed = new Set(ids);
  for (const id of removed) {
    if (!doc.getMap(CANVAS_NODES_KEY).has(id)) continue;
    doc.getMap(CANVAS_NODES_KEY).delete(id);
    doc.getMap(CANVAS_NODE_ORDER_KEY).delete(id);
    changed = true;
  }
  const edgeIds = Array.from(doc.getMap(CANVAS_EDGES_KEY), ([id, edge]) => (
    removed.has(edge.get('fromNode')) || removed.has(edge.get('toNode')) ? id : null
  )).filter((id) => id !== null);
  return deleteCanvasEdges(doc, edgeIds) || changed;
}

export function reorderCanvasNode(doc, id, direction) {
  if (!['front', 'back'].includes(direction)) throw invalid();
  const nodes = sortedItems(doc, CANVAS_NODES_KEY, CANVAS_NODE_ORDER_KEY);
  if (!nodes.some((node) => node.id === id) || nodes.length < 2) return false;
  const last = direction === 'front' ? nodes.at(-1) : nodes[0];
  if (last.id === id) return false;
  const order = doc.getMap(CANVAS_NODE_ORDER_KEY);
  const bound = order.get(last.id);
  const nextKey = direction === 'front'
    ? generateNKeysBetween(bound, null, 1)[0]
    : generateNKeysBetween(null, bound, 1)[0];
  order.set(id, nextKey);
  return true;
}

export function resolveCanvasExternalConflict(doc, choice) {
  const meta = doc.getMap(CANVAS_META_KEY);
  const conflict = meta.get('externalConflict');
  if (!conflict) return false;
  if (!['local', 'external'].includes(choice)) throw invalid();
  if (choice === 'external') replaceCanvasRoomDocument(doc, parseCanvasJson(conflict.content));
  meta.delete('externalConflict');
  return true;
}

// Merge independent fields; overlapping changes stay preserved for explicit resolution.
export function mergeCanvasDocuments(baseline, local, external) {
  let conflict = false;
  function mergeValue(before, current, next) {
    if (equal(current, before)) return next;
    if (equal(next, before) || equal(current, next)) return current;
    if (before && current && next && ![before, current, next].some((value) => typeof value !== 'object' || Array.isArray(value))) {
      return Object.fromEntries(Array.from(new Set([...Object.keys(before), ...Object.keys(current), ...Object.keys(next)]), (key) => [
        key, mergeValue(before[key], current[key], next[key]),
      ]).filter(([, value]) => value !== undefined));
    }
    conflict = true;
    return current;
  }
  const result = mergeValue(
    Object.fromEntries(Object.entries(baseline).filter(([key]) => !['nodes', 'edges'].includes(key))),
    Object.fromEntries(Object.entries(local).filter(([key]) => !['nodes', 'edges'].includes(key))),
    Object.fromEntries(Object.entries(external).filter(([key]) => !['nodes', 'edges'].includes(key))),
  );
  for (const key of ['nodes', 'edges']) {
    const before = baseline[key] ?? [];
    const current = local[key] ?? [];
    const next = external[key] ?? [];
    const currentById = new Map(current.map((item) => [item.id, item]));
    const nextById = new Map(next.map((item) => [item.id, item]));
    const beforeById = new Map(before.map((item) => [item.id, item]));
    const beforeIds = before.map((item) => item.id);
    const currentIds = current.map((item) => item.id);
    const nextIds = next.map((item) => item.id);
    const localReordered = !equal(currentIds.filter((id) => beforeById.has(id)), beforeIds.filter((id) => currentById.has(id)));
    const externalReordered = !equal(nextIds.filter((id) => beforeById.has(id)), beforeIds.filter((id) => nextById.has(id)));
    if (localReordered && externalReordered && !equal(currentIds, nextIds)) conflict = true;
    const ids = Array.from(new Set(localReordered ? [...currentIds, ...nextIds] : [...nextIds, ...currentIds]));
    const merged = ids.map((id) => mergeValue(beforeById.get(id), currentById.get(id), nextById.get(id))).filter((item) => item !== undefined);
    const present = mergeValue(Object.hasOwn(baseline, key), Object.hasOwn(local, key), Object.hasOwn(external, key));
    if (present || merged.length) result[key] = merged;
  }
  try {
    validateCanvasDocument(result);
  } catch {
    conflict = true;
  }
  return { conflict, document: conflict ? local : result };
}
