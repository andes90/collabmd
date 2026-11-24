import { createRandomUuid } from '../../domain/random-uuid.js';
import { replacePathPrefix } from '../../domain/vault-paths.js';
import {
  getVaultFileExtension,
  isMarkdownFilePath,
  isVaultFilePath,
  VAULT_FILE_EXTENSIONS,
} from '../../domain/file-kind.js';
import { copyTextToClipboard, pickFiles } from '../browser-utils.js';
import {
  createBaseStarter,
  composeVaultChildPath,
  createDrawioStarter,
  createMarkdownStarter,
  createMermaidStarter,
  createPlantUmlStarter,
  createStructurizrStarter,
  ensureVaultExtension,
  getVaultPathLeaf,
  getVaultPathParent,
  normalizeVaultPathInput,
} from '../domain/vault-paths.js';
import { createFileRouteHash } from '../domain/hash-routes.js';
import { getActiveVaultId } from '../domain/runtime-paths.js';
import { CreateMenuPresenter } from './create-menu-presenter.js';

function formatCount(value, singularLabel, pluralLabel) {
  return `${value} ${value === 1 ? singularLabel : pluralLabel}`;
}

const VAULT_FILE_PICKER_ACCEPT = VAULT_FILE_EXTENSIONS.join(',');

function createEmptyExcalidrawScene() {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  });
}

function withRequestId(payload, requestId) {
  if (!requestId) {
    return payload;
  }

  return {
    ...payload,
    requestId,
  };
}

export class FileActionController {
  constructor({
    mobileBreakpointQuery = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
      ? window.matchMedia('(max-width: 768px)')
      : { matches: false },
    onDirectoryExport,
    onFileDelete,
    onFileSelect,
    onShowFileExtensionsChange,
    pendingWorkspaceRequestIds = null,
    showFileExtensions = false,
    state,
    toastController,
    vaultClient,
    view,
    refresh,
  }) {
    this.onDirectoryExport = onDirectoryExport;
    this.onFileDelete = onFileDelete;
    this.onFileSelect = onFileSelect;
    this.onShowFileExtensionsChange = onShowFileExtensionsChange;
    this.pendingWorkspaceRequestIds = pendingWorkspaceRequestIds;
    this.showFileExtensions = Boolean(showFileExtensions);
    this.state = state;
    this.toastController = toastController;
    this.vaultClient = vaultClient;
    this.view = view;
    this.refresh = refresh;
    this.createButton = document.getElementById('sidebarCreateBtn');
    this.fileExplorerOptionsButton = document.getElementById('fileExplorerOptionsBtn');
    this.actionDialog = document.getElementById('fileActionDialog');
    this.actionForm = document.getElementById('fileActionForm');
    this.actionTitle = document.getElementById('fileActionTitle');
    this.actionCopy = document.getElementById('fileActionCopy');
    this.actionField = document.getElementById('fileActionField');
    this.actionLabel = document.getElementById('fileActionLabel');
    this.actionInput = document.getElementById('fileActionInput');
    this.actionHint = document.getElementById('fileActionHint');
    this.actionError = document.getElementById('fileActionError');
    this.actionNote = document.getElementById('fileActionNote');
    this.actionCancelButton = document.getElementById('fileActionCancel');
    this.actionSubmitButton = document.getElementById('fileActionSubmit');
    this.createMenu = new CreateMenuPresenter({
      mobileBreakpointQuery,
    });
    this.fileExplorerOptionsMenu = new CreateMenuPresenter({
      mobileBreakpointQuery,
    });
    this.pendingAction = null;
    this.actionBusy = false;
  }

  initialize() {
    this.createButton?.addEventListener('click', () => {
      this.openRootCreateMenu({ anchor: this.createButton });
    });
    this.fileExplorerOptionsButton?.addEventListener('click', () => {
      this.openFileExplorerOptionsMenu({ anchor: this.fileExplorerOptionsButton });
    });
    this.actionCancelButton?.addEventListener('click', () => this.closeActionDialog());
    this.actionForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.handleActionSubmit();
    });
    this.actionInput?.addEventListener('input', () => this.setActionError(''));
    this.actionDialog?.addEventListener('cancel', (event) => {
      if (this.actionBusy) event.preventDefault();
    });
    this.actionDialog?.addEventListener('close', () => {
      if (!this.actionDialog.open) this.resetActionDialog();
    });
  }

  getCreateActions({ parentDir = '' } = {}) {
    return [
      {
        contextLabel: 'Upload files',
        group: 'File',
        hint: 'Supported vault files',
        icon: this.getCreateActionIcon('upload'),
        id: 'upload',
        label: 'Upload files',
        meta: 'Multiple',
        onSelect: () => {
          void this.handleUploadFiles({ parentDir });
        },
      },
      {
        contextLabel: 'New markdown file',
        group: 'Note',
        hint: 'Markdown',
        icon: this.getCreateActionIcon('markdown'),
        id: 'markdown',
        label: 'Markdown note',
        meta: '.md',
        onSelect: () => this.handleNewFile({ parentDir }),
      },
      {
        contextLabel: 'New base file',
        group: 'Note',
        hint: 'Base',
        icon: this.getCreateActionIcon('base'),
        id: 'base',
        label: 'Base file',
        meta: '.base',
        onSelect: () => this.handleNewBase({ parentDir }),
      },
      {
        contextLabel: 'New canvas',
        group: 'Diagram',
        hint: 'JSON Canvas',
        icon: this.getCreateActionIcon('canvas'),
        id: 'canvas',
        label: 'Canvas',
        meta: '.canvas',
        onSelect: () => this.handleNewCanvas({ parentDir }),
      },
      {
        contextLabel: 'New Excalidraw drawing',
        group: 'Diagram',
        hint: 'Excalidraw',
        icon: this.getCreateActionIcon('excalidraw'),
        id: 'excalidraw',
        label: 'Excalidraw drawing',
        meta: '.excalidraw',
        onSelect: () => this.handleNewDrawing({ parentDir }),
      },
      {
        contextLabel: 'New draw.io diagram',
        group: 'Diagram',
        hint: 'draw.io',
        icon: this.getCreateActionIcon('drawio'),
        id: 'drawio',
        label: 'draw.io diagram',
        meta: '.drawio',
        onSelect: () => this.handleNewDrawio({ parentDir }),
      },
      {
        contextLabel: 'New Mermaid diagram',
        group: 'Diagram',
        hint: 'Mermaid',
        icon: this.getCreateActionIcon('mermaid'),
        id: 'mermaid',
        label: 'Mermaid diagram',
        meta: '.mmd',
        onSelect: () => this.handleNewMermaid({ parentDir }),
      },
      {
        contextLabel: 'New PlantUML diagram',
        group: 'Diagram',
        hint: 'PlantUML',
        icon: this.getCreateActionIcon('plantuml'),
        id: 'plantuml',
        label: 'PlantUML diagram',
        meta: '.puml',
        onSelect: () => this.handleNewPlantUml({ parentDir }),
      },
      {
        contextLabel: 'New Structurizr workspace',
        group: 'Diagram',
        hint: 'Structurizr DSL',
        icon: this.getCreateActionIcon('structurizr'),
        id: 'structurizr',
        label: 'Structurizr workspace',
        meta: '.dsl',
        onSelect: () => this.handleNewStructurizr({ parentDir }),
      },
      {
        contextLabel: 'New folder',
        group: 'Structure',
        hint: 'Folder',
        icon: this.getCreateActionIcon('folder'),
        id: 'folder',
        label: 'Folder',
        meta: 'folder',
        onSelect: () => this.handleNewFolder({ parentDir }),
      },
    ];
  }

  createContextMenuItems(parentDir = '') {
    return this.getCreateActions({ parentDir }).map((item) => ({
      label: item.contextLabel,
      onSelect: item.onSelect,
    }));
  }

  getDirectoryContextMenuItems(directoryPath) {
    return [
      {
        label: 'New…',
        onSelect: ({ anchor } = {}) => this.openCreateMenu({ anchor, parentDir: directoryPath }),
      },
      {
        label: 'Rename / move',
        onSelect: () => this.handleRenameDirectory(directoryPath),
      },
      {
        label: 'Download source ZIP',
        onSelect: () => this.handleDownloadDirectory(directoryPath),
      },
      {
        label: 'Export HTML',
        onSelect: () => this.onDirectoryExport?.(directoryPath, 'html'),
      },
      {
        label: 'Print / save PDF',
        onSelect: () => this.onDirectoryExport?.(directoryPath, 'pdf'),
      },
      {
        label: 'Delete',
        danger: true,
        onSelect: () => this.handleDeleteDirectory(directoryPath),
      },
    ];
  }

  getFileContextMenuItems(filePath) {
    return [
      {
        label: 'Copy as URL',
        onSelect: () => this.copyFileUrl(filePath),
      },
      {
        label: 'Rename / move',
        onSelect: () => this.handleRenameFile(filePath),
      },
      {
        label: 'Download',
        onSelect: () => this.handleDownloadFile(filePath),
      },
      {
        label: 'Delete',
        danger: true,
        onSelect: () => this.handleDelete(filePath),
      },
    ];
  }

  async copyFileUrl(filePath) {
    const url = new URL(window.location.href);
    url.search = '';
    const vaultId = getActiveVaultId();
    if (vaultId) url.searchParams.set('vault', vaultId);
    url.hash = createFileRouteHash(filePath);
    try {
      await copyTextToClipboard(url.toString());
      this.showToast('Link copied');
    } catch {
      this.showToast('Failed to copy link');
    }
  }

  showToast(message) {
    if (message) {
      this.toastController?.show(String(message));
    }
  }

  getCreateActionIcon(kind) {
    switch (kind) {
      case 'upload':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></svg>';
      case 'base':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M14 4v5h5"/><path d="M8 13h8"/><path d="M8 17h6"/><path d="M8 9h3"/></svg>';
      case 'canvas':
      case 'drawio':
      case 'plantuml':
      case 'structurizr':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>';
      case 'excalidraw':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>';
      case 'folder':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      case 'mermaid':
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5c0-1.38 1.12-2.5 2.5-2.5 1.04 0 1.93.64 2.3 1.56A2.5 2.5 0 0 1 14 8.5v1"/><path d="M19 16.5c0 1.38-1.12 2.5-2.5 2.5-1.04 0-1.93-.64-2.3-1.56A2.5 2.5 0 0 1 10 15.5v-1"/><path d="M8 10.5h8"/><path d="M8 13.5h8"/><path d="M10 8.5v7"/><path d="M14 8.5v7"/></svg>';
      case 'markdown':
      default:
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }
  }

  setActionError(message) {
    if (!this.actionError) return;
    this.actionError.textContent = message;
    this.actionError.hidden = !message;
    if (message && this.pendingAction?.requiresInput) {
      this.actionInput.setAttribute('aria-invalid', 'true');
    } else {
      this.actionInput?.removeAttribute('aria-invalid');
    }
  }

  showActionError(message) {
    if (this.actionDialog?.open) {
      this.setActionError(message);
    } else {
      this.showToast(message);
    }
  }

  createPendingWorkspaceRequestId() {
    if (!this.pendingWorkspaceRequestIds) {
      return null;
    }

    const requestId = createRandomUuid();
    this.pendingWorkspaceRequestIds.add(requestId);
    return requestId;
  }

  clearPendingWorkspaceRequestId(requestId) {
    if (!requestId) {
      return;
    }

    this.pendingWorkspaceRequestIds?.delete(requestId);
  }

  async runWorkspaceMutation(callback) {
    const requestId = this.createPendingWorkspaceRequestId();

    try {
      return await callback(requestId);
    } catch (error) {
      this.clearPendingWorkspaceRequestId(requestId);
      throw error;
    }
  }

  openActionDialog({
    title,
    copy,
    label = 'Path',
    hint = '',
    note = '',
    placeholder = '',
    value = '',
    submitLabel = 'Save',
    destructive = false,
    requiresInput = true,
    emptyMessage = 'A value is required',
    onSubmit,
  }) {
    if (!this.actionDialog || !this.actionTitle || !this.actionCopy || !this.actionSubmitButton || !this.actionCancelButton) {
      return;
    }

    if (requiresInput && !this.actionInput) {
      return;
    }

    if (this.actionDialog.open) {
      if (typeof this.actionDialog.close === 'function') {
        this.actionDialog.close();
      } else {
        this.actionDialog.removeAttribute('open');
        this.resetActionDialog();
      }
    }

    this.pendingAction = { requiresInput, emptyMessage, onSubmit };
    this.setActionError('');
    this.createMenu.close({ restoreFocus: false });
    this.fileExplorerOptionsMenu.close({ restoreFocus: false });
    this.view?.removeContextMenu?.();

    this.actionTitle.textContent = title;
    this.actionCopy.textContent = copy;

    if (this.actionField) {
      this.actionField.hidden = !requiresInput;
    }
    if (this.actionLabel) {
      this.actionLabel.textContent = label;
    }
    if (this.actionInput) {
      this.actionInput.value = value;
      this.actionInput.placeholder = placeholder;
      this.actionInput.required = requiresInput;
      this.actionInput.disabled = false;
    }
    if (this.actionHint) {
      this.actionHint.textContent = hint;
      this.actionHint.hidden = !requiresInput || !hint;
    }
    if (this.actionNote) {
      this.actionNote.textContent = note;
      this.actionNote.hidden = !note;
      this.actionNote.classList.toggle('is-danger', destructive);
    }

    this.actionSubmitButton.textContent = submitLabel;
    this.actionSubmitButton.disabled = false;
    this.actionSubmitButton.classList.toggle('ui-button--primary', !destructive);
    this.actionSubmitButton.classList.toggle('ui-button--danger', destructive);
    this.actionCancelButton.disabled = false;

    if (typeof this.actionDialog.showModal === 'function') {
      this.actionDialog.showModal();
    } else {
      this.actionDialog.setAttribute('open', 'true');
    }

    requestAnimationFrame(() => {
      if (!requiresInput || !this.actionInput) {
        this.actionSubmitButton.focus();
        return;
      }

      this.actionInput.focus();
      if (value) {
        this.actionInput.select();
      }
    });
  }

  resetActionDialog() {
    this.pendingAction = null;
    this.actionBusy = false;

    if (this.actionField) {
      this.actionField.hidden = false;
    }
    if (this.actionLabel) {
      this.actionLabel.textContent = 'Path';
    }
    if (this.actionInput) {
      this.actionInput.value = '';
      this.actionInput.placeholder = '';
      this.actionInput.required = true;
      this.actionInput.disabled = false;
    }
    if (this.actionHint) {
      this.actionHint.textContent = '';
      this.actionHint.hidden = true;
    }
    if (this.actionNote) {
      this.actionNote.textContent = '';
      this.actionNote.hidden = true;
      this.actionNote.classList.remove('is-danger');
    }
    if (this.actionSubmitButton) {
      this.actionSubmitButton.textContent = 'Save';
      this.actionSubmitButton.disabled = false;
      this.actionSubmitButton.className = 'ui-button ui-button--primary';
    }
    if (this.actionCancelButton) {
      this.actionCancelButton.disabled = false;
    }
  }

  closeActionDialog() {
    if (!this.actionDialog) {
      return;
    }

    if (this.actionDialog.open && typeof this.actionDialog.close === 'function') {
      this.actionDialog.close();
      return;
    }

    this.actionDialog.removeAttribute('open');
    this.resetActionDialog();
  }

  setActionDialogBusy(isBusy) {
    this.actionBusy = isBusy;

    if (this.actionInput) {
      this.actionInput.disabled = isBusy || !(this.pendingAction?.requiresInput ?? true);
    }
    if (this.actionCancelButton) {
      this.actionCancelButton.disabled = isBusy;
    }
    if (this.actionSubmitButton) {
      this.actionSubmitButton.disabled = isBusy;
    }
  }

  async handleActionSubmit() {
    if (!this.pendingAction?.onSubmit || this.actionBusy) {
      return;
    }

    const requiresInput = this.pendingAction.requiresInput;
    const rawValue = requiresInput ? this.actionInput?.value.trim() ?? '' : undefined;

    if (requiresInput && !rawValue) {
      this.setActionError(this.pendingAction.emptyMessage);
      this.actionInput?.focus();
      return;
    }

    this.setActionError('');
    this.setActionDialogBusy(true);

    let shouldClose;
    try {
      shouldClose = await this.pendingAction.onSubmit(rawValue);
    } catch (error) {
      this.showActionError(error?.message || 'Failed to complete action');
      shouldClose = false;
    }

    this.setActionDialogBusy(false);

    if (shouldClose !== false) {
      this.closeActionDialog();
      return;
    }

    if (requiresInput && this.actionInput) {
      this.actionInput.focus();
      this.actionInput.select();
    }
  }

  async uploadVaultFiles(files = [], { parentDir = '' } = {}) {
    const normalizedParentDir = normalizeVaultPathInput(parentDir);
    let uploaded = false;

    for (const file of Array.from(files ?? [])) {
      const fileName = getVaultPathLeaf(file?.name);
      const filePath = composeVaultChildPath(normalizedParentDir, fileName);
      if (!fileName || !isVaultFilePath(filePath)) {
        this.showToast(`Unsupported file type: ${fileName || 'unnamed file'}`);
        continue;
      }

      try {
        await this.runWorkspaceMutation((requestId) => this.vaultClient.uploadFile({
          file,
          path: filePath,
          requestId,
        }));
        uploaded = true;
        this.state.expandDirectoryPath(filePath, { includeLeaf: false });
      } catch (error) {
        this.showToast(`${fileName}: ${error?.message || 'Failed to upload file'}`);
      }
    }

    if (uploaded) {
      await this.refresh();
    }

    return uploaded;
  }

  async handleUploadFiles({ parentDir = '' } = {}) {
    const files = await pickFiles({ accept: VAULT_FILE_PICKER_ACCEPT, multiple: true });
    if (files.length === 0) {
      return false;
    }

    return this.uploadVaultFiles(files, { parentDir });
  }

  async createVaultFile(filePath, content, { openAfterCreate = false, errorMessage = 'Failed to create file' } = {}) {
    try {
      await this.runWorkspaceMutation((requestId) => this.vaultClient.createFile(withRequestId({
        content,
        path: filePath,
      }, requestId)));
      this.state.expandDirectoryPath(filePath, { includeLeaf: false });
      await this.refresh();

      if (openAfterCreate) {
        this.onFileSelect?.(filePath, { focusNewNote: isMarkdownFilePath(filePath) });
      }

      return true;
    } catch (error) {
      this.showActionError(error?.message || errorMessage);
      return false;
    }
  }

  async createDirectory(pathValue) {
    const directoryPath = normalizeVaultPathInput(pathValue);
    if (!directoryPath) {
      this.showActionError('Folder path is required');
      return false;
    }

    try {
      await this.runWorkspaceMutation((requestId) => this.vaultClient.createDirectory(
        directoryPath,
        withRequestId({}, requestId),
      ));
      this.state.expandDirectoryPath(directoryPath);
      await this.refresh();
      return true;
    } catch (error) {
      this.showActionError(error?.message || 'Failed to create folder');
      return false;
    }
  }

  async renameVaultFile(filePath, nextName, extension) {
    const normalizedPath = normalizeVaultPathInput(nextName);
    if (!normalizedPath) {
      this.showActionError('File path is required');
      return false;
    }

    const requestedExtension = getVaultFileExtension(normalizedPath);
    if (requestedExtension && requestedExtension.toLowerCase() !== String(extension ?? '').toLowerCase()) {
      this.showActionError(`File type changes are not supported during rename. Keep the ${extension} extension.`);
      return false;
    }

    const finalPath = requestedExtension
      ? normalizedPath
      : `${normalizedPath}${extension}`;
    if (!getVaultPathLeaf(finalPath)) {
      this.showActionError('File path is required');
      return false;
    }

    if (finalPath === filePath) {
      return true;
    }

    try {
      await this.runWorkspaceMutation((requestId) => this.vaultClient.renameFile(withRequestId({
        newPath: finalPath,
        oldPath: filePath,
      }, requestId)));
      this.state.expandDirectoryPath(finalPath, { includeLeaf: false });
      await this.refresh();

      if (this.state.activeFilePath === filePath) {
        this.state.activeFilePath = finalPath;
        this.onFileSelect?.(finalPath);
      }

      return true;
    } catch (error) {
      this.showActionError(error?.message || 'Failed to rename');
      return false;
    }
  }

  async renameDirectory(oldPath, nextPath) {
    const normalizedPath = normalizeVaultPathInput(nextPath);
    if (!normalizedPath) {
      this.showActionError('Folder path is required');
      return false;
    }

    if (normalizedPath === oldPath) {
      return true;
    }

    try {
      await this.runWorkspaceMutation((requestId) => this.vaultClient.renameDirectory(withRequestId({
        newPath: normalizedPath,
        oldPath,
      }, requestId)));
      this.state.replaceExpandedDirectoryPrefix(oldPath, normalizedPath);
      this.state.expandDirectoryPath(normalizedPath);
      await this.refresh();

      if (this.state.activeFilePath && this.state.activeFilePath.startsWith(`${oldPath}/`)) {
        const nextActivePath = replacePathPrefix(this.state.activeFilePath, oldPath, normalizedPath);
        this.state.activeFilePath = nextActivePath;
        this.onFileSelect?.(nextActivePath);
      }

      return true;
    } catch (error) {
      this.showActionError(error?.message || 'Failed to rename folder');
      return false;
    }
  }

  async deleteVaultFile(filePath) {
    try {
      await this.runWorkspaceMutation((requestId) => this.vaultClient.deleteFile(filePath, withRequestId({}, requestId)));
      await this.refresh();

      if (this.state.activeFilePath === filePath) {
        this.state.activeFilePath = null;
        this.onFileDelete?.(filePath);
      }

      return true;
    } catch (error) {
      this.showActionError(error?.message || 'Failed to delete');
      return false;
    }
  }

  async deleteDirectory(pathValue, { recursive = false } = {}) {
    try {
      await this.runWorkspaceMutation((requestId) => this.vaultClient.deleteDirectory(
        pathValue,
        withRequestId({ recursive }, requestId),
      ));
      const activeFilePath = this.state.activeFilePath;
      await this.refresh();
      this.state.removeExpandedDirectoryPrefix(pathValue);

      if (activeFilePath && activeFilePath.startsWith(`${pathValue}/`)) {
        this.state.activeFilePath = null;
        this.onFileDelete?.(activeFilePath);
      }

      return true;
    } catch (error) {
      this.showActionError(error?.message || 'Failed to delete folder');
      return false;
    }
  }

  planMoveEntryByDrop({ destinationDirectory = '', sourcePath = '', sourceType = 'file' } = {}) {
    const normalizedSourcePath = normalizeVaultPathInput(sourcePath);
    const normalizedDestinationDirectory = normalizeVaultPathInput(destinationDirectory);
    const currentParentPath = getVaultPathParent(normalizedSourcePath);
    const entryName = getVaultPathLeaf(normalizedSourcePath);

    if (!normalizedSourcePath || !entryName) {
      return { ok: false, reason: 'Invalid item to move' };
    }

    if (currentParentPath === normalizedDestinationDirectory) {
      return { ok: false, reason: 'Item is already in that folder' };
    }

    if (sourceType === 'directory') {
      if (normalizedDestinationDirectory === normalizedSourcePath) {
        return { ok: false, reason: 'A folder cannot be moved into itself' };
      }

      if (normalizedDestinationDirectory.startsWith(`${normalizedSourcePath}/`)) {
        return { ok: false, reason: 'A folder cannot be moved into one of its descendants' };
      }

      return {
        nextPath: composeVaultChildPath(normalizedDestinationDirectory, entryName),
        ok: true,
      };
    }

    const extension = getVaultFileExtension(normalizedSourcePath) || '.md';
    return {
      extension,
      nextPath: composeVaultChildPath(normalizedDestinationDirectory, entryName),
      ok: true,
    };
  }

  canMoveEntryByDrop(payload = {}) {
    return this.planMoveEntryByDrop(payload).ok;
  }

  async moveEntryByDrop(payload = {}) {
    const plan = this.planMoveEntryByDrop(payload);
    if (!plan.ok) {
      this.showToast(plan.reason);
      return false;
    }

    if (payload.sourceType === 'directory') {
      return this.renameDirectory(payload.sourcePath, plan.nextPath);
    }

    return this.renameVaultFile(payload.sourcePath, plan.nextPath, plan.extension);
  }

  async downloadFileEntry(filePath) {
    try {
      await this.vaultClient.downloadFile(filePath);
      return true;
    } catch (error) {
      this.showToast(error?.message || 'Failed to download file');
      return false;
    }
  }

  async downloadDirectoryEntry(directoryPath) {
    try {
      await this.vaultClient.downloadDirectory(directoryPath);
      return true;
    } catch (error) {
      this.showToast(error?.message || 'Failed to download folder');
      return false;
    }
  }

  getCreateContext(parentDir = '') {
    const normalizedParentDir = normalizeVaultPathInput(parentDir);

    return {
      hintPrefix: normalizedParentDir
        ? 'Use "/" to create nested items under this folder.'
        : 'Use "/" to place it inside a folder.',
      inputLabelSuffix: normalizedParentDir ? 'name or path' : 'path',
      note: normalizedParentDir ? `Parent folder: ${normalizedParentDir}` : '',
      normalizedParentDir,
    };
  }

  openRootCreateMenu({ anchor = this.createButton } = {}) {
    this.openCreateMenu({ anchor, parentDir: '' });
  }

  openCreateMenu({ anchor = this.createButton, parentDir = '' } = {}) {
    this.view?.removeContextMenu?.();
    this.fileExplorerOptionsMenu.close({ restoreFocus: false });
    this.createMenu.toggle({
      anchor,
      items: this.getCreateActions({ parentDir }),
      title: 'Create',
    });
  }

  openFileExplorerOptionsMenu({ anchor = this.fileExplorerOptionsButton } = {}) {
    this.view?.removeContextMenu?.();
    this.createMenu.close({ restoreFocus: false });
    this.fileExplorerOptionsMenu.toggle({
      anchor,
      items: [{
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>',
        id: 'show-file-extensions',
        label: 'Show file extensions',
        meta: this.showFileExtensions ? 'On' : 'Off',
        onSelect: () => {
          this.showFileExtensions = !this.showFileExtensions;
          this.onShowFileExtensionsChange?.(this.showFileExtensions);
        },
      }],
      title: 'File explorer options',
    });
  }

  openCreateFileDialog({
    buildFile,
    copy,
    emptyMessage,
    errorMessage,
    hintSuffix,
    labelPrefix,
    nestedCopy = copy,
    nestedPlaceholder,
    parentDir = '',
    placeholder,
    submitLabel,
    title,
  }) {
    const context = this.getCreateContext(parentDir);
    this.openActionDialog({
      title,
      copy: context.normalizedParentDir ? nestedCopy : copy,
      label: `${labelPrefix} ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ${hintSuffix}`,
      note: context.note,
      placeholder: context.normalizedParentDir ? nestedPlaceholder : placeholder,
      submitLabel,
      emptyMessage,
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showActionError(emptyMessage);
          return false;
        }
        const { content, path } = buildFile(composeVaultChildPath(context.normalizedParentDir, normalizedPath));
        return this.createVaultFile(path, content, { errorMessage, openAfterCreate: true });
      },
    });
  }

  handleNewFile({ parentDir = '' } = {}) {
    this.openCreateFileDialog({
      buildFile: (target) => {
        const path = ensureVaultExtension(target, '.md');
        return { content: createMarkdownStarter(path), path };
      },
      copy: 'Add a new note to the vault. It opens immediately after creation.',
      emptyMessage: 'File path is required',
      errorMessage: 'Failed to create file',
      hintSuffix: '".md" is added automatically.',
      labelPrefix: 'File',
      nestedCopy: 'Add a new note inside the selected folder. It opens immediately after creation.',
      nestedPlaceholder: 'my-note',
      parentDir,
      placeholder: 'notes/my-note',
      submitLabel: 'Create file',
      title: 'Create markdown file',
    });
  }

  handleNewBase({ parentDir = '' } = {}) {
    this.openCreateFileDialog({
      buildFile: createBaseStarter,
      copy: 'Add a new `.base` file to the vault. It opens immediately after creation.',
      emptyMessage: 'Base path is required',
      errorMessage: 'Failed to create base file',
      hintSuffix: '".base" is added automatically.',
      labelPrefix: 'Base',
      nestedCopy: 'Add a new `.base` file inside the selected folder. It opens immediately after creation.',
      nestedPlaceholder: 'table-view',
      parentDir,
      placeholder: 'views/table-view',
      submitLabel: 'Create base',
      title: 'Create base file',
    });
  }

  handleNewFolder({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create folder',
      copy: context.normalizedParentDir
        ? 'Add a new folder inside the selected folder.'
        : 'Add a new folder to organize notes and diagrams.',
      label: `Folder ${context.inputLabelSuffix}`,
      hint: context.hintPrefix,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'archive' : 'notes/archive',
      submitLabel: 'Create folder',
      emptyMessage: 'Folder path is required',
      onSubmit: (value) => this.createDirectory(composeVaultChildPath(context.normalizedParentDir, value)),
    });
  }

  handleNewCanvas({ parentDir = '' } = {}) {
    this.openCreateFileDialog({
      buildFile: (target) => ({ content: '{"nodes":[],"edges":[]}\n', path: ensureVaultExtension(target, '.canvas') }),
      copy: 'Create a canvas for connected notes, files, links, and groups.',
      emptyMessage: 'Canvas path is required',
      errorMessage: 'Failed to create canvas',
      hintSuffix: '".canvas" is added automatically.',
      labelPrefix: 'Canvas',
      nestedPlaceholder: 'ideas',
      parentDir,
      placeholder: 'diagrams/ideas',
      submitLabel: 'Create canvas',
      title: 'Create canvas',
    });
  }

  handleNewDrawing({ parentDir = '' } = {}) {
    this.openCreateFileDialog({
      buildFile: (target) => ({ content: createEmptyExcalidrawScene(), path: ensureVaultExtension(target, '.excalidraw') }),
      copy: 'Start a new drawing file in the vault.',
      emptyMessage: 'Drawing path is required',
      errorMessage: 'Failed to create drawing',
      hintSuffix: '".excalidraw" is added automatically.',
      labelPrefix: 'Drawing',
      nestedCopy: 'Start a new drawing inside the selected folder.',
      nestedPlaceholder: 'architecture',
      parentDir,
      placeholder: 'diagrams/architecture',
      submitLabel: 'Create drawing',
      title: 'Create Excalidraw drawing',
    });
  }

  handleNewMermaid({ parentDir = '' } = {}) {
    this.openCreateFileDialog({
      buildFile: createMermaidStarter,
      copy: 'Create a new `.mmd` or `.mermaid` file with starter diagram content.',
      emptyMessage: 'Diagram path is required',
      errorMessage: 'Failed to create Mermaid diagram',
      hintSuffix: '".mmd" is added automatically unless you enter ".mermaid".',
      labelPrefix: 'Diagram',
      nestedCopy: 'Create a new `.mmd` or `.mermaid` file inside the selected folder.',
      nestedPlaceholder: 'flow',
      parentDir,
      placeholder: 'diagrams/flow',
      submitLabel: 'Create diagram',
      title: 'Create Mermaid diagram',
    });
  }

  handleNewDrawio({ parentDir = '' } = {}) {
    this.openCreateFileDialog({
      buildFile: createDrawioStarter,
      copy: 'Create a new `.drawio` diagram with a native starter document.',
      emptyMessage: 'Diagram path is required',
      errorMessage: 'Failed to create draw.io diagram',
      hintSuffix: '".drawio" is added automatically.',
      labelPrefix: 'Diagram',
      nestedCopy: 'Create a new `.drawio` diagram inside the selected folder.',
      nestedPlaceholder: 'architecture',
      parentDir,
      placeholder: 'diagrams/architecture',
      submitLabel: 'Create diagram',
      title: 'Create draw.io diagram',
    });
  }

  handleNewPlantUml({ parentDir = '' } = {}) {
    this.openCreateFileDialog({
      buildFile: createPlantUmlStarter,
      copy: 'Create a new `.puml` or `.plantuml` file with starter diagram content.',
      emptyMessage: 'Diagram path is required',
      errorMessage: 'Failed to create PlantUML diagram',
      hintSuffix: '".puml" is added automatically unless you enter ".plantuml".',
      labelPrefix: 'Diagram',
      nestedCopy: 'Create a new `.puml` or `.plantuml` file inside the selected folder.',
      nestedPlaceholder: 'sequence-flow',
      parentDir,
      placeholder: 'diagrams/sequence-flow',
      submitLabel: 'Create diagram',
      title: 'Create PlantUML diagram',
    });
  }

  handleNewStructurizr({ parentDir = '' } = {}) {
    this.openCreateFileDialog({
      buildFile: createStructurizrStarter,
      copy: 'Create a collaborative C4 workspace in the vault.',
      emptyMessage: 'Workspace path is required',
      errorMessage: 'Failed to create Structurizr workspace',
      hintSuffix: '".dsl" is added automatically. workspace.dsl is conventional; any workspace .dsl file can render.',
      labelPrefix: 'Workspace',
      nestedCopy: 'Create a collaborative C4 workspace inside the selected folder.',
      nestedPlaceholder: 'workspace',
      parentDir,
      placeholder: 'workspace',
      submitLabel: 'Create workspace',
      title: 'Create Structurizr workspace',
    });
  }

  handleRenameFile(filePath) {
    const extension = getVaultFileExtension(filePath) || '.md';

    this.openActionDialog({
      title: 'Rename or move file',
      copy: 'Update the relative path without changing the file type.',
      label: 'Path',
      hint: `Use "/" to move the file into another folder. ${extension} is kept automatically.`,
      value: filePath,
      submitLabel: 'Save file path',
      emptyMessage: 'File path is required',
      onSubmit: (value) => this.renameVaultFile(filePath, value, extension),
    });
  }

  handleRenameDirectory(directoryPath) {
    this.openActionDialog({
      title: 'Rename or move folder',
      copy: 'Update the relative path for this folder and everything inside it.',
      label: 'Path',
      hint: 'Use "/" to move the folder into another location in the vault.',
      value: directoryPath,
      submitLabel: 'Save folder path',
      emptyMessage: 'Folder path is required',
      onSubmit: (value) => this.renameDirectory(directoryPath, value),
    });
  }

  handleDelete(filePath) {
    this.openActionDialog({
      title: 'Delete file',
      copy: 'This permanently removes the file from the vault.',
      note: filePath,
      submitLabel: 'Delete file',
      destructive: true,
      requiresInput: false,
      onSubmit: () => this.deleteVaultFile(filePath),
    });
  }

  handleDeleteDirectory(directoryPath) {
    const { directoryCount, fileCount } = this.state.getDirectoryDescendantSummary(directoryPath);
    const hasDescendants = directoryCount > 0 || fileCount > 0;
    const summary = hasDescendants
      ? `This will permanently remove ${formatCount(fileCount, 'file', 'files')} and ${formatCount(directoryCount, 'nested folder', 'nested folders')} inside this folder.`
      : 'This permanently removes the empty folder from the vault.';

    this.openActionDialog({
      title: hasDescendants ? 'Delete folder and contents' : 'Delete folder',
      copy: summary,
      note: directoryPath,
      submitLabel: hasDescendants ? 'Delete folder and contents' : 'Delete folder',
      destructive: true,
      requiresInput: false,
      onSubmit: () => this.deleteDirectory(directoryPath, { recursive: hasDescendants }),
    });
  }

  handleDownloadFile(filePath) {
    void this.downloadFileEntry(filePath);
  }

  handleDownloadDirectory(directoryPath) {
    void this.downloadDirectoryEntry(directoryPath);
  }
}
