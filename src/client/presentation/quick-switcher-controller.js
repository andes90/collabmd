import { createFileSearchEntry, findFileSearchMatch } from '../domain/file-search.js';
import { getVaultFileIconSvg } from './file-icon-svg.js';
import {
  DEFAULT_SEARCH_DEBOUNCE_MS,
  QuickSwitcherTextSearchRunner,
  flattenTextResults,
  formatMatchCount,
} from './quick-switcher-text-search.js';

const MAX_VISIBLE_RESULTS = 30;
const NO_RECENT_FILE_RANK = Number.MAX_SAFE_INTEGER;
const FILE_RESULT_ID_PREFIX = 'quick-switcher-file-';
const TEXT_RESULT_ID_PREFIX = 'quick-switcher-text-';

function getRawFileName(filePath) {
  return String(filePath ?? '').split('/').pop() || String(filePath ?? '');
}

function getFileName(filePath) {
  return createFileSearchEntry(filePath).fileName;
}

function getDirPath(filePath) {
  const displayName = createFileSearchEntry(filePath).displayName;
  return displayName.includes('/') ? displayName.substring(0, displayName.lastIndexOf('/')) : '';
}

function splitMatchIndices(entry, indices = []) {
  const fileNameStart = entry.displayName.length - entry.fileName.length;
  return {
    dirPath: indices.filter((index) => index < fileNameStart),
    fileName: indices
      .filter((index) => index >= fileNameStart)
      .map((index) => index - fileNameStart),
  };
}

function appendHighlightedText(element, text, indices = []) {
  const matchedIndices = new Set(indices);
  let cursor = 0;

  while (cursor < text.length) {
    const matched = matchedIndices.has(cursor);
    let end = cursor + 1;
    while (end < text.length && matchedIndices.has(end) === matched) end += 1;

    const value = text.slice(cursor, end);
    if (matched) {
      const mark = document.createElement('mark');
      mark.textContent = value;
      element.append(mark);
    } else {
      element.append(value);
    }
    cursor = end;
  }
}

export class QuickSwitcherController {
  constructor({
    getFileList,
    getFileMetadata = () => [],
    getRecentFiles = () => [],
    getSearchConfig = () => ({}),
    onFileSelect,
    onTextMatchSelect = null,
    searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
    searchText = null,
  }) {
    this.getFileList = getFileList;
    this.getFileMetadata = getFileMetadata;
    this.getRecentFiles = getRecentFiles;
    this.getSearchConfig = getSearchConfig;
    this.onFileSelect = onFileSelect;
    this.onTextMatchSelect = onTextMatchSelect;
    this.searchDebounceMs = searchDebounceMs;
    this.searchText = searchText;

    this.overlay = document.getElementById('quickSwitcher');
    this.input = document.getElementById('quickSwitcherInput');
    this.resultsList = document.getElementById('quickSwitcherResults');
    this.hint = document.getElementById('quickSwitcherHint');
    this.scope = document.getElementById('quickSwitcherScope');
    this.modeTabs = Array.from(document.querySelectorAll?.('[data-qs-mode]') ?? []);
    const searchConfig = this.getSearchConfig?.() ?? {};
    const textTab = this.modeTabs.find((tab) => tab.dataset.qsMode === 'text');
    if (textTab && searchConfig.available === false) {
      textTab.disabled = true;
      textTab.setAttribute('title', searchConfig.unavailableReason || 'Text search is unavailable');
    }

    this.filteredFiles = [];
    this.fileMatches = new Map();
    this.fileMatchCount = 0;
    this.fileResultsTruncated = false;
    this.fileCorpus = [];
    this.lastFileListRef = null;
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.isOpen = false;
    this.mode = 'files';
    this.textResults = null;
    this.textResultItems = [];
    this.textSearchRunner = new QuickSwitcherTextSearchRunner({
      debounceMs: this.searchDebounceMs,
    });
    this.blockingModalHandler = () => this.close();

    this.bindEvents();
  }

  bindEvents() {
    document.addEventListener?.('collabmd:close-custom-modals', this.blockingModalHandler);
    this.overlay?.addEventListener('close', () => this.handleClose());

    this.modeTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        this.setMode(tab.dataset.qsMode === 'text' ? 'text' : 'files', { preserveInput: true });
        this.input?.focus?.();
      });
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
          return;
        }

        event.preventDefault();
        const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + this.modeTabs.length)
          % this.modeTabs.length;
        const nextTab = this.modeTabs[nextIndex];
        if (nextTab.disabled) {
          return;
        }
        this.setMode(nextTab.dataset.qsMode === 'text' ? 'text' : 'files', { preserveInput: true });
        nextTab.focus();
      });
    });

    this.input?.addEventListener('input', () => {
      this.handleInput();
    });

    this.input?.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.moveSelection(-1);
          break;
        case 'Enter':
          e.preventDefault();
          this.confirmSelection();
          break;
        case 'Tab':
          e.preventDefault();
          if (this.modeTabs.filter((tab) => !tab.disabled).length > 1 && !e.shiftKey) {
            this.setMode(this.mode === 'files' ? 'text' : 'files', { preserveInput: true });
          } else {
            this.moveSelection(e.shiftKey ? -1 : 1);
          }
          break;
      }
    });
  }

  handleClose() {
    this.abortTextSearch();
    this.isOpen = false;
    this.input?.setAttribute('aria-expanded', 'false');
    this.input.value = '';
    this.resultsList.innerHTML = '';
    this.setActiveDescendant('');
  }

  open() {
    if (!this.overlay || this.overlay.open) return;

    this.isOpen = true;
    this.input.value = '';
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.setMode('files', { preserveInput: true });
    this.overlay.showModal();
    this.input?.setAttribute('aria-expanded', 'true');
  }

  close() {
    this.handleClose();
    if (this.overlay?.open) {
      this.overlay.close();
    }
  }

  toggle() {
    if (this.overlay?.open) {
      this.close();
    } else {
      this.open();
    }
  }

  setMode(mode = 'files', { preserveInput = false } = {}) {
    const textTab = this.modeTabs.find((tab) => tab.dataset.qsMode === 'text');
    const normalizedMode = mode === 'text' && !textTab?.disabled ? 'text' : 'files';
    this.mode = normalizedMode;
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;

    if (!preserveInput && this.input) {
      this.input.value = '';
    }

    this.modeTabs.forEach((tab) => {
      const isActive = tab.dataset.qsMode === normalizedMode;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    this.scope?.classList.toggle('hidden', normalizedMode !== 'text');
    this.scope?.setAttribute('aria-hidden', normalizedMode === 'text' ? 'false' : 'true');

    if (this.input) {
      this.input.placeholder = normalizedMode === 'text'
        ? 'Search text in files...'
        : 'Search files...';
      this.input.setAttribute(
        'aria-label',
        normalizedMode === 'text' ? 'Search text in files' : 'Search files',
      );
    }

    this.handleInput();
  }

  handleInput() {
    if (this.mode === 'text') {
      this.scheduleTextSearch();
      return;
    }

    this.abortTextSearch();
    this.filterFiles();
  }

  filterFiles() {
    this.resultsList?.setAttribute('aria-busy', 'false');
    const query = this.input?.value.trim().toLowerCase().replace(/\s+/gu, ' ') ?? '';
    const allFiles = this.getFileList?.() ?? [];
    if (allFiles !== this.lastFileListRef) {
      this.lastFileListRef = allFiles;
      this.fileCorpus = allFiles.map((filePath) => createFileSearchEntry(filePath));
    }

    this.fileMatches.clear();
    const fileMetadata = this.getFileMetadata?.() ?? [];
    const modifiedTimes = new Map(
      (Array.isArray(fileMetadata) ? fileMetadata : []).map((entry) => [
        entry?.path,
        Number.isFinite(Number(entry?.mtimeMs)) ? Number(entry.mtimeMs) : 0,
      ]),
    );
    const recentFiles = this.getRecentFiles?.() ?? [];
    const recentRanks = new Map(
      (Array.isArray(recentFiles) ? recentFiles : []).map((filePath, index) => [filePath, index]),
    );
    if (!query) {
      this.filteredFiles = [...this.fileCorpus]
        .sort((left, right) => {
          const modifiedDelta = (modifiedTimes.get(right.filePath) ?? 0) - (modifiedTimes.get(left.filePath) ?? 0);
          if (modifiedDelta !== 0) {
            return modifiedDelta;
          }

          return (recentRanks.get(left.filePath) ?? NO_RECENT_FILE_RANK)
            - (recentRanks.get(right.filePath) ?? NO_RECENT_FILE_RANK);
        })
        .slice(0, MAX_VISIBLE_RESULTS)
        .map((entry) => entry.filePath);
      this.fileMatchCount = this.fileCorpus.length;
    } else {
      const ranked = [];
      let fileMatchCount = 0;
      this.fileCorpus.forEach((entry) => {
        const match = findFileSearchMatch(entry, query);
        if (!match) {
          return;
        }

        fileMatchCount += 1;
        this.fileMatches.set(entry.filePath, match);
        const rankedEntry = {
          filePath: entry.filePath,
          recentRank: recentRanks.get(entry.filePath) ?? NO_RECENT_FILE_RANK,
          score: match.score,
        };
        let inserted = false;
        for (let index = 0; index < ranked.length; index += 1) {
          const current = ranked[index];
          const isBetter = rankedEntry.score > current.score
            || (
              rankedEntry.score === current.score
              && (
                rankedEntry.recentRank < current.recentRank
                || (
                  rankedEntry.recentRank === current.recentRank
                  && entry.lowerPath < String(current.filePath).toLowerCase()
                )
              )
            );
          if (isBetter) {
            ranked.splice(index, 0, rankedEntry);
            inserted = true;
            break;
          }
        }

        if (!inserted && ranked.length < MAX_VISIBLE_RESULTS) {
          ranked.push(rankedEntry);
        }

        if (ranked.length > MAX_VISIBLE_RESULTS) {
          ranked.length = MAX_VISIBLE_RESULTS;
        }
      });

      this.filteredFiles = ranked.map((entry) => entry.filePath);
      this.fileMatchCount = fileMatchCount;
    }

    this.fileResultsTruncated = this.fileMatchCount > MAX_VISIBLE_RESULTS;
    this.selectedIndex = 0;
    this.renderResults(query);
  }

  renderResults(query) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';

    if (this.filteredFiles.length === 0) {
      this.setActiveDescendant('');
      if (this.hint) {
        this.hint.textContent = query ? 'No files found' : 'No files in vault';
        this.hint.classList.remove('hidden');
      }
      return;
    }

    if (this.hint) {
      const hint = this.fileResultsTruncated
        ? query
          ? `Showing the top ${MAX_VISIBLE_RESULTS} of ${this.fileMatchCount} matches. Refine the query to narrow results.`
          : `Showing the first ${MAX_VISIBLE_RESULTS} of ${this.fileMatchCount} files.`
        : '';
      this.hint.textContent = hint;
      this.hint.classList.toggle('hidden', !hint);
    }

    const fragment = document.createDocumentFragment();

    this.filteredFiles.forEach((filePath, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'qs-result-item';
      if (index === this.selectedIndex) {
        item.classList.add('selected');
      }
      item.id = `${FILE_RESULT_ID_PREFIX}${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
      item.dataset.index = String(index);

      const fileName = getRawFileName(filePath);
      const dirPath = getDirPath(filePath);
      const match = this.fileMatches.get(filePath);
      const corpusEntry = this.fileCorpus.find((entry) => entry.filePath === filePath);
      const matchIndices = corpusEntry ? splitMatchIndices(corpusEntry, match?.indices) : { dirPath: [], fileName: [] };

      const svg = getVaultFileIconSvg(filePath, { className: 'qs-result-icon' });
      item.append(document.createRange().createContextualFragment(svg));
      const name = document.createElement('span');
      name.className = 'qs-result-name';
      appendHighlightedText(name, fileName, matchIndices.fileName);
      item.append(name);

      if (dirPath) {
        const path = document.createElement('span');
        path.className = 'qs-result-path';
        path.title = dirPath;
        appendHighlightedText(path, dirPath, matchIndices.dirPath);
        item.append(path);
      }

      item.addEventListener('click', () => {
        this.selectedIndex = index;
        this.confirmSelection();
      });

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });

      fragment.appendChild(item);
    });

    this.resultsList.appendChild(fragment);
    this.updateSelection();
  }

  abortTextSearch({ invalidate = true } = {}) {
    this.textSearchRunner.abort({ invalidate });
  }

  scheduleTextSearch() {
    const query = this.input?.value.trim() ?? '';
    const searchConfig = this.getSearchConfig?.() ?? {};

    this.textResults = null;
    this.textResultItems = [];
    this.textSearchRunner.schedule({
      isActive: () => this.isOpen && this.mode === 'text',
      onResults: (result, searchedQuery) => {
        this.textResults = result;
        this.textResultItems = flattenTextResults(result);
        this.selectedTextIndex = 0;
        this.renderTextResults(searchedQuery);
      },
      onState: (message) => this.renderTextState(message),
      query,
      searchConfig,
      searchText: this.searchText,
    });
  }

  renderTextState(message) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';
    this.resultsList.setAttribute('aria-busy', message === 'Searching...' ? 'true' : 'false');
    this.setActiveDescendant('');
    if (this.hint) {
      this.hint.textContent = message;
      this.hint.classList.remove('hidden');
    }
  }

  renderTextResults(query = '') {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';
    this.resultsList.setAttribute('aria-busy', 'false');

    if (!this.textResults?.files?.length || this.textResultItems.length === 0) {
      this.setActiveDescendant('');
      this.renderTextState(query ? 'No text matches found' : 'Type to search file text');
      return;
    }

    if (this.hint) {
      const hint = this.textResults.truncated
        ? `Showing partial results: ${this.textResults.files.length} files and ${formatMatchCount(this.textResults.matchCount, { truncated: true })}. Refine the query to narrow results.`
        : '';
      this.hint.textContent = hint;
      this.hint.classList.toggle('hidden', !hint);
    }

    const fragment = document.createDocumentFragment();
    let flatIndex = 0;

    this.textResults.files.forEach((fileGroup) => {
      const group = document.createElement('section');
      group.className = 'qs-text-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', fileGroup.file);

      const header = document.createElement('div');
      header.className = 'qs-text-group-header';
      [
        ['qs-text-file-name', getFileName(fileGroup.file)],
        ['qs-text-file-meta', getDirPath(fileGroup.file)],
        ['qs-text-count', formatMatchCount(fileGroup.matchCount, { truncated: fileGroup.truncated })],
      ].forEach(([className, text]) => {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        header.append(span);
      });
      group.appendChild(header);

      (fileGroup.snippets ?? []).forEach((snippet) => {
        const itemIndex = flatIndex;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qs-text-item';
        if (itemIndex === this.selectedTextIndex) {
          item.classList.add('selected');
        }
        item.id = `${TEXT_RESULT_ID_PREFIX}${itemIndex}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', itemIndex === this.selectedTextIndex ? 'true' : 'false');
        item.dataset.textIndex = String(itemIndex);
        const line = document.createElement('span');
        line.className = 'qs-text-line';
        line.textContent = `L${snippet.line ?? 1}`;
        const snippetText = document.createElement('span');
        snippetText.className = 'qs-text-snippet';
        this.appendHighlightedSnippet(snippetText, snippet);
        item.append(line, snippetText);
        item.addEventListener('click', () => {
          this.selectedTextIndex = itemIndex;
          this.confirmSelection();
        });
        item.addEventListener('mouseenter', () => {
          this.selectedTextIndex = itemIndex;
          this.updateSelection();
        });
        group.appendChild(item);
        flatIndex += 1;
      });

      fragment.appendChild(group);
    });

    this.resultsList.appendChild(fragment);
    this.updateSelection();
  }

  appendHighlightedSnippet(element, snippet = {}) {
    const text = String(snippet.text ?? '');
    const start = Math.min(Math.max(Number(snippet.matchStart) || 0, 0), text.length);
    const end = Math.min(Math.max(Number(snippet.matchEnd) || start, start), text.length);
    element.append(text.slice(0, start));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    element.append(mark, text.slice(end));
  }

  moveSelection(delta) {
    if (this.mode === 'text') {
      if (this.textResultItems.length === 0) return;
      this.selectedTextIndex = (this.selectedTextIndex + delta + this.textResultItems.length) % this.textResultItems.length;
      this.updateSelection();
      return;
    }

    if (this.filteredFiles.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.filteredFiles.length) % this.filteredFiles.length;
    this.updateSelection();
  }

  updateSelection() {
    if (!this.resultsList) return;

    if (this.mode === 'text') {
      const items = this.resultsList.querySelectorAll('.qs-text-item');
      items.forEach((item, i) => {
        const isSelected = i === this.selectedTextIndex;
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      });
      items[this.selectedTextIndex]?.scrollIntoView({ block: 'nearest' });
      this.setActiveDescendant(items[this.selectedTextIndex]?.id ?? '');
      return;
    }

    const items = this.resultsList.querySelectorAll('.qs-result-item');
    items.forEach((item, i) => {
      const isSelected = i === this.selectedIndex;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });

    items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
    this.setActiveDescendant(items[this.selectedIndex]?.id ?? '');
  }

  setActiveDescendant(id = '') {
    this.input?.setAttribute('aria-activedescendant', id);
  }

  confirmSelection() {
    if (this.mode === 'text') {
      const match = this.textResultItems[this.selectedTextIndex];
      if (match) {
        this.close({ restoreFocus: false });
        this.onTextMatchSelect?.(match);
      }
      return;
    }

    const filePath = this.filteredFiles[this.selectedIndex];
    if (filePath) {
      this.close({ restoreFocus: false });
      this.onFileSelect?.(filePath);
    }
  }
}
