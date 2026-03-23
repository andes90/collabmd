import {
  getVaultFileExtension,
} from '../../domain/file-kind.js';
import {
  composeVaultChildPath,
  createDrawioStarter,
  createMarkdownStarter,
  createMermaidStarter,
  createPlantUmlStarter,
  ensureVaultExtension,
  normalizeVaultPathInput,
} from '../domain/vault-paths.js';
import { createWorkspaceRequestId } from '../domain/workspace-request-id.js';

function getPathLeaf(path) {
  return String(path ?? '')
    .replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

function replacePathPrefix(pathValue, oldPrefix, newPrefix) {
  if (pathValue === oldPrefix) {
    return newPrefix;
  }

  return `${newPrefix}${pathValue.slice(oldPrefix.length)}`;
}

function formatCount(value, singularLabel, pluralLabel) {
  return `${value} ${value === 1 ? singularLabel : pluralLabel}`;
}

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
    onFileDelete,
    onFileSelect,
    pendingWorkspaceRequestIds = null,
    state,
    toastController,
    vaultClient,
    view,
    refresh,
  }) {
    this.onFileDelete = onFileDelete;
    this.onFileSelect = onFileSelect;
    this.pendingWorkspaceRequestIds = pendingWorkspaceRequestIds;
    this.state = state;
    this.toastController = toastController;
    this.vaultClient = vaultClient;
    this.view = view;
    this.refresh = refresh;
    this.newFileButton = document.getElementById('newFileBtn');
    this.newDrawingButton = document.getElementById('newDrawingBtn');
    this.newDrawioButton = document.getElementById('newDrawioBtn');
    this.newMermaidButton = document.getElementById('newMermaidBtn');
    this.newPlantumlButton = document.getElementById('newPlantumlBtn');
    this.newFolderButton = document.getElementById('newFolderBtn');
    this.refreshButton = document.getElementById('refreshFilesBtn');
    this.actionDialog = document.getElementById('fileActionDialog');
    this.actionForm = document.getElementById('fileActionForm');
    this.actionTitle = document.getElementById('fileActionTitle');
    this.actionCopy = document.getElementById('fileActionCopy');
    this.actionField = document.getElementById('fileActionField');
    this.actionLabel = document.getElementById('fileActionLabel');
    this.actionInput = document.getElementById('fileActionInput');
    this.actionHint = document.getElementById('fileActionHint');
    this.actionNote = document.getElementById('fileActionNote');
    this.actionCancelButton = document.getElementById('fileActionCancel');
    this.actionSubmitButton = document.getElementById('fileActionSubmit');
    this.pendingAction = null;
    this.actionBusy = false;
  }

  initialize() {
    this.newFileButton?.addEventListener('click', () => this.handleNewFile());
    this.newDrawingButton?.addEventListener('click', () => this.handleNewDrawing());
    this.newDrawioButton?.addEventListener('click', () => this.handleNewDrawio());
    this.newMermaidButton?.addEventListener('click', () => this.handleNewMermaid());
    this.newPlantumlButton?.addEventListener('click', () => this.handleNewPlantUml());
    this.newFolderButton?.addEventListener('click', () => this.handleNewFolder());
    this.refreshButton?.addEventListener('click', () => this.refresh());
    this.actionCancelButton?.addEventListener('click', () => this.closeActionDialog());
    this.actionForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.handleActionSubmit();
    });
    this.actionDialog?.addEventListener('close', () => this.resetActionDialog());
  }

  createContextMenuItems(parentDir = '') {
    return [
      {
        label: 'New markdown file',
        onSelect: () => this.handleNewFile({ parentDir }),
      },
      {
        label: 'New Excalidraw drawing',
        onSelect: () => this.handleNewDrawing({ parentDir }),
      },
      {
        label: 'New draw.io diagram',
        onSelect: () => this.handleNewDrawio({ parentDir }),
      },
      {
        label: 'New Mermaid diagram',
        onSelect: () => this.handleNewMermaid({ parentDir }),
      },
      {
        label: 'New PlantUML diagram',
        onSelect: () => this.handleNewPlantUml({ parentDir }),
      },
      {
        label: 'New folder',
        onSelect: () => this.handleNewFolder({ parentDir }),
      },
    ];
  }

  getDirectoryContextMenuItems(directoryPath) {
    return [
      ...this.createContextMenuItems(directoryPath),
      {
        label: 'Rename / move',
        onSelect: () => this.handleRenameDirectory(directoryPath),
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
        label: 'Rename / move',
        onSelect: () => this.handleRenameFile(filePath),
      },
      {
        label: 'Delete',
        danger: true,
        onSelect: () => this.handleDelete(filePath),
      },
    ];
  }

  showToast(message) {
    if (message) {
      this.toastController?.show(String(message));
    }
  }

  showError(message, error) {
    this.showToast(error?.message ? `${message}: ${error.message}` : message);
  }

  ensureExtension(pathValue, extension) {
    return ensureVaultExtension(pathValue, extension);
  }

  createPendingWorkspaceRequestId() {
    if (!this.pendingWorkspaceRequestIds) {
      return null;
    }

    const requestId = createWorkspaceRequestId();
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
    this.actionSubmitButton.classList.toggle('btn-primary', !destructive);
    this.actionSubmitButton.classList.toggle('btn-danger', destructive);
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
      this.actionSubmitButton.classList.add('btn-primary');
      this.actionSubmitButton.classList.remove('btn-danger');
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
      this.showToast(this.pendingAction.emptyMessage);
      this.actionInput?.focus();
      return;
    }

    this.setActionDialogBusy(true);

    let shouldClose = false;
    try {
      shouldClose = await this.pendingAction.onSubmit(rawValue);
    } catch (error) {
      shouldClose = false;
      this.showError('Failed to complete action', error);
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

  async createVaultFile(filePath, content, { openAfterCreate = false, errorMessage = 'Failed to create file' } = {}) {
    try {
      await this.runWorkspaceMutation((requestId) => this.vaultClient.createFile(withRequestId({
        content,
        path: filePath,
      }, requestId)));
      this.state.expandDirectoryPath(filePath, { includeLeaf: false });
      await this.refresh();

      if (openAfterCreate) {
        this.onFileSelect?.(filePath);
      }

      return true;
    } catch (error) {
      this.showToast(error?.message || errorMessage);
      return false;
    }
  }

  async createDirectory(pathValue) {
    const directoryPath = normalizeVaultPathInput(pathValue);
    if (!directoryPath) {
      this.showToast('Folder path is required');
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
      this.showToast(error?.message || 'Failed to create folder');
      return false;
    }
  }

  async renameVaultFile(filePath, nextName, extension) {
    const normalizedPath = normalizeVaultPathInput(nextName);
    if (!normalizedPath) {
      this.showToast('File path is required');
      return false;
    }

    const requestedExtension = getVaultFileExtension(normalizedPath);
    if (requestedExtension && requestedExtension.toLowerCase() !== String(extension ?? '').toLowerCase()) {
      this.showToast(`File type changes are not supported during rename. Keep the ${extension} extension.`);
      return false;
    }

    const finalPath = requestedExtension
      ? normalizedPath
      : `${normalizedPath}${extension}`;
    if (!getPathLeaf(finalPath)) {
      this.showToast('File path is required');
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
      this.showToast(error?.message || 'Failed to rename');
      return false;
    }
  }

  async renameDirectory(oldPath, nextPath) {
    const normalizedPath = normalizeVaultPathInput(nextPath);
    if (!normalizedPath) {
      this.showToast('Folder path is required');
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
      this.showToast(error?.message || 'Failed to rename folder');
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
      this.showToast(error?.message || 'Failed to delete');
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
      this.showToast(error?.message || 'Failed to delete folder');
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

  handleNewFile({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create markdown file',
      copy: context.normalizedParentDir
        ? 'Add a new note inside the selected folder. It opens immediately after creation.'
        : 'Add a new note to the vault. It opens immediately after creation.',
      label: `File ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".md" is added automatically.`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'my-note' : 'notes/my-note',
      submitLabel: 'Create file',
      emptyMessage: 'File path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('File path is required');
          return false;
        }

        const filePath = this.ensureExtension(composeVaultChildPath(context.normalizedParentDir, normalizedPath), '.md');
        return this.createVaultFile(filePath, createMarkdownStarter(filePath), {
          errorMessage: 'Failed to create file',
          openAfterCreate: true,
        });
      },
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

  handleNewDrawing({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create Excalidraw drawing',
      copy: context.normalizedParentDir
        ? 'Start a new drawing inside the selected folder.'
        : 'Start a new drawing file in the vault.',
      label: `Drawing ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".excalidraw" is added automatically.`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'architecture' : 'diagrams/architecture',
      submitLabel: 'Create drawing',
      emptyMessage: 'Drawing path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('Drawing path is required');
          return false;
        }

        const filePath = this.ensureExtension(composeVaultChildPath(context.normalizedParentDir, normalizedPath), '.excalidraw');
        return this.createVaultFile(filePath, createEmptyExcalidrawScene(), {
          errorMessage: 'Failed to create drawing',
          openAfterCreate: true,
        });
      },
    });
  }

  handleNewMermaid({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create Mermaid diagram',
      copy: context.normalizedParentDir
        ? 'Create a new `.mmd` or `.mermaid` file inside the selected folder.'
        : 'Create a new `.mmd` or `.mermaid` file with starter diagram content.',
      label: `Diagram ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".mmd" is added automatically unless you enter ".mermaid".`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'flow' : 'diagrams/flow',
      submitLabel: 'Create diagram',
      emptyMessage: 'Diagram path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('Diagram path is required');
          return false;
        }

        const starter = createMermaidStarter(composeVaultChildPath(context.normalizedParentDir, normalizedPath));
        return this.createVaultFile(starter.path, starter.content, {
          errorMessage: 'Failed to create Mermaid diagram',
          openAfterCreate: true,
        });
      },
    });
  }

  handleNewDrawio({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create draw.io diagram',
      copy: context.normalizedParentDir
        ? 'Create a new `.drawio` diagram inside the selected folder.'
        : 'Create a new `.drawio` diagram with a native starter document.',
      label: `Diagram ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".drawio" is added automatically.`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'architecture' : 'diagrams/architecture',
      submitLabel: 'Create diagram',
      emptyMessage: 'Diagram path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('Diagram path is required');
          return false;
        }

        const starter = createDrawioStarter(composeVaultChildPath(context.normalizedParentDir, normalizedPath));
        return this.createVaultFile(starter.path, starter.content, {
          errorMessage: 'Failed to create draw.io diagram',
          openAfterCreate: true,
        });
      },
    });
  }

  handleNewPlantUml({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create PlantUML diagram',
      copy: context.normalizedParentDir
        ? 'Create a new `.puml` or `.plantuml` file inside the selected folder.'
        : 'Create a new `.puml` or `.plantuml` file with starter diagram content.',
      label: `Diagram ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".puml" is added automatically unless you enter ".plantuml".`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'sequence-flow' : 'diagrams/sequence-flow',
      submitLabel: 'Create diagram',
      emptyMessage: 'Diagram path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('Diagram path is required');
          return false;
        }

        const starter = createPlantUmlStarter(composeVaultChildPath(context.normalizedParentDir, normalizedPath));
        return this.createVaultFile(starter.path, starter.content, {
          errorMessage: 'Failed to create PlantUML diagram',
          openAfterCreate: true,
        });
      },
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
}
