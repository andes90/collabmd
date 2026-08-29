import * as Y from 'yjs';

const EXCALIDRAW_TYPE = 'excalidraw';
const EXCALIDRAW_VERSION = 2;
const EXCALIDRAW_SOURCE = 'collabmd';

export const EXCALIDRAW_APP_STATE_KEY = 'excalidraw-app-state';
export const EXCALIDRAW_ELEMENTS_KEY = 'excalidraw-elements';
export const EXCALIDRAW_FILES_KEY = 'excalidraw-files';
export const EXCALIDRAW_META_KEY = 'excalidraw-meta';
export const EXCALIDRAW_ROOM_SCHEMA_VERSION = 1;
export const EXCALIDRAW_ROOM_TEXT_KEY = 'codemirror';
export const EXCALIDRAW_SCHEMA_VERSION_KEY = 'schemaVersion';

function createEmptyScene() {
  return {
    type: EXCALIDRAW_TYPE,
    version: EXCALIDRAW_VERSION,
    source: EXCALIDRAW_SOURCE,
    elements: [],
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
  };
}

function normalizeAppState(appState = {}) {
  return {
    gridSize: appState?.gridSize ?? null,
    viewBackgroundColor: appState?.viewBackgroundColor ?? '#ffffff',
  };
}

function normalizeScene(raw) {
  if (!raw || typeof raw !== 'object') {
    return createEmptyScene();
  }

  return {
    type: EXCALIDRAW_TYPE,
    version: EXCALIDRAW_VERSION,
    source: EXCALIDRAW_SOURCE,
    elements: Array.isArray(raw.elements) ? raw.elements : [],
    appState: normalizeAppState(raw.appState),
    files: raw.files && typeof raw.files === 'object' ? raw.files : {},
  };
}

function parseSceneJson(rawJson, { fallbackToEmpty = true } = {}) {
  if (!rawJson) {
    return fallbackToEmpty ? createEmptyScene() : null;
  }

  try {
    return normalizeScene(JSON.parse(rawJson));
  } catch {
    return fallbackToEmpty ? createEmptyScene() : null;
  }
}

function cloneJsonValue(value) {
  return structuredClone(value);
}

function getRevisionKey(element) {
  const version = Number.isFinite(Number(element?.version)) ? Number(element.version) : 0;
  const versionNonce = Number.isFinite(Number(element?.versionNonce)) ? Number(element.versionNonce) : 0;
  const updated = Number.isFinite(Number(element?.updated)) ? Number(element.updated) : 0;
  return `${version}:${versionNonce}:${updated}`;
}

function compareElementVersions(left, right) {
  const leftVersion = Number(left?.version) || 0;
  const rightVersion = Number(right?.version) || 0;
  if (leftVersion !== rightVersion) {
    return leftVersion - rightVersion;
  }

  const leftVersionNonce = Number(left?.versionNonce) || 0;
  const rightVersionNonce = Number(right?.versionNonce) || 0;
  if (leftVersionNonce !== rightVersionNonce) {
    return rightVersionNonce - leftVersionNonce;
  }

  const leftUpdated = Number(left?.updated) || 0;
  const rightUpdated = Number(right?.updated) || 0;
  if (leftUpdated !== rightUpdated) {
    return leftUpdated - rightUpdated;
  }

  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function compareElementIndex(left, right) {
  const leftIndex = String(left?.index ?? '');
  const rightIndex = String(right?.index ?? '');
  if (leftIndex !== rightIndex) {
    return leftIndex < rightIndex ? -1 : 1;
  }

  const leftId = String(left?.id || '');
  const rightId = String(right?.id || '');
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function getNestedMapValue(map, key, { create = false } = {}) {
  const existing = map.get(key);
  if (existing instanceof Y.Map) {
    return existing;
  }

  if (!create) {
    return null;
  }

  const nested = new Y.Map();
  map.set(key, nested);
  return nested;
}

function readRevisionEntry(entryValue) {
  if (typeof entryValue === 'string') {
    try {
      return JSON.parse(entryValue);
    } catch {
      return null;
    }
  }

  if (!entryValue || typeof entryValue !== 'object') {
    return null;
  }

  return cloneJsonValue(entryValue);
}

function selectWinningElementFromSlot(slot) {
  if (!(slot instanceof Y.Map) || slot.size === 0) {
    return null;
  }

  let winningElement = null;
  slot.forEach((value) => {
    const candidate = readRevisionEntry(value);
    if (!candidate || !candidate.id) {
      return;
    }

    if (!winningElement || compareElementVersions(candidate, winningElement) > 0) {
      winningElement = candidate;
    }
  });

  return winningElement;
}

function writeElementSlot(slot, element, {
  maxRevisions = 2,
} = {}) {
  const revisionKey = getRevisionKey(element);
  const serialized = cloneJsonValue(element);
  const previous = slot.get(revisionKey);
  const previousSerialized = previous && typeof previous === 'object'
    ? JSON.stringify(previous)
    : '';
  const nextSerialized = JSON.stringify(serialized);
  if (previousSerialized === nextSerialized) {
    return false;
  }

  slot.set(revisionKey, serialized);
  pruneElementSlot(slot, maxRevisions);
  return true;
}

function pruneElementSlot(slot, maxRevisions = 2) {
  if (!(slot instanceof Y.Map) || slot.size <= maxRevisions) {
    return;
  }

  const revisions = [];
  slot.forEach((value, key) => {
    const element = readRevisionEntry(value);
    if (!element) {
      revisions.push({ element: null, key });
      return;
    }

    revisions.push({ element, key });
  });

  revisions.sort((left, right) => {
    if (!left.element) {
      return -1;
    }
    if (!right.element) {
      return 1;
    }
    return compareElementVersions(left.element, right.element);
  });

  while (revisions.length > maxRevisions) {
    const entry = revisions.shift();
    if (entry?.key) {
      slot.delete(entry.key);
    }
  }
}

function sortSceneElements(elements) {
  return [...elements].sort(compareElementIndex);
}

export function isExcalidrawRoomDocStructured(ydoc) {
  if (!ydoc) {
    return false;
  }

  const meta = ydoc.getMap(EXCALIDRAW_META_KEY);
  return Number(meta.get(EXCALIDRAW_SCHEMA_VERSION_KEY)) === EXCALIDRAW_ROOM_SCHEMA_VERSION;
}

export function ensureExcalidrawRoomSchema(ydoc) {
  const meta = ydoc.getMap(EXCALIDRAW_META_KEY);
  if (Number(meta.get(EXCALIDRAW_SCHEMA_VERSION_KEY)) !== EXCALIDRAW_ROOM_SCHEMA_VERSION) {
    meta.set(EXCALIDRAW_SCHEMA_VERSION_KEY, EXCALIDRAW_ROOM_SCHEMA_VERSION);
  }

  return meta;
}

export function buildExcalidrawRoomScene(ydoc, {
  includeDeleted = true,
} = {}) {
  if (!ydoc) {
    return createEmptyScene();
  }

  const elementsMap = ydoc.getMap(EXCALIDRAW_ELEMENTS_KEY);
  const filesMap = ydoc.getMap(EXCALIDRAW_FILES_KEY);
  const appStateMap = ydoc.getMap(EXCALIDRAW_APP_STATE_KEY);

  const elements = [];
  elementsMap.forEach((value) => {
    const winningElement = selectWinningElementFromSlot(value);
    if (!winningElement) {
      return;
    }

    if (!includeDeleted && winningElement.isDeleted) {
      return;
    }

    elements.push(winningElement);
  });

  const files = {};
  filesMap.forEach((value, key) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    files[key] = cloneJsonValue(value);
  });

  const scene = normalizeScene({
    appState: {
      gridSize: appStateMap.get('gridSize'),
      viewBackgroundColor: appStateMap.get('viewBackgroundColor'),
    },
    elements: sortSceneElements(elements),
    files,
  });

  return scene;
}

export function serializeExcalidrawRoomScene(ydoc, {
  includeDeleted = false,
} = {}) {
  const scene = buildExcalidrawRoomScene(ydoc, { includeDeleted });
  if (!includeDeleted) {
    scene.elements = scene.elements.filter((element) => !element.isDeleted);
  }
  return JSON.stringify(scene);
}

export function replaceExcalidrawRoomScene(ydoc, rawScene, {
  maxRevisionsPerElement = 2,
} = {}) {
  if (!ydoc) {
    return createEmptyScene();
  }

  const scene = normalizeScene(rawScene);
  ensureExcalidrawRoomSchema(ydoc);

  const elementsMap = ydoc.getMap(EXCALIDRAW_ELEMENTS_KEY);
  const filesMap = ydoc.getMap(EXCALIDRAW_FILES_KEY);
  const appStateMap = ydoc.getMap(EXCALIDRAW_APP_STATE_KEY);

  Array.from(elementsMap.keys()).forEach((key) => elementsMap.delete(key));
  Array.from(filesMap.keys()).forEach((key) => filesMap.delete(key));
  Array.from(appStateMap.keys()).forEach((key) => appStateMap.delete(key));

  scene.elements.forEach((element) => {
    if (!element?.id) {
      return;
    }

    const slot = getNestedMapValue(elementsMap, element.id, { create: true });
    writeElementSlot(slot, element, { maxRevisions: maxRevisionsPerElement });
  });

  Object.entries(scene.files || {}).forEach(([key, value]) => {
    filesMap.set(key, cloneJsonValue(value));
  });

  const nextAppState = normalizeAppState(scene.appState);
  appStateMap.set('gridSize', nextAppState.gridSize);
  appStateMap.set('viewBackgroundColor', nextAppState.viewBackgroundColor);

  return scene;
}

export function applySceneDiffToExcalidrawRoom(ydoc, rawScene, {
  maxRevisionsPerElement = 2,
} = {}) {
  if (!ydoc) {
    return false;
  }

  const scene = normalizeScene(rawScene);
  ensureExcalidrawRoomSchema(ydoc);

  const elementsMap = ydoc.getMap(EXCALIDRAW_ELEMENTS_KEY);
  const filesMap = ydoc.getMap(EXCALIDRAW_FILES_KEY);
  const appStateMap = ydoc.getMap(EXCALIDRAW_APP_STATE_KEY);
  let changed = false;

  scene.elements.forEach((element) => {
    if (!element?.id) {
      return;
    }

    const slot = getNestedMapValue(elementsMap, element.id, { create: true });
    changed = writeElementSlot(slot, element, { maxRevisions: maxRevisionsPerElement }) || changed;
  });

  const nextFiles = scene.files || {};
  Object.entries(nextFiles).forEach(([key, value]) => {
    const nextValue = cloneJsonValue(value);
    const currentValue = filesMap.get(key);
    if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) {
      return;
    }

    filesMap.set(key, nextValue);
    changed = true;
  });

  const nextAppState = normalizeAppState(scene.appState);
  Object.entries(nextAppState).forEach(([key, value]) => {
    if (appStateMap.get(key) === value) {
      return;
    }

    appStateMap.set(key, value);
    changed = true;
  });

  Array.from(appStateMap.keys()).forEach((key) => {
    if (!(key in nextAppState)) {
      appStateMap.delete(key);
      changed = true;
    }
  });

  return changed;
}

export function readLegacyExcalidrawRoomScene(ydoc) {
  if (!ydoc) {
    return null;
  }

  const rawJson = ydoc.getText(EXCALIDRAW_ROOM_TEXT_KEY).toString();
  return parseSceneJson(rawJson, { fallbackToEmpty: false });
}

export function migrateLegacyExcalidrawRoomData(ydoc, rawScene, options = {}) {
  const scene = normalizeScene(rawScene);
  replaceExcalidrawRoomScene(ydoc, scene, options);
  return scene;
}

export function tryParseExcalidrawSceneJson(rawJson) {
  return parseSceneJson(rawJson, { fallbackToEmpty: false });
}
