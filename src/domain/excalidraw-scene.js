export function createEmptyScene() {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    elements: [],
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
  };
}

export function normalizeScene(raw) {
  if (!raw || typeof raw !== 'object') {
    return createEmptyScene();
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    elements: Array.isArray(raw.elements) ? raw.elements : [],
    appState: {
      gridSize: raw.appState?.gridSize ?? null,
      viewBackgroundColor: raw.appState?.viewBackgroundColor ?? '#ffffff',
    },
    files: raw.files && typeof raw.files === 'object' ? raw.files : {},
  };
}

export function parseSceneJson(rawJson) {
  const parsed = tryParseSceneJson(rawJson);
  return parsed || createEmptyScene();
}

export function tryParseSceneJson(rawJson) {
  if (!rawJson) {
    return null;
  }

  try {
    return normalizeScene(JSON.parse(rawJson));
  } catch {
    return null;
  }
}
