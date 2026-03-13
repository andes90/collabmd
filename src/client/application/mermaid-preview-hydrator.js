import { clamp } from '../domain/vault-utils.js';
import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import { DiagramPreviewHydrator } from './diagram-preview-hydrator.js';
import {
  createMermaidPlaceholderCard,
  createMermaidPlaceholderCardWithMessage,
  easeOutCubic,
  getFrameViewportSize,
  MERMAID_BATCH_SIZE,
  MERMAID_ZOOM,
  normalizeMermaidSvg,
} from './preview-diagram-utils.js';

export class MermaidPreviewHydrator extends DiagramPreviewHydrator {
  constructor(renderer) {
    super(renderer, {
      batchSize: MERMAID_BATCH_SIZE,
      datasetKeys: {
        hydrated: 'mermaidHydrated',
        instanceId: 'mermaidInstanceId',
        key: 'mermaidKey',
        label: 'mermaidLabel',
        queued: 'mermaidQueued',
        sourceHash: 'mermaidSourceHash',
        sourceLine: 'sourceLine',
        sourceLineEnd: 'sourceLineEnd',
        target: 'mermaidTarget',
      },
      filePathLabel: 'Mermaid',
      shellClassName: 'mermaid-shell',
      sourceClassName: 'mermaid-source',
    });
    this.renderer = renderer;
    this.currentTheme = document.documentElement?.dataset.theme === 'light' ? 'light' : 'dark';
    this.loader = null;
    this.runtime = null;
    this.shellRefits = new WeakMap();
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    const mermaid = this.runtime;
    if (!mermaid) {
      return;
    }

    this.configureMermaid(mermaid);
    this.resetHydratedShells();
  }

  configureMermaid(mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      flowchart: {
        defaultRenderer: 'dagre-wrapper',
        useMaxWidth: true,
      },
      class: {
        defaultRenderer: 'dagre-wrapper',
        useMaxWidth: true,
      },
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
    if (this.runtime) {
      this.configureMermaid(this.runtime);
      return Promise.resolve(this.runtime);
    }

    if (this.loader) {
      return this.loader;
    }

    this.loader = import('../mermaid-runtime.js')
      .then((module) => {
        const mermaid = module?.default;
        if (!mermaid) {
          throw new Error('Mermaid runtime failed to initialize');
        }

        this.runtime = mermaid;
        this.configureMermaid(mermaid);
        return mermaid;
      })
      .catch((error) => {
        this.loader = null;
        this.runtime = null;
        throw new Error(error instanceof Error ? error.message : 'Failed to load Mermaid runtime');
      });

    return this.loader;
  }

  handleReconcile({ restoredMaximizedShell }) {
    if (restoredMaximizedShell) {
      document.body.classList.add('mermaid-maximized-open');
    }
  }

  async prepareHydrationBatch() {
    return this.ensureMermaid();
  }

  handlePrepareHydrationBatchError(_shells, error) {
    console.warn('[preview] Mermaid runtime failed to load:', error);
  }

  async hydrateShell(shell, mermaid) {
    if (!mermaid || !shell?.isConnected || this.isShellHydrated(shell)) {
      return;
    }

    let sourceNode = shell.querySelector('.mermaid-source');
    if (!sourceNode) {
      sourceNode = document.createElement('span');
      sourceNode.className = 'mermaid-source';
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }

    let source = sourceNode.textContent ?? '';
    try {
      if (!source.trim() && shell.dataset.mermaidTarget) {
        source = await this.fetchSource(shell.dataset.mermaidTarget);
        if (!shell.isConnected) {
          return;
        }
        sourceNode.textContent = source;
      }

      if (!source.trim()) {
        throw new Error(shell.dataset.mermaidTarget ? 'Mermaid file is empty' : 'Mermaid source is empty');
      }

      source = this.prepareSource(source);

      shell.querySelector('.mermaid-placeholder-card')?.remove();

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

      await mermaid.run({ nodes: [diagram] });
      if (!diagram.isConnected || shell !== diagram.parentElement) {
        return;
      }

      this.enhanceDiagram(shell, diagram);
      this.markShellHydrated(shell);
    } catch (error) {
      console.warn('[preview] Mermaid render failed:', error);
      shell.querySelector(':scope > .mermaid-toolbar')?.remove();
      shell.querySelector(':scope > .mermaid-frame')?.remove();
      shell.querySelector(':scope > .mermaid-render-node')?.remove();
      if (!shell.querySelector('.mermaid-placeholder-card')) {
        sourceNode?.after(createMermaidPlaceholderCardWithMessage(shell.dataset.mermaidKey || 'mermaid', {
          label: shell.dataset.mermaidLabel || 'Mermaid diagram',
          message: error instanceof Error ? error.message : 'Render failed',
        }));
      }
    }
  }

  prepareSource(source) {
    let text = String(source ?? '');

    if (!/%%\{[\s\S]*?\binit\s*:/m.test(text)) {
      const initConfig = this.getPreviewInitConfig(text);
      if (initConfig) {
        text = `%%{init: ${JSON.stringify(initConfig)}}%%\n${text}`;
      }
    }

    if (!/^\s*gantt\b/m.test(text) || /\btodayMarker\b/.test(text)) {
      return text;
    }

    const lines = text.split('\n');
    const ganttLineIndex = lines.findIndex((line) => /^\s*gantt\b/.test(line));
    if (ganttLineIndex === -1) {
      return text;
    }

    lines.splice(ganttLineIndex + 1, 0, '    todayMarker off');
    return lines.join('\n');
  }

  getPreviewInitConfig(source) {
    if (/^\s*stateDiagram(?:-v2)?\b/m.test(source)) {
      return {
        htmlLabels: false,
      };
    }

    if (/^\s*classDiagram\b/m.test(source)) {
      return {
        htmlLabels: false,
      };
    }

    if (/^\s*gantt\b/m.test(source)) {
      return {
        htmlLabels: false,
      };
    }

    return null;
  }

  resetHydratedShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return;
    }

    const hydratedShells = Array.from(previewElement.querySelectorAll('.mermaid-shell[data-mermaid-hydrated="true"]'));
    if (hydratedShells.length === 0) {
      return;
    }

    hydratedShells.forEach((shell) => {
      this.shellRefits.delete(shell);
      shell.removeAttribute('data-mermaid-hydrated');
      shell.querySelector(':scope > .mermaid-toolbar')?.remove();
      shell.querySelector(':scope > .mermaid-frame')?.remove();
      shell.querySelector(':scope > .mermaid-render-node')?.remove();
      if (!shell.querySelector('.mermaid-placeholder-card')) {
        shell.querySelector('.mermaid-source')?.after(createMermaidPlaceholderCard(shell.dataset.mermaidKey || 'mermaid'));
      }
      this.enqueueShell(shell, { prioritize: true });
    });
  }

  enhanceDiagram(shell, renderedDiagram) {
    const svg = renderedDiagram.querySelector('svg');
    if (!svg) {
      renderedDiagram.remove();
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'mermaid-toolbar diagram-preview-toolbar';

    const decreaseButton = this.createZoomButton('−', 'Zoom out');
    const increaseButton = this.createZoomButton('+', 'Zoom in');
    const resetButton = this.createZoomButton('Reset', 'Reset zoom');
    const maximizeButton = this.createZoomButton('Max', 'Maximize diagram');
    maximizeButton.classList.add('mermaid-maximize-btn');
    setDiagramActionButtonIcon(maximizeButton, 'maximize');
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'mermaid-zoom-label diagram-preview-zoom-label';
    zoomLabel.setAttribute('aria-live', 'polite');

    toolbar.append(decreaseButton, zoomLabel, resetButton, increaseButton, maximizeButton);

    const frame = document.createElement('div');
    frame.className = 'mermaid-frame diagram-preview-frame';

    const { width: baseWidth, height: baseHeight } = normalizeMermaidSvg(svg);
    let currentZoom = MERMAID_ZOOM.default;
    let defaultZoom = 1;
    let zoomAnimationFrameId = null;
    let resetZoomFrameId = null;
    let hasManualZoom = false;
    let lastAutoFitViewportWidth = 0;
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
        return MERMAID_ZOOM.default;
      }

      const fittedZoom = viewport.width / baseWidth;
      if (!Number.isFinite(fittedZoom) || fittedZoom <= 0) {
        return MERMAID_ZOOM.default;
      }

      return clamp(fittedZoom, MERMAID_ZOOM.min, MERMAID_ZOOM.max);
    };

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
      svg.style.margin = isPannable ? '0' : '0 auto';
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
      hasManualZoom = true;
      animateZoomTo(currentZoom + delta);
    };

    const resetZoomToFit = ({ animate = false } = {}) => {
      defaultZoom = calculateDefaultZoom();
      hasManualZoom = false;
      lastAutoFitViewportWidth = getFrameViewportSize(frame).width;

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

    const scheduleResetZoomToFit = ({ force = false } = {}) => {
      if (resetZoomFrameId) {
        cancelAnimationFrame(resetZoomFrameId);
      }

      resetZoomFrameId = requestAnimationFrame(() => {
        resetZoomFrameId = null;
        if (!shell.isConnected) {
          return;
        }

        const viewportWidth = getFrameViewportSize(frame).width;
        const viewportChanged = Math.abs(viewportWidth - lastAutoFitViewportWidth) > 1;
        if (!force && hasManualZoom) {
          return;
        }
        if (!force && lastAutoFitViewportWidth > 0 && !viewportChanged) {
          return;
        }

        resetZoomToFit();
      });
    };

    this.shellRefits.set(shell, scheduleResetZoomToFit);

    decreaseButton.addEventListener('click', () => zoomBy(-MERMAID_ZOOM.step));
    increaseButton.addEventListener('click', () => zoomBy(MERMAID_ZOOM.step));
    resetButton.addEventListener('click', () => {
      resetZoomToFit({ animate: true });
    });

    const syncMaximizeButtonState = () => {
      const isMaximized = shell.classList.contains('is-maximized');
      setDiagramActionButtonIcon(maximizeButton, isMaximized ? 'restore' : 'maximize');
      const label = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
      maximizeButton.setAttribute('aria-label', label);
      maximizeButton.title = label;
    };

    const setMaximizedState = (shouldMaximize) => {
      const previewElement = this.renderer.previewElement;
      if (shouldMaximize) {
        const activeContainer = previewElement.querySelector('.mermaid-shell.is-maximized');
        if (activeContainer && activeContainer !== shell) {
          activeContainer.classList.remove('is-maximized');
          this.shellRefits.get(activeContainer)?.();
          const activeButton = activeContainer.querySelector('.mermaid-maximize-btn');
          if (activeButton) {
            setDiagramActionButtonIcon(activeButton, 'maximize');
            activeButton.setAttribute('aria-label', 'Maximize diagram');
            activeButton.title = 'Maximize diagram';
          }
        }
        shell.classList.add('is-maximized');
        document.body.classList.add('mermaid-maximized-open');
        syncMaximizeButtonState();
        scheduleResetZoomToFit({ force: true });
        return;
      }

      shell.classList.remove('is-maximized');
      if (!previewElement.querySelector('.mermaid-shell.is-maximized')) {
        document.body.classList.remove('mermaid-maximized-open');
      }
      syncMaximizeButtonState();
      scheduleResetZoomToFit({ force: true });
    };

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
    const sourceNode = shell.querySelector('.mermaid-source');
    renderedDiagram.remove();
    shell.replaceChildren();
    if (sourceNode) {
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }
    shell.append(toolbar, frame);

    scheduleResetZoomToFit({ force: true });
  }

  scheduleActiveRefit() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return;
    }

    Array.from(previewElement.querySelectorAll('.mermaid-shell[data-mermaid-hydrated="true"]')).forEach((shell) => {
      this.shellRefits.get(shell)?.();
    });
  }

  createZoomButton(label, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mermaid-zoom-btn diagram-preview-action-btn';
    button.setAttribute('aria-label', ariaLabel);
    button.title = ariaLabel;
    button.textContent = label;
    return button;
  }
}
