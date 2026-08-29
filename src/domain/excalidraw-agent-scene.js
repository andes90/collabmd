const ELEMENT_TYPES = new Set([
  'arrow',
  'diamond',
  'ellipse',
  'freedraw',
  'line',
  'rectangle',
  'text',
]);

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
  if (!['arrow', 'freedraw', 'line'].includes(type)) return points;
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

function readElementGeometry(raw, id, type) {
  const x = requireNumber(raw.x, `Element ${id} x`);
  const y = requireNumber(raw.y, `Element ${id} y`);
  const fontSize = type === 'text'
    ? requireNumber(raw.fontSize ?? 20, `Element ${id} fontSize`)
    : raw.fontSize;
  const text = type === 'text' ? String(raw.text ?? '') : raw.text;
  const defaultWidth = type === 'text'
    ? Math.max(1, ...text.split('\n').map((line) => line.length)) * fontSize * 0.6
    : 100;
  const defaultHeight = type === 'text'
    ? Math.max(1, text.split('\n').length) * fontSize * 1.25
    : 100;
  return {
    fontSize,
    height: requireNumber(raw.height ?? defaultHeight, `Element ${id} height`),
    points: normalizePoints(raw.points, type),
    text,
    width: requireNumber(raw.width ?? defaultWidth, `Element ${id} width`),
    x,
    y,
  };
}

function createBaseElement(raw, { height, id, index, now, type, width, x, y }) {
  const rest = { ...raw };
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
    index: raw.index ?? `a${index}`,
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

function normalizeElement(rawElement, index, now) {
  const raw = requireObject(rawElement, 'Element');
  const id = String(raw.id ?? '').trim();
  if (!id || id.length > 128) throw invalid('Element id must contain 1 to 128 characters');
  if (!ELEMENT_TYPES.has(raw.type)) throw invalid(`Unsupported Excalidraw element type: ${raw.type}`);

  const type = raw.type;
  const geometry = readElementGeometry(raw, id, type);
  const element = createBaseElement(raw, { ...geometry, id, index, now, type });
  if (geometry.points) element.points = geometry.points;
  if (type === 'arrow' || type === 'line') addLinearElementFields(element, raw);
  if (type === 'text') addTextElementFields(element, raw, geometry);
  return element;
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
  const elements = rawElements.map((element, index) => normalizeElement(element, index, now));
  validateUniqueIds(elements);
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
  const remove = edits.delete ?? [];
  if (![create, update, remove].every(Array.isArray) || create.length + update.length + remove.length < 1) {
    throw invalid('Excalidraw edits must include at least one create, update, or delete operation');
  }
  if (create.length + update.length + remove.length > 200) {
    throw invalid('Excalidraw edits cannot exceed 200 operations');
  }

  const now = Date.now();
  const elements = (Array.isArray(scene.elements) ? scene.elements : []).map((element) => ({ ...element }));
  const byId = new Map(elements.map((element) => [element.id, element]));
  const createStartIndex = elements.length;
  create.forEach((raw, index) => {
    const element = normalizeElement(raw, createStartIndex + index, now);
    if (byId.has(element.id)) throw invalid(`Excalidraw element already exists: ${element.id}`);
    elements.push(element);
    byId.set(element.id, element);
  });
  update.forEach((operation) => {
    requireObject(operation, 'Update operation');
    const id = String(operation.id ?? '').trim();
    const current = byId.get(id);
    if (!current || current.isDeleted) throw invalid(`Excalidraw element not found: ${id}`);
    const set = requireObject(operation.set, `Update ${id} set`);
    if (Object.hasOwn(set, 'id') || Object.hasOwn(set, 'type') || Object.hasOwn(set, 'version')) {
      throw invalid(`Update ${id} cannot change id, type, or version`);
    }
    const next = normalizeElement({ ...current, ...set }, elements.indexOf(current), now);
    next.version = (Number(current.version) || 0) + 1;
    next.versionNonce = stableNumber(`${id}:${next.version}:${now}`);
    elements[elements.indexOf(current)] = next;
    byId.set(id, next);
  });
  remove.forEach((rawId) => {
    const id = String(rawId ?? '').trim();
    const current = byId.get(id);
    if (!current || current.isDeleted) throw invalid(`Excalidraw element not found: ${id}`);
    const deleted = {
      ...current,
      isDeleted: true,
      updated: now,
      version: (Number(current.version) || 0) + 1,
      versionNonce: stableNumber(`${id}:deleted:${now}`),
    };
    elements[elements.indexOf(current)] = deleted;
    byId.set(id, deleted);
  });
  validateUniqueIds(elements);
  refreshArrowBindings(elements);
  return { ...scene, elements };
}
