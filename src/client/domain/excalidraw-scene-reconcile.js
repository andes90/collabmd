export function buildReconciledExcalidrawSceneUpdate({
  appStateOverrides = {},
  authoritative = false,
  currentAppState,
  currentElements = [],
  documentViewState = {},
  includeUnchangedAppState = false,
  reconcileElementsFn,
  restoreAppStateFn,
  restoreElementsFn,
  scene,
  theme = 'dark',
} = {}) {
  const restoredElements = restoreElementsFn(scene?.elements || [], authoritative ? [] : currentElements, {
    repairBindings: true,
  });
  const restoredAppState = restoreAppStateFn(scene?.appState || {}, currentAppState);
  const nextAppState = {
    theme,
    viewBackgroundColor: restoredAppState.viewBackgroundColor ?? '#ffffff',
    gridSize: restoredAppState.gridSize ?? null,
    ...documentViewState,
    ...appStateOverrides,
  };
  const appStateUpdate = Object.fromEntries(
    Object.entries(nextAppState).filter(([key, value]) => (
      includeUnchangedAppState || currentAppState?.[key] !== value
    )),
  );
  const update = {
    elements: authoritative
      ? restoredElements
      : reconcileElementsFn(currentElements, restoredElements, currentAppState),
  };

  if (Object.keys(appStateUpdate).length > 0) {
    update.appState = appStateUpdate;
  }

  return update;
}
