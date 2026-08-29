import {
  generateNKeysBetween,
  validateOrderKey,
} from '@excalidraw/fractional-indexing';

const ELEMENT_TYPES = new Set([
  'arrow',
  'diamond',
  'ellipse',
  'freedraw',
  'line',
  'rectangle',
  'text',
]);

const LINEAR_TYPES = new Set(['arrow', 'freedraw', 'line']);

function invalid(message) {
  const error = new Error(message);
  error.code = 'EXCALIDRAW_SCENE_INVALID';
  return error;
}

function stableNumber(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${name} must be an object`);
  }
  return value;
}

function requireNumber(value, name) {
  if (!Number.isFinite(value)) throw invalid(`${name} must be a finite number`);
  return value;
}

function normalizePoints(points, type) {
  if (!LINEAR_TYPES.has(type)) return points;
  const source = points ?? [[0, 0], [100, 0]];
  if (!Array.isArray(source) || source.length < 2 || source.length > 1_000) {
    throw invalid(`${type} points must contain 2 to 1000 coordinate pairs`);
  }
  return source.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw invalid(`${type} points must be [x, y] coordinate pairs`);
    }
    return [requireNumber(point[0], `${type} point x`), requireNumber(point[1], `${type} point y`)];
  });
}

function normalizePointGeometry(points, x, y, type) {
  const [offsetX, offsetY] = points[0];
  const normalizedPoints = points.map(([pointX, pointY]) => [
    pointX - offsetX,
    pointY - offsetY,
  ]);
  const xs = normalizedPoints.map(([pointX]) => pointX);
  const ys = normalizedPoints.map(([, pointY]) => pointY);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width === 0 && height === 0) {
    throw invalid(`${type} points must span a non-zero distance`);
  }
  return {
    height,
    points: normalizedPoints,
    width,
    x: x + offsetX,
    y: y + offsetY,
  };
}

function readElementGeometry(raw, id, type) {
  const x = requireNumber(raw.x, `Element ${id} x`);
  const y = requireNumber(raw.y, `Element ${id} y`);
  const points = normalizePoints(raw.points, type);
  if (points) {
    return {
      ...normalizePointGeometry(points, x, y, type),
      fontSize: raw.fontSize,
      text: raw.text,
    };
  }

  const fontSize = type === 'text'
    ? requireNumber(raw.fontSize ?? 20, `Element ${id} fontSize`)
    : raw.fontSize;
  if (type === 'text' && fontSize <= 0) throw invalid(`Element ${id} fontSize must be positive`);
  const text = type === 'text' ? String(raw.text ?? '') : raw.text;
  const defaultWidth = type === 'text'
    ? Math.max(1, ...text.split('\n').map((line) => line.length)) * fontSize * 0.6
    : 100;
  const defaultHeight = type === 'text'
    ? Math.max(1, text.split('\n').length) * fontSize * 1.25
    : 100;
  const width = requireNumber(raw.width ?? defaultWidth, `Element ${id} width`);
  const height = requireNumber(raw.height ?? defaultHeight, `Element ${id} height`);
  if (width <= 0 || height <= 0) {
    throw invalid(`Element ${id} width and height must be positive`);
  }
  return { fontSize, height, points, text, width, x, y };
}

function createBaseElement(raw, {
  height,
  id,
  now,
  type,
  width,
  x,
  y,
}) {
  const rest = { ...raw };
  delete rest.afterElementId;
  delete rest.beforeElementId;
  delete rest.endElementId;
  delete rest.startElementId;
  return {
    ...rest,
    angle: raw.angle ?? 0,
    backgroundColor: raw.backgroundColor ?? 'transparent',
    boundElements: raw.boundElements ?? null,
    fillStyle: raw.fillStyle ?? 'solid',
    frameId: raw.frameId ?? null,
    groupIds: raw.groupIds ?? [],
    height,
    id,
    index: raw.index ?? null,
    isDeleted: false,
    link: raw.link ?? null,
    locked: raw.locked ?? false,
    opacity: raw.opacity ?? 100,
    roughness: raw.roughness ?? 1,
    roundness: raw.roundness ?? (['diamond', 'ellipse', 'rectangle'].includes(type) ? { type: 3 } : null),
    seed: raw.seed ?? stableNumber(`${id}:seed`),
    strokeColor: raw.strokeColor ?? '#1e1e1e',
    strokeStyle: raw.strokeStyle ?? 'solid',
    strokeWidth: raw.strokeWidth ?? 2,
    type,
    updated: raw.updated ?? now,
    version: raw.version ?? 1,
    versionNonce: raw.versionNonce ?? stableNumber(`${id}:nonce`),
    width,
    x,
    y,
  };
}

function addLinearElementFields(element, raw) {
  const startBinding = raw.startElementId
    ? { elementId: raw.startElementId, fixedPoint: null, focus: 0, gap: 4 }
    : raw.startBinding ?? null;
  const endBinding = raw.endElementId
    ? { elementId: raw.endElementId, fixedPoint: null, focus: 0, gap: 4 }
    : raw.endBinding ?? null;
  element.endBinding = endBinding;
  element.lastCommittedPoint = raw.lastCommittedPoint ?? null;
  element.startBinding = startBinding;
  if (element.type === 'arrow') {
    element.endArrowhead = raw.endArrowhead ?? 'arrow';
    element.startArrowhead = raw.startArrowhead ?? null;
  }
}

function addFreeDrawElementFields(element, raw) {
  element.pressures = Array.isArray(raw.pressures) ? raw.pressures : [];
  element.simulatePressure = raw.simulatePressure ?? true;
  element.strokeOptions = raw.strokeOptions ?? {
    streamline: 0.5,
    variability: 'variable',
  };
}

function addTextElementFields(element, raw, { fontSize, text }) {
  element.autoResize = raw.autoResize ?? true;
  element.containerId = raw.containerId ?? null;
  element.fontFamily = raw.fontFamily ?? 1;
  element.fontSize = fontSize;
  element.lineHeight = raw.lineHeight ?? 1.25;
  element.originalText = raw.originalText ?? text;
  element.text = text;
  element.textAlign = raw.textAlign ?? 'center';
  element.verticalAlign = raw.verticalAlign ?? 'middle';
}

function normalizeElement(rawElement, now) {
  const raw = requireObject(rawElement, 'Element');
  const id = String(raw.id ?? '').trim();
  if (!id || id.length > 128) throw invalid('Element id must contain 1 to 128 characters');
  if (!ELEMENT_TYPES.has(raw.type)) throw invalid(`Unsupported Excalidraw element type: ${raw.type}`);

  const type = raw.type;
  const geometry = readElementGeometry(raw, id, type);
  const element = createBaseElement(raw, { ...geometry, id, now, type });
  if (geometry.points) element.points = geometry.points;
  if (type === 'arrow' || type === 'line') addLinearElementFields(element, raw);
  if (type === 'freedraw') addFreeDrawElementFields(element, raw);
  if (type === 'text') addTextElementFields(element, raw, geometry);
  return element;
}

function bumpElementVersion(element, now, reason) {
  const version = (Number(element.version) || 0) + 1;
  return {
    ...element,
    updated: now,
    version,
    versionNonce: stableNumber(`${element.id}:${reason}:${version}:${now}`),
  };
}

function moveElement(elements, id, directive, name) {
  const { action, afterElementId, beforeElementId } = directive ?? {};
  const instructions = [action, beforeElementId, afterElementId].filter((value) => value !== undefined);
  if (instructions.length === 0) return;
  if (instructions.length !== 1) {
    throw invalid(`${name} must specify exactly one action, beforeElementId, or afterElementId`);
  }
  if (action !== undefined && !['bringToFront', 'sendToBack'].includes(action)) {
    throw invalid(`${name} uses unsupported action ${action}`);
  }

  const currentIndex = elements.findIndex((element) => element.id === id && !element.isDeleted);
  if (currentIndex < 0) throw invalid(`Excalidraw element not found: ${id}`);
  const [element] = elements.splice(currentIndex, 1);
  let targetIndex;
  if (action === 'sendToBack') {
    targetIndex = elements.findIndex((candidate) => !candidate.isDeleted);
    if (targetIndex < 0) targetIndex = elements.length;
  } else if (action === 'bringToFront') {
    const lastActiveIndex = elements.findLastIndex((candidate) => !candidate.isDeleted);
    targetIndex = lastActiveIndex < 0 ? elements.length : lastActiveIndex + 1;
  } else {
    const targetId = beforeElementId ?? afterElementId;
    if (targetId === id) throw invalid(`${name} cannot target its own element`);
    const referenceIndex = elements.findIndex((candidate) => (
      candidate.id === targetId && !candidate.isDeleted
    ));
    if (referenceIndex < 0) {
      throw invalid(`${name} targets missing element ${targetId}`);
    }
    targetIndex = beforeElementId ? referenceIndex : referenceIndex + 1;
  }
  elements.splice(targetIndex, 0, element);
}

function hasValidElementOrder(elements) {
  let previousIndex = null;
  for (const element of elements) {
    if (element.isDeleted) continue;
    if (typeof element.index !== 'string') return false;
    try {
      validateOrderKey(element.index);
    } catch {
      return false;
    }
    if (previousIndex !== null && element.index <= previousIndex) return false;
    previousIndex = element.index;
  }
  return true;
}

function normalizeElementOrder(elements, now, alreadyVersionedIds = new Set()) {
  if (hasValidElementOrder(elements)) return elements;
  const activeElements = elements.filter((element) => !element.isDeleted);
  const indices = generateNKeysBetween(null, null, activeElements.length);
  let activeIndex = 0;
  return elements.map((element) => {
    if (element.isDeleted) return element;
    const index = indices[activeIndex];
    activeIndex += 1;
    if (element.index === index) return element;
    if (alreadyVersionedIds.has(element.id)) {
      return { ...element, index };
    }
    return {
      ...bumpElementVersion(element, now, `index:${index}`),
      index,
    };
  });
}

function refreshArrowBindings(elements) {
  const activeById = new Map(elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]));
  for (const element of activeById.values()) {
    if (Array.isArray(element.boundElements)) {
      element.boundElements = element.boundElements.filter(({ type }) => type !== 'arrow');
      if (element.boundElements.length === 0) element.boundElements = null;
    }
  }
  for (const element of activeById.values()) {
    if (element.type !== 'arrow' && element.type !== 'line') continue;
    for (const binding of [element.startBinding, element.endBinding]) {
      if (!binding?.elementId) continue;
      const target = activeById.get(binding.elementId);
      if (!target) throw invalid(`Element ${element.id} binds to missing element ${binding.elementId}`);
      target.boundElements = [...(target.boundElements ?? []), { id: element.id, type: 'arrow' }];
    }
  }
}

function validateUniqueIds(elements) {
  const ids = new Set();
  for (const element of elements) {
    if (ids.has(element.id)) throw invalid(`Duplicate Excalidraw element id: ${element.id}`);
    ids.add(element.id);
  }
}

export function createAgentExcalidrawScene(rawElements) {
  if (!Array.isArray(rawElements) || rawElements.length < 1 || rawElements.length > 200) {
    throw invalid('Excalidraw scene must contain 1 to 200 elements');
  }
  const now = Date.now();
  let elements = rawElements.map((element) => normalizeElement(element, now));
  validateUniqueIds(elements);
  rawElements.forEach((rawElement) => {
    moveElement(
      elements,
      String(rawElement?.id ?? '').trim(),
      rawElement,
      `Element ${rawElement?.id ?? ''} layer placement`,
    );
  });
  elements = normalizeElementOrder(elements, now, new Set(elements.map(({ id }) => id)));
  refreshArrowBindings(elements);
  return {
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    elements,
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  };
}

export function applyAgentExcalidrawEdits(scene, edits = {}) {
  requireObject(scene, 'Excalidraw scene');
  if (scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) {
    throw invalid('Document is not a valid Excalidraw scene');
  }
  requireObject(edits, 'Excalidraw edits');
  const create = edits.create ?? [];
  const update = edits.update ?? [];
  const replace = edits.replace ?? [];
  const remove = edits.delete ?? [];
  const reorder = edits.reorder ?? [];
  const operations = [create, update, replace, remove, reorder];
  const operationCount = operations.reduce((count, entries) => (
    count + (Array.isArray(entries) ? entries.length : 0)
  ), 0);
  if (!operations.every(Array.isArray) || operationCount < 1) {
    throw invalid('Excalidraw edits must include at least one operation');
  }
  if (operationCount > 200) {
    throw invalid('Excalidraw edits cannot exceed 200 operations');
  }

  const now = Date.now();
  let elements = scene.elements.map((element) => ({ ...element }));
  const byId = new Map(elements.map((element) => [element.id, element]));
  const alreadyVersionedIds = new Set();
  const createdElements = create.map((raw) => {
    const element = normalizeElement(raw, now);
    if (byId.has(element.id)) throw invalid(`Excalidraw element already exists: ${element.id}`);
    elements.push(element);
    byId.set(element.id, element);
    alreadyVersionedIds.add(element.id);
    return { element, raw };
  });
  createdElements.forEach(({ element, raw }) => {
    moveElement(elements, element.id, raw, `Element ${element.id} layer placement`);
  });
  update.forEach((operation) => {
    requireObject(operation, 'Update operation');
    const id = String(operation.id ?? '').trim();
    const current = byId.get(id);
    if (!current || current.isDeleted) throw invalid(`Excalidraw element not found: ${id}`);
    const set = requireObject(operation.set, `Update ${id} set`);
    if (
      ['id', 'index', 'isDeleted', 'type', 'version', 'versionNonce']
        .some((field) => Object.hasOwn(set, field))
    ) {
      throw invalid(`Update ${id} cannot change identity, type, deletion, version, or layer fields`);
    }
    const next = bumpElementVersion(normalizeElement({ ...current, ...set }, now), now, 'update');
    elements[elements.indexOf(current)] = next;
    byId.set(id, next);
    alreadyVersionedIds.add(id);
  });
  replace.forEach((operation) => {
    requireObject(operation, 'Replace operation');
    const id = String(operation.id ?? '').trim();
    const current = byId.get(id);
    if (!current || current.isDeleted) throw invalid(`Excalidraw element not found: ${id}`);
    const rawElement = requireObject(operation.element, `Replace ${id} element`);
    if (rawElement.id !== undefined && String(rawElement.id) !== id) {
      throw invalid(`Replace ${id} element id must match the replaced element`);
    }
    const next = bumpElementVersion(normalizeElement({
      ...rawElement,
      id,
      index: current.index,
      updated: current.updated,
      version: current.version,
      versionNonce: current.versionNonce,
    }, now), now, 'replace');
    elements[elements.indexOf(current)] = next;
    byId.set(id, next);
    alreadyVersionedIds.add(id);
  });
  remove.forEach((rawId) => {
    const id = String(rawId ?? '').trim();
    const current = byId.get(id);
    if (!current || current.isDeleted) throw invalid(`Excalidraw element not found: ${id}`);
    const deleted = {
      ...bumpElementVersion(current, now, 'deleted'),
      isDeleted: true,
    };
    elements[elements.indexOf(current)] = deleted;
    byId.set(id, deleted);
    alreadyVersionedIds.add(id);
  });
  reorder.forEach((operation) => {
    requireObject(operation, 'Reorder operation');
    const id = String(operation.id ?? '').trim();
    moveElement(elements, id, operation, `Reorder ${id}`);
  });
  validateUniqueIds(elements);
  elements = normalizeElementOrder(elements, now, alreadyVersionedIds);
  refreshArrowBindings(elements);
  return { ...scene, elements };
}
