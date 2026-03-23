import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { vaultApiClient } from '../domain/vault-api-client.js';
import { FileActionController } from './file-action-controller.js';
import { FileTreeState } from './file-tree-state.js';
import { FileExplorerView } from './file-explorer-view.js';

export class FileExplorerController {
  constructor({
    mobileBreakpointQuery = window.matchMedia('(max-width: 768px)'),
    onFileSelect,
    onFileDelete,
    pendingWorkspaceRequestIds = null,
    toastController,
    vaultClient = vaultApiClient,
  }) {
    this.onFileSelect = onFileSelect;
    this.onFileDelete = onFileDelete;
    this.toastController = toastController;
    this.vaultClient = vaultClient;
    this.state = new FileTreeState();
    this.view = new FileExplorerView({
      mobileBreakpointQuery,
      onDirectorySelect: (pathValue) => {
        this.state.expandDirectoryPath(pathValue);
        this.state.setSearchQuery('');
        this.renderTree({ reset: true });
      },
      onDirectoryToggle: (pathValue) => {
        this.state.toggleDirectory(pathValue);
        this.renderTree();
      },
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
      onSearchChange: (value) => {
        this.state.setSearchQuery(value);
        this.renderTree();
      },
      onTreeContextMenu: (event) => {
        this.view.showContextMenu(event, this.actionController.createContextMenuItems());
      },
    });
    this.actionController = new FileActionController({
      onFileDelete: this.onFileDelete,
      onFileSelect: this.onFileSelect,
      pendingWorkspaceRequestIds,
      refresh: () => this.refresh(),
      state: this.state,
      toastController: this.toastController,
      vaultClient: this.vaultClient,
      view: this.view,
    });
  }

  initialize() {
    this.view.initialize();
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
    this.state.setActiveFile(filePath);
    this.renderTree();
  }

  get flatFiles() {
    return this.state.flatFiles;
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
      tree: this.state.tree,
    });
  }
}
