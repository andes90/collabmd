import { resolveApiUrl } from '../domain/runtime-paths.js';
import {
  cancelIdleRender,
  IDLE_RENDER_TIMEOUT_MS,
  isNearViewport,
  requestIdleRender,
  shouldPreserveHydratedDiagram,
  syncAttribute,
} from './preview-diagram-utils.js';

function datasetKeyToAttributeName(datasetKey) {
  return `data-${datasetKey.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

export class DiagramPreviewHydrator {
  constructor(renderer, {
    batchSize,
    datasetKeys,
    fetchFn = (...args) => fetch(...args),
    filePathLabel,
    requestIdleRenderFn = requestIdleRender,
    cancelIdleRenderFn = cancelIdleRender,
    intersectionObserverFactory = (callback, options) => new IntersectionObserver(callback, options),
    isNearViewportFn = isNearViewport,
    requestAnimationFrameFn = (callback) => requestAnimationFrame(callback),
    shellClassName,
    sourceClassName,
  }) {
    this.renderer = renderer;
    this.batchSize = batchSize;
    this.datasetKeys = datasetKeys;
    this.fetchFn = fetchFn;
    this.filePathLabel = filePathLabel;
    this.requestIdleRenderFn = requestIdleRenderFn;
    this.cancelIdleRenderFn = cancelIdleRenderFn;
    this.intersectionObserverFactory = intersectionObserverFactory;
    this.isNearViewportFn = isNearViewportFn;
    this.requestAnimationFrameFn = requestAnimationFrameFn;
    this.shellClassName = shellClassName;
    this.sourceClassName = sourceClassName;
    this.shellSelector = `.${shellClassName}`;
    this.sourceSelector = `.${sourceClassName}`;
    this.attributeNames = Object.fromEntries(
      Object.entries(datasetKeys).map(([name, datasetKey]) => [name, datasetKeyToAttributeName(datasetKey)]),
    );

    this.observer = null;
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
    this.instanceCounter = 0;
    this.preservedShells = new Map();
    this.fileInflightRequests = new Map();
  }

  destroy() {
    this.cancelHydration();
    this.preservedShells.clear();
  }

  cancelHydration() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.cancelIdleRenderFn(this.idleId);
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
  }

  cancelPendingIdleWork() {
    this.cancelIdleRenderFn(this.idleId);
    this.idleId = null;
  }

  clearPreservedShells() {
    this.preservedShells.clear();
  }

  hasPendingWork() {
    return this.hydrationInProgress || this.pendingShells.length > 0;
  }

  preserveHydratedShellsForCommit() {
    this.preservedShells.clear();
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return;
    }

    Array.from(
      previewElement.querySelectorAll(
        `${this.shellSelector}[${this.attributeNames.hydrated}="true"][${this.attributeNames.key}]`,
      ),
    ).forEach((shell) => {
      const key = shell.dataset[this.datasetKeys.key];
      const source = shell.querySelector(this.sourceSelector)?.textContent ?? '';
      const target = shell.dataset[this.datasetKeys.target] ?? '';
      if (!key || (!source && !target)) {
        return;
      }

      if (shell.isConnected) {
        shell.remove();
      }

      this.preservedShells.set(key, {
        key,
        shell,
        source,
        target,
      });
    });
  }

  reconcileHydratedShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement || this.preservedShells.size === 0) {
      this.preservedShells.clear();
      return;
    }

    let restoredMaximizedShell = false;
    Array.from(previewElement.querySelectorAll(`${this.shellSelector}[${this.attributeNames.key}]`)).forEach((nextShell) => {
      const key = nextShell.dataset[this.datasetKeys.key];
      const preservedEntry = key ? this.preservedShells.get(key) : null;
      if (!preservedEntry) {
        return;
      }

      const nextSource = nextShell.querySelector(this.sourceSelector)?.textContent ?? '';
      const nextTarget = nextShell.dataset[this.datasetKeys.target] ?? '';
      if (!shouldPreserveHydratedDiagram({
        nextSource,
        nextTarget,
        preservedSource: preservedEntry.source,
        preservedTarget: preservedEntry.target,
      })) {
        return;
      }

      this.syncPreservedShell(preservedEntry.shell, nextShell);
      nextShell.replaceWith(preservedEntry.shell);
      restoredMaximizedShell = restoredMaximizedShell || preservedEntry.shell.classList.contains('is-maximized');
      this.preservedShells.delete(key);
    });

    this.preservedShells.clear();
    this.handleReconcile({ restoredMaximizedShell });
  }

  handleReconcile() {}

  syncPreservedShell(preservedShell, nextShell) {
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceLine);
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceLineEnd);
    syncAttribute(preservedShell, nextShell, this.attributeNames.key);
    syncAttribute(preservedShell, nextShell, this.attributeNames.target);
    syncAttribute(preservedShell, nextShell, this.attributeNames.label);
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceHash);

    preservedShell.classList.add(this.shellClassName);
    preservedShell.dataset[this.datasetKeys.hydrated] = 'true';
    this.removeDatasetValue(preservedShell, 'queued');

    const nextSourceNode = nextShell.querySelector(this.sourceSelector);
    let preservedSourceNode = preservedShell.querySelector(this.sourceSelector);

    if (!preservedSourceNode && nextSourceNode) {
      preservedSourceNode = nextSourceNode.cloneNode(true);
      preservedShell.prepend(preservedSourceNode);
    }

    if (preservedSourceNode && nextSourceNode) {
      const nextSource = nextSourceNode.textContent ?? '';
      if (nextSource || !nextShell.dataset[this.datasetKeys.target]) {
        preservedSourceNode.textContent = nextSource;
      }
      preservedSourceNode.hidden = true;
    }
  }

  setupHydration(renderVersion) {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    if (!previewElement || !previewContainer) {
      return 0;
    }

    const shells = Array.from(previewElement.querySelectorAll(this.shellSelector));
    if (shells.length === 0) {
      return 0;
    }

    this.observer = this.intersectionObserverFactory((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        this.enqueueShell(entry.target);
      });
    }, {
      root: previewContainer,
      rootMargin: this.renderer.isLargeDocument ? '180px 0px' : '420px 0px',
    });

    shells.forEach((shell) => this.observer.observe(shell));

    this.requestAnimationFrameFn(() => {
      if (renderVersion !== this.renderer.activeRenderVersion) {
        return;
      }

      this.hydrateVisibleShells();
      this.renderer.updateHydrationPhase();
    });

    return shells.length;
  }

  hydrateVisibleShells() {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    if (this.renderer.hydrationPaused || !previewElement || !previewContainer) {
      return;
    }

    const margin = this.renderer.isLargeDocument ? 180 : 420;
    Array.from(previewElement.querySelectorAll(this.shellSelector)).forEach((shell) => {
      if (this.isNearViewportFn(shell, previewContainer, margin)) {
        this.enqueueShell(shell, { prioritize: true });
      }
    });
  }

  enqueueShell(shell, { prioritize = false } = {}) {
    if (!shell?.isConnected || this.isShellHydrated(shell) || this.isShellQueued(shell)) {
      return;
    }

    shell.dataset[this.datasetKeys.queued] = 'true';
    if (prioritize) {
      this.pendingShells.unshift(shell);
    } else {
      this.pendingShells.push(shell);
    }

    if (this.renderer.hydrationPaused) {
      return;
    }

    this.renderer.updateHydrationPhase();
    this.scheduleHydration();
  }

  scheduleHydration() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress || this.idleId !== null) {
      return;
    }

    this.idleId = this.requestIdleRenderFn(() => {
      this.idleId = null;
      void this.flushHydrationQueue();
    }, IDLE_RENDER_TIMEOUT_MS);
  }

  async flushHydrationQueue() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress) {
      return;
    }

    const shells = [];
    while (this.pendingShells.length > 0 && shells.length < this.batchSize) {
      const nextShell = this.pendingShells.shift();
      if (!nextShell?.isConnected || this.isShellHydrated(nextShell)) {
        continue;
      }

      this.removeDatasetValue(nextShell, 'queued');
      shells.push(nextShell);
    }

    if (shells.length === 0) {
      this.renderer.updateHydrationPhase();
      return;
    }

    this.hydrationInProgress = true;
    this.renderer.setPhase('hydrating');

    let batchContext = null;
    try {
      batchContext = await this.prepareHydrationBatch(shells);
    } catch (error) {
      this.handlePrepareHydrationBatchError(shells, error);
      this.hydrationInProgress = false;
      this.renderer.updateHydrationPhase();
      return;
    }

    for (const shell of shells) {
      await this.hydrateShell(shell, batchContext);
    }

    this.hydrationInProgress = false;

    if (this.pendingShells.length > 0) {
      this.scheduleHydration();
    }

    this.renderer.updateHydrationPhase();
  }

  async prepareHydrationBatch() {
    return null;
  }

  handlePrepareHydrationBatchError(_shells, _error) {}

  async hydrateShell() {
    throw new Error('hydrateShell must be implemented by subclasses');
  }

  markShellHydrated(shell) {
    shell.dataset[this.datasetKeys.hydrated] = 'true';
    shell.dataset[this.datasetKeys.instanceId] = String(++this.instanceCounter);
  }

  isShellHydrated(shell) {
    return shell?.dataset?.[this.datasetKeys.hydrated] === 'true';
  }

  removeDatasetValue(shell, name) {
    const datasetKey = this.datasetKeys[name];
    if (!datasetKey || !shell) {
      return;
    }

    shell.removeAttribute?.(this.attributeNames[name]);
    if (shell.dataset) {
      delete shell.dataset[datasetKey];
    }
  }

  isShellQueued(shell) {
    return shell?.dataset?.[this.datasetKeys.queued] === 'true';
  }

  async fetchSource(filePath) {
    const target = String(filePath ?? '').trim();
    if (!target) {
      throw new Error(`Missing ${this.filePathLabel} file path`);
    }

    if (this.fileInflightRequests.has(target)) {
      return this.fileInflightRequests.get(target);
    }

    const request = this.fetchFn(resolveApiUrl(`/file?path=${encodeURIComponent(target)}`), {
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
        this.fileInflightRequests.delete(target);
      });

    this.fileInflightRequests.set(target, request);
    return request;
  }
}
