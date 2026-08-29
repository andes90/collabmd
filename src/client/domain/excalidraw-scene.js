export function normalizeDocumentMode(mode) {
  return mode === 'preview' ? 'preview' : 'edit';
}

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

export function sceneToInitialData(parsedScene, { theme = 'dark' } = {}) {
  return {
    elements: parsedScene.elements || [],
    appState: {
      theme,
      viewBackgroundColor: parsedScene.appState?.viewBackgroundColor ?? '#ffffff',
      gridSize: parsedScene.appState?.gridSize ?? null,
    },
    files: parsedScene.files || {},
  };
}

export function createExcalidrawExportOptions(scene, {
  padding = 24,
  scale = 1,
} = {}) {
  return {
    appState: {
      exportBackground: true,
      exportScale: scale,
      exportWithDarkMode: false,
      gridSize: scene.appState?.gridSize ?? null,
      theme: 'light',
      viewBackgroundColor: scene.appState?.viewBackgroundColor ?? '#ffffff',
    },
    elements: Array.isArray(scene.elements)
      ? scene.elements.filter((element) => element && !element.isDeleted)
      : [],
    exportPadding: padding,
    files: scene.files || null,
  };
}

export function buildStoredScene(elements, appState, files) {
  return normalizeScene({
    elements: elements.filter((element) => !element.isDeleted),
    appState: {
      gridSize: appState.gridSize ?? null,
      viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
    },
    files: files || {},
  });
}

export function buildLiveCollaborationScene(elements, appState, files) {
  return normalizeScene({
    elements: Array.isArray(elements) ? elements : [],
    appState: {
      gridSize: appState?.gridSize ?? null,
      viewBackgroundColor: appState?.viewBackgroundColor ?? '#ffffff',
    },
    files: files || {},
  });
}
