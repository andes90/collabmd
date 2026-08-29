import { createExcalidrawExportOptions } from '../domain/excalidraw-scene.js';
import { escapeHtml } from '../domain/vault-utils.js';
import { commitButtonLabel } from '../domain/git-labels.js';
import { getVaultPathLeaf, getVaultPathParent } from '../domain/vault-paths.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';
import { renderDrawioViewer } from './drawio-viewer.js';
import { buttonClassNames } from './components/ui/button.js';
import { getVaultFileKind } from '../../domain/file-kind.js';

const IMAGE_MIME_LABELS = Object.freeze({
  '.gif': 'GIF',
  '.jpeg': 'JPEG',
  '.jpg': 'JPEG',
  '.png': 'PNG',
  '.svg': 'SVG',
  '.webp': 'WebP',
});

function getDiffFileKind(file = null) {
  return file?.fileKind || getVaultFileKind(file?.path) || null;
}

function getImageFormat(filePath = '') {
  const normalizedPath = String(filePath ?? '').toLowerCase();
  const extension = Object.keys(IMAGE_MIME_LABELS).find((candidate) => normalizedPath.endsWith(candidate));
  return extension ? IMAGE_MIME_LABELS[extension] : 'Image';
}

function parseExcalidrawScene(rawSource = '') {
  try {
    const parsed = JSON.parse(String(rawSource ?? ''));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.elements)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function pickExcalidrawSceneSource(lines = []) {
  if (lines.length === 0) {
    return null;
  }

  const joinedSource = lines.join('\n');
  if (parseExcalidrawScene(joinedSource)) {
    return joinedSource;
  }

  return lines.find((line) => parseExcalidrawScene(line)) ?? null;
}

function getExcalidrawSceneSources(detail = {}) {
  const beforeLines = [];
  const afterLines = [];

  for (const hunk of detail.hunks ?? []) {
    for (const line of hunk.lines ?? []) {
      if (line.type === 'context') {
        beforeLines.push(line.content);
        afterLines.push(line.content);
      } else if (line.type === 'deletion') {
        beforeLines.push(line.content);
      } else if (line.type === 'addition') {
        afterLines.push(line.content);
      }
    }
  }

  const beforeSource = pickExcalidrawSceneSource(beforeLines);
  const afterSource = pickExcalidrawSceneSource(afterLines);
  const isAdded = detail.status === 'added' || detail.status === 'untracked';
  const isDeleted = detail.status === 'deleted';

  return {
    after: isDeleted ? null : parseExcalidrawScene(afterSource),
    before: isAdded ? null : parseExcalidrawScene(beforeSource),
    afterSource: isDeleted ? '' : afterSource || '',
    beforeSource: isAdded ? '' : beforeSource || '',
  };
}

function getVisibleSceneElements(scene = null) {
  return Array.isArray(scene?.elements)
    ? scene.elements.filter((element) => element && !element.isDeleted)
    : [];
}

function sceneElementSignature(element) {
  if (!element || typeof element !== 'object') {
    return '';
  }

  const copy = { ...element };
  delete copy.version;
  delete copy.versionNonce;
  return JSON.stringify(copy);
}

function summarizeExcalidrawChange(beforeScene, afterScene) {
  if (!beforeScene && !afterScene) {
    return null;
  }

  const beforeById = new Map(getVisibleSceneElements(beforeScene).map((element) => [element.id, element]));
  const afterById = new Map(getVisibleSceneElements(afterScene).map((element) => [element.id, element]));
  let added = 0;
  let removed = 0;
  let updated = 0;

  for (const [id, element] of afterById) {
    if (!beforeById.has(id)) {
      added += 1;
    } else if (sceneElementSignature(beforeById.get(id)) !== sceneElementSignature(element)) {
      updated += 1;
    }
  }

  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) {
      removed += 1;
    }
  }

  return {
    added,
    afterCount: afterById.size,
    beforeCount: beforeById.size,
    removed,
    updated,
  };
}

function formatByteLength(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasDrawioSourceRoot(source) {
  return /<(?:mxfile|mxGraphModel|diagram)\b/iu.test(String(source ?? ''));
}

function formatDrawioSource(source) {
  return String(source ?? '')
    .replace(/>\s*</gu, '>\n<')
    .trim();
}

function pickDrawioSource(lines = []) {
  if (lines.length === 0) {
    return '';
  }

  const joinedSource = lines.join('\n');
  if (hasDrawioSourceRoot(joinedSource)) {
    return joinedSource;
  }

  return lines.find((line) => hasDrawioSourceRoot(line)) ?? '';
}

function getDrawioSourcePair(detail = {}) {
  const beforeLines = [];
  const afterLines = [];

  for (const hunk of detail.hunks ?? []) {
    for (const line of hunk.lines ?? []) {
      if (line.type === 'context') {
        beforeLines.push(line.content);
        afterLines.push(line.content);
      } else if (line.type === 'deletion') {
        beforeLines.push(line.content);
      } else if (line.type === 'addition') {
        afterLines.push(line.content);
      }
    }
  }

  const beforeSource = typeof detail.drawioBeforeSource === 'string'
    ? detail.drawioBeforeSource
    : pickDrawioSource(beforeLines);
  const afterSource = typeof detail.drawioAfterSource === 'string'
    ? detail.drawioAfterSource
    : pickDrawioSource(afterLines);
  const isAdded = detail.status === 'added' || detail.status === 'untracked';
  const isDeleted = detail.status === 'deleted';

  return {
    after: isDeleted ? '' : afterSource,
    before: isAdded ? '' : beforeSource,
  };
}

function getDrawioCellMap(source) {
  const cells = new Map();
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return cells;
  }

  const documentNode = new DOMParser().parseFromString(String(source ?? ''), 'application/xml');
  if (documentNode.querySelector('parsererror')) {
    return cells;
  }

  const serializer = new XMLSerializer();
  for (const cell of documentNode.getElementsByTagName('mxCell')) {
    const id = cell.getAttribute('id');
    if (!id || id === '0' || id === '1') {
      continue;
    }

    cells.set(id, serializer.serializeToString(cell).replace(/\s+/gu, ' ').trim());
  }

  return cells;
}

function isEmptyDrawioModel(source) {
  return /<mxGraphModel\b/iu.test(String(source ?? '')) && getDrawioCellMap(source).size === 0;
}

function summarizeDrawioChange(beforeSource, afterSource) {
  if (!beforeSource && !afterSource) {
    return null;
  }

  const beforeCells = getDrawioCellMap(beforeSource);
  const afterCells = getDrawioCellMap(afterSource);
  const cellBased = beforeCells.size > 0 || afterCells.size > 0;
  let added = 0;
  let removed = 0;
  let updated = 0;

  if (cellBased) {
    for (const [id, signature] of afterCells) {
      if (!beforeCells.has(id)) {
        added += 1;
      } else if (beforeCells.get(id) !== signature) {
        updated += 1;
      }
    }

    for (const id of beforeCells.keys()) {
      if (!afterCells.has(id)) {
        removed += 1;
      }
    }

    if (beforeSource !== afterSource && added === 0 && removed === 0 && updated === 0) {
      updated = 1;
    }
  } else {
    const hasBefore = Boolean(beforeSource);
    const hasAfter = Boolean(afterSource);
    added = !hasBefore && hasAfter ? 1 : 0;
    removed = hasBefore && !hasAfter ? 1 : 0;
    updated = hasBefore && hasAfter && beforeSource !== afterSource ? 1 : 0;
  }

  return {
    added,
    afterCount: afterCells.size,
    beforeCount: beforeCells.size,
    cellBased,
    removed,
    updated,
  };
}

function createSectionId(pathValue) {
  return `diff-section-${encodeURIComponent(String(pathValue ?? '')).replace(/%/g, '_')}`;
}

function badgeClass(status) {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'ui-status-badge--success';
    case 'deleted':
      return 'ui-status-badge--danger';
    case 'renamed':
      return 'ui-status-badge--accent';
    default:
      return 'ui-status-badge--warning';
  }
}

function chevronSvg(collapsed = false) {
  return `<svg class="diff-section-chevron${collapsed ? ' collapsed' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
}

function commonPrefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left, right, prefixLength) {
  let index = 0;
  const maxLength = Math.min(left.length, right.length) - prefixLength;
  while (index < maxLength) {
    const leftIndex = left.length - 1 - index;
    const rightIndex = right.length - 1 - index;
    if (left[leftIndex] !== right[rightIndex]) {
      break;
    }
    index += 1;
  }
  return index;
}

function highlightPair(leftText, rightText) {
  const prefixLength = commonPrefixLength(leftText, rightText);
  const suffixLength = commonSuffixLength(leftText, rightText, prefixLength);
  const leftChangedEnd = Math.max(prefixLength, leftText.length - suffixLength);
  const rightChangedEnd = Math.max(prefixLength, rightText.length - suffixLength);

  const leftHtml = `${escapeHtml(leftText.slice(0, prefixLength))}${leftChangedEnd > prefixLength ? `<span class="diff-highlight-del">${escapeHtml(leftText.slice(prefixLength, leftChangedEnd))}</span>` : ''}${escapeHtml(leftText.slice(leftChangedEnd))}`;
  const rightHtml = `${escapeHtml(rightText.slice(0, prefixLength))}${rightChangedEnd > prefixLength ? `<span class="diff-highlight-add">${escapeHtml(rightText.slice(prefixLength, rightChangedEnd))}</span>` : ''}${escapeHtml(rightText.slice(rightChangedEnd))}`;

  return { leftHtml, rightHtml };
}

function createPairedBlocks(lines = []) {
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.type === 'context' || line.type === 'note') {
      blocks.push({ additions: [], context: [line], deletions: [] });
      continue;
    }

    if (line.type !== 'deletion' && line.type !== 'addition') {
      continue;
    }

    const deletions = [];
    const additions = [];

    while (index < lines.length && lines[index].type === 'deletion') {
      deletions.push(lines[index]);
      index += 1;
    }

    while (index < lines.length && lines[index].type === 'addition') {
      additions.push(lines[index]);
      index += 1;
    }

    index -= 1;
    blocks.push({ additions, context: [], deletions });
  }

  return blocks;
}

function renderUnifiedLine(line, prefix, contentHtml) {
  const oldLine = Number.isInteger(line.oldLine) ? line.oldLine : '';
  const newLine = Number.isInteger(line.newLine) ? line.newLine : '';
  const lineClass = line.type === 'note' ? 'note' : line.type;
  const renderedPrefix = line.type === 'context' || line.type === 'note' ? ' ' : prefix;

  return `
    <div class="diff-line ${lineClass}">
      <div class="diff-line-numbers">
        <span class="diff-line-num">${oldLine}</span>
        <span class="diff-line-num">${newLine}</span>
      </div>
      <div class="diff-line-prefix">${escapeHtml(renderedPrefix)}</div>
      <div class="diff-line-content">${contentHtml}</div>
    </div>
  `;
}

function renderSplitRow(leftLine, rightLine) {
  let leftHtml = leftLine ? escapeHtml(leftLine.content) : '';
  let rightHtml = rightLine ? escapeHtml(rightLine.content) : '';

  if (leftLine && rightLine && leftLine.type === 'deletion' && rightLine.type === 'addition') {
    const highlighted = highlightPair(leftLine.content, rightLine.content);
    leftHtml = highlighted.leftHtml;
    rightHtml = highlighted.rightHtml;
  }

  return `
    <div class="diff-split-row">
      <div class="diff-split-line ${leftLine?.type || 'empty'}">
        <span class="diff-split-num">${Number.isInteger(leftLine?.oldLine) ? leftLine.oldLine : ''}</span>
        <span class="diff-split-content">${leftHtml}</span>
      </div>
      <div class="diff-split-line ${rightLine?.type || 'empty'}">
        <span class="diff-split-num">${Number.isInteger(rightLine?.newLine) ? rightLine.newLine : ''}</span>
        <span class="diff-split-content">${rightHtml}</span>
      </div>
    </div>
  `;
}

export class GitDiffViewController {
  constructor({
    getTheme = () => 'dark',
    gitApiClient = null,
    onBackToHistory = null,
    onCommitStaged = null,
    onOpenFile = null,
    onStageFile = null,
    onUnstageFile = null,
    toastController = null,
    vaultApiClient = null,
  } = {}) {
    this.getTheme = getTheme;
    this.gitApiClient = gitApiClient;
    this.onBackToHistory = onBackToHistory;
    this.onCommitStaged = onCommitStaged;
    this.onOpenFile = onOpenFile;
    this.onStageFile = onStageFile;
    this.onUnstageFile = onUnstageFile;
    this.toastController = toastController;
    this.vaultApiClient = vaultApiClient;
    this.page = document.getElementById('diff-page');
    this.content = document.getElementById('diffContent');
    this.scrollContainer = document.getElementById('diffScroll');
    this.fileIndicator = document.getElementById('diffFileIndicator');
    this.openEditorButton = document.getElementById('diffOpenEditorBtn');
    this.primaryActionButton = document.getElementById('diffPrimaryActionBtn');
    this.commitButton = document.getElementById('diffCommitBtn');
    this.backToHistoryButton = document.getElementById('diffBackToHistoryBtn');
    this.gitActionsGroup = document.getElementById('diffGitActionsGroup');
    this.editorActionsGroup = document.getElementById('diffEditorActionsGroup');
    this.actionsDivider = document.getElementById('diffToolbarDivider');
    this.stats = document.getElementById('diffStats');
    this.prevButton = document.getElementById('diffPrevBtn');
    this.nextButton = document.getElementById('diffNextBtn');
    this.layoutToggle = document.getElementById('diffLayoutToggle');
    this.modeButtons = Array.from(document.querySelectorAll('[data-diff-mode]'));
    this.layoutButtons = Array.from(document.querySelectorAll('[data-diff-layout]'));
    this.isActive = false;
    this.mode = 'unified';
    this.layoutMode = 'focused';
    this.source = 'workspace';
    this.data = null;
    this.currentIndex = 0;
    this.activeFilePath = null;
    this.workspaceFilePath = null;
    this.fileCache = new Map();
    this.fileErrors = new Map();
    this.loadingFiles = new Set();
    this.collapsedFiles = new Set();
    this.fileLoadPromises = new Map();
    this.excalidrawPreviewPayloads = new Map();
    this.excalidrawPreviewCounter = 0;
    this.drawioPreviewPayloads = new Map();
    this.drawioPreviewCounter = 0;
    this.requestScope = 'all';
    this.commitHash = null;
    this.commitBaseRef = null;
    this.commitMeta = null;
    this.historyFilePath = null;
    this.pendingAction = null;
    this.repoStatus = null;
  }

  initialize() {
    this.prevButton?.addEventListener('click', () => {
      if (!this.isActive) {
        return;
      }
      this.navigateFile(-1);
    });
    this.nextButton?.addEventListener('click', () => {
      if (!this.isActive) {
        return;
      }
      this.navigateFile(1);
    });
    this.backToHistoryButton?.addEventListener('click', () => {
      if (!this.isActive) {
        return;
      }
      if (!this.commitMeta?.hash) {
        return;
      }
      this.onBackToHistory?.({
        hash: this.commitMeta.hash,
        historyFilePath: this.historyFilePath,
      });
    });
    this.openEditorButton?.addEventListener('click', () => {
      if (!this.isActive) {
        return;
      }
      if (this.source !== 'workspace') {
        return;
      }

      const filePath = this.getCurrentFile()?.path ?? this.workspaceFilePath;
      if (!filePath) {
        return;
      }

      this.onOpenFile?.(filePath);
    });
    this.primaryActionButton?.addEventListener('click', () => {
      if (!this.isActive) {
        return;
      }
      const action = this.getPrimaryAction();
      if (!action) {
        return;
      }

      void this.handleFileAction(action);
    });
    this.commitButton?.addEventListener('click', () => {
      if (!this.isActive) {
        return;
      }
      void this.handleFileAction('commit');
    });
    this.content?.addEventListener('click', (event) => {
      if (!this.isActive) {
        return;
      }
      const loadButton = event.target instanceof Element
        ? event.target.closest('[data-load-full-diff]')
        : null;
      if (loadButton) {
        const filePath = loadButton.getAttribute('data-diff-file-path') || this.activeFilePath;
        if (filePath) {
          void this.loadFileForPath(filePath, { forceFullPatch: true });
        }
        return;
      }

      const toggleButton = event.target instanceof Element
        ? event.target.closest('[data-diff-section-toggle]')
        : null;
      if (toggleButton) {
        const filePath = toggleButton.getAttribute('data-diff-section-toggle');
        if (filePath) {
          void this.toggleFileSection(filePath);
        }
        return;
      }

      const indexButton = event.target instanceof Element
        ? event.target.closest('[data-diff-index-path]')
        : null;
      if (indexButton) {
        const filePath = indexButton.getAttribute('data-diff-index-path');
        if (filePath) {
          void this.handleIndexSelection(filePath);
        }
      }
    });
    this.modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.isActive) {
          return;
        }
        const nextMode = button.getAttribute('data-diff-mode');
        if (!nextMode || nextMode === this.mode) {
          return;
        }
        this.mode = nextMode;
        this.render();
      });
    });
    this.layoutButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.isActive) {
          return;
        }
        const nextLayout = button.getAttribute('data-diff-layout');
        if (!nextLayout || nextLayout === this.layoutMode) {
          return;
        }
        void this.setLayoutMode(nextLayout);
      });
    });
    this.scrollContainer?.addEventListener('scroll', () => {
      if (!this.isActive) {
        return;
      }
      this.handleScrollSelection();
    });
  }

  hide() {
    this.isActive = false;
    this.page?.classList.add('hidden');
    if (this.content) {
      this.content.innerHTML = '';
    }
    this.data = null;
    this.source = 'workspace';
    this.layoutMode = 'focused';
    this.currentIndex = 0;
    this.activeFilePath = null;
    this.workspaceFilePath = null;
    this.fileCache.clear();
    this.fileErrors.clear();
    this.loadingFiles.clear();
    this.collapsedFiles.clear();
    this.fileLoadPromises.clear();
    this.excalidrawPreviewPayloads.clear();
    this.drawioPreviewPayloads.clear();
    this.requestScope = 'all';
    this.commitHash = null;
    this.commitBaseRef = null;
    this.commitMeta = null;
    this.historyFilePath = null;
    this.pendingAction = null;
  }

  async openWorkspaceDiff({ filePath = null, scope = 'all' } = {}) {
    this.isActive = true;
    this.source = 'workspace';
    this.layoutMode = 'focused';
    this.commitHash = null;
    this.commitBaseRef = null;
    this.commitMeta = null;
    this.historyFilePath = null;
    this.activeFilePath = filePath;
    this.workspaceFilePath = filePath;
    this.fileCache.clear();
    this.fileErrors.clear();
    this.loadingFiles.clear();
    this.collapsedFiles.clear();
    this.fileLoadPromises.clear();
    this.excalidrawPreviewPayloads.clear();
    this.drawioPreviewPayloads.clear();
    this.requestScope = scope;
    this.renderLoading('Loading diff summary…');

    try {
      const data = await this.gitApiClient.readDiff({
        metaOnly: true,
        path: filePath,
        scope,
      });
      this.data = data;
      const initialIndex = filePath
        ? Math.max(0, data.files.findIndex((file) => file.path === filePath))
        : 0;
      this.currentIndex = initialIndex;
      this.activeFilePath = data.files?.[initialIndex]?.path ?? null;
      if ((data.files?.length ?? 0) === 0) {
        this.render();
        return data;
      }

      await this.loadCurrentFile();
      return data;
    } catch (error) {
      console.error('[git-diff] Failed to load diff:', error);
      this.toastController?.show('Failed to load git diff');
      this.data = {
        files: [],
        metaOnly: false,
        source: 'workspace',
        summary: { additions: 0, deletions: 0, filesChanged: 0 },
      };
      this.renderEmpty('Failed to load git diff', { alert: true });
      return this.data;
    }
  }

  async openCommitDiff({ hash, path = null, historyFilePath = null } = {}) {
    this.isActive = true;
    this.source = 'commit';
    this.layoutMode = 'stacked';
    this.commitHash = String(hash ?? '').trim() || null;
    this.commitBaseRef = null;
    this.commitMeta = null;
    this.historyFilePath = String(historyFilePath ?? '').trim() || null;
    this.activeFilePath = path || null;
    this.workspaceFilePath = null;
    this.fileCache.clear();
    this.fileErrors.clear();
    this.loadingFiles.clear();
    this.collapsedFiles.clear();
    this.fileLoadPromises.clear();
    this.excalidrawPreviewPayloads.clear();
    this.drawioPreviewPayloads.clear();
    this.requestScope = 'all';
    this.renderLoading('Loading commit summary…');

    try {
      const data = await this.gitApiClient.readCommit({
        hash: this.commitHash || '',
        metaOnly: true,
      });
      this.data = data;
      this.commitMeta = data.commit ?? null;
      this.commitBaseRef = data.baseRef || null;
      const initialIndex = path
        ? Math.max(0, data.files.findIndex((file) => file.path === path))
        : 0;
      this.currentIndex = initialIndex;
      this.activeFilePath = data.files?.[initialIndex]?.path ?? null;
      this.collapsedFiles = new Set(
        (data.files ?? [])
          .map((file) => file.path)
          .filter((filePath) => filePath && filePath !== this.activeFilePath),
      );
      if ((data.files?.length ?? 0) === 0) {
        this.render();
        return data;
      }

      if (this.activeFilePath) {
        await this.loadFileForPath(this.activeFilePath, { render: false });
      }
      this.render();
      return data;
    } catch (error) {
      console.error('[git-diff] Failed to load commit:', error);
      this.toastController?.show('Failed to load git commit');
      this.data = {
        commit: null,
        files: [],
        metaOnly: false,
        source: 'commit',
        summary: { additions: 0, deletions: 0, filesChanged: 0 },
      };
      this.commitMeta = null;
      this.renderEmpty('Failed to load git commit', { alert: true });
      return this.data;
    }
  }

  async open(payload = {}) {
    return this.openWorkspaceDiff(payload);
  }

  async setLayoutMode(layoutMode) {
    const normalizedLayout = layoutMode === 'stacked' ? 'stacked' : 'focused';
    if (this.source !== 'commit') {
      this.layoutMode = 'focused';
      this.render();
      return;
    }

    this.layoutMode = normalizedLayout;
    if (this.activeFilePath) {
      this.setActiveFilePath(this.activeFilePath);
    }
    if (this.layoutMode === 'focused') {
      await this.loadCurrentFile();
      return;
    }

    if (this.activeFilePath) {
      this.collapsedFiles.delete(this.activeFilePath);
      await this.loadFileForPath(this.activeFilePath, { render: false });
    }
    this.render();
  }

  navigateFile(direction) {
    if (!this.data?.files?.length || (this.source === 'commit' && this.layoutMode === 'stacked')) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(this.currentIndex + direction, this.data.files.length - 1));
    if (nextIndex === this.currentIndex) {
      return;
    }

    this.currentIndex = nextIndex;
    this.activeFilePath = this.data.files[nextIndex]?.path ?? null;
    this.scrollContainer?.scrollTo({ top: 0, behavior: 'auto' });
    void this.loadCurrentFile();
  }

  renderLoading(message = 'Loading git diff…') {
    if (!this.isActive) {
      return;
    }
    this.page?.classList.remove('hidden');
    if (this.content) {
      // pi-lens-ignore: ast-grep:no-inner-html-js
      this.content.innerHTML = `<div class="diff-empty-state" role="status" aria-live="polite">${escapeHtml(message)}</div>`;
    }
    this.data = null;
    this.syncToolbar();
  }

  renderEmpty(message, { alert = false } = {}) {
    if (!this.isActive) {
      return;
    }
    this.page?.classList.remove('hidden');
    if (this.content) {
      // pi-lens-ignore: ast-grep:no-inner-html-js
      this.content.innerHTML = `<div class="diff-empty-state"${alert ? ' role="alert"' : ''}>${escapeHtml(message)}</div>`;
    }
    this.syncToolbar();
  }

  renderUnifiedHunk(hunk) {
    const markup = [];
    for (const block of createPairedBlocks(hunk.lines)) {
      if (block.context.length > 0) {
        for (const line of block.context) {
          markup.push(renderUnifiedLine(line, ' ', escapeHtml(line.content)));
        }
        continue;
      }

      const pairCount = Math.max(block.deletions.length, block.additions.length);
      for (let index = 0; index < pairCount; index += 1) {
        const deletion = block.deletions[index] ?? null;
        const addition = block.additions[index] ?? null;
        const highlighted = deletion && addition
          ? highlightPair(deletion.content, addition.content)
          : null;

        if (deletion) {
          markup.push(renderUnifiedLine(deletion, '-', highlighted?.leftHtml ?? escapeHtml(deletion.content)));
        }

        if (addition) {
          markup.push(renderUnifiedLine(addition, '+', highlighted?.rightHtml ?? escapeHtml(addition.content)));
        }
      }
    }

    return `
      <div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>
      ${markup.join('')}
    `;
  }

  getGitImageUrl(hash, filePath) {
    if (!hash || !filePath) {
      return '';
    }

    if (typeof this.gitApiClient?.getFileAttachmentUrl === 'function') {
      return this.gitApiClient.getFileAttachmentUrl({ hash, path: filePath });
    }

    return resolveApiUrl(`/git/file-attachment?hash=${encodeURIComponent(hash)}&path=${encodeURIComponent(filePath)}`);
  }

  getCurrentImageUrl(filePath) {
    if (!filePath) {
      return '';
    }

    return resolveApiUrl(`/attachment?path=${encodeURIComponent(filePath)}`);
  }

  getImageDiffSources(file) {
    const isAdded = file.status === 'added' || file.status === 'untracked';
    const isDeleted = file.status === 'deleted';
    const oldPath = file.oldPath || file.path;
    const newPath = file.path;

    if (this.source === 'commit') {
      return {
        after: isDeleted ? '' : this.getGitImageUrl(this.commitHash, newPath),
        before: isAdded ? '' : this.getGitImageUrl(this.commitBaseRef, oldPath),
      };
    }

    return {
      after: isDeleted ? '' : this.getCurrentImageUrl(newPath),
      before: isAdded ? '' : this.getGitImageUrl('HEAD', oldPath),
    };
  }

  renderImagePane({ file, label, source, emptyLabel }) {
    const imageMarkup = source
      ? `<img class="diff-media-image" src="${escapeHtml(source)}" alt="${escapeHtml(`${label} ${file.path}`)}" loading="lazy" decoding="async">`
      : `<div class="diff-media-empty"><span class="diff-media-empty-icon" aria-hidden="true">—</span><span>${escapeHtml(emptyLabel)}</span></div>`;

    return `
      <div class="diff-media-pane">
        <div class="diff-media-pane-header">
          <span class="diff-media-pane-label">${escapeHtml(label)}</span>
          <span class="diff-media-pane-meta">${escapeHtml(getImageFormat(file.path))}</span>
        </div>
        <div class="diff-media-canvas">${imageMarkup}</div>
      </div>
    `;
  }

  renderImageDiff(file) {
    const sources = this.getImageDiffSources(file);
    const sizeLabel = formatByteLength(file.byteLength);
    return `
      <section class="diff-special diff-media-diff" aria-label="Image diff">
        <div class="diff-special-header">
          <div>
            <span class="diff-special-eyebrow">Binary preview</span>
            <h2 class="diff-special-title">Image comparison</h2>
          </div>
          <span class="diff-special-note">${escapeHtml(getImageFormat(file.path))}${sizeLabel ? ` · ${escapeHtml(sizeLabel)}` : ''}</span>
        </div>
        <div class="diff-media-grid">
          ${this.renderImagePane({
            emptyLabel: 'No previous image',
            file,
            label: 'Before',
            source: sources.before,
          })}
          ${this.renderImagePane({
            emptyLabel: 'No image in this revision',
            file,
            label: 'After',
            source: sources.after,
          })}
        </div>
        <p class="diff-special-footnote">Image bytes are shown as a visual comparison instead of a text patch.</p>
      </section>
    `;
  }

  registerExcalidrawPreview(scene) {
    if (!scene) {
      return '';
    }

    this.excalidrawPreviewCounter += 1;
    const id = `diff-excalidraw-preview-${this.excalidrawPreviewCounter.toString(36)}`;
    this.excalidrawPreviewPayloads.set(id, scene);
    return id;
  }

  renderExcalidrawPane({ label, scene, source, emptyLabel }) {
    const previewId = this.registerExcalidrawPreview(scene);
    const previewMarkup = scene
      ? `
        <div class="diff-excalidraw-preview" data-diff-excalidraw-preview="${escapeHtml(previewId)}">
          <span class="diff-excalidraw-preview-loading">Rendering diagram…</span>
        </div>
      `
      : `<div class="diff-excalidraw-preview diff-excalidraw-preview--empty"><span>${escapeHtml(emptyLabel)}</span></div>`;
    const sourceMarkup = source
      ? `
        <details class="diff-excalidraw-source">
          <summary>Structured scene</summary>
          <pre>${escapeHtml(source)}</pre>
        </details>
      `
      : '';

    return `
      <div class="diff-excalidraw-pane">
        <div class="diff-excalidraw-pane-header">
          <span class="diff-media-pane-label">${escapeHtml(label)}</span>
          <span class="diff-media-pane-meta">${scene ? `${getVisibleSceneElements(scene).length} elements` : '—'}</span>
        </div>
        ${previewMarkup}
        ${sourceMarkup}
      </div>
    `;
  }

  renderExcalidrawDiff(file) {
    const scenes = getExcalidrawSceneSources(file);
    const changeSummary = summarizeExcalidrawChange(scenes.before, scenes.after);
    const stats = changeSummary ?? {
      added: 0,
      afterCount: 0,
      beforeCount: 0,
      removed: 0,
      updated: 0,
    };
    const hasSceneData = Boolean(scenes.before || scenes.after);
    const loadButton = file.tooLarge && file.canLoadFullPatch
      ? `<button class="${buttonClassNames({ variant: 'secondary', extra: 'diff-load-full-btn' })}" type="button" data-load-full-diff data-diff-file-path="${escapeHtml(file.path)}">Load full diff</button>`
      : '';

    return `
      <section class="diff-special diff-excalidraw-diff" aria-label="Excalidraw diff">
        <div class="diff-special-header">
          <div>
            <span class="diff-special-eyebrow">Diagram-aware preview</span>
            <h2 class="diff-special-title">Excalidraw scene changes</h2>
          </div>
          <span class="diff-special-note">${hasSceneData ? `${stats.afterCount} visible elements` : 'Scene preview unavailable'}</span>
        </div>
        <div class="diff-scene-summary" aria-label="Scene change summary">
          <span class="diff-scene-stat diff-scene-stat--add"><strong>+${stats.added}</strong><span>added</span></span>
          <span class="diff-scene-stat diff-scene-stat--update"><strong>~${stats.updated}</strong><span>updated</span></span>
          <span class="diff-scene-stat diff-scene-stat--remove"><strong>-${stats.removed}</strong><span>removed</span></span>
        </div>
        <div class="diff-excalidraw-grid">
          ${this.renderExcalidrawPane({
            emptyLabel: 'No previous scene',
            label: 'Before',
            scene: scenes.before,
            source: scenes.beforeSource ? JSON.stringify(scenes.before || parseExcalidrawScene(scenes.beforeSource), null, 2) : '',
          })}
          ${this.renderExcalidrawPane({
            emptyLabel: file.tooLarge ? 'Load the full diff to preview this scene' : 'No scene in this revision',
            label: 'After',
            scene: scenes.after,
            source: scenes.afterSource ? JSON.stringify(scenes.after || parseExcalidrawScene(scenes.afterSource), null, 2) : '',
          })}
        </div>
        ${loadButton}
        <p class="diff-special-footnote">The preview compares drawable elements by id; expand “Structured scene” when you need the underlying JSON.</p>
      </section>
    `;
  }

  async readDrawioSource({ hash = null, path = null, current = false } = {}) {
    if (!path) {
      return '';
    }

    try {
      if (current) {
        const response = await this.vaultApiClient?.readFile?.(path);
        return typeof response?.content === 'string' ? response.content : '';
      }

      if (!hash || typeof this.gitApiClient?.readFileSnapshot !== 'function') {
        return '';
      }

      const response = await this.gitApiClient.readFileSnapshot({ hash, path });
      return typeof response?.content === 'string' ? response.content : '';
    } catch {
      return '';
    }
  }

  async enrichDrawioDetail(detail) {
    const sources = getDrawioSourcePair(detail);
    let beforeSource = sources.before;
    let afterSource = sources.after;
    const isAdded = detail.status === 'added' || detail.status === 'untracked';
    const isDeleted = detail.status === 'deleted';
    const beforePath = detail.oldPath || detail.path;
    const afterPath = detail.path;

    if (!isAdded && !hasDrawioSourceRoot(beforeSource)) {
      beforeSource = await this.readDrawioSource({
        current: false,
        hash: this.source === 'commit' ? this.commitBaseRef : 'HEAD',
        path: beforePath,
      });
    }

    if (!isDeleted && !hasDrawioSourceRoot(afterSource)) {
      afterSource = await this.readDrawioSource({
        current: this.source !== 'commit',
        hash: this.source === 'commit' ? this.commitHash : null,
        path: afterPath,
      });
    }

    return {
      ...detail,
      drawioAfterSource: afterSource,
      drawioBeforeSource: beforeSource,
    };
  }

  registerDrawioPreview(source) {
    if (!source) {
      return '';
    }

    this.drawioPreviewCounter += 1;
    const id = `diff-drawio-preview-${this.drawioPreviewCounter.toString(36)}`;
    this.drawioPreviewPayloads.set(id, source);
    return id;
  }

  renderDrawioPane({ emptyLabel, label, source }) {
    const isEmptyModel = isEmptyDrawioModel(source);
    const previewId = isEmptyModel ? '' : this.registerDrawioPreview(source);
    const previewMarkup = source && !isEmptyModel
      ? `
        <div class="diff-drawio-preview" data-diff-drawio-preview="${escapeHtml(previewId)}">
          <span class="diff-drawio-preview-loading">Rendering draw.io preview…</span>
        </div>
      `
      : `<div class="diff-drawio-preview diff-drawio-preview--empty"><span>${escapeHtml(isEmptyModel ? 'No drawable cells' : emptyLabel)}</span></div>`;
    const sourceMarkup = source
      ? `
        <details class="diff-drawio-source">
          <summary>XML source</summary>
          <pre>${escapeHtml(formatDrawioSource(source))}</pre>
        </details>
      `
      : '';

    return `
      <div class="diff-drawio-pane">
        <div class="diff-drawio-pane-header">
          <span class="diff-media-pane-label">${escapeHtml(label)}</span>
          <span class="diff-media-pane-meta">draw.io</span>
        </div>
        ${previewMarkup}
        ${sourceMarkup}
      </div>
    `;
  }

  renderDrawioDiff(file) {
    const sources = getDrawioSourcePair(file);
    const changeSummary = summarizeDrawioChange(sources.before, sources.after);
    const stats = changeSummary ?? {
      added: 0,
      afterCount: 0,
      beforeCount: 0,
      cellBased: false,
      removed: 0,
      updated: 0,
    };
    const hasSource = Boolean(sources.before || sources.after);
    const countLabel = !hasSource
      ? 'Preview unavailable'
      : stats.cellBased
        ? `${stats.afterCount} drawable cells`
        : 'Source-level comparison';
    const loadButton = file.tooLarge && file.canLoadFullPatch
      ? `<button class="${buttonClassNames({ variant: 'secondary', extra: 'diff-load-full-btn' })}" type="button" data-load-full-diff data-diff-file-path="${escapeHtml(file.path)}">Load full diff</button>`
      : '';

    return `
      <section class="diff-special diff-drawio-diff" aria-label="draw.io diff">
        <div class="diff-special-header">
          <div>
            <span class="diff-special-eyebrow">Diagram-aware preview</span>
            <h2 class="diff-special-title">draw.io diagram changes</h2>
          </div>
          <span class="diff-special-note">${escapeHtml(countLabel)}</span>
        </div>
        <div class="diff-scene-summary" aria-label="draw.io change summary">
          <span class="diff-scene-stat diff-scene-stat--add"><strong>+${stats.added}</strong><span>added</span></span>
          <span class="diff-scene-stat diff-scene-stat--update"><strong>~${stats.updated}</strong><span>updated</span></span>
          <span class="diff-scene-stat diff-scene-stat--remove"><strong>-${stats.removed}</strong><span>removed</span></span>
        </div>
        <div class="diff-drawio-grid">
          ${this.renderDrawioPane({
            emptyLabel: 'No previous diagram',
            label: 'Before',
            source: sources.before,
          })}
          ${this.renderDrawioPane({
            emptyLabel: file.tooLarge ? 'Load the full diff to preview this diagram' : 'No diagram in this revision',
            label: 'After',
            source: sources.after,
          })}
        </div>
        ${loadButton}
        <p class="diff-special-footnote">Both revisions use the draw.io viewer; expand “XML source” when you need the underlying document.</p>
      </section>
    `;
  }

  async hydrateExcalidrawPreviews() {
    if (this.excalidrawPreviewPayloads.size === 0 || !this.content) {
      return;
    }

    let exportToSvg;
    try {
      ({ exportToSvg } = await import('@excalidraw/excalidraw'));
    } catch (error) {
      console.warn('[git-diff] Excalidraw preview renderer unavailable:', error);
      return;
    }

    for (const [previewId, scene] of this.excalidrawPreviewPayloads) {
      const preview = this.content.querySelector?.(`[data-diff-excalidraw-preview="${previewId}"]`);
      if (!preview) {
        continue;
      }

      try {
        const svg = await exportToSvg(createExcalidrawExportOptions(scene));
        preview.replaceChildren(svg);
        preview.classList.add('is-ready');
      } catch (error) {
        console.warn('[git-diff] Failed to render Excalidraw scene preview:', error);
        preview.textContent = 'Visual preview unavailable';
        preview.classList.add('is-error');
      }
    }
  }

  async hydrateDrawioPreviews() {
    if (this.drawioPreviewPayloads.size === 0 || !this.content) {
      return;
    }

    for (const [previewId, source] of this.drawioPreviewPayloads) {
      const preview = this.content.querySelector?.(`[data-diff-drawio-preview="${previewId}"]`);
      if (!preview) {
        continue;
      }

      try {
        await renderDrawioViewer(preview, {
          ariaLabel: 'draw.io diagram diff preview',
          className: 'mxgraph drawio-viewer-frame diff-drawio-viewer-frame',
          source,
          theme: this.getTheme?.() === 'light' ? 'light' : 'dark',
        });
        preview.classList.add('is-ready');
      } catch (error) {
        console.warn('[git-diff] Failed to render draw.io diagram preview:', error);
        preview.textContent = 'Visual preview unavailable';
        preview.classList.add('is-error');
      }
    }
  }

  renderFileHeader(file) {
    const fileKind = getDiffFileKind(file);
    const headerStats = fileKind === 'image'
      ? `<span class="diff-file-header-kind">${escapeHtml(getImageFormat(file.path))} image</span>`
      : `<span class="diff-file-header-stats"><span class="ui-stat-token ui-stat-token--add diff-stats-add">+${file.stats?.additions ?? 0}</span><span class="ui-stat-token ui-stat-token--del diff-stats-del">-${file.stats?.deletions ?? 0}</span></span>`;
    const inclusionStatus = file.hasStagedChanges
      ? '<span class="ui-pill-badge ui-pill-badge--muted" aria-label="Included in next commit">✓ Included</span>'
      : '';
    return `
      <div class="diff-file-header">
        <span class="diff-file-path">${escapeHtml(file.path)}</span>
        <span class="ui-status-badge ${badgeClass(file.status)}">${escapeHtml(file.status)}</span>
        ${inclusionStatus}
        ${headerStats}
      </div>
    `;
  }

  renderUnifiedFileBody(file) {
    return `
      ${file.isBinary ? `<div class="diff-binary-message">${escapeHtml(file.binaryMessage || 'Binary file changed')}</div>` : ''}
      ${file.hunks.map((hunk) => this.renderUnifiedHunk(hunk)).join('')}
    `;
  }

  renderSplitFileBody(file) {
    const hunks = file.hunks.map((hunk) => {
      const rows = [];
      for (const block of createPairedBlocks(hunk.lines)) {
        if (block.context.length > 0) {
          for (const line of block.context) {
            rows.push(renderSplitRow(line, line));
          }
          continue;
        }

        const count = Math.max(block.deletions.length, block.additions.length);
        for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
          rows.push(renderSplitRow(block.deletions[rowIndex] ?? null, block.additions[rowIndex] ?? null));
        }
      }

      return `
        <div class="diff-split-hunk">${escapeHtml(hunk.header)}</div>
        ${rows.join('')}
      `;
    }).join('');

    return `
      <div class="diff-split">
        <div class="diff-split-pane">
          <div class="diff-split-pane-header">Before</div>
          ${hunks}
        </div>
      </div>
    `;
  }

  renderDiffDetail(detail, index, { includeHeader = true } = {}) {
    if (!detail) {
      return '<div class="diff-empty-state">Select a file to load its diff.</div>';
    }

    const fileKind = getDiffFileKind(detail);
    if (fileKind === 'image') {
      return `${includeHeader ? this.renderFileHeader(detail) : ''}${this.renderImageDiff(detail)}`;
    }

    if (fileKind === 'excalidraw') {
      return `${includeHeader ? this.renderFileHeader(detail) : ''}${this.renderExcalidrawDiff(detail)}`;
    }

    if (fileKind === 'drawio') {
      return `${includeHeader ? this.renderFileHeader(detail) : ''}${this.renderDrawioDiff(detail)}`;
    }

    if (detail.tooLarge) {
      return `
        ${includeHeader ? this.renderFileHeader(detail) : ''}
        <div class="diff-limit-card">
          <strong>Large diff withheld</strong>
          <span>This file diff is large enough to impact rendering performance.</span>
          <button class="${buttonClassNames({ variant: 'secondary', extra: 'diff-load-full-btn' })}" type="button" data-load-full-diff data-diff-file-path="${escapeHtml(detail.path)}">Load full diff</button>
        </div>
      `;
    }

    const contentMarkup = this.mode === 'split'
      ? this.renderSplitFileBody(detail, index)
      : this.renderUnifiedFileBody(detail, index);

    return `${includeHeader ? this.renderFileHeader(detail) : ''}${contentMarkup}`;
  }

  renderFocusedFileBody() {
    const currentFile = this.getCurrentFile();
    if (!currentFile) {
      return '<div class="diff-empty-state">No changes to display.</div>';
    }

    if (this.isFileLoading(currentFile.path)) {
      return `
        <section class="diff-file-block">
          ${this.renderFileHeader(currentFile)}
          <div class="diff-empty-state" role="status" aria-live="polite">Loading file diff…</div>
        </section>
      `;
    }

    const errorMessage = this.fileErrors.get(currentFile.path);
    if (errorMessage) {
      return `
        <section class="diff-file-block">
          ${this.renderFileHeader(currentFile)}
          <div class="diff-empty-state" role="alert">${escapeHtml(errorMessage)}</div>
        </section>
      `;
    }

    return `
      <section class="diff-file-block" data-diff-file-index="${this.currentIndex}">
        ${this.renderDiffDetail(this.getFileDetail(currentFile.path) ?? currentFile, this.currentIndex)}
      </section>
    `;
  }

  renderCommitHeader() {
    if (this.source !== 'commit' || !this.commitMeta) {
      return '';
    }

    return `
      <section class="diff-commit-header">
        <div class="diff-commit-subject">${escapeHtml(this.commitMeta.subject || this.commitMeta.shortHash || 'Commit')}</div>
        <div class="diff-commit-meta">
          <span>${escapeHtml(this.commitMeta.shortHash || '')}</span>
          <span>${escapeHtml(this.commitMeta.authorName || 'Unknown')}</span>
          <span title="${escapeHtml(this.commitMeta.authoredAt || '')}">${escapeHtml(this.commitMeta.relativeDateLabel || '')}</span>
          ${this.commitMeta.isMergeCommit ? '<span>Merge commit</span>' : ''}
        </div>
        <div class="diff-commit-meta diff-commit-meta-secondary">
          <span>${escapeHtml(this.commitMeta.hash || '')}</span>
          <span>${Number(this.data?.summary?.filesChanged || 0)} file${Number(this.data?.summary?.filesChanged || 0) === 1 ? '' : 's'}</span>
        </div>
      </section>
    `;
  }

  renderCommitIndex() {
    const files = this.data?.files ?? [];
    const items = files.map((file, index) => {
      const isActive = this.activeFilePath === file.path;
      const dirPath = getVaultPathParent(file.path);
      return `
        <button
          class="ui-record-surface diff-index-item${isActive ? ' active' : ''}"
          type="button"
          data-diff-index-path="${escapeHtml(file.path)}"
          aria-current="${isActive ? 'true' : 'false'}"
        >
          <span class="ui-record-header diff-index-item-top">
            <span class="ui-record-title diff-index-item-name">${escapeHtml(getVaultPathLeaf(file.path))}</span>
            <span class="ui-status-badge ${badgeClass(file.status)}">${escapeHtml(file.status)}</span>
          </span>
          ${dirPath ? `<span class="ui-record-subtitle diff-index-item-path">${escapeHtml(dirPath)}</span>` : ''}
          <span class="ui-record-meta diff-index-item-meta">
            <span>${index + 1}</span>
            <span class="ui-stat-token ui-stat-token--add diff-stats-add">+${file.stats?.additions ?? 0}</span>
            <span class="ui-stat-token ui-stat-token--del diff-stats-del">-${file.stats?.deletions ?? 0}</span>
          </span>
        </button>
      `;
    }).join('');

    return `
      <aside class="diff-commit-index" aria-label="Changed files in commit">
        <div class="diff-commit-index-header">Changed Files</div>
        <div class="diff-commit-index-list">
          ${items}
        </div>
      </aside>
    `;
  }

  renderStackedSection(file, index) {
    const isCollapsed = this.isFileCollapsed(file.path);
    const isActive = this.activeFilePath === file.path;
    const isLoading = this.isFileLoading(file.path);
    const errorMessage = this.fileErrors.get(file.path);
    const detail = this.getFileDetail(file.path) ?? file;

    const bodyMarkup = isCollapsed
      ? ''
      : isLoading
        ? '<div class="diff-empty-state" role="status" aria-live="polite">Loading file diff…</div>'
        : errorMessage
          ? `<div class="diff-empty-state" role="alert">${escapeHtml(errorMessage)}</div>`
          : this.renderDiffDetail(detail, index, { includeHeader: false });

    return `
      <section
        class="diff-commit-section${isActive ? ' active' : ''}${isCollapsed ? ' collapsed' : ''}"
        id="${createSectionId(file.path)}"
        data-diff-section-path="${escapeHtml(file.path)}"
      >
        <button
          class="diff-commit-section-header"
          type="button"
          data-diff-section-toggle="${escapeHtml(file.path)}"
        >
          <span class="diff-commit-section-main">
            ${chevronSvg(isCollapsed)}
            <span class="diff-commit-section-copy">
              <span class="diff-commit-section-name">${escapeHtml(getVaultPathLeaf(file.path))}</span>
              ${getVaultPathParent(file.path) ? `<span class="diff-commit-section-path">${escapeHtml(getVaultPathParent(file.path))}</span>` : ''}
            </span>
          </span>
          <span class="diff-commit-section-meta">
            <span class="ui-status-badge ${badgeClass(file.status)}">${escapeHtml(file.status)}</span>
            <span class="ui-stat-token ui-stat-token--add diff-stats-add">+${file.stats?.additions ?? 0}</span>
            <span class="ui-stat-token ui-stat-token--del diff-stats-del">-${file.stats?.deletions ?? 0}</span>
          </span>
        </button>
        <div class="diff-commit-section-body${isCollapsed ? ' hidden' : ''}">
          ${bodyMarkup}
        </div>
      </section>
    `;
  }

  renderCommitBody() {
    if (this.layoutMode === 'focused') {
      return `
        <div class="diff-commit-shell diff-commit-shell-focused">
          ${this.renderCommitIndex()}
          <div class="diff-commit-main">
            ${this.renderFocusedFileBody()}
          </div>
        </div>
      `;
    }

    return `
      <div class="diff-commit-shell diff-commit-shell-stacked">
        ${this.renderCommitIndex()}
        <div class="diff-commit-main">
          <div class="diff-commit-sections">
            ${(this.data?.files ?? []).map((file, index) => this.renderStackedSection(file, index)).join('')}
          </div>
        </div>
      </div>
    `;
  }

  getCurrentFile() {
    const files = this.data?.files ?? [];
    if (files.length === 0) {
      return null;
    }

    return files[this.currentIndex] ?? files[0] ?? null;
  }

  getFileByPath(path) {
    return (this.data?.files ?? []).find((file) => file.path === path) ?? null;
  }

  setActiveFilePath(path, { syncIndex = true } = {}) {
    this.activeFilePath = path;
    if (!syncIndex) {
      return;
    }

    const nextIndex = Math.max(0, (this.data?.files ?? []).findIndex((file) => file.path === path));
    if (nextIndex >= 0) {
      this.currentIndex = nextIndex;
    }
  }

  getCacheKeyForPath(path) {
    if (!path) {
      return null;
    }
    if (this.source === 'commit') {
      return `commit:${this.commitHash}:${path}`;
    }
    return `workspace:${this.requestScope}:${path}`;
  }

  getCurrentCacheKey() {
    return this.getCacheKeyForPath(this.getCurrentFile()?.path ?? null);
  }

  getCurrentFileDetail() {
    const cacheKey = this.getCurrentCacheKey();
    return cacheKey ? this.fileCache.get(cacheKey) : null;
  }

  getFileDetail(path) {
    const cacheKey = this.getCacheKeyForPath(path);
    return cacheKey ? this.fileCache.get(cacheKey) : null;
  }

  isFileCollapsed(path) {
    return this.collapsedFiles.has(path);
  }

  isFileLoading(path) {
    return this.loadingFiles.has(path);
  }

  getCurrentActionState() {
    if (this.source === 'commit') {
      return {
        canCommit: false,
        canStage: false,
        canUnstage: false,
      };
    }

    const currentFile = this.getCurrentFile();
    const detail = this.getCurrentFileDetail() ?? currentFile;
    const stagedCount = Number(this.repoStatus?.summary?.staged || 0);
    if (!detail?.path) {
      return {
        canCommit: stagedCount > 0,
        canStage: false,
        canUnstage: false,
      };
    }

    return {
      canCommit: stagedCount > 0,
      canStage: Boolean(detail.hasWorkingTreeChanges || detail.hasUntrackedChanges),
      canUnstage: Boolean(detail.hasStagedChanges),
    };
  }

  getPrimaryAction() {
    if (this.source === 'commit') {
      return null;
    }

    const actionState = this.getCurrentActionState();
    if (actionState.canStage && !actionState.canUnstage) {
      return 'stage';
    }
    if (actionState.canUnstage && !actionState.canStage) {
      return 'unstage';
    }
    if (this.requestScope === 'staged' && actionState.canUnstage) {
      return 'unstage';
    }
    if (actionState.canStage) {
      return 'stage';
    }
    if (actionState.canUnstage) {
      return 'unstage';
    }
    return null;
  }

  async handleFileAction(action) {
    if (this.source === 'commit') {
      return;
    }

    const currentFile = this.getCurrentFile();
    if (!currentFile?.path || this.pendingAction) {
      return;
    }

    this.pendingAction = action;
    this.syncToolbar();

    try {
      if (action === 'stage') {
        await this.onStageFile?.(currentFile.path, { scope: this.requestScope });
      } else if (action === 'unstage') {
        await this.onUnstageFile?.(currentFile.path, { scope: this.requestScope });
      } else if (action === 'commit') {
        await this.onCommitStaged?.();
      }
    } finally {
      this.pendingAction = null;
      this.syncToolbar();
    }
  }

  setRepoStatus(status) {
    this.repoStatus = status;
    this.syncToolbar();
  }

  async handleIndexSelection(filePath) {
    const file = this.getFileByPath(filePath);
    if (!file) {
      return;
    }

    this.setActiveFilePath(filePath);
    if (this.source === 'commit' && this.layoutMode === 'stacked') {
      this.collapsedFiles.delete(filePath);
      await this.loadFileForPath(filePath, { render: false });
      this.render();
      this.scrollToFileSection(filePath);
      return;
    }

    await this.loadFileForPath(filePath);
  }

  async toggleFileSection(filePath) {
    if (this.source !== 'commit' || this.layoutMode !== 'stacked') {
      return;
    }

    this.setActiveFilePath(filePath);
    if (this.collapsedFiles.has(filePath)) {
      this.collapsedFiles.delete(filePath);
      await this.loadFileForPath(filePath, { render: false });
      this.render();
      this.scrollToFileSection(filePath);
      return;
    }

    this.collapsedFiles.add(filePath);
    this.render();
  }

  scrollToFileSection(filePath) {
    if (!this.content) {
      return;
    }

    const targetId = createSectionId(filePath);
    const scrollToTarget = () => {
      const section = document.getElementById?.(targetId) ?? null;
      if (!section) {
        return;
      }

      if (this.scrollContainer?.scrollTo && this.scrollContainer.getBoundingClientRect && section.getBoundingClientRect) {
        const containerRect = this.scrollContainer.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const currentTop = Number(this.scrollContainer.scrollTop) || 0;
        const nextTop = Math.max(0, currentTop + (sectionRect.top - containerRect.top) - 8);
        this.scrollContainer.scrollTo({ top: nextTop, behavior: 'smooth' });
        return;
      }

      section.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scrollToTarget);
      return;
    }

    setTimeout(scrollToTarget, 0);
  }

  handleScrollSelection() {
    if (this.source !== 'commit' || this.layoutMode !== 'stacked' || !this.scrollContainer || !this.content) {
      return;
    }

    const sections = Array.from(this.content.querySelectorAll?.('[data-diff-section-path]') ?? []);
    if (sections.length === 0) {
      return;
    }

    const containerRect = this.scrollContainer.getBoundingClientRect?.();
    if (!containerRect) {
      return;
    }

    const threshold = containerRect.top + 120;
    let nextPath = null;
    for (const section of sections) {
      const rect = section.getBoundingClientRect?.();
      if (!rect) {
        continue;
      }
      const sectionPath = section.getAttribute?.('data-diff-section-path');
      if (!sectionPath) {
        continue;
      }
      if (rect.top <= threshold) {
        nextPath = sectionPath;
      } else if (!nextPath) {
        nextPath = sectionPath;
        break;
      } else {
        break;
      }
    }

    if (nextPath && nextPath !== this.activeFilePath) {
      this.setActiveFilePath(nextPath);
      this.render();
    }
  }

  async loadCurrentFile({ forceFullPatch = false } = {}) {
    const currentFile = this.getCurrentFile();
    if (!currentFile?.path) {
      this.render();
      return null;
    }

    return this.loadFileForPath(currentFile.path, { forceFullPatch });
  }

  async loadFileForPath(filePath, { forceFullPatch = false, render = true } = {}) {
    const file = this.getFileByPath(filePath);
    if (!file?.path) {
      if (render) {
        this.render();
      }
      return null;
    }

    this.setActiveFilePath(filePath);
    const cacheKey = this.getCacheKeyForPath(filePath);
    const cachedFile = cacheKey ? this.fileCache.get(cacheKey) : null;
    if (cachedFile && (!cachedFile.tooLarge || !forceFullPatch)) {
      if (render) {
        this.render();
      }
      return cachedFile;
    }

    const requestKey = `${filePath}:${forceFullPatch ? 'full' : 'partial'}`;
    if (this.fileLoadPromises.has(requestKey)) {
      return this.fileLoadPromises.get(requestKey);
    }

    this.loadingFiles.add(filePath);
    this.fileErrors.delete(filePath);
    if (render) {
      this.render();
    }

    const requestPromise = (async () => {
      try {
        let detail;
        if (this.source === 'commit') {
          const data = await this.gitApiClient.readCommit({
            allowLargePatch: forceFullPatch,
            hash: this.commitHash || '',
            path: filePath,
          });
          detail = {
            ...file,
            ...(data.files?.[0] ?? {}),
          };
        } else {
          const data = await this.gitApiClient.readDiff({
            allowLargePatch: forceFullPatch,
            path: filePath,
            scope: this.requestScope,
          });
          detail = {
            ...file,
            ...(data.files?.[0] ?? {}),
          };
        }

        if (getDiffFileKind(detail) === 'drawio') {
          detail = await this.enrichDrawioDetail(detail);
        }

        if (cacheKey) {
          this.fileCache.set(cacheKey, detail);
        }
        this.fileErrors.delete(filePath);
        return detail;
      } catch (error) {
        console.error('[git-diff] Failed to load file diff:', error);
        const message = this.source === 'commit' ? 'Failed to load commit file diff' : 'Failed to load file diff';
        this.fileErrors.set(filePath, message);
        this.toastController?.show(message);
        return null;
      } finally {
        this.loadingFiles.delete(filePath);
        this.fileLoadPromises.delete(requestKey);
        this.render();
      }
    })();

    this.fileLoadPromises.set(requestKey, requestPromise);
    return requestPromise;
  }

  syncToolbar() {
    const totalFiles = this.data?.files?.length ?? 0;
    const visibleIndex = totalFiles === 0 ? 0 : this.currentIndex + 1;
    const isCommitSource = this.source === 'commit';
    const isStackedCommit = isCommitSource && this.layoutMode === 'stacked';

    if (this.fileIndicator) {
      if (isStackedCommit) {
        this.fileIndicator.textContent = `${totalFiles} file${totalFiles === 1 ? '' : 's'}`;
      } else {
        this.fileIndicator.textContent = totalFiles > 0
          ? `${visibleIndex} of ${totalFiles}`
          : '0 files';
      }
    }

    if (this.stats) {
      const imageLineStats = (this.data?.files ?? [])
        .filter((file) => getDiffFileKind(file) === 'image')
        .reduce((summary, file) => ({
          additions: summary.additions + Number(file.stats?.additions || 0),
          deletions: summary.deletions + Number(file.stats?.deletions || 0),
        }), { additions: 0, deletions: 0 });
      const files = this.data?.files ?? [];
      const allFilesAreImages = files.length > 0 && files.every((file) => getDiffFileKind(file) === 'image');
      const rawAdditions = Number(this.data?.summary?.additions ?? 0);
      const rawDeletions = Number(this.data?.summary?.deletions ?? 0);
      const additions = allFilesAreImages
        ? 0
        : Math.max(0, rawAdditions - imageLineStats.additions);
      const deletions = allFilesAreImages
        ? 0
        : Math.max(0, rawDeletions - imageLineStats.deletions);
      // pi-lens-ignore: ast-grep:no-inner-html-js
      this.stats.innerHTML = `
        <span class="ui-stat-token ui-stat-token--add diff-stats-add">+${additions}</span>
        <span class="ui-stat-token ui-stat-token--del diff-stats-del">-${deletions}</span>
      `;
    }

    this.modeButtons.forEach((button) => {
      const active = button.getAttribute('data-diff-mode') === this.mode;
      button.classList.remove('hidden');
      button.classList.toggle('active', active);
      button.setAttribute?.('aria-pressed', String(active));
    });
    this.layoutButtons.forEach((button) => {
      const active = button.getAttribute('data-diff-layout') === this.layoutMode;
      button.classList.toggle('active', active);
      button.setAttribute?.('aria-pressed', String(active));
    });

    const hasCurrentFile = Boolean(this.getCurrentFile()?.path);
    const hasEditorFile = hasCurrentFile || Boolean(this.workspaceFilePath);
    const actionState = this.getCurrentActionState();
    const primaryAction = this.getPrimaryAction();
    const includedFileCount = Number(this.repoStatus?.summary?.staged || 0);

    this.backToHistoryButton?.classList.toggle('hidden', !isCommitSource);
    this.gitActionsGroup?.classList.toggle('hidden', isCommitSource);
    this.editorActionsGroup?.classList.toggle('hidden', isCommitSource);
    this.actionsDivider?.classList.toggle('hidden', isCommitSource);
    this.layoutToggle?.classList.toggle('hidden', !isCommitSource);
    this.stats?.classList.remove('hidden');

    if (this.openEditorButton) {
      this.openEditorButton.textContent = 'Open in editor';
    }
    this.openEditorButton?.toggleAttribute('disabled', !hasEditorFile || isCommitSource);
    if (this.primaryActionButton) {
      const emphasizeInclude = primaryAction === 'stage' && !actionState.canUnstage;
      this.primaryActionButton.classList.toggle('ui-button--primary', emphasizeInclude);
      this.primaryActionButton.classList.toggle('ui-button--secondary', !emphasizeInclude);
      this.primaryActionButton.classList.toggle('ui-button--surface', !emphasizeInclude);
      this.primaryActionButton.textContent = this.pendingAction && this.pendingAction === primaryAction
        ? 'Working…'
        : primaryAction === 'unstage'
          ? 'Remove'
          : 'Include in commit';
      this.primaryActionButton.toggleAttribute(
        'disabled',
        isCommitSource || !hasCurrentFile || !primaryAction || Boolean(this.pendingAction),
      );
    }
    if (this.commitButton) {
      this.commitButton.textContent = this.pendingAction === 'commit'
        ? 'Working…'
        : commitButtonLabel(includedFileCount);
    }
    this.commitButton?.classList.toggle(
      'hidden',
      isCommitSource || !hasCurrentFile || !actionState.canUnstage,
    );
    this.commitButton?.toggleAttribute(
      'disabled',
      isCommitSource || !actionState.canCommit || Boolean(this.pendingAction),
    );
    this.prevButton?.classList.remove('hidden');
    this.nextButton?.classList.remove('hidden');
    this.prevButton?.classList.toggle('hidden', isStackedCommit);
    this.nextButton?.classList.toggle('hidden', isStackedCommit);
    this.prevButton?.toggleAttribute('disabled', isStackedCommit || this.currentIndex <= 0);
    this.nextButton?.toggleAttribute('disabled', isStackedCommit || totalFiles === 0 || this.currentIndex >= totalFiles - 1);
  }

  render() {
    if (!this.isActive) {
      return;
    }
    this.page?.classList.remove('hidden');

    const files = this.data?.files ?? [];
    if (files.length === 0) {
      this.renderEmpty(this.source === 'commit' ? 'No commit changes to display.' : 'No changes to display.');
      return;
    }

    if (!this.content) {
      return;
    }

    this.excalidrawPreviewPayloads.clear();
    this.drawioPreviewPayloads.clear();

    if (this.source === 'commit') {
      // pi-lens-ignore: ast-grep:no-inner-html-js
      this.content.innerHTML = `${this.renderCommitHeader()}${this.renderCommitBody()}`;
    } else {
      // pi-lens-ignore: ast-grep:no-inner-html-js
      this.content.innerHTML = this.renderFocusedFileBody();
    }
    this.syncToolbar();
    void this.hydrateExcalidrawPreviews();
    void this.hydrateDrawioPreviews();
  }

  getToolbarTitle({ commitHash = null, filePath = null, path = null, scope = 'all', source = 'workspace' } = {}) {
    if (source === 'commit' || this.source === 'commit') {
      if (this.layoutMode === 'stacked') {
        if (this.commitMeta?.shortHash) {
          return `Commit ${this.commitMeta.shortHash}`;
        }
        if (commitHash) {
          return `Commit ${String(commitHash).slice(0, 7)}`;
        }
        return 'Commit Diff';
      }

      if (path) {
        return getVaultPathLeaf(path);
      }
      if (this.activeFilePath) {
        return getVaultPathLeaf(this.activeFilePath);
      }
      if (this.commitMeta?.shortHash) {
        return `Commit ${this.commitMeta.shortHash}`;
      }
      if (commitHash) {
        return `Commit ${String(commitHash).slice(0, 7)}`;
      }
      return 'Commit Diff';
    }

    if (filePath) {
      return getVaultPathLeaf(filePath);
    }

    if (scope === 'staged') {
      return 'Staged Changes';
    }

    if (scope === 'working-tree') {
      return 'Working Tree Changes';
    }

    return 'All Changes';
  }
}
