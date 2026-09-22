import { normalizeScene } from '../../domain/excalidraw-scene.js';

export { createEmptyScene, normalizeScene, parseSceneJson, tryParseSceneJson } from '../../domain/excalidraw-scene.js';

export function normalizeDocumentMode(mode) {
  return mode === 'preview' ? 'preview' : 'edit';
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
