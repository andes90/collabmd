import { escapeHtml } from '../domain/vault-utils.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';

/**
 * BacklinksPanel — renders "Linked Mentions" for the current file.
 *
 * Desktop uses a docked bottom-left panel outside the preview scroll flow.
 * Mobile keeps an inline collapsible panel at the end of the preview content.
 */
export class BacklinksPanel {
  constructor({
    documentRef = document,
    inlinePanelElement = null,
    onFileSelect,
    panelElement,
  }) {
    this.documentRef = documentRef;
    this.panelRoot = panelElement;
    this.inlinePanel = inlinePanelElement;
    this.onFileSelect = onFileSelect;

    this._expanded = false;
    this._currentFile = null;
    this._fetchController = null;
    this._backlinks = [];
    this._pendingOutsidePointer = null;

    const desktopPanel = this.panelRoot?.querySelector('[data-backlinks-variant="dock"]') ?? this.panelRoot;
    this.panels = [
      this._createPanelRef(desktopPanel),
      this._createPanelRef(this.inlinePanel),
    ].filter(Boolean);

    this.handleDocumentPointerDown = (event) => {
      if (!this._expanded) {
        return;
      }

      const target = event?.target;
      if (target && this.panels.some(({ panel }) => panel?.contains?.(target))) {
        this._pendingOutsidePointer = null;
        return;
      }

      if (event?.pointerType === 'mouse' && event?.button !== 0) {
        return;
      }

      this._pendingOutsidePointer = {
        pointerId: event?.pointerId ?? 'mouse',
        startX: Number(event?.clientX ?? 0),
        startY: Number(event?.clientY ?? 0),
      };
    };

    this.handleDocumentPointerMove = (event) => {
      if (!this._pendingOutsidePointer) {
        return;
      }

      const deltaX = Math.abs(Number(event?.clientX ?? 0) - this._pendingOutsidePointer.startX);
      const deltaY = Math.abs(Number(event?.clientY ?? 0) - this._pendingOutsidePointer.startY);
      if (deltaX > 10 || deltaY > 10) {
        this._pendingOutsidePointer = null;
      }
    };

    this.handleDocumentPointerEnd = (event) => {
      if (!this._expanded || !this._pendingOutsidePointer) {
        return;
      }

      const target = event?.target;
      if (target && this.panels.some(({ panel }) => panel?.contains?.(target))) {
        this._pendingOutsidePointer = null;
        return;
      }

      this._pendingOutsidePointer = null;
      this.close();
    };

    this.handleDocumentKeyDown = (event) => {
      if (!this._expanded || event?.key !== 'Escape') {
        return;
      }

      event.preventDefault?.();
      this.close();
    };

    this.bindEvents();
  }

  bindEvents() {
    this.panels.forEach((refs) => {
      refs.header?.addEventListener('click', () => {
        if (this._backlinks.length === 0) return;
        this._expanded = !this._expanded;
        this._pendingOutsidePointer = null;
        this._applyExpandState();
      });
    });

    this.documentRef?.addEventListener?.('pointerdown', this.handleDocumentPointerDown);
    this.documentRef?.addEventListener?.('pointermove', this.handleDocumentPointerMove, { passive: true });
    this.documentRef?.addEventListener?.('pointerup', this.handleDocumentPointerEnd);
    this.documentRef?.addEventListener?.('pointercancel', this.handleDocumentPointerEnd);
    this.documentRef?.addEventListener?.('keydown', this.handleDocumentKeyDown);
  }

  async load(filePath) {
    const fileChanged = filePath !== this._currentFile;
    this._currentFile = filePath;

    if (fileChanged) {
      this._expanded = false;
    }

    if (!filePath) {
      this._backlinks = [];
      this._render();
      return;
    }

    this._fetchController?.abort();
    this._fetchController = new AbortController();

    try {
      const response = await fetch(
        resolveApiUrl(`/backlinks?file=${encodeURIComponent(filePath)}`),
        { signal: this._fetchController.signal },
      );
      const data = await response.json();

      if (this._currentFile !== filePath) return;

      this._backlinks = data.backlinks ?? [];
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.warn('[backlinks] Failed to load:', error.message);
      this._backlinks = [];
    }

    this._render();
  }

  clear() {
    this._currentFile = null;
    this._backlinks = [];
    this._expanded = false;
    this._render();
  }

  close() {
    if (!this._expanded) {
      return;
    }

    this._expanded = false;
    this._pendingOutsidePointer = null;
    this._applyExpandState();
  }

  _createPanelRef(panel) {
    if (!panel) {
      return null;
    }

    return {
      panel,
      header: panel.querySelector('.backlinks-header'),
      toggle: panel.querySelector('.backlinks-toggle'),
      countBadge: panel.querySelector('.backlinks-count'),
      body: panel.querySelector('.backlinks-body'),
      list: panel.querySelector('.backlinks-list'),
    };
  }

  _render() {
    const count = this._backlinks.length;
    const label = count === 1 ? 'Linked Mention' : 'Linked Mentions';
    const shouldShow = Boolean(this._currentFile) && count > 0;

    this.panelRoot?.classList?.toggle('hidden', !shouldShow);
    this.inlinePanel?.classList?.toggle('hidden', !shouldShow);

    if (!shouldShow) {
      this._expanded = false;
    }

    this.panels.forEach((refs) => {
      refs.countBadge.textContent = shouldShow ? String(count) : '';
      refs.toggle.textContent = label;
      refs.header?.classList.toggle('backlinks-header-empty', !shouldShow);

      if (!shouldShow) {
        refs.list.innerHTML = '';
      } else {
        this._renderList(refs.list);
      }
    });

    this._applyExpandState();
  }

  _renderList(listElement) {
    if (!listElement) return;
    listElement.innerHTML = '';

    const fragment = this.documentRef?.createDocumentFragment?.();
    const target = fragment ?? listElement;

    this._backlinks.forEach((backlink) => {
      target.appendChild(this._createBacklinkItem(backlink));
    });

    if (fragment) {
      listElement.appendChild(fragment);
    }
  }

  _createBacklinkItem(backlink) {
    const fileName = backlink.file.replace(/\.md$/i, '').split('/').pop();
    const dirPath = backlink.file.includes('/')
      ? backlink.file.substring(0, backlink.file.lastIndexOf('/'))
      : '';

    const item = this.documentRef.createElement('button');
    item.type = 'button';
    item.className = 'backlink-item';
    item.addEventListener('click', () => {
      this.close();
      this.onFileSelect?.(backlink.file);
    });

    const nameRow = this.documentRef.createElement('div');
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

    backlink.contexts.slice(0, 3).forEach((ctx) => {
      const contextElement = this.documentRef.createElement('div');
      contextElement.className = 'backlink-context';
      contextElement.textContent = ctx;
      item.appendChild(contextElement);
    });

    if (backlink.contexts.length > 3) {
      const moreElement = this.documentRef.createElement('div');
      moreElement.className = 'backlink-context backlink-more';
      moreElement.textContent = `+${backlink.contexts.length - 3} more`;
      item.appendChild(moreElement);
    }

    return item;
  }

  _applyExpandState() {
    const expanded = this._expanded && this._backlinks.length > 0;

    this.panels.forEach((refs) => {
      refs.panel.classList.toggle('expanded', expanded);
      refs.header?.setAttribute('aria-expanded', String(expanded));
      refs.header?.setAttribute('aria-disabled', String(this._backlinks.length === 0));
      refs.body?.setAttribute('aria-hidden', String(!expanded));
      refs.body?.toggleAttribute('inert', !expanded);
    });
  }
}
