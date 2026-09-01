import { MermaidPreviewHydrator } from './mermaid-preview-hydrator.js';
import { PlantUmlPreviewHydrator } from './plantuml-preview-hydrator.js';
import { DiagramChrome } from './diagram-chrome.js';
import { PreviewRenderExecutor } from './preview-render-executor.js';
import { isLargeDocumentStats } from './preview-render-profile.js';
import { PreviewRenderScheduler } from './preview-render-scheduler.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';

export class PreviewRenderer {
  constructor({
    getContent,
    getFileList,
    getSourceFilePath,
    getWikiLinkAutoCreate = null,
    loadFileSource = null,
    onAfterRenderCommit,
    onBeforeRenderCommit,
    onPreviewLayoutChange,
    onRenderComplete,
    outlineController,
    plantUmlRenderClient = null,
    previewContainer,
    previewElement,
    toastController = null,
  }) {
    this.getContent = getContent;
    this.getFileList = getFileList;
    this.getSourceFilePath = getSourceFilePath;
    this.getWikiLinkAutoCreate = getWikiLinkAutoCreate;
    this.loadFileSource = loadFileSource;
    this.onAfterRenderCommit = onAfterRenderCommit;
    this.onBeforeRenderCommit = onBeforeRenderCommit;
    this.onPreviewLayoutChange = onPreviewLayoutChange;
    this.onRenderComplete = onRenderComplete;
    this.outlineController = outlineController;
    this.plantUmlRenderClient = plantUmlRenderClient;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.toastController = toastController;
    this.renderHost = null;

    this.pendingRenderVersion = 0;
    this.activeRenderVersion = 0;
    this.readyRenderVersion = 0;
    this.currentStats = null;
    this.isLargeDocument = false;
    this.hydrationPaused = false;
    this.frontmatterCollapsed = false;

    this.handlePreviewClick = (event) => {
      const frontmatterToggle = event.target.closest('.frontmatter-toggle');
      if (frontmatterToggle) {
        event.preventDefault();
        this.frontmatterCollapsed = !this.frontmatterCollapsed;
        this.applyFrontmatterState();
        this.handleFrontmatterLayoutChange();
        return;
      }

      const mermaidButton = event.target.closest('.mermaid-placeholder-btn');
      if (mermaidButton) {
        const shell = mermaidButton.closest('.mermaid-shell');
        if (!shell) {
          return;
        }

        event.preventDefault();
        if (mermaidButton.closest('.diagram-preview-error-card')) {
          this.mermaidHydrator.retryShell(shell);
        } else {
          this.mermaidHydrator.enqueueShell(shell, { prioritize: true });
        }
        return;
      }

      const plantUmlButton = event.target.closest('.plantuml-placeholder-btn');
      if (plantUmlButton) {
        const shell = plantUmlButton.closest('.plantuml-shell');
        if (!shell) {
          return;
        }

        event.preventDefault();
        if (plantUmlButton.closest('.diagram-preview-error-card')) {
          this.plantUmlHydrator.retryShell(shell);
        } else {
          this.plantUmlHydrator.enqueueShell(shell, { prioritize: true });
        }
      }
    };

    this.handleWindowResize = () => {
      this.scheduleActiveMermaidRefit();
      this.scheduleActivePlantUmlRefit();
    };

    this.diagramChrome = new DiagramChrome({
      toastController,
    });
    this.mermaidHydrator = new MermaidPreviewHydrator(this, {
      loadFileSource,
    });
    this.plantUmlHydrator = new PlantUmlPreviewHydrator(this, {
      loadFileSource,
      renderClient: plantUmlRenderClient,
    });
    this.renderScheduler = new PreviewRenderScheduler();
    this.renderExecutor = new PreviewRenderExecutor({
      attachmentApiPath: resolveApiUrl('/attachment'),
      getFileList: () => this.getFileList?.() ?? [],
      getSourceFilePath: () => this.getSourceFilePath?.() ?? '',
      getWikiLinkAutoCreate: () => this.getWikiLinkAutoCreate?.() ?? true,
    });

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

  normalizePreviewChildren(renderHost = this.renderHost) {
    if (!this.previewElement) {
      return;
    }

    Array.from(this.previewElement.children).forEach((child) => {
      if (
        child === renderHost
        || child.dataset.drawioOverlayRoot === 'true'
        || child.dataset.excalidrawOverlayRoot === 'true'
        || child.dataset.videoOverlayRoot === 'true'
      ) {
        return;
      }

      child.remove();
    });
  }

  getReservedPreviewHeight() {
    const currentRenderHeight = this.renderHost?.getBoundingClientRect?.().height ?? 0;
    const containerHeight = this.previewContainer?.clientHeight ?? 0;
    return Math.max(Math.round(currentRenderHeight), Math.round(containerHeight), 320);
  }

  beginDocumentLoad() {
    this.renderScheduler.cancel();
    this.mermaidHydrator.cancelHydration();
    this.plantUmlHydrator.cancelHydration();
    this.mermaidHydrator.clearPreservedShells();
    this.plantUmlHydrator.clearPreservedShells();
    this.diagramChrome.clearActiveShell();
    this.onBeforeRenderCommit?.(this.previewElement);
    this.pendingRenderVersion += 1;
    this.activeRenderVersion = this.pendingRenderVersion;
    this.readyRenderVersion = 0;
    this.currentStats = null;
    this.isLargeDocument = false;
    this.frontmatterCollapsed = false;
    if (this.renderExecutor.hasPendingJob()) {
      this.renderExecutor.reset('Document changed');
    }
    const renderHost = this.ensureRenderHost();
    this.normalizePreviewChildren(renderHost);
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
    const highlightTheme = document.getElementById('hljs-theme');
    if (highlightTheme) {
      const { darkHref, lightHref } = highlightTheme.dataset;
      highlightTheme.href = theme === 'dark' ? darkHref : lightHref;
    }
    this.mermaidHydrator.applyTheme(theme);
  }

  queueRender() {
    this._deferredPreviewStylesPromise ??= import('../styles/deferred-preview.css');
    const markdownText = this.getContent();
    this.renderScheduler.cancel();
    this.mermaidHydrator.markPending();
    this.plantUmlHydrator.markPending();
    this.pendingRenderVersion += 1;
    const scheduledVersion = this.pendingRenderVersion;
    this.renderScheduler.queue({
      markdownText,
      onRenderRequested: (queuedText, renderVersion) => {
        void this._deferredPreviewStylesPromise.then(() => this.render(queuedText, renderVersion));
      },
      renderVersion: scheduledVersion,
    });
  }


  async render(markdownText = this.getContent(), renderVersion = this.pendingRenderVersion) {
    if (!this.previewElement) {
      return;
    }

    try {
      const result = await this.renderExecutor.compile(markdownText, renderVersion, {
        frontmatterCollapsed: this.frontmatterCollapsed,
        frontmatterInteractive: true,
      });
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
    this.renderScheduler.destroy();
    this.diagramChrome.destroy();
    this.mermaidHydrator.destroy();
    this.plantUmlHydrator.destroy();
    this.renderExecutor.destroy();
    this.previewElement?.removeEventListener('click', this.handlePreviewClick);
    window.removeEventListener('resize', this.handleWindowResize);
  }

  setPhase(phase) {
    if (this.previewElement) {
      this.previewElement.dataset.renderPhase = phase;
    }
  }

  scheduleActiveMermaidRefit() {
    this.diagramChrome.scheduleActiveRefit({
      kind: 'mermaid',
      root: this.previewElement,
    });
  }

  scheduleActivePlantUmlRefit() {
    this.diagramChrome.scheduleActiveRefit({
      kind: 'plantuml',
      root: this.previewElement,
    });
  }

  setHydrationPaused(paused) {
    this.hydrationPaused = Boolean(paused);

    if (this.hydrationPaused) {
      this.mermaidHydrator.cancelPendingIdleWork();
      this.plantUmlHydrator.cancelPendingIdleWork();
      return;
    }

    this.mermaidHydrator.hydrateVisibleShells();
    this.mermaidHydrator.scheduleHydration();
    this.plantUmlHydrator.hydrateVisibleShells();
    this.plantUmlHydrator.scheduleHydration();
    this.updateHydrationPhase();
  }


  commitBaseRender({ html, stats }, renderVersion) {
    this.activeRenderVersion = renderVersion;
    this.readyRenderVersion = 0;
    this.currentStats = stats;
    this.isLargeDocument = isLargeDocumentStats(stats);

    this.mermaidHydrator.cancelHydration({ preserveActiveShell: true });
    this.plantUmlHydrator.cancelHydration({ preserveActiveShell: true });
    document.body.classList.remove('mermaid-maximized-open');
    document.body.classList.remove('plantuml-maximized-open');
    this.mermaidHydrator.preserveHydratedShellsForCommit();
    this.plantUmlHydrator.preserveHydratedShellsForCommit();

    this.onBeforeRenderCommit?.(this.previewElement);
    const renderHost = this.ensureRenderHost();
    this.normalizePreviewChildren(renderHost);
    if (renderHost) {
      renderHost.innerHTML = html;
    }
    this.applyFrontmatterState();
    this.mermaidHydrator.reconcileHydratedShells();
    this.plantUmlHydrator.reconcileHydratedShells();
    this.setPhase('base');

    this.outlineController.refresh();
    this.onAfterRenderCommit?.(this.previewElement, {
      ...stats,
      isLargeDocument: this.isLargeDocument,
      renderVersion,
    });

    const mermaidShellCount = this.mermaidHydrator.setupHydration(renderVersion);
    const plantUmlShellCount = this.plantUmlHydrator.setupHydration(renderVersion);

    if (mermaidShellCount === 0 && plantUmlShellCount === 0) {
      this.notifyReady();
    }
  }

  applyFrontmatterState() {
    const block = this.renderHost?.querySelector?.('.frontmatter-block');
    if (!(block instanceof HTMLElement)) {
      return;
    }

    const collapsed = this.frontmatterCollapsed;
    const toggle = block.querySelector('.frontmatter-toggle');
    const summary = block.querySelector('.frontmatter-summary');
    const content = block.querySelector('.frontmatter-content');

    block.dataset.collapsed = collapsed ? 'true' : 'false';
    if (toggle instanceof HTMLButtonElement) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.textContent = collapsed ? 'Show' : 'Hide';
    }
    if (summary instanceof HTMLElement) {
      summary.hidden = !collapsed;
    }
    if (content instanceof HTMLElement) {
      content.hidden = collapsed;
    }
  }

  handleFrontmatterLayoutChange() {
    this.outlineController.refresh();
    this.onPreviewLayoutChange?.({
      isLargeDocument: this.isLargeDocument,
      renderVersion: this.activeRenderVersion,
      stats: this.currentStats,
    });
  }

  updateHydrationPhase() {
    if (this.hydrationPaused) {
      if (this.mermaidHydrator.hasPendingWork() || this.plantUmlHydrator.hasPendingWork()) {
        this.setPhase('base');
        return;
      }
    }

    if (this.mermaidHydrator.hasPendingWork() || this.plantUmlHydrator.hasPendingWork()) {
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
}
