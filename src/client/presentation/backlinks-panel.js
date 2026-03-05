import { escapeHtml } from '../domain/vault-utils.js';

/**
 * BacklinksPanel — a collapsible panel below the preview showing
 * which files link to the currently open file ("Linked Mentions").
 *
 * Each mention shows the source file name and the context line
 * containing the [[wiki link]]. Clicking a mention navigates to that file.
 */
export class BacklinksPanel {
  constructor({ panelElement, onFileSelect }) {
    this.panel = panelElement;
    this.onFileSelect = onFileSelect;

    this.header = this.panel?.querySelector('.backlinks-header');
    this.toggle = this.panel?.querySelector('.backlinks-toggle');
    this.countBadge = this.panel?.querySelector('.backlinks-count');
    this.body = this.panel?.querySelector('.backlinks-body');
    this.list = this.panel?.querySelector('.backlinks-list');

    this._expanded = false;
    this._currentFile = null;
    this._fetchController = null;
    this._backlinks = [];

    this.bindEvents();
  }

  bindEvents() {
    this.header?.addEventListener('click', () => {
      if (this._backlinks.length === 0) return;
      this._expanded = !this._expanded;
      this._applyExpandState();
    });
  }

  /**
   * Load backlinks for a file. Call on every file open and after
   * content changes (debounced).
   */
  async load(filePath) {
    this._currentFile = filePath;

    if (!filePath) {
      this._backlinks = [];
      this._render();
      return;
    }

    // Abort any in-flight fetch
    this._fetchController?.abort();
    this._fetchController = new AbortController();

    try {
      const response = await fetch(
        `/api/backlinks?file=${encodeURIComponent(filePath)}`,
        { signal: this._fetchController.signal },
      );
      const data = await response.json();

      // Guard against stale responses (user switched files)
      if (this._currentFile !== filePath) return;

      this._backlinks = data.backlinks ?? [];
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.warn('[backlinks] Failed to load:', error.message);
      this._backlinks = [];
    }

    this._render();
  }

  /** Clear the panel (e.g. when navigating to empty state). */
  clear() {
    this._currentFile = null;
    this._backlinks = [];
    this._expanded = false;
    this._render();
  }

  // --- Private ---

  _render() {
    if (!this.panel) return;

    const count = this._backlinks.length;
    const label = count === 1 ? '1 Linked Mention' : `${count} Linked Mentions`;

    if (this.countBadge) {
      this.countBadge.textContent = count > 0 ? String(count) : '';
    }

    if (this.toggle) {
      this.toggle.textContent = label;
    }

    // Hide entire panel when no current file
    this.panel.classList.toggle('hidden', !this._currentFile);

    // Disable header click when 0 backlinks
    this.header?.classList.toggle('backlinks-header-empty', count === 0);

    if (count === 0) {
      this._expanded = false;
      this._applyExpandState();
      if (this.list) this.list.innerHTML = '';
      return;
    }

    this._renderList();
    this._applyExpandState();
  }

  _renderList() {
    if (!this.list) return;
    this.list.innerHTML = '';

    const fragment = document.createDocumentFragment();

    for (const backlink of this._backlinks) {
      const fileName = backlink.file.replace(/\.md$/i, '').split('/').pop();
      const dirPath = backlink.file.includes('/')
        ? backlink.file.substring(0, backlink.file.lastIndexOf('/'))
        : '';

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'backlink-item';
      item.addEventListener('click', () => {
        this.onFileSelect?.(backlink.file);
      });

      // File name row
      const nameRow = document.createElement('div');
      nameRow.className = 'backlink-file-name';
      nameRow.innerHTML = `
        <svg class="backlink-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>${escapeHtml(fileName)}</span>
        ${dirPath ? `<span class="backlink-dir">${escapeHtml(dirPath)}</span>` : ''}
      `;
      item.appendChild(nameRow);

      // Context snippets
      for (const ctx of backlink.contexts.slice(0, 3)) {
        const contextEl = document.createElement('div');
        contextEl.className = 'backlink-context';
        contextEl.textContent = ctx;
        item.appendChild(contextEl);
      }

      if (backlink.contexts.length > 3) {
        const more = document.createElement('div');
        more.className = 'backlink-context backlink-more';
        more.textContent = `+${backlink.contexts.length - 3} more`;
        item.appendChild(more);
      }

      fragment.appendChild(item);
    }

    this.list.appendChild(fragment);
  }

  _applyExpandState() {
    this.panel?.classList.toggle('expanded', this._expanded);
    this.body?.setAttribute('aria-hidden', String(!this._expanded));
  }
}
