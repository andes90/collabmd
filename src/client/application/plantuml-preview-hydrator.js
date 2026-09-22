import {
  createDiagramExportFileNames,
  exportSvgMarkupFromElement,
} from './diagram-preview-export.js';
import { DiagramPreviewHydrator } from './diagram-preview-hydrator.js';
import {
  createDiagramErrorPlaceholderCard,
  createPlantUmlPlaceholderCard,
  getSvgSize,
  PLANTUML_BATCH_SIZE,
  normalizeDiagramError,
  sanitizeSvgMarkup,
} from './preview-diagram-utils.js';

const SVG_CACHE_LIMIT = 30;

export class PlantUmlPreviewHydrator extends DiagramPreviewHydrator {
  constructor(renderer, { loadFileSource = null, renderClient = null } = {}) {
    super(renderer, {
      batchSize: PLANTUML_BATCH_SIZE,
      datasetKeys: {
        hydrated: 'plantumlHydrated',
        instanceId: 'plantumlInstanceId',
        key: 'plantumlKey',
        label: 'plantumlLabel',
        queued: 'plantumlQueued',
        sourceHash: 'plantumlSourceHash',
        sourceLine: 'sourceLine',
        sourceLineEnd: 'sourceLineEnd',
        target: 'plantumlTarget',
      },
      filePathLabel: 'PlantUML',
      loadFileSource,
      shellClassName: 'plantuml-shell',
      sourceClassName: 'plantuml-source',
    });
    this.diagramChrome = renderer.diagramChrome;
    this.renderClient = renderClient;
    this.svgCache = new Map();
    this.svgInflightRequests = new Map();
  }

  cancelHydration({ preserveActiveShell = false } = {}) {
    super.cancelHydration();
    if (!preserveActiveShell) {
      this.diagramChrome?.cancelActiveShell?.('plantuml');
    }
  }

  handleReconcile({ restoredMaximizedShell }) {
    if (restoredMaximizedShell) {
      document.body.classList.add('plantuml-maximized-open');
    }
    this.diagramChrome?.syncActiveShell?.();
  }

  async hydrateShell(shell, _batchContext, { hydrationToken, renderVersion } = {}) {
    if (!shell?.isConnected || this.isShellHydrated(shell)) {
      return;
    }

    if (!this.isHydrationCurrent(renderVersion, shell, hydrationToken)) {
      return;
    }

    let sourceNode = shell.querySelector('.plantuml-source');
    if (!sourceNode) {
      sourceNode = document.createElement('span');
      sourceNode.className = 'plantuml-source';
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }

    shell.querySelector('.plantuml-placeholder-card')?.remove();

    try {
      let source = sourceNode.textContent ?? '';
      if (!source.trim() && shell.dataset.plantumlTarget) {
        source = await this.fetchSource(shell.dataset.plantumlTarget);
        if (!shell.isConnected) {
          return;
        }
        sourceNode.textContent = source;
      }

      if (!source.trim()) {
        throw new Error(shell.dataset.plantumlTarget ? 'PlantUML file is empty' : 'PlantUML source is empty');
      }

      if (!this.isHydrationCurrent(renderVersion, shell, hydrationToken)) {
        return;
      }

      const svgMarkup = await this.fetchSvg(source);

      if (!this.isHydrationCurrent(renderVersion, shell, hydrationToken)) {
        return;
      }

      this.enhanceDiagram(shell, svgMarkup);
      this.markShellHydrated(shell);
    } catch (error) {
      console.warn('[preview] PlantUML render failed:', error);
      if (!this.isHydrationCurrent(renderVersion, shell, hydrationToken)) {
        return;
      }

      if (this.markShellError(shell, error)) {
        return;
      }

      const key = shell.dataset.plantumlKey || 'plantuml';
      const message = normalizeDiagramError(error);
      shell.querySelector(':scope > .plantuml-toolbar')?.remove();
      shell.querySelector(':scope > .plantuml-frame')?.remove();
      if (!shell.querySelector('.plantuml-placeholder-card')) {
        sourceNode?.after(createDiagramErrorPlaceholderCard({
          key,
          kind: 'plantuml',
          label: shell.dataset.plantumlLabel || 'PlantUML diagram',
          message,
        }));
      }
    }
  }

  async fetchSvg(source) {
    const cacheKey = source;
    if (this.svgCache.has(cacheKey)) {
      return this.svgCache.get(cacheKey);
    }

    if (this.svgInflightRequests.has(cacheKey)) {
      return this.svgInflightRequests.get(cacheKey);
    }

    const request = this.renderClient.renderSvg(source)
      .then((svgMarkup) => {
        const sanitized = sanitizeSvgMarkup(svgMarkup);
        this.svgCache.delete(cacheKey);
        while (this.svgCache.size >= SVG_CACHE_LIMIT) {
          this.svgCache.delete(this.svgCache.keys().next().value);
        }
        this.svgCache.set(cacheKey, sanitized);
        return sanitized;
      })
      .finally(() => {
        this.svgInflightRequests.delete(cacheKey);
      });

    this.svgInflightRequests.set(cacheKey, request);
    return request;
  }

  resetShell(shell, { clearCache = false, message = 'Renders server-side when visible' } = {}) {
    const source = shell.querySelector('.plantuml-source')?.textContent ?? '';
    if (clearCache && source) {
      this.svgCache.delete(source);
      this.svgInflightRequests.delete(source);
    }

    this.diagramChrome?.destroyShell?.(shell);

    this.clearShellOutput(shell);
    shell.removeAttribute('data-plantuml-instance-id');
    shell.removeAttribute('data-plantuml-queued');
    shell.classList.remove('is-maximized');
    this.diagramChrome?.syncBodyMaximizedClasses?.();
    shell.querySelector(':scope > .plantuml-toolbar')?.remove();
    shell.querySelector(':scope > .plantuml-frame')?.remove();
    if (!shell.querySelector('.plantuml-placeholder-card')) {
      shell.querySelector('.plantuml-source')?.after(createPlantUmlPlaceholderCard(
        shell.dataset.plantumlKey || 'plantuml',
        message,
      ));
    }
  }

  enhanceDiagram(shell, svgMarkup) {
    const container = document.createElement('div');
    container.innerHTML = svgMarkup;
    const svg = container.querySelector('svg');
    if (!svg) {
      throw new Error('Renderer returned invalid SVG');
    }

    const { width: baseWidth, height: baseHeight } = getSvgSize(svg);
    const exportSvgMarkup = () => exportSvgMarkupFromElement(svg);
    const exportFileNames = () => createDiagramExportFileNames({
      currentFilePath: this.renderer.getSourceFilePath?.() ?? '',
      diagramKind: 'plantuml',
      sourceLine: shell.getAttribute('data-source-line') || '',
      targetPath: shell.dataset.plantumlTarget || '',
    });
    this.diagramChrome.mount(shell, {
      baseHeight,
      baseWidth,
      diagramElement: svg,
      exportFileNames,
      exportSvgMarkup,
      kind: 'plantuml',
      onReload: () => {
        this.resetShell(shell, {
          clearCache: true,
          message: 'Refreshing…',
        });
        this.enqueueShell(shell, { prioritize: true });
      },
      sourceSelector: '.plantuml-source',
    });
  }
}
