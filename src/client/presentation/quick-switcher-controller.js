import { escapeHtml } from '../domain/vault-utils.js';

const MAX_VISIBLE_RESULTS = 12;

function stripDisplayExtension(filePath) {
  return String(filePath ?? '').replace(/\.(?:md|markdown|mdx|excalidraw|puml|plantuml|mmd|mermaid)$/i, '');
}

export class QuickSwitcherController {
  constructor({ getFileList, onFileSelect }) {
    this.getFileList = getFileList;
    this.onFileSelect = onFileSelect;

    this.overlay = document.getElementById('quickSwitcher');
    this.input = document.getElementById('quickSwitcherInput');
    this.resultsList = document.getElementById('quickSwitcherResults');
    this.hint = document.getElementById('quickSwitcherHint');

    this.filteredFiles = [];
    this.selectedIndex = 0;
    this.isOpen = false;

    this.bindEvents();
  }

  bindEvents() {
    this.overlay?.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.input?.addEventListener('input', () => {
      this.filterFiles();
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
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
        case 'Tab':
          e.preventDefault();
          this.moveSelection(e.shiftKey ? -1 : 1);
          break;
      }
    });
  }

  open() {
    if (!this.overlay) return;

    this.isOpen = true;
    this.input.value = '';
    this.selectedIndex = 0;
    this.overlay.classList.add('visible');
    this.filterFiles();

    // The overlay transitions visibility hidden→visible over 120ms.
    // Browsers ignore .focus() while the element is still visibility:hidden,
    // so we must wait for the transition to complete.
    this._focusAfterTransition();
  }

  /** Focus the input once the overlay visibility transition finishes. */
  _focusAfterTransition() {
    // Clean up any previous pending focus attempt
    this._cancelPendingFocus();

    const tryFocus = () => {
      this._focusCleanup = null;
      this.input?.focus();
      // Verify focus actually landed — if not, try once more
      if (this.isOpen && this.input && document.activeElement !== this.input) {
        setTimeout(() => this.input?.focus(), 50);
      }
    };

    // Primary: listen for transitionend on the overlay
    const onEnd = (e) => {
      if (e.propertyName === 'visibility' || e.propertyName === 'opacity') {
        this.overlay.removeEventListener('transitionend', onEnd);
        clearTimeout(fallbackTimer);
        tryFocus();
      }
    };
    this.overlay.addEventListener('transitionend', onEnd);

    // Fallback: if transitionend never fires (e.g. transition skipped),
    // focus after a delay that exceeds the 120ms CSS transition.
    const fallbackTimer = setTimeout(() => {
      this.overlay.removeEventListener('transitionend', onEnd);
      tryFocus();
    }, 160);

    this._focusCleanup = () => {
      this.overlay.removeEventListener('transitionend', onEnd);
      clearTimeout(fallbackTimer);
    };
  }

  _cancelPendingFocus() {
    if (this._focusCleanup) {
      this._focusCleanup();
      this._focusCleanup = null;
    }
  }

  close() {
    if (!this.overlay) return;

    this._cancelPendingFocus();
    this.isOpen = false;
    this.overlay.classList.remove('visible');
    this.input.value = '';
    this.resultsList.innerHTML = '';
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  filterFiles() {
    const query = this.input?.value.trim().toLowerCase() ?? '';
    const allFiles = this.getFileList?.() ?? [];

    if (!query) {
      this.filteredFiles = allFiles.slice(0, MAX_VISIBLE_RESULTS);
    } else {
      this.filteredFiles = allFiles
        .map((filePath) => {
          const score = this.fuzzyScore(filePath.toLowerCase(), query);
          return { filePath, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_VISIBLE_RESULTS)
        .map((item) => item.filePath);
    }

    this.selectedIndex = 0;
    this.renderResults(query);
  }

  fuzzyScore(text, query) {
    const name = stripDisplayExtension(text);
    const nameOnly = name.split('/').pop();

    // Exact substring match in filename gets highest score
    if (nameOnly.includes(query)) return 100 + (1 / nameOnly.length);

    // Exact substring in full path
    if (name.includes(query)) return 50 + (1 / name.length);

    // Fuzzy character-by-character match
    let queryIndex = 0;
    let score = 0;
    let consecutiveBonus = 0;

    for (let i = 0; i < name.length && queryIndex < query.length; i++) {
      if (name[i] === query[queryIndex]) {
        queryIndex++;
        consecutiveBonus += 1;
        score += consecutiveBonus;

        // Bonus for matching at word boundaries
        if (i === 0 || name[i - 1] === '/' || name[i - 1] === '-' || name[i - 1] === '_' || name[i - 1] === ' ') {
          score += 5;
        }
      } else {
        consecutiveBonus = 0;
      }
    }

    return queryIndex === query.length ? score : 0;
  }

  renderResults(query) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';

    if (this.filteredFiles.length === 0) {
      if (this.hint) {
        this.hint.textContent = query ? 'No files found' : 'No files in vault';
        this.hint.classList.remove('hidden');
      }
      return;
    }

    if (this.hint) {
      this.hint.classList.add('hidden');
    }

    const fragment = document.createDocumentFragment();

    this.filteredFiles.forEach((filePath, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'qs-result-item';
      if (index === this.selectedIndex) {
        item.classList.add('selected');
      }
      item.dataset.index = String(index);

      const displayName = stripDisplayExtension(filePath);
      const fileName = displayName.split('/').pop();
      const dirPath = displayName.includes('/') ? displayName.substring(0, displayName.lastIndexOf('/')) : '';

      item.innerHTML = `
        <svg class="qs-result-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="qs-result-name">${this.highlightMatch(fileName, query)}</span>
        ${dirPath ? `<span class="qs-result-path">${escapeHtml(dirPath)}</span>` : ''}
      `;

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
  }

  highlightMatch(text, query) {
    if (!query) return escapeHtml(text);

    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);

    if (idx >= 0) {
      const before = text.slice(0, idx);
      const match = text.slice(idx, idx + query.length);
      const after = text.slice(idx + query.length);
      return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
    }

    // Fuzzy highlight
    let result = '';
    let queryIdx = 0;
    for (let i = 0; i < text.length; i++) {
      if (queryIdx < query.length && text[i].toLowerCase() === query[queryIdx]) {
        result += `<mark>${escapeHtml(text[i])}</mark>`;
        queryIdx++;
      } else {
        result += escapeHtml(text[i]);
      }
    }
    return result;
  }

  moveSelection(delta) {
    if (this.filteredFiles.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.filteredFiles.length) % this.filteredFiles.length;
    this.updateSelection();
  }

  updateSelection() {
    if (!this.resultsList) return;

    const items = this.resultsList.querySelectorAll('.qs-result-item');
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
    });

    // Scroll selected item into view
    const selectedItem = items[this.selectedIndex];
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }

  confirmSelection() {
    const filePath = this.filteredFiles[this.selectedIndex];
    if (filePath) {
      this.close();
      this.onFileSelect?.(filePath);
    }
  }
}
