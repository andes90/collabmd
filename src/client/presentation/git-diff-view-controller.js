import { escapeHtml } from '../domain/vault-utils.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';

function getPathLeaf(pathValue) {
  return String(pathValue ?? '').split('/').pop() || '';
}

function getPathDir(pathValue) {
  const parts = String(pathValue ?? '').split('/');
  parts.pop();
  return parts.join('/');
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
    onBackToHistory = null,
    onCommitStaged = null,
    onOpenFile = null,
    onStageFile = null,
    onUnstageFile = null,
    toastController = null,
  } = {}) {
    this.onBackToHistory = onBackToHistory;
    this.onCommitStaged = onCommitStaged;
    this.onOpenFile = onOpenFile;
    this.onStageFile = onStageFile;
    this.onUnstageFile = onUnstageFile;
    this.toastController = toastController;
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
    this.mode = 'unified';
    this.layoutMode = 'focused';
    this.source = 'workspace';
    this.data = null;
    this.currentIndex = 0;
    this.activeFilePath = null;
    this.fileCache = new Map();
    this.fileErrors = new Map();
    this.loadingFiles = new Set();
    this.collapsedFiles = new Set();
    this.fileLoadPromises = new Map();
    this.requestScope = 'all';
    this.commitHash = null;
    this.commitMeta = null;
    this.historyFilePath = null;
    this.pendingAction = null;
    this.repoStatus = null;
  }

  initialize() {
    this.prevButton?.addEventListener('click', () => this.navigateFile(-1));
    this.nextButton?.addEventListener('click', () => this.navigateFile(1));
    this.backToHistoryButton?.addEventListener('click', () => {
      if (!this.commitMeta?.hash) {
        return;
      }
      this.onBackToHistory?.({
        hash: this.commitMeta.hash,
        historyFilePath: this.historyFilePath,
      });
    });
    this.openEditorButton?.addEventListener('click', () => {
      if (this.source !== 'workspace') {
        return;
      }

      const currentFile = this.getCurrentFile();
      if (!currentFile?.path) {
        return;
      }

      this.onOpenFile?.(currentFile.path);
    });
    this.primaryActionButton?.addEventListener('click', () => {
      const action = this.getPrimaryAction();
      if (!action) {
        return;
      }

      void this.handleFileAction(action);
    });
    this.commitButton?.addEventListener('click', () => {
      void this.handleFileAction('commit');
    });
    this.content?.addEventListener('click', (event) => {
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
        const nextLayout = button.getAttribute('data-diff-layout');
        if (!nextLayout || nextLayout === this.layoutMode) {
          return;
        }
        void this.setLayoutMode(nextLayout);
      });
    });
    this.scrollContainer?.addEventListener('scroll', () => {
      this.handleScrollSelection();
    });
  }

  hide() {
    this.page?.classList.add('hidden');
    if (this.content) {
      this.content.innerHTML = '';
    }
    this.data = null;
    this.source = 'workspace';
    this.layoutMode = 'focused';
    this.currentIndex = 0;
    this.activeFilePath = null;
    this.fileCache.clear();
    this.fileErrors.clear();
    this.loadingFiles.clear();
    this.collapsedFiles.clear();
    this.fileLoadPromises.clear();
    this.requestScope = 'all';
    this.commitHash = null;
    this.commitMeta = null;
    this.historyFilePath = null;
    this.pendingAction = null;
    this.repoStatus = null;
    this.syncToolbar();
  }

  async openWorkspaceDiff({ filePath = null, scope = 'all' } = {}) {
    this.source = 'workspace';
    this.layoutMode = 'focused';
    this.commitHash = null;
    this.commitMeta = null;
    this.historyFilePath = null;
    this.activeFilePath = filePath;
    this.fileCache.clear();
    this.fileErrors.clear();
    this.loadingFiles.clear();
    this.collapsedFiles.clear();
    this.fileLoadPromises.clear();
    this.requestScope = scope;
    this.renderLoading('Loading diff summary...');

    try {
      const query = new URLSearchParams();
      query.set('scope', scope);
      if (filePath) {
        query.set('path', filePath);
      }
      query.set('metaOnly', 'true');

      const response = await fetch(resolveApiUrl(`/git/diff?${query.toString()}`));
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load git diff');
      }

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
      this.renderEmpty('Failed to load git diff');
      return this.data;
    }
  }

  async openCommitDiff({ hash, path = null, historyFilePath = null } = {}) {
    this.source = 'commit';
    this.layoutMode = 'stacked';
    this.commitHash = String(hash ?? '').trim() || null;
    this.commitMeta = null;
    this.historyFilePath = String(historyFilePath ?? '').trim() || null;
    this.activeFilePath = path || null;
    this.fileCache.clear();
    this.fileErrors.clear();
    this.loadingFiles.clear();
    this.collapsedFiles.clear();
    this.fileLoadPromises.clear();
    this.requestScope = 'all';
    this.renderLoading('Loading commit summary...');

    try {
      const query = new URLSearchParams();
      query.set('hash', this.commitHash || '');
      query.set('metaOnly', 'true');

      const response = await fetch(resolveApiUrl(`/git/commit?${query.toString()}`));
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load git commit');
      }

      this.data = data;
      this.commitMeta = data.commit ?? null;
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
      this.renderEmpty('Failed to load git commit');
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

  renderLoading(message = 'Loading git diff...') {
    this.page?.classList.remove('hidden');
    if (this.content) {
      this.content.innerHTML = `<div class="diff-empty-state">${escapeHtml(message)}</div>`;
    }
    this.data = null;
    this.syncToolbar();
  }

  renderEmpty(message) {
    this.page?.classList.remove('hidden');
    if (this.content) {
      this.content.innerHTML = `<div class="diff-empty-state">${escapeHtml(message)}</div>`;
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

  renderFileHeader(file) {
    return `
      <div class="diff-file-header">
        <span class="diff-file-path">${escapeHtml(file.path)}</span>
        <span class="ui-status-badge ${badgeClass(file.status)}">${escapeHtml(file.status)}</span>
        <span class="diff-file-header-stats"><span class="ui-stat-token ui-stat-token--add diff-stats-add">+${file.stats?.additions ?? 0}</span><span class="ui-stat-token ui-stat-token--del diff-stats-del">-${file.stats?.deletions ?? 0}</span></span>
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

    if (detail.tooLarge) {
      return `
        ${includeHeader ? this.renderFileHeader(detail) : ''}
        <div class="diff-limit-card">
          <strong>Large diff withheld</strong>
          <span>This file diff is large enough to impact rendering performance.</span>
          <button class="ui-button btn btn-secondary diff-load-full-btn" type="button" data-load-full-diff data-diff-file-path="${escapeHtml(detail.path)}">Load full diff</button>
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
          <div class="diff-empty-state">Loading file diff...</div>
        </section>
      `;
    }

    const errorMessage = this.fileErrors.get(currentFile.path);
    if (errorMessage) {
      return `
        <section class="diff-file-block">
          ${this.renderFileHeader(currentFile)}
          <div class="diff-empty-state">${escapeHtml(errorMessage)}</div>
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
      const dirPath = getPathDir(file.path);
      return `
        <button
          class="ui-record-surface diff-index-item${isActive ? ' active' : ''}"
          type="button"
          data-diff-index-path="${escapeHtml(file.path)}"
          aria-current="${isActive ? 'true' : 'false'}"
        >
          <span class="ui-record-header diff-index-item-top">
            <span class="ui-record-title diff-index-item-name">${escapeHtml(getPathLeaf(file.path))}</span>
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

    let bodyMarkup = '';
    if (isCollapsed) {
      bodyMarkup = '';
    } else if (isLoading) {
      bodyMarkup = '<div class="diff-empty-state">Loading file diff...</div>';
    } else if (errorMessage) {
      bodyMarkup = `<div class="diff-empty-state">${escapeHtml(errorMessage)}</div>`;
    } else {
      bodyMarkup = this.renderDiffDetail(detail, index, { includeHeader: false });
    }

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
              <span class="diff-commit-section-name">${escapeHtml(getPathLeaf(file.path))}</span>
              ${getPathDir(file.path) ? `<span class="diff-commit-section-path">${escapeHtml(getPathDir(file.path))}</span>` : ''}
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
          const query = new URLSearchParams();
          query.set('hash', this.commitHash || '');
          query.set('path', filePath);
          if (forceFullPatch) {
            query.set('allowLargePatch', 'true');
          }

          const response = await fetch(resolveApiUrl(`/git/commit?${query.toString()}`));
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || 'Failed to load commit file diff');
          }

          detail = {
            ...file,
            ...(data.files?.[0] ?? {}),
          };
        } else {
          const query = new URLSearchParams();
          query.set('scope', this.requestScope);
          query.set('path', filePath);
          if (forceFullPatch) {
            query.set('allowLargePatch', 'true');
          }

          const response = await fetch(resolveApiUrl(`/git/diff?${query.toString()}`));
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || 'Failed to load file diff');
          }

          detail = {
            ...file,
            ...(data.files?.[0] ?? {}),
          };
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
          ? `${visibleIndex} / ${totalFiles} files`
          : '0 / 0 files';
      }
    }

    if (this.stats) {
      const additions = this.data?.summary?.additions ?? 0;
      const deletions = this.data?.summary?.deletions ?? 0;
      this.stats.innerHTML = `
        <span class="ui-stat-token ui-stat-token--add diff-stats-add">+${additions}</span>
        <span class="ui-stat-token ui-stat-token--del diff-stats-del">-${deletions}</span>
      `;
    }

    this.modeButtons.forEach((button) => {
      button.classList.remove('hidden');
      button.classList.toggle('active', button.getAttribute('data-diff-mode') === this.mode);
    });
    this.layoutButtons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-diff-layout') === this.layoutMode);
    });

    const hasCurrentFile = Boolean(this.getCurrentFile()?.path);
    const actionState = this.getCurrentActionState();
    const primaryAction = this.getPrimaryAction();

    this.backToHistoryButton?.classList.toggle('hidden', !isCommitSource);
    this.gitActionsGroup?.classList.toggle('hidden', isCommitSource);
    this.editorActionsGroup?.classList.toggle('hidden', isCommitSource);
    this.actionsDivider?.classList.toggle('hidden', isCommitSource);
    this.layoutToggle?.classList.toggle('hidden', !isCommitSource);
    this.stats?.classList.remove('hidden');

    if (this.openEditorButton) {
      this.openEditorButton.textContent = 'Open in Editor';
    }
    this.openEditorButton?.toggleAttribute('disabled', !hasCurrentFile || isCommitSource);
    if (this.primaryActionButton) {
      this.primaryActionButton.textContent = this.pendingAction === primaryAction
        ? 'Working...'
        : primaryAction === 'unstage'
          ? 'Unstage'
          : 'Stage';
      this.primaryActionButton.toggleAttribute(
        'disabled',
        isCommitSource || !hasCurrentFile || !primaryAction || Boolean(this.pendingAction),
      );
    }
    if (this.commitButton) {
      this.commitButton.textContent = this.pendingAction === 'commit' ? 'Working...' : 'Commit Staged';
    }
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
    this.page?.classList.remove('hidden');

    const files = this.data?.files ?? [];
    if (files.length === 0) {
      this.renderEmpty(this.source === 'commit' ? 'No commit changes to display.' : 'No changes to display.');
      return;
    }

    if (!this.content) {
      return;
    }

    if (this.source === 'commit') {
      this.content.innerHTML = `${this.renderCommitHeader()}${this.renderCommitBody()}`;
    } else {
      this.content.innerHTML = this.renderFocusedFileBody();
    }
    this.syncToolbar();
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
        return getPathLeaf(path);
      }
      if (this.activeFilePath) {
        return getPathLeaf(this.activeFilePath);
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
      return getPathLeaf(filePath);
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
