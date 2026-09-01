import {
  getVaultFileKind,
  getVaultTreeNodeType,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';
import { escapeHtml } from '../domain/vault-utils.js';
import { getVaultPathLeaf, getVaultPathParent } from '../domain/vault-paths.js';
import { buttonClassNames } from './components/ui/button.js';


function findNodeByPath(nodes = [], pathValue = '') {
  for (const node of nodes) {
    if (node.path === pathValue) {
      return node;
    }

    if (node.type === 'directory' && Array.isArray(node.children)) {
      const nested = findNodeByPath(node.children, pathValue);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

const MOBILE_LONG_PRESS_DELAY_MS = 420;
const MOBILE_LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const DRAG_AUTO_EXPAND_DELAY_MS = 700;

export class FileExplorerView {
  constructor({
    mobileBreakpointQuery = window.matchMedia('(max-width: 768px)'),
    onEntryDrop,
    onDirectoryToggle,
    onFileContextMenu,
    onFileSelect,
    onSearchChange,
    onTreeContextMenu,
    onValidateDrop,
  }) {
    this.onEntryDrop = onEntryDrop;
    this.onDirectoryToggle = onDirectoryToggle;
    this.onFileContextMenu = onFileContextMenu;
    this.onFileSelect = onFileSelect;
    this.onSearchChange = onSearchChange;
    this.onTreeContextMenu = onTreeContextMenu;
    this.onValidateDrop = onValidateDrop;
    this.mobileBreakpointQuery = mobileBreakpointQuery;
    this.treeContainer = document.getElementById('fileTree');
    this.searchInput = document.getElementById('fileSearchInput');
    this.searchStatus = document.getElementById('fileSearchStatus');
    this.renderedDirectoryWrappers = new Map();
    this.renderedChildContainers = new Map();
    this.renderedFileItems = new Map();
    this.lastRenderMode = 'tree';
    this.longPressTimer = 0;
    this.longPressContext = null;
    this.suppressedActivationTarget = null;
    this.contextMenuCloseHandler = null;
    this.contextMenuCloseTimer = null;
    this.contextMenuAnchor = null;
    this.actionSheetCloseHandler = null;
    this.blockingModalHandler = () => this.removeContextMenu();
    this.dragSource = null;
    this.currentSearchQuery = '';
    this.activeDropTarget = null;
    this.invalidDropAttempt = null;
    this.autoExpandTimer = 0;
    this.autoExpandTargetPath = '';
    this.rootDropZone = null;
    this.threadCounts = new Map();
    this.showFileExtensions = false;
  }

  initialize() {
    this.searchInput?.addEventListener('input', (event) => {
      this.onSearchChange?.(event.target.value);
    });

    this.treeContainer?.addEventListener('click', (event) => {
      this.handleTreeClick(event);
    });
    this.treeContainer?.addEventListener('contextmenu', (event) => {
      this.handleTreeContextMenu(event);
    });
    this.treeContainer?.addEventListener('pointerdown', (event) => {
      this.handleTreePointerDown(event);
    });
    this.treeContainer?.addEventListener('pointermove', (event) => {
      this.handleLongPressPointerMove(event);
    }, { passive: true });
    this.treeContainer?.addEventListener('pointerup', () => {
      this.cancelLongPress();
    });
    this.treeContainer?.addEventListener('pointercancel', () => {
      this.cancelLongPress();
    });
    this.treeContainer?.addEventListener('scroll', () => {
      this.cancelLongPress();
    }, { passive: true });
    this.treeContainer?.addEventListener('dragstart', (event) => {
      this.handleTreeDragStart(event);
    });
    this.treeContainer?.addEventListener('dragend', (event) => {
      this.handleTreeDragEnd(event);
    });
    this.treeContainer?.addEventListener('dragenter', (event) => {
      this.handleTreeDragEnter(event);
    });
    this.treeContainer?.addEventListener('dragover', (event) => {
      this.handleTreeDragOver(event);
    });
    this.treeContainer?.addEventListener('drop', (event) => {
      this.handleTreeDrop(event);
    });
    this.treeContainer?.addEventListener('dragleave', (event) => {
      this.handleTreeDragLeave(event);
    });
  }

  getTreeItem(event) {
    const item = event.target instanceof Element
      ? event.target.closest('.file-tree-item')
      : null;
    if (!item || !this.treeContainer?.contains(item)) {
      return null;
    }
    return item;
  }

  handleTreeClick(event) {
    const item = this.getTreeItem(event);
    if (!item) {
      return;
    }
    if (this.consumeSuppressedActivation(item, event)) {
      return;
    }
    if (item.classList.contains('file-tree-dir')) {
      this.onDirectoryToggle?.(item.dataset.path);
      return;
    }
    this.onFileSelect?.(item.dataset.path);
  }

  handleTreeContextMenu(event) {
    const item = this.getTreeItem(event);
    if (item) {
      event.preventDefault();
      if (item.classList.contains('file-tree-dir')) {
        this.onFileContextMenu?.(event, { directoryPath: item.dataset.path, type: 'directory' });
        return;
      }
      this.onFileContextMenu?.(event, { filePath: item.dataset.path, type: 'file' });
      return;
    }

    event.preventDefault();
    this.onTreeContextMenu?.(event);
  }

  handleTreePointerDown(event) {
    const item = this.getTreeItem(event);
    if (item) {
      this.startLongPress(event, () => {
        if (item.classList.contains('file-tree-dir')) {
          this.onFileContextMenu?.(this.createLongPressEvent(item), {
            directoryPath: item.dataset.path,
            type: 'directory',
          });
          return;
        }
        this.onFileContextMenu?.(this.createLongPressEvent(item), {
          filePath: item.dataset.path,
          type: 'file',
        });
      }, item);
      return;
    }

    this.startLongPress(event, () => {
      this.onTreeContextMenu?.({
        clientX: Number(event.clientX || 0),
        clientY: Number(event.clientY || 0),
        preventDefault() {},
        target: this.treeContainer,
      });
    }, this.treeContainer);
  }

  handleTreeDragStart(event) {
    const item = this.getTreeItem(event);
    if (!item || !this.isDragAndDropEnabled()) {
      return;
    }

    this.dragSource = {
      path: item.dataset.path,
      type: item.dataset.entryType,
    };
    document.body?.classList.add('is-file-tree-dragging');
    if (this.treeContainer) {
      this.treeContainer.dataset.dragActive = 'true';
    }
    item.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.path);
    }
  }

  handleTreeDragEnd(event) {
    const item = this.getTreeItem(event) ?? this.treeContainer?.querySelector('.file-tree-item.is-dragging');
    item?.classList.remove('is-dragging');
    const dragSource = this.dragSource;
    if (this.invalidDropAttempt && dragSource) {
      void this.onEntryDrop?.(this.invalidDropAttempt);
    }
    this.dragSource = null;
    this.invalidDropAttempt = null;
    this.clearDragFeedback();
  }

  handleTreeDragEnter(event) {
    const directory = event.target instanceof Element
      ? event.target.closest('.file-tree-dir')
      : null;
    if (directory && this.treeContainer?.contains(directory)) {
      this.handleDirectoryDragEnter(event, directory, directory.dataset.path);
      return;
    }
    if (event.target instanceof Element && event.target.closest('.file-tree-root-drop-zone')) {
      this.handleRootZoneDragEnter(event);
    }
  }


  updateSearchStatus(query, matchCount = null) {
    if (!this.searchStatus) {
      return;
    }

    const status = String(query ?? '').trim() && Number.isInteger(matchCount)
      ? `${matchCount} match${matchCount === 1 ? '' : 'es'}`
      : '';
    this.searchStatus.textContent = status;
    this.searchStatus.classList.toggle('hidden', !status);
  }

  revealFile(filePath) {
    this.renderedFileItems.get(filePath)?.scrollIntoView({ block: 'nearest' });
  }

  setActiveFile(filePath) {
    this.treeContainer?.querySelector('.file-tree-file.active')?.classList.remove('active');
    if (!filePath) {
      return true;
    }

    const fileItem = this.renderedFileItems.get(filePath);
    fileItem?.classList.add('active');
    return Boolean(fileItem);
  }

  setThreadCounts(threadCounts) {
    this.threadCounts = threadCounts instanceof Map ? threadCounts : new Map();
    this.renderedFileItems.forEach((button, filePath) => {
      const threadCount = Number(this.threadCounts.get(filePath) ?? 0) || 0;
      let badge = button.querySelector('.file-tree-comment-count');
      button.classList.toggle('has-comments', threadCount > 0);
      button.setAttribute(
        'aria-label',
        `${filePath}${threadCount > 0 ? `, ${threadCount} open comment thread${threadCount === 1 ? '' : 's'}` : ''}`,
      );

      if (threadCount <= 0) {
        delete button.dataset.threadCount;
        badge?.remove();
        return;
      }

      button.dataset.threadCount = String(threadCount);
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'file-tree-comment-count';
        button.appendChild(badge);
      }
      badge.textContent = String(threadCount);
      badge.setAttribute('aria-hidden', 'true');
    });
  }

  render({ activeFilePath, changedPaths = null, expandedDirs, reset = false, searchMatches, searchQuery, showFileExtensions = false, threadCounts = new Map(), tree }) {
    if (!this.treeContainer) {
      return;
    }

    this.threadCounts = threadCounts instanceof Map ? threadCounts : new Map();
    this.showFileExtensions = Boolean(showFileExtensions);
    this.currentSearchQuery = String(searchQuery ?? '').trim();
    if (this.currentSearchQuery) {
      this.clearDragFeedback();
    }

    if (this.searchInput && this.searchInput.value !== searchQuery) {
      this.searchInput.value = searchQuery;
    }
    this.updateSearchStatus(searchQuery, this.currentSearchQuery ? searchMatches.length : null);

    if (this.currentSearchQuery) {
      this.lastRenderMode = 'search';
      this.renderSearchResults(searchMatches, activeFilePath);
      return;
    }

    if (
      reset
      || this.lastRenderMode !== 'tree'
      || !Array.isArray(changedPaths)
      || changedPaths.length === 0
    ) {
      this.renderFullTree(tree, {
        activeFilePath,
        expandedDirs,
      });
      this.lastRenderMode = 'tree';
      return;
    }

    const affectedParentPaths = Array.from(new Set(
      changedPaths.map((pathValue) => getVaultPathParent(pathValue)),
    ))
      .sort((left, right) => left.split('/').length - right.split('/').length)
      .filter((pathValue, index, values) => (
        !values.slice(0, index).some((ancestorPath) => ancestorPath && pathValue.startsWith(`${ancestorPath}/`))
      ));
    if (affectedParentPaths.includes('')) {
      this.renderFullTree(tree, {
        activeFilePath,
        expandedDirs,
      });
      this.lastRenderMode = 'tree';
      return;
    }

    for (const parentPath of affectedParentPaths) {
      if (!this.rerenderDirectoryBranch(parentPath, tree, {
        activeFilePath,
        expandedDirs,
      })) {
        this.renderFullTree(tree, {
          activeFilePath,
          expandedDirs,
        });
        this.lastRenderMode = 'tree';
        return;
      }
    }

    this.lastRenderMode = 'tree';
  }

  renderSearchResults(matches, activeFilePath) {
    if (!this.treeContainer) {
      return;
    }

    this.resetTreeIndexes();
    this.treeContainer.innerHTML = '';
    this.rootDropZone = null;

    if (matches.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No matches</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const match of matches) {
      fragment.appendChild(this.createFileItem({
        activeFilePath,
        depth: 0,
        filePath: match.path,
        fileType: match.type || (getVaultTreeNodeType(match.path) ?? 'file'),
        name: match.name || getVaultPathLeaf(match.path),
        searchResult: true,
      }));
    }
    this.treeContainer.appendChild(fragment);
  }

  renderFullTree(tree, { activeFilePath, expandedDirs }) {
    this.resetTreeIndexes();
    this.treeContainer.innerHTML = '';
    this.rootDropZone = null;

    if (tree.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No vault files found</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    fragment.appendChild(this.createRootDropZone());
    this.renderNodes(tree, fragment, {
      activeFilePath,
      depth: 0,
      expandedDirs,
    });
    this.treeContainer.appendChild(fragment);
  }

  resetTreeIndexes() {
    this.renderedDirectoryWrappers.clear();
    this.renderedChildContainers.clear();
    this.renderedFileItems.clear();
  }

  renderNodes(nodes, container, { activeFilePath, depth, expandedDirs }) {
    for (const node of nodes) {
      if (node.type === 'directory') {
        container.appendChild(this.createDirectoryItem(node, {
          activeFilePath,
          depth,
          expandedDirs,
        }));
        continue;
      }

      container.appendChild(this.createFileItem({
        activeFilePath,
        depth,
        filePath: node.path,
        fileType: node.type,
        name: node.name,
      }));
    }
  }

  createDirectoryItem(node, { activeFilePath, depth, expandedDirs }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-tree-group';

    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-dir';
    button.title = node.path;
    button.setAttribute('aria-label', node.path);
    button.style.setProperty('--depth', depth);
    button.dataset.depth = depth;

    const isExpanded = expandedDirs.has(node.path);
    button.setAttribute('aria-expanded', String(isExpanded));
    button.dataset.path = node.path;
    button.dataset.entryType = 'directory';
    // Dynamic labels are escaped and icons are application-owned markup.
    // pi-lens-ignore: no-inner-html-js
    button.innerHTML = `
      <span class="file-tree-chevron${isExpanded ? ' expanded' : ''}" aria-hidden="true"></span>
      <span class="file-tree-icon" aria-hidden="true"></span>
      <span class="file-tree-name">${escapeHtml(node.name)}</span>
    `;
    this.configureDragSource(button);


    wrapper.appendChild(button);
    this.renderedDirectoryWrappers.set(node.path, wrapper);

    if (isExpanded && Array.isArray(node.children)) {
      const childContainer = document.createElement('div');
      childContainer.className = 'file-tree-children';
      this.renderedChildContainers.set(node.path, childContainer);
      this.renderNodes(node.children, childContainer, {
        activeFilePath,
        depth: depth + 1,
        expandedDirs,
      });
      wrapper.appendChild(childContainer);
    } else {
      this.renderedChildContainers.delete(node.path);
    }

    return wrapper;
  }

  rerenderDirectoryBranch(parentPath, tree, { activeFilePath, expandedDirs }) {
    const wrapper = this.renderedDirectoryWrappers.get(parentPath);
    const parentNode = findNodeByPath(tree, parentPath);
    if (!wrapper || parentNode?.type !== 'directory') {
      return false;
    }

    const button = wrapper.querySelector('.file-tree-dir');
    const isExpanded = expandedDirs.has(parentPath);
    button?.setAttribute('aria-expanded', String(isExpanded));
    button?.querySelector('.file-tree-chevron')?.classList.toggle('expanded', isExpanded);

    const depth = Number(button?.dataset.depth ?? 0);
    let childContainer = this.renderedChildContainers.get(parentPath) ?? wrapper.querySelector('.file-tree-children');

    this.clearRenderedDescendants(parentPath);

    if (!isExpanded) {
      childContainer?.remove();
      this.renderedChildContainers.delete(parentPath);
      return true;
    }

    if (!childContainer) {
      childContainer = document.createElement('div');
      childContainer.className = 'file-tree-children';
      wrapper.appendChild(childContainer);
    } else {
      childContainer.innerHTML = '';
    }
    this.renderedChildContainers.set(parentPath, childContainer);

    this.renderNodes(parentNode.children ?? [], childContainer, {
      activeFilePath,
      depth: depth + 1,
      expandedDirs,
    });

    return true;
  }

  clearRenderedDescendants(parentPath) {
    const prefix = `${parentPath}/`;
    Array.from(this.renderedDirectoryWrappers.keys()).forEach((pathValue) => {
      if (pathValue.startsWith(prefix)) {
        this.renderedDirectoryWrappers.delete(pathValue);
      }
    });
    Array.from(this.renderedChildContainers.keys()).forEach((pathValue) => {
      if (pathValue.startsWith(prefix)) {
        this.renderedChildContainers.delete(pathValue);
      }
    });
    Array.from(this.renderedFileItems.keys()).forEach((pathValue) => {
      if (pathValue.startsWith(prefix)) {
        this.renderedFileItems.delete(pathValue);
      }
    });
  }

  createFileItem({ activeFilePath, depth, filePath, fileType = 'file', name, searchResult = false }) {
    const button = document.createElement('button');
    const parentPath = getVaultPathParent(filePath);
    button.className = `file-tree-item file-tree-file${searchResult ? ' file-tree-search-result' : ''}`;
    button.title = filePath;
    const threadCount = Number(this.threadCounts.get(filePath) ?? 0);
    button.setAttribute(
      'aria-label',
      `${filePath}${threadCount > 0 ? `, ${threadCount} open comment thread${threadCount === 1 ? '' : 's'}` : ''}`,
    );
    if (filePath === activeFilePath) {
      button.classList.add('active');
    }
    if (threadCount > 0) {
      button.classList.add('has-comments');
    }

    button.style.setProperty('--depth', depth);
    button.dataset.depth = depth;
    button.dataset.path = filePath;
    button.dataset.entryType = 'file';
    button.dataset.kind = getVaultFileKind(filePath) ?? fileType ?? 'file';
    if (threadCount > 0) {
      button.dataset.threadCount = String(threadCount);
    }
    const displayName = this.showFileExtensions || searchResult ? String(name ?? '') : stripVaultFileExtension(name);
    const nameMarkup = searchResult
      ? `<span class="file-tree-search-copy">
          <span class="file-tree-name">${escapeHtml(displayName)}</span>
          ${parentPath ? `<span class="file-tree-search-path">${escapeHtml(parentPath)}</span>` : ''}
        </span>`
      : `<span class="file-tree-name">${escapeHtml(displayName)}</span>`;
    // Dynamic labels are escaped and icons are application-owned markup.
    // pi-lens-ignore: no-inner-html-js
    button.innerHTML = `
      <span class="file-tree-icon" aria-hidden="true"></span>
      ${nameMarkup}
      ${threadCount > 0 ? `<span class="file-tree-comment-count" aria-hidden="true">${threadCount}</span>` : ''}
    `;
    this.configureDragSource(button);


    this.renderedFileItems.set(filePath, button);
    return button;
  }

  isMobileViewport() {
    return Boolean(this.mobileBreakpointQuery?.matches);
  }

  isDragAndDropEnabled() {
    return !this.isMobileViewport() && !this.currentSearchQuery;
  }

  configureDragSource(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.draggable = this.isDragAndDropEnabled();
  }


  createRootDropZone() {
    const zone = document.createElement('div');
    zone.className = 'file-tree-root-drop-zone';
    zone.textContent = 'Drop here to move to vault root';
    zone.addEventListener('dragenter', (event) => {
      this.handleRootZoneDragEnter(event);
    });
    zone.addEventListener('dragover', (event) => {
      this.handleRootZoneDragOver(event);
    });
    zone.addEventListener('drop', (event) => {
      this.handleRootZoneDrop(event);
    });
    this.rootDropZone = zone;
    return zone;
  }

  validateDrop(destinationDirectory) {
    if (!this.dragSource || this.currentSearchQuery) {
      return false;
    }

    return this.onValidateDrop?.({
      destinationDirectory,
      sourcePath: this.dragSource.path,
      sourceType: this.dragSource.type,
    }) === true;
  }

  setDropTarget(target) {
    if (this.activeDropTarget?.element && this.activeDropTarget.element !== target?.element) {
      this.activeDropTarget.element.classList.remove('is-drop-target', 'is-drop-invalid');
    }

    if (this.activeDropTarget?.root && !target?.root) {
      this.treeContainer?.classList.remove('is-drop-target-root', 'is-drop-invalid');
    }
    if (this.activeDropTarget?.rootZone && !target?.rootZone) {
      this.rootDropZone?.classList.remove('is-drop-target', 'is-drop-invalid');
    }

    this.activeDropTarget = target;
    if (!target || target.isValid) {
      this.invalidDropAttempt = null;
    } else if (this.dragSource) {
      this.invalidDropAttempt = {
        destinationDirectory: target.destinationDirectory || '',
        sourcePath: this.dragSource.path,
        sourceType: this.dragSource.type,
      };
    }

    if (!target) {
      return;
    }

    if (target.root) {
      this.treeContainer?.classList.toggle('is-drop-target-root', target.isValid);
      this.treeContainer?.classList.toggle('is-drop-invalid', !target.isValid);
      return;
    }

    if (target.rootZone) {
      this.rootDropZone?.classList.toggle('is-drop-target', target.isValid);
      this.rootDropZone?.classList.toggle('is-drop-invalid', !target.isValid);
      return;
    }

    target.element.classList.toggle('is-drop-target', target.isValid);
    target.element.classList.toggle('is-drop-invalid', !target.isValid);
  }

  scheduleAutoExpand(element, directoryPath) {
    const isExpanded = element.getAttribute('aria-expanded') === 'true';
    if (isExpanded || this.autoExpandTargetPath === directoryPath) {
      return;
    }

    this.cancelAutoExpand();
    this.autoExpandTargetPath = directoryPath;
    this.autoExpandTimer = window.setTimeout(() => {
      this.autoExpandTimer = 0;
      this.autoExpandTargetPath = '';
      if (element.isConnected && element.getAttribute('aria-expanded') !== 'true') {
        this.onDirectoryToggle?.(directoryPath);
      }
    }, DRAG_AUTO_EXPAND_DELAY_MS);
  }

  cancelAutoExpand() {
    if (this.autoExpandTimer) {
      window.clearTimeout(this.autoExpandTimer);
      this.autoExpandTimer = 0;
    }
    this.autoExpandTargetPath = '';
  }

  clearDragFeedback() {
    this.cancelAutoExpand();
    this.setDropTarget(null);
    document.body?.classList.remove('is-file-tree-dragging');
    if (this.treeContainer) {
      delete this.treeContainer.dataset.dragActive;
    }
  }

  handleDirectoryDragEnter(event, element, directoryPath) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const isValid = this.validateDrop(directoryPath);
    this.setDropTarget({ destinationDirectory: directoryPath, element, isValid, root: false });
    if (isValid) {
      this.scheduleAutoExpand(element, directoryPath);
    } else {
      this.cancelAutoExpand();
    }
  }

  handleDirectoryDragOver(event, element, directoryPath) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const isValid = this.validateDrop(directoryPath);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = isValid ? 'move' : 'none';
    }
    this.setDropTarget({ destinationDirectory: directoryPath, element, isValid, root: false });
    if (isValid) {
      this.scheduleAutoExpand(element, directoryPath);
    } else {
      this.cancelAutoExpand();
    }
  }

  handleDirectoryDrop(event, directoryPath) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const payload = {
      destinationDirectory: directoryPath,
      sourcePath: this.dragSource.path,
      sourceType: this.dragSource.type,
    };
    this.clearDragFeedback();
    void this.onEntryDrop?.(payload);
  }

  handleTreeDragOver(event) {
    if (!this.dragSource || !this.treeContainer) {
      return;
    }

    const directory = event.target instanceof Element
      ? event.target.closest('.file-tree-dir')
      : null;
    if (directory && this.treeContainer.contains(directory)) {
      this.handleDirectoryDragOver(event, directory, directory.dataset.path);
      return;
    }

    const file = event.target instanceof Element
      ? event.target.closest('.file-tree-file')
      : null;
    if (file && this.treeContainer.contains(file)) {
      this.handleNonDropTargetDragOver(event);
      return;
    }

    if (event.target instanceof Element && event.target.closest('.file-tree-root-drop-zone')) {
      this.handleRootZoneDragOver(event);
      return;
    }

    event.preventDefault();
    this.cancelAutoExpand();
    const isValid = this.validateDrop('');
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = isValid ? 'move' : 'none';
    }
    this.setDropTarget({ destinationDirectory: '', element: this.treeContainer, isValid, root: true });
  }

  handleTreeDrop(event) {
    if (!this.dragSource || !this.treeContainer) {
      return;
    }

    const directory = event.target instanceof Element
      ? event.target.closest('.file-tree-dir')
      : null;
    if (directory && this.treeContainer.contains(directory)) {
      this.handleDirectoryDrop(event, directory.dataset.path);
      return;
    }

    if (event.target instanceof Element && event.target.closest('.file-tree-root-drop-zone')) {
      this.handleRootZoneDrop(event);
      return;
    }

    if (event.target instanceof Element && event.target.closest('.file-tree-file')) {
      return;
    }

    event.preventDefault();
    const payload = {
      destinationDirectory: '',
      sourcePath: this.dragSource.path,
      sourceType: this.dragSource.type,
    };
    this.clearDragFeedback();
    void this.onEntryDrop?.(payload);
  }


  handleTreeDragLeave(event) {
    if (!this.dragSource || !this.treeContainer) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget && this.treeContainer.contains(nextTarget)) {
      return;
    }

    this.clearDragFeedback();
  }

  handleRootZoneDragEnter(event) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const isValid = this.validateDrop('');
    this.cancelAutoExpand();
    this.setDropTarget({ destinationDirectory: '', element: this.rootDropZone, isValid, rootZone: true });
  }

  handleRootZoneDragOver(event) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const isValid = this.validateDrop('');
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = isValid ? 'move' : 'none';
    }
    this.cancelAutoExpand();
    this.setDropTarget({ destinationDirectory: '', element: this.rootDropZone, isValid, rootZone: true });
  }

  handleRootZoneDrop(event) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const payload = {
      destinationDirectory: '',
      sourcePath: this.dragSource.path,
      sourceType: this.dragSource.type,
    };
    this.clearDragFeedback();
    void this.onEntryDrop?.(payload);
  }

  handleNonDropTargetDragOver(event) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none';
    }
    this.clearDragFeedback();
  }


  startLongPress(event, callback, target = null) {
    if (!this.isMobileViewport()) {
      return;
    }

    if (!['touch', 'pen'].includes(String(event.pointerType || ''))) {
      return;
    }

    if (Number(event.button ?? 0) !== 0) {
      return;
    }

    this.cancelLongPress();
    this.longPressContext = {
      callback,
      pointerId: event.pointerId,
      startX: Number(event.clientX || 0),
      startY: Number(event.clientY || 0),
      target: target ?? event.currentTarget ?? event.target ?? null,
    };
    this.longPressTimer = window.setTimeout(() => {
      const activeContext = this.longPressContext;
      this.longPressTimer = 0;
      if (!activeContext) {
        return;
      }

      this.suppressedActivationTarget = activeContext.target;
      activeContext.callback();
      this.longPressContext = null;
    }, MOBILE_LONG_PRESS_DELAY_MS);
  }

  handleLongPressPointerMove(event) {
    if (!this.longPressContext || event.pointerId !== this.longPressContext.pointerId) {
      return;
    }

    const deltaX = Math.abs(Number(event.clientX || 0) - this.longPressContext.startX);
    const deltaY = Math.abs(Number(event.clientY || 0) - this.longPressContext.startY);
    if (deltaX > MOBILE_LONG_PRESS_MOVE_TOLERANCE_PX || deltaY > MOBILE_LONG_PRESS_MOVE_TOLERANCE_PX) {
      this.cancelLongPress();
    }
  }

  cancelLongPress() {
    if (this.longPressTimer) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = 0;
    }
    this.longPressContext = null;
  }

  createLongPressEvent(target) {
    return {
      clientX: this.longPressContext?.startX ?? 0,
      clientY: this.longPressContext?.startY ?? 0,
      preventDefault() {},
      stopPropagation() {},
      target,
    };
  }

  consumeSuppressedActivation(target, event) {
    if (this.suppressedActivationTarget !== target) {
      return false;
    }

    this.suppressedActivationTarget = null;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }

  showContextMenu(event, items) {
    this.removeContextMenu();

    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    const contextAnchor = event.currentTarget instanceof Element ? event.currentTarget : event.target;
    this.contextMenuAnchor = contextAnchor instanceof HTMLElement ? contextAnchor : null;
    if (this.isMobileViewport()) {
      this.showActionSheet(items);
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'File actions');

    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `file-context-item${item.danger ? ' file-context-danger' : ''}`;
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.removeContextMenu();
        item.onSelect?.({ anchor: contextAnchor });
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
    menu.style.left = `${Math.max(8, Math.min(event.clientX, maxLeft))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, maxTop))}px`;

    const close = (closeEvent) => {
      if (!menu.contains(closeEvent.target)) {
        this.removeContextMenu();
      }
    };
    this.contextMenuCloseHandler = close;
    const handleKeydown = (keyEvent) => {
      const buttons = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const index = Math.max(0, buttons.indexOf(document.activeElement));
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        this.removeContextMenu();
        return;
      }
      if (keyEvent.key === 'Tab') {
        this.removeContextMenu({ restoreFocus: false });
        return;
      }
      const nextIndex = keyEvent.key === 'Home'
        ? 0
        : keyEvent.key === 'End'
          ? buttons.length - 1
          : keyEvent.key === 'ArrowDown'
            ? (index + 1) % buttons.length
            : keyEvent.key === 'ArrowUp'
              ? (index - 1 + buttons.length) % buttons.length
              : -1;
      if (nextIndex >= 0) {
        keyEvent.preventDefault();
        buttons[nextIndex]?.focus();
      }
    };
    menu.addEventListener('keydown', handleKeydown);
    document.addEventListener('collabmd:close-custom-modals', this.blockingModalHandler);
    this.contextMenuCloseTimer = setTimeout(() => {
      this.contextMenuCloseTimer = null;
      if (menu.isConnected && this.contextMenuCloseHandler === close) {
        document.addEventListener('click', close);
      }
    }, 0);
    menu.querySelector('[role="menuitem"]')?.focus();
  }

  showActionSheet(items) {
    const sheet = document.createElement('dialog');
    sheet.className = 'file-action-sheet';
    sheet.setAttribute('aria-label', 'File actions');

    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = buttonClassNames({
        variant: 'secondary',
        extra: ['file-action-sheet-item', item.danger ? 'file-context-danger' : ''],
      });
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.removeContextMenu();
        item.onSelect?.();
      });
      sheet.appendChild(button);
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = buttonClassNames({
      variant: 'ghost',
      extra: 'file-action-sheet-item',
    });
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      this.removeContextMenu();
    });
    sheet.appendChild(cancelButton);

    sheet.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.removeContextMenu();
    });
    sheet.addEventListener('click', (event) => {
      const bounds = sheet.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) this.removeContextMenu();
    });

    document.body.append(sheet);
    document.addEventListener('collabmd:close-custom-modals', this.blockingModalHandler);
    this.actionSheetCloseHandler = () => {
      if (sheet.open) sheet.close();
      sheet.remove();
      this.actionSheetCloseHandler = null;
    };
    sheet.showModal();
    sheet.querySelector('button:not(:disabled)')?.focus();
  }

  removeContextMenu({ restoreFocus = true } = {}) {
    this.cancelLongPress();
    this.clearDragFeedback();
    document.querySelectorAll('.file-context-menu').forEach((menu) => menu.remove());
    if (this.contextMenuCloseTimer !== null) {
      clearTimeout(this.contextMenuCloseTimer);
      this.contextMenuCloseTimer = null;
    }
    if (this.contextMenuCloseHandler) {
      document.removeEventListener('click', this.contextMenuCloseHandler);
      this.contextMenuCloseHandler = null;
    }
    document.removeEventListener('collabmd:close-custom-modals', this.blockingModalHandler);
    this.actionSheetCloseHandler?.();
    if (restoreFocus) this.contextMenuAnchor?.focus?.();
    this.contextMenuAnchor = null;
  }
}
