import { clamp } from '../domain/vault-utils.js';
import { getRenderProfile, isLargeDocumentStats } from './preview-render-profile.js';

const MERMAID_ZOOM = {
  default: 1,
  animationDurationMs: 160,
  max: 3,
  min: 0.5,
  step: 0.1,
};
const PLANTUML_ZOOM = {
  default: 1,
  animationDurationMs: 160,
  max: 3,
  min: 0.1,
  step: 0.1,
};
const IDLE_RENDER_TIMEOUT_MS = 500;
const MERMAID_BATCH_SIZE = 2;
const MERMAID_SCRIPT_PATH = '/assets/vendor/mermaid/mermaid.min.js';
const PLANTUML_BATCH_SIZE = 2;

function requestIdleRender(callback, timeout) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout });
  }

  return window.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => 0,
    });
  }, 1);
}

function cancelIdleRender(id) {
  if (id === null) {
    return;
  }

  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(id);
    return;
  }

  window.clearTimeout(id);
}

function syncAttribute(target, source, name) {
  const nextValue = source.getAttribute(name);
  if (nextValue === null) {
    target.removeAttribute(name);
    return;
  }

  target.setAttribute(name, nextValue);
}

function getSvgSize(svg) {
  const viewBox = svg.viewBox?.baseVal;
  const attributeWidth = Number.parseFloat(svg.getAttribute('width') || '');
  const attributeHeight = Number.parseFloat(svg.getAttribute('height') || '');
  const rect = svg.getBoundingClientRect();
  const bbox = typeof svg.getBBox === 'function' ? svg.getBBox() : null;

  return {
    height: viewBox?.height || bbox?.height || attributeHeight || rect.height || 480,
    width: viewBox?.width || bbox?.width || attributeWidth || rect.width || 640,
  };
}

function normalizeMermaidSvg(svg) {
  if (!svg || typeof svg.getBBox !== 'function') {
    return getSvgSize(svg);
  }

  try {
    const bbox = svg.getBBox();
    if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
      return getSvgSize(svg);
    }

    const padding = 16;
    const x = bbox.x - padding;
    const y = bbox.y - padding;
    const width = bbox.width + (padding * 2);
    const height = bbox.height + (padding * 2);

    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    return { width, height };
  } catch {
    return getSvgSize(svg);
  }
}

function getFrameViewportSize(frame) {
  const styles = window.getComputedStyle(frame);
  const paddingX = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');
  const paddingY = Number.parseFloat(styles.paddingTop || '0') + Number.parseFloat(styles.paddingBottom || '0');

  return {
    height: Math.max(frame.clientHeight - paddingY, 0),
    width: Math.max(frame.clientWidth - paddingX, 0),
  };
}

function easeOutCubic(progress) {
  return 1 - ((1 - progress) ** 3);
}

function createMermaidPlaceholderCard(key) {
  const card = document.createElement('div');
  card.className = 'mermaid-placeholder-card';

  const copy = document.createElement('div');
  copy.className = 'mermaid-placeholder-copy';

  const title = document.createElement('strong');
  title.textContent = 'Mermaid diagram';

  const subtitle = document.createElement('span');
  subtitle.textContent = 'Loads when visible';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mermaid-placeholder-btn';
  button.dataset.mermaidKey = key;
  button.textContent = 'Render';

  copy.append(title, subtitle);
  card.append(copy, button);
  return card;
}

function createPlantUmlPlaceholderCard(key, message = 'Renders server-side when visible') {
  const card = document.createElement('div');
  card.className = 'plantuml-placeholder-card';

  const copy = document.createElement('div');
  copy.className = 'plantuml-placeholder-copy';

  const title = document.createElement('strong');
  title.textContent = 'PlantUML diagram';

  const subtitle = document.createElement('span');
  subtitle.textContent = message;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plantuml-placeholder-btn';
  button.dataset.plantumlKey = key;
  button.textContent = 'Render';

  copy.append(title, subtitle);
  card.append(copy, button);
  return card;
}

function sanitizeSvgMarkup(svgMarkup) {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const svg = documentNode.documentElement;

  if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Renderer returned invalid SVG');
  }

  documentNode.querySelectorAll('script, foreignObject').forEach((node) => {
    node.remove();
  });

  Array.from(documentNode.querySelectorAll('*')).forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || '';
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        return;
      }

      if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return svg.outerHTML;
}

function isNearViewport(element, root, marginPx) {
  if (!element || !root) {
    return false;
  }

  const rootRect = root.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  return (
    elementRect.bottom >= (rootRect.top - marginPx)
    && elementRect.top <= (rootRect.bottom + marginPx)
  );
}

export class PreviewRenderer {
  constructor({
    getContent,
    getFileList,
    onAfterRenderCommit,
    onBeforeRenderCommit,
    onRenderComplete,
    outlineController,
    previewContainer,
    previewElement,
  }) {
    this.getContent = getContent;
    this.getFileList = getFileList;
    this.onAfterRenderCommit = onAfterRenderCommit;
    this.onBeforeRenderCommit = onBeforeRenderCommit;
    this.onRenderComplete = onRenderComplete;
    this.outlineController = outlineController;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.renderHost = null;

    this.frameId = null;
    this.idleId = null;
    this.timeoutId = null;
    this.pendingRenderVersion = 0;
    this.activeRenderVersion = 0;
    this.readyRenderVersion = 0;
    this.currentStats = null;
    this.currentTheme = document.documentElement?.dataset.theme === 'light' ? 'light' : 'dark';
    this.isLargeDocument = false;
    this.mermaidLoader = null;
    this.worker = null;
    this.workerDisabled = false;
    this.workerJob = null;

    this.mermaidObserver = null;
    this.mermaidIdleId = null;
    this.pendingMermaidShells = [];
    this.plantUmlObserver = null;
    this.plantUmlIdleId = null;
    this.pendingPlantUmlShells = [];
    this.hydrationPaused = false;
    this.mermaidHydrationInProgress = false;
    this.plantUmlHydrationInProgress = false;
    this.mermaidInstanceCounter = 0;
    this.plantUmlInstanceCounter = 0;
    this.preservedMermaidShells = new Map();
    this.preservedPlantUmlShells = new Map();
    this.plantUmlSvgCache = new Map();
    this.plantUmlFileInflightRequests = new Map();
    this.plantUmlInflightRequests = new Map();
    this.plantUmlShellRefits = new WeakMap();
    this.activeMaximizedPlantUmlShell = null;
    this.plantUmlResizeFrameId = null;

    this.handlePreviewClick = (event) => {
      const mermaidButton = event.target.closest('.mermaid-placeholder-btn');
      if (mermaidButton) {
        const shell = mermaidButton.closest('.mermaid-shell');
        if (!shell) {
          return;
        }

        event.preventDefault();
        this.enqueueMermaidShell(shell, { prioritize: true });
        return;
      }

      const plantUmlButton = event.target.closest('.plantuml-placeholder-btn');
      if (plantUmlButton) {
        const shell = plantUmlButton.closest('.plantuml-shell');
        if (!shell) {
          return;
        }

        event.preventDefault();
        this.enqueuePlantUmlShell(shell, { prioritize: true });
      }
    };

    this.handleWorkerMessage = (event) => {
      if (!this.workerJob || event.data?.renderVersion !== this.workerJob.renderVersion) {
        return;
      }

      const job = this.workerJob;
      this.workerJob = null;

      if (event.data?.error) {
        job.reject(new Error(event.data.error));
        return;
      }

      job.resolve({
        html: event.data.html,
        stats: event.data.stats,
      });
    };

    this.handleWorkerError = (event) => {
      const error = new Error(event.message || 'Preview worker failed');
      if (this.workerJob) {
        this.workerJob.reject(error);
        this.workerJob = null;
      }

      this.resetWorker('Preview worker failed', { disable: true });
    };

    this.handleWindowResize = () => {
      this.scheduleActivePlantUmlRefit();
    };

    this.previewElement?.addEventListener('click', this.handlePreviewClick);
    window.addEventListener('resize', this.handleWindowResize);
    this.setPhase('ready');
  }

  ensureRenderHost() {
    if (!this.previewElement) {
      return null;
    }

    if (this.renderHost?.isConnected && this.renderHost.parentElement === this.previewElement) {
      return this.renderHost;
    }

    let renderHost = this.previewElement.querySelector('[data-preview-render-host="true"]');
    if (!renderHost) {
      renderHost = document.createElement('div');
      renderHost.dataset.previewRenderHost = 'true';
      this.previewElement.appendChild(renderHost);
    }

    this.renderHost = renderHost;
    return this.renderHost;
  }

  getReservedPreviewHeight() {
    const currentRenderHeight = this.renderHost?.getBoundingClientRect?.().height ?? 0;
    const containerHeight = this.previewContainer?.clientHeight ?? 0;
    return Math.max(Math.round(currentRenderHeight), Math.round(containerHeight), 320);
  }

  beginDocumentLoad() {
    this.cancelScheduledRender();
    this.cancelMermaidHydration();
    this.cancelPlantUmlHydration();
    this.preservedMermaidShells.clear();
    this.preservedPlantUmlShells.clear();
    this.clearActivePlantUmlShell();
    this.pendingRenderVersion += 1;
    this.activeRenderVersion = this.pendingRenderVersion;
    this.readyRenderVersion = 0;
    this.currentStats = null;
    this.isLargeDocument = false;
    this.resetWorker('Document changed');
    const renderHost = this.ensureRenderHost();
    const reservedHeight = this.getReservedPreviewHeight();
    if (renderHost) {
      renderHost.replaceChildren();
      renderHost.style.minHeight = `${reservedHeight}px`;
    }
    const shell = document.createElement('div');
    shell.className = 'preview-shell';
    shell.style.minHeight = `${reservedHeight}px`;
    shell.textContent = 'Rendering preview…';
    renderHost?.append(shell);
    this.setPhase('shell');
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    const mermaid = window.mermaid;
    const highlightTheme = document.getElementById('hljs-theme');
    if (highlightTheme) {
      const { darkHref, lightHref } = highlightTheme.dataset;
      highlightTheme.href = theme === 'dark' ? darkHref : lightHref;
    }

    if (!mermaid) {
      return;
    }

    this.configureMermaid(mermaid);
    this.resetHydratedMermaids();
  }

  configureMermaid(mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      theme: this.currentTheme === 'dark' ? 'dark' : 'default',
      themeVariables: this.currentTheme === 'dark' ? {
        background: '#161822',
        clusterBkg: '#1a1c28',
        edgeLabelBackground: '#161822',
        lineColor: '#8b8ba0',
        mainBkg: '#1c1e2c',
        nodeBorder: '#383a50',
        primaryBorderColor: '#383a50',
        primaryColor: '#818cf8',
        primaryTextColor: '#e2e2ea',
        secondaryColor: '#1c1e2c',
        tertiaryColor: '#161822',
        titleColor: '#e2e2ea',
      } : {},
    });
  }

  ensureMermaid() {
    if (window.mermaid) {
      this.configureMermaid(window.mermaid);
      return Promise.resolve(window.mermaid);
    }

    if (this.mermaidLoader) {
      return this.mermaidLoader;
    }

    this.mermaidLoader = new Promise((resolve, reject) => {
      const onReady = () => {
        const mermaid = window.mermaid;
        if (!mermaid) {
          this.mermaidLoader = null;
          reject(new Error('Mermaid runtime failed to initialize'));
          return;
        }

        const readyScript = document.querySelector('script[data-collabmd-mermaid="true"]');
        readyScript?.setAttribute('data-collabmd-mermaid-state', 'ready');
        this.configureMermaid(mermaid);
        resolve(mermaid);
      };

      const onError = () => {
        this.mermaidLoader = null;
        const failedScript = document.querySelector('script[data-collabmd-mermaid="true"]');
        failedScript?.setAttribute('data-collabmd-mermaid-state', 'error');
        reject(new Error('Failed to load Mermaid runtime'));
      };

      const existingScript = document.querySelector('script[data-collabmd-mermaid="true"]');
      if (existingScript) {
        if (existingScript.getAttribute('data-collabmd-mermaid-state') === 'ready') {
          onReady();
          return;
        }

        if (existingScript.getAttribute('data-collabmd-mermaid-state') === 'error') {
          existingScript.remove();
        } else {
          existingScript.addEventListener('load', onReady, { once: true });
          existingScript.addEventListener('error', onError, { once: true });
          return;
        }
      }

      const script = document.createElement('script');
      script.src = MERMAID_SCRIPT_PATH;
      script.async = true;
      script.dataset.collabmdMermaid = 'true';
      script.dataset.collabmdMermaidState = 'loading';
      script.addEventListener('load', onReady, { once: true });
      script.addEventListener('error', onError, { once: true });
      document.head.appendChild(script);
    });

    return this.mermaidLoader;
  }

  queueRender() {
    const markdownText = this.getContent();
    const renderProfile = getRenderProfile(markdownText);

    this.cancelScheduledRender();

    this.pendingRenderVersion += 1;
    const scheduledVersion = this.pendingRenderVersion;

    const scheduleRender = () => {
      if (renderProfile.deferUntilIdle) {
        this.idleId = requestIdleRender(() => {
          this.idleId = null;
          this.frameId = requestAnimationFrame(() => {
            this.frameId = null;
            this.timeoutId = null;
            void this.render(markdownText, scheduledVersion);
          });
        }, IDLE_RENDER_TIMEOUT_MS);
        return;
      }

      this.frameId = requestAnimationFrame(() => {
        this.frameId = null;
        this.timeoutId = null;
        void this.render(markdownText, scheduledVersion);
      });
    };

    this.timeoutId = setTimeout(scheduleRender, renderProfile.debounceMs);
  }

  async render(markdownText = this.getContent(), renderVersion = this.pendingRenderVersion) {
    if (!this.previewElement) {
      return;
    }

    try {
      const result = await this.compilePreview(markdownText, renderVersion);
      if (renderVersion !== this.pendingRenderVersion) {
        return;
      }

      this.commitBaseRender(result, renderVersion);
    } catch (error) {
      if (renderVersion !== this.pendingRenderVersion) {
        return;
      }

      console.warn('[preview] Failed to render preview:', error);
    }
  }

  destroy() {
    this.cancelScheduledRender();
    this.cancelMermaidHydration();
    this.cancelPlantUmlHydration();
    this.preservedMermaidShells.clear();
    this.preservedPlantUmlShells.clear();
    this.clearActivePlantUmlShell();
    if (this.plantUmlResizeFrameId) {
      cancelAnimationFrame(this.plantUmlResizeFrameId);
      this.plantUmlResizeFrameId = null;
    }
    this.resetWorker('Preview renderer destroyed');
    this.previewElement?.removeEventListener('click', this.handlePreviewClick);
    window.removeEventListener('resize', this.handleWindowResize);
  }

  setPhase(phase) {
    if (this.previewElement) {
      this.previewElement.dataset.renderPhase = phase;
    }
  }

  cancelScheduledRender() {
    clearTimeout(this.timeoutId);
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
    }
    cancelIdleRender(this.idleId);
    this.frameId = null;
    this.idleId = null;
    this.timeoutId = null;
  }

  cancelMermaidHydration() {
    if (this.mermaidObserver) {
      this.mermaidObserver.disconnect();
      this.mermaidObserver = null;
    }

    cancelIdleRender(this.mermaidIdleId);
    this.mermaidIdleId = null;
    this.pendingMermaidShells = [];
    this.mermaidHydrationInProgress = false;
  }

  cancelPlantUmlHydration() {
    if (this.plantUmlObserver) {
      this.plantUmlObserver.disconnect();
      this.plantUmlObserver = null;
    }

    cancelIdleRender(this.plantUmlIdleId);
    this.plantUmlIdleId = null;
    this.pendingPlantUmlShells = [];
    this.plantUmlHydrationInProgress = false;
  }

  clearActivePlantUmlShell() {
    this.activeMaximizedPlantUmlShell = null;
  }

  syncActivePlantUmlShell() {
    if (
      this.activeMaximizedPlantUmlShell?.isConnected
      && this.activeMaximizedPlantUmlShell.classList.contains('is-maximized')
    ) {
      return this.activeMaximizedPlantUmlShell;
    }

    this.clearActivePlantUmlShell();
    return null;
  }

  scheduleActivePlantUmlRefit() {
    if (this.plantUmlResizeFrameId) {
      cancelAnimationFrame(this.plantUmlResizeFrameId);
    }

    this.plantUmlResizeFrameId = requestAnimationFrame(() => {
      this.plantUmlResizeFrameId = null;
      const activeShell = this.syncActivePlantUmlShell();
      if (!activeShell) {
        return;
      }

      this.plantUmlShellRefits.get(activeShell)?.();
    });
  }

  setHydrationPaused(paused) {
    this.hydrationPaused = Boolean(paused);

    if (this.hydrationPaused) {
      cancelIdleRender(this.mermaidIdleId);
      this.mermaidIdleId = null;
      cancelIdleRender(this.plantUmlIdleId);
      this.plantUmlIdleId = null;
      return;
    }

    this.hydrateVisibleMermaids();
    this.scheduleMermaidHydration();
    this.hydrateVisiblePlantUmls();
    this.schedulePlantUmlHydration();
    this.updateHydrationPhase();
  }

  resetWorker(reason, { disable = false } = {}) {
    if (this.workerJob) {
      this.workerJob.reject(new Error(reason));
      this.workerJob = null;
    }

    if (this.worker) {
      this.worker.removeEventListener('message', this.handleWorkerMessage);
      this.worker.removeEventListener('error', this.handleWorkerError);
      this.worker.terminate();
      this.worker = null;
    }

    if (disable) {
      this.workerDisabled = true;
    }
  }

  ensureWorker() {
    if (this.workerDisabled || typeof Worker !== 'function') {
      return null;
    }

    if (this.worker) {
      return this.worker;
    }

    try {
      this.worker = new Worker(new URL('./preview-render-worker.js', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', this.handleWorkerMessage);
      this.worker.addEventListener('error', this.handleWorkerError);
      return this.worker;
    } catch {
      this.workerDisabled = true;
      return null;
    }
  }

  async compilePreview(markdownText, renderVersion) {
    const worker = this.ensureWorker();

    if (worker) {
      if (this.workerJob) {
        this.resetWorker('Superseded preview render');
      }

      const activeWorker = this.ensureWorker();
      return new Promise((resolve, reject) => {
        this.workerJob = { reject, renderVersion, resolve };
        activeWorker.postMessage({
          fileList: this.getFileList?.() ?? [],
          markdownText,
          renderVersion,
        });
      });
    }

    const { compilePreviewDocument } = await import('./preview-render-compiler.js');
    return compilePreviewDocument({
      fileList: this.getFileList?.() ?? [],
      markdownText,
    });
  }

  commitBaseRender({ html, stats }, renderVersion) {
    this.activeRenderVersion = renderVersion;
    this.readyRenderVersion = 0;
    this.currentStats = stats;
    this.isLargeDocument = isLargeDocumentStats(stats);

    this.cancelMermaidHydration();
    this.cancelPlantUmlHydration();
    document.body.classList.remove('mermaid-maximized-open');
    document.body.classList.remove('plantuml-maximized-open');
    this.preserveHydratedMermaidsForCommit();
    this.preserveHydratedPlantUmlsForCommit();

    this.onBeforeRenderCommit?.(this.previewElement);
    const renderHost = this.ensureRenderHost();
    if (renderHost) {
      renderHost.innerHTML = html;
    }
    this.reconcileHydratedMermaids();
    this.reconcileHydratedPlantUmls();
    this.setPhase('base');

    this.outlineController.refresh();
    this.onAfterRenderCommit?.(this.previewElement, {
      ...stats,
      isLargeDocument: this.isLargeDocument,
      renderVersion,
    });

    const mermaidShellCount = this.setupMermaidHydration(renderVersion);
    const plantUmlShellCount = this.setupPlantUmlHydration(renderVersion);

    if (mermaidShellCount === 0 && plantUmlShellCount === 0) {
      this.notifyReady();
    }
  }

  preserveHydratedMermaidsForCommit() {
    this.preservedMermaidShells.clear();
    if (!this.previewElement) {
      return;
    }

    Array.from(this.previewElement.querySelectorAll('.mermaid-shell[data-mermaid-hydrated="true"][data-mermaid-key]')).forEach((shell) => {
      const key = shell.dataset.mermaidKey;
      const source = shell.querySelector('.mermaid-source')?.textContent ?? '';
      if (!key || !source) {
        return;
      }

      if (shell.isConnected) {
        shell.remove();
      }

      this.preservedMermaidShells.set(key, {
        key,
        shell,
        source,
      });
    });
  }

  preserveHydratedPlantUmlsForCommit() {
    this.preservedPlantUmlShells.clear();
    if (!this.previewElement) {
      return;
    }

    Array.from(this.previewElement.querySelectorAll('.plantuml-shell[data-plantuml-hydrated="true"][data-plantuml-key]')).forEach((shell) => {
      const key = shell.dataset.plantumlKey;
      const source = shell.querySelector('.plantuml-source')?.textContent ?? '';
      if (!key || !source) {
        return;
      }

      if (shell.isConnected) {
        shell.remove();
      }

      this.preservedPlantUmlShells.set(key, {
        key,
        shell,
        source,
      });
    });
  }

  reconcileHydratedMermaids() {
    if (!this.previewElement || this.preservedMermaidShells.size === 0) {
      this.preservedMermaidShells.clear();
      return;
    }

    let restoredMaximizedShell = false;
    Array.from(this.previewElement.querySelectorAll('.mermaid-shell[data-mermaid-key]')).forEach((nextShell) => {
      const key = nextShell.dataset.mermaidKey;
      const preservedEntry = key ? this.preservedMermaidShells.get(key) : null;
      if (!preservedEntry) {
        return;
      }

      const nextSource = nextShell.querySelector('.mermaid-source')?.textContent ?? '';
      if (nextSource !== preservedEntry.source) {
        return;
      }

      this.syncPreservedMermaidShell(preservedEntry.shell, nextShell);
      nextShell.replaceWith(preservedEntry.shell);
      restoredMaximizedShell = restoredMaximizedShell || preservedEntry.shell.classList.contains('is-maximized');
      this.preservedMermaidShells.delete(key);
    });

    this.preservedMermaidShells.clear();
    if (restoredMaximizedShell) {
      document.body.classList.add('mermaid-maximized-open');
    }
  }

  reconcileHydratedPlantUmls() {
    if (!this.previewElement || this.preservedPlantUmlShells.size === 0) {
      this.preservedPlantUmlShells.clear();
      return;
    }

    let restoredMaximizedShell = false;
    Array.from(this.previewElement.querySelectorAll('.plantuml-shell[data-plantuml-key]')).forEach((nextShell) => {
      const key = nextShell.dataset.plantumlKey;
      const preservedEntry = key ? this.preservedPlantUmlShells.get(key) : null;
      if (!preservedEntry) {
        return;
      }

      const nextSource = nextShell.querySelector('.plantuml-source')?.textContent ?? '';
      if (nextSource !== preservedEntry.source) {
        return;
      }

      this.syncPreservedPlantUmlShell(preservedEntry.shell, nextShell);
      nextShell.replaceWith(preservedEntry.shell);
      restoredMaximizedShell = restoredMaximizedShell || preservedEntry.shell.classList.contains('is-maximized');
      this.preservedPlantUmlShells.delete(key);
    });

    this.preservedPlantUmlShells.clear();
    if (restoredMaximizedShell) {
      document.body.classList.add('plantuml-maximized-open');
    }
    this.syncActivePlantUmlShell();
  }

  syncPreservedMermaidShell(preservedShell, nextShell) {
    syncAttribute(preservedShell, nextShell, 'data-source-line');
    syncAttribute(preservedShell, nextShell, 'data-source-line-end');
    syncAttribute(preservedShell, nextShell, 'data-mermaid-key');
    syncAttribute(preservedShell, nextShell, 'data-mermaid-source-hash');

    preservedShell.classList.add('mermaid-shell');
    preservedShell.dataset.mermaidHydrated = 'true';
    preservedShell.removeAttribute('data-mermaid-queued');

    const nextSourceNode = nextShell.querySelector('.mermaid-source');
    let preservedSourceNode = preservedShell.querySelector('.mermaid-source');

    if (!preservedSourceNode && nextSourceNode) {
      preservedSourceNode = nextSourceNode.cloneNode(true);
      preservedShell.prepend(preservedSourceNode);
    }

    if (preservedSourceNode && nextSourceNode) {
      preservedSourceNode.textContent = nextSourceNode.textContent ?? '';
      preservedSourceNode.hidden = true;
    }
  }

  syncPreservedPlantUmlShell(preservedShell, nextShell) {
    syncAttribute(preservedShell, nextShell, 'data-source-line');
    syncAttribute(preservedShell, nextShell, 'data-source-line-end');
    syncAttribute(preservedShell, nextShell, 'data-plantuml-key');
    syncAttribute(preservedShell, nextShell, 'data-plantuml-target');
    syncAttribute(preservedShell, nextShell, 'data-plantuml-label');
    syncAttribute(preservedShell, nextShell, 'data-plantuml-source-hash');

    preservedShell.classList.add('plantuml-shell');
    preservedShell.dataset.plantumlHydrated = 'true';
    preservedShell.removeAttribute('data-plantuml-queued');

    const nextSourceNode = nextShell.querySelector('.plantuml-source');
    let preservedSourceNode = preservedShell.querySelector('.plantuml-source');

    if (!preservedSourceNode && nextSourceNode) {
      preservedSourceNode = nextSourceNode.cloneNode(true);
      preservedShell.prepend(preservedSourceNode);
    }

    if (preservedSourceNode && nextSourceNode) {
      preservedSourceNode.textContent = nextSourceNode.textContent ?? '';
      preservedSourceNode.hidden = true;
    }
  }

  setupMermaidHydration(renderVersion) {
    const shells = Array.from(this.previewElement.querySelectorAll('.mermaid-shell'));
    if (shells.length === 0) {
      return 0;
    }

    this.mermaidObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        this.enqueueMermaidShell(entry.target);
      });
    }, {
      root: this.previewContainer,
      rootMargin: this.isLargeDocument ? '180px 0px' : '420px 0px',
    });

    shells.forEach((shell) => this.mermaidObserver.observe(shell));

    requestAnimationFrame(() => {
      if (renderVersion !== this.activeRenderVersion) {
        return;
      }

      this.hydrateVisibleMermaids();
      this.updateHydrationPhase();
    });

    return shells.length;
  }

  hydrateVisibleMermaids() {
    if (this.hydrationPaused || !this.previewElement || !this.previewContainer) {
      return;
    }

    const margin = this.isLargeDocument ? 180 : 420;
    Array.from(this.previewElement.querySelectorAll('.mermaid-shell')).forEach((shell) => {
      if (isNearViewport(shell, this.previewContainer, margin)) {
        this.enqueueMermaidShell(shell, { prioritize: true });
      }
    });
  }

  enqueueMermaidShell(shell, { prioritize = false } = {}) {
    if (!shell?.isConnected || shell.dataset.mermaidHydrated === 'true' || shell.dataset.mermaidQueued === 'true') {
      return;
    }

    shell.dataset.mermaidQueued = 'true';
    if (prioritize) {
      this.pendingMermaidShells.unshift(shell);
    } else {
      this.pendingMermaidShells.push(shell);
    }

    if (this.hydrationPaused) {
      return;
    }

    this.updateHydrationPhase();
    this.scheduleMermaidHydration();
  }

  scheduleMermaidHydration() {
    if (this.hydrationPaused || this.mermaidHydrationInProgress || this.mermaidIdleId !== null) {
      return;
    }

    this.mermaidIdleId = requestIdleRender(() => {
      this.mermaidIdleId = null;
      void this.flushMermaidHydrationQueue();
    }, IDLE_RENDER_TIMEOUT_MS);
  }

  async flushMermaidHydrationQueue() {
    if (this.hydrationPaused || this.mermaidHydrationInProgress) {
      return;
    }

    const shells = [];
    while (this.pendingMermaidShells.length > 0 && shells.length < MERMAID_BATCH_SIZE) {
      const nextShell = this.pendingMermaidShells.shift();
      if (!nextShell?.isConnected || nextShell.dataset.mermaidHydrated === 'true') {
        continue;
      }

      nextShell.removeAttribute('data-mermaid-queued');
      shells.push(nextShell);
    }

    if (shells.length === 0) {
      this.updateHydrationPhase();
      return;
    }

    this.mermaidHydrationInProgress = true;
    this.setPhase('hydrating');

    let mermaid = null;
    try {
      mermaid = await this.ensureMermaid();
    } catch (error) {
      console.warn('[preview] Mermaid runtime failed to load:', error);
      shells.forEach((shell) => {
        shell.removeAttribute('data-mermaid-queued');
      });
      this.mermaidHydrationInProgress = false;
      this.updateHydrationPhase();
      return;
    }

    for (const shell of shells) {
      await this.hydrateMermaidShell(shell, mermaid);
    }

    this.mermaidHydrationInProgress = false;

    if (this.pendingMermaidShells.length > 0) {
      this.scheduleMermaidHydration();
    }

    this.updateHydrationPhase();
  }

  async hydrateMermaidShell(shell, mermaid) {
    if (!mermaid || !shell?.isConnected || shell.dataset.mermaidHydrated === 'true') {
      return;
    }

    const sourceNode = shell.querySelector('.mermaid-source');
    const source = sourceNode?.textContent ?? '';
    if (!source.trim()) {
      return;
    }

    const placeholder = shell.querySelector('.mermaid-placeholder-card');
    placeholder?.remove();

    const diagram = document.createElement('div');
    diagram.className = 'mermaid mermaid-render-node';
    diagram.id = shell.dataset.mermaidKey || `mermaid-${Date.now()}`;
    const sourceLine = shell.getAttribute('data-source-line');
    const sourceLineEnd = shell.getAttribute('data-source-line-end');
    if (sourceLine) {
      diagram.setAttribute('data-source-line', sourceLine);
    }
    if (sourceLineEnd) {
      diagram.setAttribute('data-source-line-end', sourceLineEnd);
    }
    diagram.textContent = source;
    shell.appendChild(diagram);

    try {
      await mermaid.run({ nodes: [diagram] });
      if (!diagram.isConnected || shell !== diagram.parentElement) {
        return;
      }

      this.enhanceMermaidDiagram(shell, diagram);
      shell.dataset.mermaidHydrated = 'true';
      shell.dataset.mermaidInstanceId = String(++this.mermaidInstanceCounter);
    } catch (error) {
      console.warn('[preview] Mermaid render failed:', error);
      diagram.remove();
      if (!shell.querySelector('.mermaid-placeholder-card')) {
        sourceNode?.after(createMermaidPlaceholderCard(shell.dataset.mermaidKey || 'mermaid'));
      }
    }
  }

  resetHydratedMermaids() {
    if (!this.previewElement) {
      return;
    }

    const hydratedShells = Array.from(this.previewElement.querySelectorAll('.mermaid-shell[data-mermaid-hydrated="true"]'));
    if (hydratedShells.length === 0) {
      return;
    }

    hydratedShells.forEach((shell) => {
      shell.removeAttribute('data-mermaid-hydrated');
      shell.querySelector(':scope > .mermaid-toolbar')?.remove();
      shell.querySelector(':scope > .mermaid-frame')?.remove();
      shell.querySelector(':scope > .mermaid-render-node')?.remove();
      if (!shell.querySelector('.mermaid-placeholder-card')) {
        shell.querySelector('.mermaid-source')?.after(createMermaidPlaceholderCard(shell.dataset.mermaidKey || 'mermaid'));
      }
      this.enqueueMermaidShell(shell, { prioritize: true });
    });
  }

  setupPlantUmlHydration(renderVersion) {
    const shells = Array.from(this.previewElement.querySelectorAll('.plantuml-shell'));
    if (shells.length === 0) {
      return 0;
    }

    this.plantUmlObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        this.enqueuePlantUmlShell(entry.target);
      });
    }, {
      root: this.previewContainer,
      rootMargin: this.isLargeDocument ? '180px 0px' : '420px 0px',
    });

    shells.forEach((shell) => this.plantUmlObserver.observe(shell));

    requestAnimationFrame(() => {
      if (renderVersion !== this.activeRenderVersion) {
        return;
      }

      this.hydrateVisiblePlantUmls();
      this.updateHydrationPhase();
    });

    return shells.length;
  }

  hydrateVisiblePlantUmls() {
    if (this.hydrationPaused || !this.previewElement || !this.previewContainer) {
      return;
    }

    const margin = this.isLargeDocument ? 180 : 420;
    Array.from(this.previewElement.querySelectorAll('.plantuml-shell')).forEach((shell) => {
      if (isNearViewport(shell, this.previewContainer, margin)) {
        this.enqueuePlantUmlShell(shell, { prioritize: true });
      }
    });
  }

  enqueuePlantUmlShell(shell, { prioritize = false } = {}) {
    if (!shell?.isConnected || shell.dataset.plantumlHydrated === 'true' || shell.dataset.plantumlQueued === 'true') {
      return;
    }

    shell.dataset.plantumlQueued = 'true';
    if (prioritize) {
      this.pendingPlantUmlShells.unshift(shell);
    } else {
      this.pendingPlantUmlShells.push(shell);
    }

    if (this.hydrationPaused) {
      return;
    }

    this.updateHydrationPhase();
    this.schedulePlantUmlHydration();
  }

  schedulePlantUmlHydration() {
    if (this.hydrationPaused || this.plantUmlHydrationInProgress || this.plantUmlIdleId !== null) {
      return;
    }

    this.plantUmlIdleId = requestIdleRender(() => {
      this.plantUmlIdleId = null;
      void this.flushPlantUmlHydrationQueue();
    }, IDLE_RENDER_TIMEOUT_MS);
  }

  async flushPlantUmlHydrationQueue() {
    if (this.hydrationPaused || this.plantUmlHydrationInProgress) {
      return;
    }

    const shells = [];
    while (this.pendingPlantUmlShells.length > 0 && shells.length < PLANTUML_BATCH_SIZE) {
      const nextShell = this.pendingPlantUmlShells.shift();
      if (!nextShell?.isConnected || nextShell.dataset.plantumlHydrated === 'true') {
        continue;
      }

      nextShell.removeAttribute('data-plantuml-queued');
      shells.push(nextShell);
    }

    if (shells.length === 0) {
      this.updateHydrationPhase();
      return;
    }

    this.plantUmlHydrationInProgress = true;
    this.setPhase('hydrating');

    for (const shell of shells) {
      await this.hydratePlantUmlShell(shell);
    }

    this.plantUmlHydrationInProgress = false;

    if (this.pendingPlantUmlShells.length > 0) {
      this.schedulePlantUmlHydration();
    }

    this.updateHydrationPhase();
  }

  async hydratePlantUmlShell(shell) {
    if (!shell?.isConnected || shell.dataset.plantumlHydrated === 'true') {
      return;
    }

    let sourceNode = shell.querySelector('.plantuml-source');
    if (!sourceNode) {
      sourceNode = document.createElement('span');
      sourceNode.className = 'plantuml-source';
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }

    const placeholder = shell.querySelector('.plantuml-placeholder-card');
    placeholder?.remove();

    try {
      let source = sourceNode.textContent ?? '';
      if (!source.trim() && shell.dataset.plantumlTarget) {
        source = await this.fetchPlantUmlSource(shell.dataset.plantumlTarget);
        if (!shell.isConnected) {
          return;
        }
        sourceNode.textContent = source;
      }

      if (!source.trim()) {
        throw new Error(shell.dataset.plantumlTarget ? 'PlantUML file is empty' : 'PlantUML source is empty');
      }

      const svgMarkup = await this.fetchPlantUmlSvg(source);

      if (!shell.isConnected) {
        return;
      }

      this.enhancePlantUmlDiagram(shell, svgMarkup);
      shell.dataset.plantumlHydrated = 'true';
      shell.dataset.plantumlInstanceId = String(++this.plantUmlInstanceCounter);
    } catch (error) {
      console.warn('[preview] PlantUML render failed:', error);
      shell.querySelector(':scope > .plantuml-toolbar')?.remove();
      shell.querySelector(':scope > .plantuml-frame')?.remove();
      if (!shell.querySelector('.plantuml-placeholder-card')) {
        sourceNode?.after(createPlantUmlPlaceholderCard(
          shell.dataset.plantumlKey || 'plantuml',
          error instanceof Error ? error.message : 'Render failed',
        ));
      }
    }
  }

  updateHydrationPhase() {
    if (this.hydrationPaused) {
      if (
        this.pendingMermaidShells.length > 0
        || this.pendingPlantUmlShells.length > 0
        || this.mermaidHydrationInProgress
        || this.plantUmlHydrationInProgress
      ) {
        this.setPhase('base');
        return;
      }
    }

    if (
      this.mermaidHydrationInProgress
      || this.plantUmlHydrationInProgress
      || this.pendingMermaidShells.length > 0
      || this.pendingPlantUmlShells.length > 0
    ) {
      this.setPhase('hydrating');
      return;
    }

    this.notifyReady();
  }

  notifyReady() {
    if (this.renderHost) {
      this.renderHost.style.minHeight = '';
    }

    this.setPhase('ready');

    if (this.readyRenderVersion === this.activeRenderVersion) {
      return;
    }

    this.readyRenderVersion = this.activeRenderVersion;
    this.onRenderComplete?.({
      isLargeDocument: this.isLargeDocument,
      stats: this.currentStats,
    });
  }

  async fetchPlantUmlSvg(source) {
    const cacheKey = source;
    if (this.plantUmlSvgCache.has(cacheKey)) {
      return this.plantUmlSvgCache.get(cacheKey);
    }

    if (this.plantUmlInflightRequests.has(cacheKey)) {
      return this.plantUmlInflightRequests.get(cacheKey);
    }

    const request = fetch('/api/plantuml/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || typeof data.svg !== 'string') {
          throw new Error(data?.error || 'Failed to render PlantUML');
        }

        const sanitized = sanitizeSvgMarkup(data.svg);
        this.plantUmlSvgCache.set(cacheKey, sanitized);
        return sanitized;
      })
      .finally(() => {
        this.plantUmlInflightRequests.delete(cacheKey);
      });

    this.plantUmlInflightRequests.set(cacheKey, request);
    return request;
  }

  async fetchPlantUmlSource(filePath) {
    const target = String(filePath ?? '').trim();
    if (!target) {
      throw new Error('Missing PlantUML file path');
    }

    if (this.plantUmlFileInflightRequests.has(target)) {
      return this.plantUmlFileInflightRequests.get(target);
    }

    const request = fetch(`/api/file?path=${encodeURIComponent(target)}`, {
      headers: {
        Accept: 'application/json',
      },
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || typeof data?.content !== 'string') {
          throw new Error(data?.error || `Failed to load ${target}`);
        }

        return data.content;
      })
      .finally(() => {
        this.plantUmlFileInflightRequests.delete(target);
      });

    this.plantUmlFileInflightRequests.set(target, request);
    return request;
  }

  resetPlantUmlShell(shell, { clearCache = false, message = 'Renders server-side when visible' } = {}) {
    const source = shell.querySelector('.plantuml-source')?.textContent ?? '';
    if (clearCache && source) {
      this.plantUmlSvgCache.delete(source);
      this.plantUmlInflightRequests.delete(source);
    }

    this.plantUmlShellRefits.delete(shell);
    if (this.activeMaximizedPlantUmlShell === shell) {
      this.clearActivePlantUmlShell();
    }

    shell.removeAttribute('data-plantuml-hydrated');
    shell.removeAttribute('data-plantuml-instance-id');
    shell.removeAttribute('data-plantuml-queued');
    shell.classList.remove('is-maximized');
    if (!this.previewElement?.querySelector('.plantuml-shell.is-maximized')) {
      document.body.classList.remove('plantuml-maximized-open');
    }
    shell.querySelector(':scope > .plantuml-toolbar')?.remove();
    shell.querySelector(':scope > .plantuml-frame')?.remove();
    if (!shell.querySelector('.plantuml-placeholder-card')) {
      shell.querySelector('.plantuml-source')?.after(createPlantUmlPlaceholderCard(
        shell.dataset.plantumlKey || 'plantuml',
        message,
      ));
    }
  }

  enhancePlantUmlDiagram(shell, svgMarkup) {
    const container = document.createElement('div');
    container.innerHTML = svgMarkup;
    const svg = container.querySelector('svg');
    if (!svg) {
      throw new Error('Renderer returned invalid SVG');
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'plantuml-toolbar';

    const frame = document.createElement('div');
    frame.className = 'plantuml-frame';
    const decreaseButton = this.createPlantUmlToolButton('−', 'Zoom out');
    const increaseButton = this.createPlantUmlToolButton('+', 'Zoom in');
    const resetButton = this.createPlantUmlToolButton('Reset', 'Reset zoom');
    const reloadButton = this.createPlantUmlToolButton('Reload', 'Reload diagram');
    const maximizeButton = this.createPlantUmlToolButton('Max', 'Maximize diagram');
    maximizeButton.classList.add('plantuml-maximize-btn');
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'plantuml-zoom-label';
    zoomLabel.setAttribute('aria-live', 'polite');

    toolbar.append(decreaseButton, zoomLabel, resetButton, increaseButton, reloadButton, maximizeButton);

    const { width: baseWidth, height: baseHeight } = getSvgSize(svg);
    let currentZoom = PLANTUML_ZOOM.default;
    let defaultZoom = 1;
    let zoomAnimationFrameId = null;
    let isPanning = false;
    let activePointerId = null;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;

    svg.style.display = 'block';
    svg.style.margin = '0 auto';
    svg.style.maxWidth = 'none';

    const calculateDefaultZoom = () => {
      const viewport = getFrameViewportSize(frame);
      if (!Number.isFinite(baseWidth) || baseWidth <= 0 || viewport.width <= 0) {
        return PLANTUML_ZOOM.default;
      }

      return clamp(Math.min(PLANTUML_ZOOM.default, viewport.width / baseWidth), PLANTUML_ZOOM.min, PLANTUML_ZOOM.max);
    };

    const applyZoom = (nextZoom) => {
      currentZoom = clamp(nextZoom, PLANTUML_ZOOM.min, PLANTUML_ZOOM.max);

      svg.style.width = `${baseWidth * currentZoom}px`;
      svg.style.height = `${baseHeight * currentZoom}px`;
      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;

      decreaseButton.disabled = currentZoom <= PLANTUML_ZOOM.min;
      increaseButton.disabled = currentZoom >= PLANTUML_ZOOM.max;

      const viewport = getFrameViewportSize(frame);
      const isPannable = (baseWidth * currentZoom) > viewport.width || (baseHeight * currentZoom) > viewport.height;
      frame.classList.toggle('is-pannable', isPannable);
    };

    const getViewportCenter = () => ({
      x: frame.scrollLeft + (frame.clientWidth / 2),
      y: frame.scrollTop + (frame.clientHeight / 2),
    });

    const restoreViewportCenter = (previousZoom, nextZoom, center) => {
      if (previousZoom === 0) {
        return;
      }

      const scale = nextZoom / previousZoom;
      frame.scrollLeft = (center.x * scale) - (frame.clientWidth / 2);
      frame.scrollTop = (center.y * scale) - (frame.clientHeight / 2);
    };

    const animateZoomTo = (nextZoom) => {
      const targetZoom = clamp(nextZoom, PLANTUML_ZOOM.min, PLANTUML_ZOOM.max);
      const startZoom = currentZoom;

      if (targetZoom === startZoom) {
        return;
      }

      const center = getViewportCenter();
      const startedAt = performance.now();

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
      }

      const tick = (now) => {
        const progress = clamp((now - startedAt) / PLANTUML_ZOOM.animationDurationMs, 0, 1);
        const easedProgress = easeOutCubic(progress);
        const animatedZoom = startZoom + ((targetZoom - startZoom) * easedProgress);

        applyZoom(animatedZoom);
        restoreViewportCenter(startZoom, animatedZoom, center);

        if (progress < 1) {
          zoomAnimationFrameId = requestAnimationFrame(tick);
          return;
        }

        zoomAnimationFrameId = null;
        applyZoom(targetZoom);
        restoreViewportCenter(startZoom, targetZoom, center);
      };

      zoomAnimationFrameId = requestAnimationFrame(tick);
    };

    const zoomBy = (delta) => {
      animateZoomTo(currentZoom + delta);
    };

    const resetZoomToFit = ({ animate = false } = {}) => {
      defaultZoom = calculateDefaultZoom();

      if (animate && Math.abs(defaultZoom - currentZoom) > 0.001) {
        animateZoomTo(defaultZoom);
        return;
      }

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      applyZoom(defaultZoom);
      frame.scrollLeft = 0;
      frame.scrollTop = 0;
    };

    let resetZoomFrameId = null;
    const scheduleResetZoomToFit = () => {
      if (resetZoomFrameId) {
        cancelAnimationFrame(resetZoomFrameId);
      }

      resetZoomFrameId = requestAnimationFrame(() => {
        resetZoomFrameId = null;
        if (!shell.isConnected) {
          return;
        }

        resetZoomToFit();
      });
    };

    this.plantUmlShellRefits.set(shell, scheduleResetZoomToFit);

    decreaseButton.addEventListener('click', () => zoomBy(-PLANTUML_ZOOM.step));
    increaseButton.addEventListener('click', () => zoomBy(PLANTUML_ZOOM.step));
    resetButton.addEventListener('click', () => {
      resetZoomToFit({ animate: true });
    });

    const syncMaximizeButtonState = () => {
      const isMaximized = shell.classList.contains('is-maximized');
      maximizeButton.textContent = isMaximized ? 'Restore' : 'Max';
      maximizeButton.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    };

    const setMaximizedState = (shouldMaximize) => {
      if (shouldMaximize) {
        const activeContainer = this.previewElement.querySelector('.plantuml-shell.is-maximized');
        if (activeContainer && activeContainer !== shell) {
          activeContainer.classList.remove('is-maximized');
          this.plantUmlShellRefits.get(activeContainer)?.();
          const activeButton = activeContainer.querySelector('.plantuml-maximize-btn');
          if (activeButton) {
            activeButton.textContent = 'Max';
            activeButton.setAttribute('aria-label', 'Maximize diagram');
          }
        }

        shell.classList.add('is-maximized');
        this.activeMaximizedPlantUmlShell = shell;
        document.body.classList.add('plantuml-maximized-open');
        syncMaximizeButtonState();
        scheduleResetZoomToFit();
        return;
      }

      shell.classList.remove('is-maximized');
      if (this.activeMaximizedPlantUmlShell === shell) {
        this.clearActivePlantUmlShell();
      }
      if (!this.previewElement.querySelector('.plantuml-shell.is-maximized')) {
        document.body.classList.remove('plantuml-maximized-open');
      }
      syncMaximizeButtonState();
      scheduleResetZoomToFit();
    };

    reloadButton.addEventListener('click', () => {
      this.resetPlantUmlShell(shell, {
        clearCache: true,
        message: 'Refreshing…',
      });
      this.enqueuePlantUmlShell(shell, { prioritize: true });
    });

    syncMaximizeButtonState();
    maximizeButton.addEventListener('click', () => {
      setMaximizedState(!shell.classList.contains('is-maximized'));
    });

    const stopPanning = () => {
      if (!isPanning) {
        return;
      }

      isPanning = false;
      frame.classList.remove('is-dragging');

      if (activePointerId !== null && typeof frame.releasePointerCapture === 'function') {
        try {
          frame.releasePointerCapture(activePointerId);
        } catch {
          // Ignore capture release issues during drag end.
        }
      }

      activePointerId = null;
    };

    frame.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !frame.classList.contains('is-pannable')) {
        return;
      }

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      isPanning = true;
      activePointerId = event.pointerId;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panStartScrollLeft = frame.scrollLeft;
      panStartScrollTop = frame.scrollTop;

      frame.classList.add('is-dragging');
      frame.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    frame.addEventListener('pointermove', (event) => {
      if (!isPanning) {
        return;
      }

      frame.scrollLeft = panStartScrollLeft - (event.clientX - panStartX);
      frame.scrollTop = panStartScrollTop - (event.clientY - panStartY);
    });

    frame.addEventListener('pointerup', stopPanning);
    frame.addEventListener('pointercancel', stopPanning);
    frame.addEventListener('lostpointercapture', stopPanning);

    frame.appendChild(svg);
    const sourceNode = shell.querySelector('.plantuml-source');
    shell.replaceChildren();
    if (sourceNode) {
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }
    shell.append(toolbar, frame);

    defaultZoom = calculateDefaultZoom();
    applyZoom(defaultZoom);
  }

  enhanceMermaidDiagram(shell, renderedDiagram) {
    const svg = renderedDiagram.querySelector('svg');
    if (!svg) {
      renderedDiagram.remove();
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'mermaid-toolbar';

    const decreaseButton = this.createMermaidZoomButton('−', 'Zoom out');
    const increaseButton = this.createMermaidZoomButton('+', 'Zoom in');
    const resetButton = this.createMermaidZoomButton('Reset', 'Reset zoom');
    const maximizeButton = this.createMermaidZoomButton('Max', 'Maximize diagram');
    maximizeButton.classList.add('mermaid-maximize-btn');
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'mermaid-zoom-label';
    zoomLabel.setAttribute('aria-live', 'polite');

    toolbar.append(decreaseButton, zoomLabel, resetButton, increaseButton, maximizeButton);

    const frame = document.createElement('div');
    frame.className = 'mermaid-frame';

    const { width: baseWidth, height: baseHeight } = normalizeMermaidSvg(svg);
    let currentZoom = MERMAID_ZOOM.default;
    let defaultZoom = 1;
    let zoomAnimationFrameId = null;
    let isPanning = false;
    let activePointerId = null;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;

    svg.style.display = 'block';
    svg.style.margin = '0 auto';
    svg.style.maxWidth = 'none';

    const applyZoom = (nextZoom) => {
      currentZoom = clamp(nextZoom, MERMAID_ZOOM.min, MERMAID_ZOOM.max);

      svg.style.width = `${baseWidth * currentZoom}px`;
      svg.style.height = `${baseHeight * currentZoom}px`;
      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;

      decreaseButton.disabled = currentZoom <= MERMAID_ZOOM.min;
      increaseButton.disabled = currentZoom >= MERMAID_ZOOM.max;

      const viewport = getFrameViewportSize(frame);
      const isPannable = (baseWidth * currentZoom) > viewport.width || (baseHeight * currentZoom) > viewport.height;
      frame.classList.toggle('is-pannable', isPannable);
    };

    const getViewportCenter = () => ({
      x: frame.scrollLeft + (frame.clientWidth / 2),
      y: frame.scrollTop + (frame.clientHeight / 2),
    });

    const restoreViewportCenter = (previousZoom, nextZoom, center) => {
      if (previousZoom === 0) {
        return;
      }

      const scale = nextZoom / previousZoom;
      frame.scrollLeft = (center.x * scale) - (frame.clientWidth / 2);
      frame.scrollTop = (center.y * scale) - (frame.clientHeight / 2);
    };

    const animateZoomTo = (nextZoom) => {
      const targetZoom = clamp(nextZoom, MERMAID_ZOOM.min, MERMAID_ZOOM.max);
      const startZoom = currentZoom;

      if (targetZoom === startZoom) {
        return;
      }

      const center = getViewportCenter();
      const startedAt = performance.now();

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
      }

      const tick = (now) => {
        const progress = clamp((now - startedAt) / MERMAID_ZOOM.animationDurationMs, 0, 1);
        const easedProgress = easeOutCubic(progress);
        const animatedZoom = startZoom + ((targetZoom - startZoom) * easedProgress);

        applyZoom(animatedZoom);
        restoreViewportCenter(startZoom, animatedZoom, center);

        if (progress < 1) {
          zoomAnimationFrameId = requestAnimationFrame(tick);
          return;
        }

        zoomAnimationFrameId = null;
        applyZoom(targetZoom);
        restoreViewportCenter(startZoom, targetZoom, center);
      };

      zoomAnimationFrameId = requestAnimationFrame(tick);
    };

    const zoomBy = (delta) => {
      animateZoomTo(currentZoom + delta);
    };

    decreaseButton.addEventListener('click', () => zoomBy(-MERMAID_ZOOM.step));
    increaseButton.addEventListener('click', () => zoomBy(MERMAID_ZOOM.step));
    resetButton.addEventListener('click', () => animateZoomTo(defaultZoom));

    const syncMaximizeButtonState = () => {
      const isMaximized = shell.classList.contains('is-maximized');
      maximizeButton.textContent = isMaximized ? 'Restore' : 'Max';
      maximizeButton.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    };

    const setMaximizedState = (shouldMaximize) => {
      if (shouldMaximize) {
        const activeContainer = this.previewElement.querySelector('.mermaid-shell.is-maximized');
        if (activeContainer && activeContainer !== shell) {
          activeContainer.classList.remove('is-maximized');
          const activeButton = activeContainer.querySelector('.mermaid-maximize-btn');
          if (activeButton) {
            activeButton.textContent = 'Max';
            activeButton.setAttribute('aria-label', 'Maximize diagram');
          }
        }
        shell.classList.add('is-maximized');
        document.body.classList.add('mermaid-maximized-open');
        syncMaximizeButtonState();
        return;
      }

      shell.classList.remove('is-maximized');
      if (!this.previewElement.querySelector('.mermaid-shell.is-maximized')) {
        document.body.classList.remove('mermaid-maximized-open');
      }
      syncMaximizeButtonState();
    };

    syncMaximizeButtonState();
    maximizeButton.addEventListener('click', () => {
      const shouldMaximize = !shell.classList.contains('is-maximized');
      setMaximizedState(shouldMaximize);
    });

    const stopPanning = () => {
      if (!isPanning) {
        return;
      }

      isPanning = false;
      frame.classList.remove('is-dragging');

      if (activePointerId !== null && typeof frame.releasePointerCapture === 'function') {
        try {
          frame.releasePointerCapture(activePointerId);
        } catch {
          // Ignore capture release issues during drag end.
        }
      }

      activePointerId = null;
    };

    frame.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !frame.classList.contains('is-pannable')) {
        return;
      }

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      isPanning = true;
      activePointerId = event.pointerId;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panStartScrollLeft = frame.scrollLeft;
      panStartScrollTop = frame.scrollTop;

      frame.classList.add('is-dragging');
      frame.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    frame.addEventListener('pointermove', (event) => {
      if (!isPanning) {
        return;
      }

      frame.scrollLeft = panStartScrollLeft - (event.clientX - panStartX);
      frame.scrollTop = panStartScrollTop - (event.clientY - panStartY);
    });

    frame.addEventListener('pointerup', stopPanning);
    frame.addEventListener('pointercancel', stopPanning);
    frame.addEventListener('lostpointercapture', stopPanning);

    frame.appendChild(svg);
    const sourceNode = shell.querySelector('.mermaid-source');
    renderedDiagram.remove();
    shell.replaceChildren();
    if (sourceNode) {
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }
    shell.append(toolbar, frame);

    applyZoom(defaultZoom);
  }

  createMermaidZoomButton(label, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mermaid-zoom-btn';
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = label;
    return button;
  }

  createPlantUmlToolButton(label, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plantuml-tool-btn';
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = label;
    return button;
  }
}
