import { escapeHtml } from '../domain/vault-utils.js';

const MARKDOWN_EXTENSION_PATTERN = /\.(?:md|markdown|mdx)$/i;
const DISPLAY_NAME_EXTENSION_PATTERN = /\.(?:md|markdown|mdx|excalidraw|puml|plantuml|mmd|mermaid)$/i;
const MERMAID_EXTENSION_PATTERN = /\.(?:mmd|mermaid)$/i;
const PLANTUML_EXTENSION_PATTERN = /\.(?:puml|plantuml)$/i;

function stripVaultExtension(name) {
  return String(name ?? '').replace(DISPLAY_NAME_EXTENSION_PATTERN, '');
}

function getPathLeaf(path) {
  return String(path ?? '')
    .replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

function normalizePathInput(value) {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/u, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

function composeChildPath(parentDir, childPath) {
  const normalizedParent = normalizePathInput(parentDir);
  const normalizedChild = normalizePathInput(childPath);

  if (!normalizedParent) {
    return normalizedChild;
  }

  if (!normalizedChild) {
    return normalizedParent;
  }

  return `${normalizedParent}/${normalizedChild}`;
}

export class FileExplorerController {
  constructor({ onFileSelect, onFileDelete, toastController }) {
    this.onFileSelect = onFileSelect;
    this.onFileDelete = onFileDelete;
    this.toastController = toastController;
    this.panel = document.getElementById('fileExplorer');
    this.treeContainer = document.getElementById('fileTree');
    this.newFileButton = document.getElementById('newFileBtn');
    this.newDrawingButton = document.getElementById('newDrawingBtn');
    this.newMermaidButton = document.getElementById('newMermaidBtn');
    this.newPlantumlButton = document.getElementById('newPlantumlBtn');
    this.newFolderButton = document.getElementById('newFolderBtn');
    this.refreshButton = document.getElementById('refreshFilesBtn');
    this.searchInput = document.getElementById('fileSearchInput');
    this.tree = [];
    this.flatFiles = [];
    this.activeFilePath = null;
    this.expandedDirs = new Set();
    this.searchQuery = '';
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
    this.newMermaidButton?.addEventListener('click', () => this.handleNewMermaid());
    this.newPlantumlButton?.addEventListener('click', () => this.handleNewPlantUml());
    this.newFolderButton?.addEventListener('click', () => this.handleNewFolder());
    this.refreshButton?.addEventListener('click', () => this.refresh());
    this.searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderTree();
    });
    this.treeContainer?.addEventListener('contextmenu', (event) => this.handleTreeContextMenu(event));
    this.actionCancelButton?.addEventListener('click', () => this.closeActionDialog());
    this.actionForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.handleActionSubmit();
    });
    this.actionDialog?.addEventListener('close', () => this.resetActionDialog());
  }

  async refresh() {
    try {
      const response = await fetch('/api/files');
      const data = await response.json();
      this.tree = data.tree || [];
      this.flatFiles = this.flattenTree(this.tree);
      this.renderTree();
    } catch (error) {
      console.error('[explorer] Failed to load file tree:', error.message);
    }
  }

  flattenTree(nodes) {
    const files = [];
    for (const node of nodes) {
      if (node.type === 'file' || node.type === 'excalidraw' || node.type === 'mermaid' || node.type === 'plantuml') {
        files.push(node.path);
      } else if (node.type === 'directory' && node.children) {
        files.push(...this.flattenTree(node.children, node.path));
      }
    }
    return files;
  }

  getDisplayName(name) {
    return stripVaultExtension(name);
  }

  setActiveFile(filePath) {
    this.activeFilePath = filePath;

    if (filePath) {
      const parts = filePath.split('/');
      let dirPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i];
        this.expandedDirs.add(dirPath);
      }
    }

    this.renderTree();
  }

  renderTree() {
    if (!this.treeContainer) return;

    if (this.searchQuery) {
      this.renderSearchResults();
      return;
    }

    this.treeContainer.innerHTML = '';

    if (this.tree.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No vault files found</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    this.renderNodes(this.tree, fragment, 0);
    this.treeContainer.appendChild(fragment);
  }

  renderSearchResults() {
    if (!this.treeContainer) return;
    this.treeContainer.innerHTML = '';

    const matches = this.flatFiles.filter((path) =>
      path.toLowerCase().includes(this.searchQuery),
    );

    if (matches.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No matches</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const filePath of matches) {
      const item = this.createFileItem(getPathLeaf(filePath), filePath, 0, this.getFileType(filePath));
      fragment.appendChild(item);
    }
    this.treeContainer.appendChild(fragment);
  }

  getFileType(filePath) {
    const normalized = String(filePath || '').toLowerCase();
    if (normalized.endsWith('.excalidraw')) {
      return 'excalidraw';
    }

    if (MERMAID_EXTENSION_PATTERN.test(normalized)) {
      return 'mermaid';
    }

    if (PLANTUML_EXTENSION_PATTERN.test(normalized)) {
      return 'plantuml';
    }

    return 'file';
  }

  getFileExtension(filePath) {
    const normalized = String(filePath ?? '');
    const lower = normalized.toLowerCase();

    if (lower.endsWith('.excalidraw')) {
      return '.excalidraw';
    }

    if (lower.endsWith('.mermaid')) {
      return '.mermaid';
    }

    if (lower.endsWith('.mmd')) {
      return '.mmd';
    }

    if (lower.endsWith('.plantuml')) {
      return '.plantuml';
    }

    if (lower.endsWith('.puml')) {
      return '.puml';
    }

    const markdownMatch = normalized.match(MARKDOWN_EXTENSION_PATTERN);
    return markdownMatch ? markdownMatch[0] : '.md';
  }

  ensureExtension(pathValue, extension) {
    return pathValue.toLowerCase().endsWith(extension.toLowerCase())
      ? pathValue
      : `${pathValue}${extension}`;
  }

  expandDirectoryPath(pathValue, { includeLeaf = true } = {}) {
    const normalized = normalizePathInput(pathValue);
    if (!normalized) {
      return;
    }

    const segments = normalized.split('/');
    const segmentCount = includeLeaf ? segments.length : Math.max(segments.length - 1, 0);
    let currentPath = '';

    for (let index = 0; index < segmentCount; index += 1) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
      this.expandedDirs.add(currentPath);
    }
  }

  showToast(message) {
    if (!message) {
      return;
    }

    this.toastController?.show(String(message));
  }

  showError(message, error) {
    this.showToast(error?.message ? `${message}: ${error.message}` : message);
  }

  buildMarkdownStarter(filePath) {
    const title = stripVaultExtension(getPathLeaf(filePath)) || 'Untitled';
    return `# ${title}\n\n`;
  }

  renderNodes(nodes, container, depth) {
    for (const node of nodes) {
      if (node.type === 'directory') {
        const dir = this.createDirectoryItem(node, depth);
        container.appendChild(dir);
      } else {
        const file = this.createFileItem(node.name, node.path, depth, node.type);
        container.appendChild(file);
      }
    }
  }

  createDirectoryItem(node, depth) {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-tree-group';

    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-dir';
    button.style.paddingLeft = `${8 + depth * 16}px`;

    const isExpanded = this.expandedDirs.has(node.path);
    button.setAttribute('aria-expanded', String(isExpanded));

    button.innerHTML = `
      <svg class="file-tree-chevron${isExpanded ? ' expanded' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      <svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span class="file-tree-name">${escapeHtml(node.name)}</span>
    `;

    button.addEventListener('click', () => {
      if (this.expandedDirs.has(node.path)) {
        this.expandedDirs.delete(node.path);
      } else {
        this.expandedDirs.add(node.path);
      }
      this.renderTree();
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showDirectoryContextMenu(event, node.path);
    });

    wrapper.appendChild(button);

    if (isExpanded && node.children) {
      const childContainer = document.createElement('div');
      childContainer.className = 'file-tree-children';
      this.renderNodes(node.children, childContainer, depth + 1);
      wrapper.appendChild(childContainer);
    }

    return wrapper;
  }

  createFileItem(name, filePath, depth, fileType = 'file') {
    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-file';
    const isExcalidraw = fileType === 'excalidraw';
    const isMermaid = fileType === 'mermaid';
    const isPlantUml = fileType === 'plantuml';
    if (isExcalidraw) {
      button.classList.add('is-excalidraw');
    }
    if (isMermaid) {
      button.classList.add('is-mermaid');
    }
    if (isPlantUml) {
      button.classList.add('is-plantuml');
    }
    if (filePath === this.activeFilePath) {
      button.classList.add('active');
    }
    button.style.paddingLeft = `${8 + depth * 16 + 14}px`;
    button.dataset.path = filePath;

    const displayName = this.getDisplayName(name);

    const iconSvg = isExcalidraw
      ? '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>'
      : isMermaid
        ? '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5c0-1.38 1.12-2.5 2.5-2.5 1.04 0 1.93.64 2.3 1.56A2.5 2.5 0 0 1 14 8.5v1"/><path d="M19 16.5c0 1.38-1.12 2.5-2.5 2.5-1.04 0-1.93-.64-2.3-1.56A2.5 2.5 0 0 1 10 15.5v-1"/><path d="M8 10.5h8"/><path d="M8 13.5h8"/><path d="M10 8.5v7"/><path d="M14 8.5v7"/></svg>'
      : isPlantUml
        ? '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>'
      : '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

    button.innerHTML = `
      ${iconSvg}
      <span class="file-tree-name">${escapeHtml(displayName)}</span>
    `;

    button.addEventListener('click', () => {
      this.onFileSelect?.(filePath);
    });

    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showFileContextMenu(e, filePath);
    });

    return button;
  }

  handleTreeContextMenu(event) {
    if (event.target.closest('.file-tree-item')) {
      return;
    }

    event.preventDefault();
    this.showCreateContextMenu(event);
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

  showFileContextMenu(event, filePath) {
    this.showContextMenu(event, [
      {
        label: 'Rename',
        onSelect: () => this.handleRename(filePath),
      },
      {
        label: 'Delete',
        danger: true,
        onSelect: () => this.handleDelete(filePath),
      },
    ]);
  }

  showDirectoryContextMenu(event, directoryPath) {
    this.showContextMenu(event, this.createContextMenuItems(directoryPath));
  }

  showCreateContextMenu(event) {
    this.showContextMenu(event, this.createContextMenuItems());
  }

  showContextMenu(event, items) {
    this.removeContextMenu();

    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'file-context-menu';

    for (const item of items) {
      const button = document.createElement('button');
      button.className = `file-context-item${item.danger ? ' file-context-danger' : ''}`;
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.removeContextMenu();
        item.onSelect?.();
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
    menu.style.left = `${Math.max(8, Math.min(event.clientX, maxLeft))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, maxTop))}px`;

    const close = (e) => {
      if (!menu.contains(e.target)) {
        this.removeContextMenu();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  removeContextMenu() {
    document.querySelectorAll('.file-context-menu').forEach((m) => m.remove());
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
    this.removeContextMenu();

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
      const response = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await response.json();

      if (!data.ok) {
        this.showToast(data.error || errorMessage);
        return false;
      }

      this.expandDirectoryPath(filePath, { includeLeaf: false });
      await this.refresh();

      if (openAfterCreate) {
        this.onFileSelect?.(filePath);
      }

      return true;
    } catch (error) {
      this.showError(errorMessage, error);
      return false;
    }
  }

  async createDirectory(pathValue) {
    const directoryPath = normalizePathInput(pathValue);
    if (!directoryPath) {
      this.showToast('Folder path is required');
      return false;
    }

    try {
      const response = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: directoryPath }),
      });
      const data = await response.json();

      if (!data.ok) {
        this.showToast(data.error || 'Failed to create folder');
        return false;
      }

      this.expandDirectoryPath(directoryPath);
      await this.refresh();
      return true;
    } catch (error) {
      this.showError('Failed to create folder', error);
      return false;
    }
  }

  async renameVaultFile(filePath, nextName, extension) {
    const normalizedName = String(nextName ?? '').trim();
    if (!normalizedName) {
      this.showToast('File name is required');
      return false;
    }

    if (/[\\/]/u.test(normalizedName)) {
      this.showToast('Rename only supports the file name right now');
      return false;
    }

    const baseName = stripVaultExtension(normalizedName).trim();
    if (!baseName) {
      this.showToast('File name is required');
      return false;
    }

    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/') + 1) : '';
    const newPath = `${dir}${baseName}${extension}`;

    if (newPath === filePath) {
      return true;
    }

    try {
      const response = await fetch('/api/file', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: filePath, newPath }),
      });
      const data = await response.json();

      if (!data.ok) {
        this.showToast(data.error || 'Failed to rename');
        return false;
      }

      this.expandDirectoryPath(newPath, { includeLeaf: false });
      await this.refresh();

      if (this.activeFilePath === filePath) {
        this.activeFilePath = newPath;
        this.onFileSelect?.(newPath);
      }

      return true;
    } catch (error) {
      this.showError('Failed to rename', error);
      return false;
    }
  }

  async deleteVaultFile(filePath) {
    try {
      const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (!data.ok) {
        this.showToast(data.error || 'Failed to delete');
        return false;
      }

      await this.refresh();

      if (this.activeFilePath === filePath) {
        this.activeFilePath = null;
        this.onFileDelete?.(filePath);
      }

      return true;
    } catch (error) {
      this.showError('Failed to delete', error);
      return false;
    }
  }

  getCreateContext(parentDir = '') {
    const normalizedParentDir = normalizePathInput(parentDir);

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
        const normalizedPath = normalizePathInput(value);
        if (!normalizedPath) {
          this.showToast('File path is required');
          return false;
        }

        const filePath = this.ensureExtension(composeChildPath(context.normalizedParentDir, normalizedPath), '.md');
        return this.createVaultFile(filePath, this.buildMarkdownStarter(filePath), {
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
      onSubmit: (value) => this.createDirectory(composeChildPath(context.normalizedParentDir, value)),
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
        const normalizedPath = normalizePathInput(value);
        if (!normalizedPath) {
          this.showToast('Drawing path is required');
          return false;
        }

        const filePath = this.ensureExtension(composeChildPath(context.normalizedParentDir, normalizedPath), '.excalidraw');
        const emptyScene = JSON.stringify({
          type: 'excalidraw',
          version: 2,
          source: 'collabmd',
          elements: [],
          appState: { viewBackgroundColor: '#ffffff', gridSize: null },
          files: {},
        });

        return this.createVaultFile(filePath, emptyScene, {
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
        const normalizedPath = normalizePathInput(value);
        if (!normalizedPath) {
          this.showToast('Diagram path is required');
          return false;
        }

        const composedPath = composeChildPath(context.normalizedParentDir, normalizedPath);
        const filePath = MERMAID_EXTENSION_PATTERN.test(composedPath)
          ? composedPath
          : `${composedPath}.mmd`;
        const starter = [
          'flowchart TD',
          '  A[Start] --> B{Decide}',
          '  B -->|Yes| C[Ship it]',
          '  B -->|No| D[Revise]',
          '',
        ].join('\n');

        return this.createVaultFile(filePath, starter, {
          errorMessage: 'Failed to create Mermaid diagram',
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
        const normalizedPath = normalizePathInput(value);
        if (!normalizedPath) {
          this.showToast('Diagram path is required');
          return false;
        }

        const composedPath = composeChildPath(context.normalizedParentDir, normalizedPath);
        const filePath = PLANTUML_EXTENSION_PATTERN.test(composedPath)
          ? composedPath
          : `${composedPath}.puml`;
        const starter = [
          '@startuml',
          'Alice -> Bob: Hello',
          '@enduml',
          '',
        ].join('\n');

        return this.createVaultFile(filePath, starter, {
          errorMessage: 'Failed to create PlantUML diagram',
          openAfterCreate: true,
        });
      },
    });
  }

  handleRename(filePath) {
    const currentName = getPathLeaf(filePath);
    const extension = this.getFileExtension(currentName);

    this.openActionDialog({
      title: 'Rename file',
      copy: 'Update the file name without changing its current type.',
      label: 'Name',
      hint: `${extension} is kept automatically.`,
      value: stripVaultExtension(currentName),
      submitLabel: 'Rename file',
      emptyMessage: 'File name is required',
      onSubmit: (value) => this.renameVaultFile(filePath, value, extension),
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
}
