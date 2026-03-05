/**
 * Manages Excalidraw diagram embeds within the preview panel.
 *
 * Detects `![[*.excalidraw]]` patterns in rendered wiki-links,
 * replaces them with interactive iframe editors, and handles
 * save messages from the embedded Excalidraw instances.
 */

const EXCALIDRAW_REGEX = /\.excalidraw$/i;
const DEFAULT_HEIGHT = 420;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 800;
const RESIZE_HANDLE_SIZE = 8;

export class ExcalidrawEmbedController {
  constructor({ getTheme, getLocalUser, toastController }) {
    this.getTheme = getTheme;
    this.getLocalUser = getLocalUser;
    this.toastController = toastController;
    this.activeEmbeds = new Map(); // filePath → { iframe, container }
    this.maximizedEmbed = null; // { wrapper, exit }

    this._onMessage = this._onMessage.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    window.addEventListener('message', this._onMessage);
    window.addEventListener('keydown', this._onKeyDown);
  }

  destroy() {
    window.removeEventListener('message', this._onMessage);
    window.removeEventListener('keydown', this._onKeyDown);
    this._exitMaximizedEmbed();
    document.body.classList.remove('excalidraw-maximized-open');
    this.activeEmbeds.clear();
  }

  /**
   * After the preview is rendered, scan for excalidraw wiki-link embeds
   * and replace them with interactive iframe editors.
   *
   * Embed syntax:  ![[diagram.excalidraw]]
   *
   * The `!` prefix distinguishes embeds from regular wiki-links.
   * We detect this by looking at the text node before the rendered wiki-link.
   */
  processEmbeds(previewElement) {
    // Clean up previous embeds
    this._exitMaximizedEmbed();
    this.activeEmbeds.clear();

    const wikiLinks = previewElement.querySelectorAll('a.wiki-link');
    for (const link of wikiLinks) {
      const target = link.dataset.wikiTarget;
      if (!target || !EXCALIDRAW_REGEX.test(target)) continue;

      // Check if this is an embed (preceded by `!`)
      const prevNode = link.previousSibling;
      const isEmbed = prevNode
        && prevNode.nodeType === Node.TEXT_NODE
        && prevNode.textContent.endsWith('!');

      if (!isEmbed) continue;

      // Remove the `!` prefix from text
      prevNode.textContent = prevNode.textContent.slice(0, -1);

      // Resolve the file path — the target may or may not have .excalidraw extension
      const filePath = target.endsWith('.excalidraw') ? target : `${target}.excalidraw`;

      // Replace the link with an embed container
      const container = this._createEmbedContainer(filePath);
      link.parentNode.replaceChild(container, link);
    }
  }

  /**
   * Update theme on all active embeds.
   */
  updateTheme(theme) {
    for (const { iframe } of this.activeEmbeds.values()) {
      iframe.contentWindow?.postMessage({
        source: 'collabmd-host',
        type: 'set-theme',
        theme,
      }, window.location.origin);
    }
  }

  // ── Private ──────────────────────────────────────────────────────

  _createEmbedContainer(filePath) {
    const wrapper = document.createElement('div');
    wrapper.className = 'excalidraw-embed';
    wrapper.dataset.file = filePath;

    // Header
    const header = document.createElement('div');
    header.className = 'excalidraw-embed-header';

    const icon = document.createElement('span');
    icon.className = 'excalidraw-embed-icon';
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`;

    const label = document.createElement('span');
    label.className = 'excalidraw-embed-label';
    label.textContent = filePath.replace(/\.excalidraw$/i, '');

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'excalidraw-embed-btn';
    expandBtn.title = 'Expand diagram';
    expandBtn.setAttribute('aria-label', 'Toggle diagram size');
    expandBtn.textContent = 'Expand';

    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'excalidraw-embed-btn';
    maxBtn.title = 'Maximize diagram';
    maxBtn.setAttribute('aria-label', 'Maximize diagram');
    maxBtn.textContent = 'Max';

    header.append(icon, label, expandBtn, maxBtn);

    // Iframe
    const theme = this.getTheme?.() || 'dark';
    const iframe = document.createElement('iframe');
    iframe.className = 'excalidraw-embed-iframe';
    const iframeUrl = new URL('/excalidraw-editor.html', window.location.origin);
    iframeUrl.searchParams.set('file', filePath);
    iframeUrl.searchParams.set('theme', theme);
    const localUser = this.getLocalUser?.();
    if (localUser?.name) {
      iframeUrl.searchParams.set('userName', localUser.name);
    }
    if (localUser?.color) {
      iframeUrl.searchParams.set('userColor', localUser.color);
    }
    if (localUser?.colorLight) {
      iframeUrl.searchParams.set('userColorLight', localUser.colorLight);
    }
    if (localUser?.peerId) {
      iframeUrl.searchParams.set('userPeerId', localUser.peerId);
    }
    const serverOverride = new URLSearchParams(window.location.search).get('server');
    if (serverOverride) {
      iframeUrl.searchParams.set('server', serverOverride);
    }
    iframe.src = iframeUrl.toString();
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    iframe.setAttribute('loading', 'lazy');
    iframe.title = `Excalidraw: ${filePath}`;
    iframe.style.height = `${DEFAULT_HEIGHT}px`;

    // Resize handle
    const resizer = document.createElement('div');
    resizer.className = 'excalidraw-embed-resizer';
    resizer.title = 'Drag to resize';
    this._setupResizer(resizer, iframe);

    wrapper.append(header, iframe, resizer);

    // Expand/collapse toggle
    let isExpanded = false;
    let isMaximized = false;
    let restoreHeight = `${DEFAULT_HEIGHT}px`;

    const exitMaximize = () => {
      if (!isMaximized) return;
      isMaximized = false;
      wrapper.classList.remove('is-maximized');
      maxBtn.textContent = 'Max';
      maxBtn.title = 'Maximize diagram';
      maxBtn.setAttribute('aria-label', 'Maximize diagram');
      document.body.classList.remove('excalidraw-maximized-open');
      iframe.style.height = restoreHeight;
      if (this.maximizedEmbed?.wrapper === wrapper) {
        this.maximizedEmbed = null;
      }
    };

    const enterMaximize = () => {
      if (isMaximized) return;
      this._exitMaximizedEmbed();
      isMaximized = true;
      restoreHeight = iframe.style.height || `${DEFAULT_HEIGHT}px`;
      wrapper.classList.add('is-maximized');
      maxBtn.textContent = 'Min';
      maxBtn.title = 'Restore diagram size';
      maxBtn.setAttribute('aria-label', 'Restore diagram size');
      document.body.classList.add('excalidraw-maximized-open');
      this.maximizedEmbed = { wrapper, exit: exitMaximize };
    };

    expandBtn.addEventListener('click', () => {
      if (isMaximized) return;
      isExpanded = !isExpanded;
      wrapper.classList.toggle('is-expanded', isExpanded);
      expandBtn.textContent = isExpanded ? 'Collapse' : 'Expand';

      if (isExpanded) {
        iframe.style.height = `${Math.max(600, window.innerHeight * 0.7)}px`;
      } else {
        iframe.style.height = `${DEFAULT_HEIGHT}px`;
      }
    });

    maxBtn.addEventListener('click', () => {
      if (isMaximized) {
        exitMaximize();
      } else {
        enterMaximize();
      }
    });

    this.activeEmbeds.set(filePath, { iframe, container: wrapper });
    return wrapper;
  }

  _setupResizer(resizer, iframe) {
    let startY = 0;
    let startHeight = 0;

    const onPointerMove = (e) => {
      const delta = e.clientY - startY;
      const newHeight = Math.min(Math.max(startHeight + delta, MIN_HEIGHT), MAX_HEIGHT);
      iframe.style.height = `${newHeight}px`;
      iframe.style.pointerEvents = 'none';
    };

    const onPointerUp = () => {
      iframe.style.pointerEvents = '';
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startHeight = iframe.offsetHeight;
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
  }

  _onMessage(event) {
    if (event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'excalidraw-editor') return;

    if (msg.type === 'ready') {
      // Could notify parent that editor is ready
    }
  }

  _onKeyDown(event) {
    if (event.key === 'Escape') {
      this._exitMaximizedEmbed();
    }
  }

  _exitMaximizedEmbed() {
    if (this.maximizedEmbed?.exit) {
      this.maximizedEmbed.exit();
    }
    this.maximizedEmbed = null;
    document.body.classList.remove('excalidraw-maximized-open');
  }
}
