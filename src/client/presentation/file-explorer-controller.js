import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { FileActionController } from './file-action-controller.js';
import { FileTreeState } from './file-tree-state.js';
import { FileExplorerView } from './file-explorer-view.js';

export class FileExplorerController {
  constructor({
    mobileBreakpointQuery = window.matchMedia('(max-width: 768px)'),
    onFileSelect,
    onFileDelete,
    onDirectoryExport,
    pendingWorkspaceRequestIds = null,
    onShowFileExtensionsChange,
    showFileExtensions = false,
    toastController,
    vaultClient,
    vaultSwitcher = null,
  }) {
    this.onFileSelect = onFileSelect;
    this.onFileDelete = onFileDelete;
    this.onDirectoryExport = onDirectoryExport;
    this.onShowFileExtensionsChange = onShowFileExtensionsChange;
    this.toastController = toastController;
    this.vaultClient = vaultClient;
    this.vaultSwitcher = vaultSwitcher;
    this.state = new FileTreeState();
    this.showFileExtensions = Boolean(showFileExtensions);
    this.threadCounts = new Map();
    this.view = new FileExplorerView({
      mobileBreakpointQuery,
      onDirectoryToggle: (pathValue) => {
        this.state.toggleDirectory(pathValue);
        if (!this.view.rerenderDirectoryBranch(pathValue, this.state.tree, {
          activeFilePath: this.state.activeFilePath,
          expandedDirs: this.state.expandedDirs,
        })) {
          this.renderTree();
        }
      },
      onEntryDrop: (payload) => this.actionController.moveEntryByDrop(payload),
      onFileContextMenu: (event, payload) => {
        if (payload.type === 'directory') {
          this.view.showContextMenu(event, this.actionController.getDirectoryContextMenuItems(payload.directoryPath));
          return;
        }

        this.view.showContextMenu(event, this.actionController.getFileContextMenuItems(payload.filePath));
      },
      onFileSelect: (filePath) => {
        this.onFileSelect?.(filePath);
      },
      onValidateDrop: (payload) => this.actionController.canMoveEntryByDrop(payload),
      onSearchChange: (value) => {
        this.state.setSearchQuery(value);
        this.renderTree();
      },
      onTreeContextMenu: (event) => {
        this.view.showContextMenu(event, this.actionController.createContextMenuItems());
      },
    });
    this.actionController = new FileActionController({
      mobileBreakpointQuery,
      onDirectoryExport: this.onDirectoryExport,
      onFileDelete: this.onFileDelete,
      onFileSelect: this.onFileSelect,
      onShowFileExtensionsChange: (enabled) => {
        this.showFileExtensions = Boolean(enabled);
        this.onShowFileExtensionsChange?.(this.showFileExtensions);
        this.renderTree();
      },
      pendingWorkspaceRequestIds,
      showFileExtensions: this.showFileExtensions,
      refresh: () => this.refresh(),
      state: this.state,
      toastController: this.toastController,
      vaultClient: this.vaultClient,
      view: this.view,
    });
  }

  initialize() {
    this.view.initialize();
    this.view.renderVaultSwitcher(this.vaultSwitcher);
    this.actionController.initialize();
  }

  async refresh() {
    try {
      const data = await this.vaultClient.readTree();
      this.setTree(data.tree || []);
    } catch (error) {
      console.error('[explorer] Failed to load file tree:', error.message);
    }
  }

  setTree(tree, {
    changedPaths = null,
    reset = false,
  } = {}) {
    this.state.setTree(tree);
    this.renderTree({ changedPaths, reset });
  }

  setActiveFile(filePath) {
    const expandedDirectoryCount = this.state.expandedDirs.size;
    this.state.setActiveFile(filePath);
    if (this.state.searchQuery) {
      this.view.setActiveFile(filePath);
      return;
    }
    if (
      this.state.expandedDirs.size !== expandedDirectoryCount
      || !this.view.setActiveFile(filePath)
    ) {
      this.renderTree();
    }
  }

  setThreadCounts(threadCounts = new Map()) {
    this.threadCounts = threadCounts instanceof Map
      ? new Map(threadCounts)
      : new Map(Object.entries(threadCounts ?? {}));
    this.view.setThreadCounts(this.threadCounts);
  }

  revealFile(filePath, { clearSearch = false } = {}) {
    if (clearSearch) {
      this.state.setSearchQuery('');
    }

    this.state.setActiveFile(filePath);
    this.renderTree({ reset: clearSearch });
    this.view.revealFile(filePath);
  }

  get flatFiles() {
    return this.state.flatFiles;
  }

  get fileEntries() {
    return this.state.flatFileEntries;
  }

  get flatDocumentFiles() {
    return this.state.flatFiles.filter((path) => !isImageAttachmentFilePath(path));
  }

  renderTree({
    changedPaths = null,
    reset = false,
  } = {}) {
    this.view.render({
      activeFilePath: this.state.activeFilePath,
      changedPaths,
      expandedDirs: this.state.expandedDirs,
      reset,
      searchMatches: this.state.getSearchMatches(),
      searchQuery: this.state.searchQuery,
      showFileExtensions: this.showFileExtensions,
      threadCounts: this.threadCounts,
      tree: this.state.tree,
    });
  }
}
