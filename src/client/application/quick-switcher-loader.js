export async function ensureQuickSwitcherInstance(host) {
  if (host.quickSwitcher) {
    return host.quickSwitcher;
  }

  if (!host.quickSwitcherModulePromise) {
    host.quickSwitcherModulePromise = host.loadQuickSwitcherController();
  }

  let QuickSwitcherController;
  try {
    QuickSwitcherController = await host.quickSwitcherModulePromise;
  } catch (error) {
    host.quickSwitcherModulePromise = null;
    console.error('[quick-switcher] Failed to load file search.', error);
    host.toastController?.show?.('Failed to load file search. Try again.', {
      dismissible: true,
    });
    throw error;
  }

  if (!host.quickSwitcher) {
    host.quickSwitcher = new QuickSwitcherController({
      getFileList: () => host.fileExplorer.flatFiles,
      getFileMetadata: () => host.fileExplorer.fileEntries,
      getRecentFiles: () => host.preferences?.getRecentFiles?.() ?? [],
      getSearchConfig: () => host.runtimeConfig.search ?? {},
      onFileSelect: (filePath) => host.workspaceRouteController.handleFileSelection(filePath, {
        closeSidebarOnMobile: true,
        revealInTree: !host.sidebarDrawerQuery.matches,
      }),
      onTextMatchSelect: (match) => {
        if (!match?.file) {
          return;
        }

        host.navigation.navigateToFile(match.file, {
          column: match.column,
          drawioMode: match.kind === 'drawio' ? 'text' : null,
          line: match.line,
          matchLength: match.matchLength,
        });
      },
      searchText: (payload) => host.vaultApiClient.searchText(payload),
    });
  }

  return host.quickSwitcher;
}

export async function toggleQuickSwitcherInstance(host) {
  try {
    const quickSwitcher = await ensureQuickSwitcherInstance(host);
    quickSwitcher.toggle();
  } catch {
    // ensureQuickSwitcherInstance reports the load failure and resets the cached import.
  }
}
