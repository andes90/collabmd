import {
  isBaseFilePath,
  isCanvasFilePath,
  isDiagramFilePath,
  isHtmlFilePath,
  isMarkdownFilePath,
  isStructurizrFilePath,
} from '../../domain/file-kind.js';
import { canFormatDocument } from '../domain/document-formatter.js';
import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';

const HTML_PREVIEW_CSP = "default-src 'none'; base-uri about:; form-action 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

function createHtmlPreviewDocument(content, allowScripts = false) {
  const scriptSource = allowScripts ? "'unsafe-inline'" : "'none'";
  return `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}; script-src ${scriptSource};"><base href="about:srcdoc">${String(content ?? '')}`;
}

function hasHtmlScripts(content) {
  const preview = new DOMParser().parseFromString(content, 'text/html');
  if (preview.scripts.length > 0) return true;
  return [...preview.querySelectorAll('*')].some((element) => [...element.attributes].some(({ name, value }) => (
    (name.startsWith('on') && name in element)
    || ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/iu.test(value))
  )));
}

function syncFormatDocumentButton(button, filePath, isPlantUml) {
  if (!button) return;
  const actionLabel = isPlantUml ? 'Indent PlantUML document' : 'Format document';
  button.classList.toggle('hidden', !canFormatDocument(filePath));
  button.setAttribute('aria-label', actionLabel);
  button.setAttribute('title', actionLabel);
  const label = button.querySelector('.ui-action-label');
  if (label) label.textContent = isPlantUml ? 'Indent' : 'Format';
}

export class WorkspacePreviewController {
  constructor({
    backlinksPanel,
    basesPreview = null,
    canvasEmbed = null,
    drawioEmbed,
    elements,
    excalidrawEmbed,
    getDisplayName,
    getSession,
    isDrawioFile,
    isExcalidrawFile,
    isBaseFile,
    isImageFile,
    isPdfFile,
    isMermaidFile,
    isPlantUmlFile,
    layoutController,
    outlineController,
    previewRenderer,
    pdfPreview = null,
    scrollSyncController,
    structurizrPreview = null,
    videoEmbed,
  }) {
    this.backlinksPanel = backlinksPanel;
    this.basesPreview = basesPreview ?? { reconcileEmbeds() {}, renderStandalone() {} };
    this.canvasEmbed = canvasEmbed;
    this.drawioEmbed = drawioEmbed ?? {
      detachForCommit() {},
      hydrateVisibleEmbeds() {},
      reconcileEmbeds() {},
      setHydrationPaused() {},
      syncLayout() {},
      updateLocalUser() {},
      updateTheme() {},
    };
    this.elements = elements;
    this.htmlPreviewShell = null;
    if (this.elements.htmlPreviewMaximizeButton) {
      this.elements.htmlPreviewMaximizeButton.addEventListener('click', () => {
        const isMaximized = this.htmlPreviewShell?.classList.contains('is-maximized');
        this.setHtmlPreviewMaximized(!isMaximized);
      });
      setDiagramActionButtonIcon(this.elements.htmlPreviewMaximizeButton, 'maximize');
    }
    this.excalidrawEmbed = excalidrawEmbed;
    this.getDisplayName = getDisplayName;
    this.getSession = getSession;
    this.isDrawioFile = isDrawioFile ?? (() => false);
    this.isExcalidrawFile = isExcalidrawFile ?? (() => false);
    this.isBaseFile = isBaseFile ?? isBaseFilePath;
    this.isImageFile = isImageFile ?? (() => false);
    this.isPdfFile = isPdfFile ?? (() => false);
    this.isMermaidFile = isMermaidFile ?? (() => false);
    this.isPlantUmlFile = isPlantUmlFile ?? (() => false);
    this.layoutController = layoutController;
    this.outlineController = outlineController;
    this.previewRenderer = previewRenderer;
    this.pdfPreview = pdfPreview ?? { cancel() {}, render() {} };
    this.previewHydrationPaused = false;
    this.pendingPreviewLayoutSync = false;
    this.previewLayoutSyncTimer = null;
    this.scrollSyncController = scrollSyncController;
    this.structurizrPreview = structurizrPreview ?? {
      queueSync() {},
      render: async () => false,
      reset() {},
    };
    this.videoEmbed = videoEmbed;
  }

  createDiagramPreviewDocument(language, source = '') {
    const text = String(source ?? '');
    const longestFence = Math.max(...(text.match(/`+/g)?.map((fence) => fence.length) ?? [0]));
    const fence = '`'.repeat(Math.max(3, longestFence + 1));
    return `${fence}${language}\n${text}\n${fence}`;
  }

  getPreviewSource(filePath, { drawioMode = null } = {}) {
    const source = this.getSession()?.getText() ?? '';
    if (this.isMermaidFile(filePath)) {
      return this.createDiagramPreviewDocument('mermaid', source);
    }

    if (this.isPlantUmlFile(filePath)) {
      return this.createDiagramPreviewDocument('plantuml', source);
    }

    if (this.isDrawioFile(filePath) && drawioMode === 'text') {
      return this.createDiagramPreviewDocument('xml', source);
    }

    return source;
  }

  setHtmlPreviewMaximized(maximized) {
    const isMaximized = Boolean(maximized && this.htmlPreviewShell);
    this.htmlPreviewShell?.classList.toggle('is-maximized', isMaximized);
    globalThis.document?.body?.classList.toggle('html-preview-maximized-open', isMaximized);

    const button = this.elements.htmlPreviewMaximizeButton;
    if (button) {
      setDiagramActionButtonIcon(button, isMaximized ? 'restore' : 'maximize');
      button.title = isMaximized ? 'Restore HTML preview' : 'Maximize HTML preview';
      button.setAttribute('aria-label', button.title);
    }
  }

  resetPreviewMode() {
    this.canvasEmbed?.unmount();
    this.setHtmlPreviewMaximized(false);
    this.htmlPreviewShell = null;
    this.pdfPreview.cancel();
    this.elements.previewContent?.classList.remove('is-drawio-file-preview');
    this.elements.previewContent?.classList.remove('is-excalidraw-file-preview');
    this.elements.previewContent?.classList.remove('is-canvas-file-preview');
    this.elements.previewContent?.classList.remove('is-base-file-preview');
    this.elements.previewContent?.classList.remove('is-image-file-preview');
    this.elements.previewContent?.classList.remove('is-pdf-file-preview');
    this.elements.previewContent?.classList.remove('is-html-file-preview');
    this.elements.previewContent?.classList.remove('is-mermaid-file-preview');
    this.elements.previewContent?.classList.remove('is-plantuml-file-preview');
    this.elements.previewContent?.classList.remove('is-structurizr-file-preview');
    this.structurizrPreview.reset();
  }

  syncFileChrome(filePath, { drawioMode = null, preferPreviewForBase = false } = {}) {
    const isDrawio = this.isDrawioFile(filePath);
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isCanvas = isCanvasFilePath(filePath);
    const isBase = this.isBaseFile(filePath);
    const isImage = this.isImageFile(filePath);
    const isPdf = this.isPdfFile(filePath);
    const isHtml = isHtmlFilePath(filePath);
    const isMarkdown = isMarkdownFilePath(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    const isStructurizr = isStructurizrFilePath(filePath);
    const isDiagramFile = isDiagramFilePath(filePath);
    const usesHeaderBacklinks = isExcalidraw || isCanvas || (isDrawio && drawioMode !== 'text');

    this.backlinksPanel.setDisplayMode?.(usesHeaderBacklinks ? 'header' : 'dock');

    this.elements.editorFindButton?.classList.toggle('hidden', !isMarkdown);
    this.elements.toolbarViewToggle?.classList.toggle('hidden', isCanvas);
    this.elements.mobileViewToggle?.classList.toggle('hidden', isCanvas);
    this.elements.toggleWrapButton?.classList.toggle('hidden', isCanvas);
    syncFormatDocumentButton(this.elements.editorFormatButton, filePath, isPlantUml);
    this.elements.markdownToolbar?.classList.toggle('hidden', !isMarkdown);
    this.elements.exportMenuGroup?.classList.toggle('hidden', !isMarkdown);
    this.elements.htmlPreviewMaximizeButton?.classList.toggle('hidden', !isHtml);
    this.elements.outlineToggle?.classList.toggle('hidden', isDiagramFile || isImage || isPdf || isHtml || isBase);
    this.elements.previewContent?.classList.toggle('is-mermaid-file-preview', isMermaid);
    this.elements.previewContent?.classList.toggle('is-plantuml-file-preview', isPlantUml);
    this.elements.previewContent?.classList.toggle('is-structurizr-file-preview', isStructurizr);

    if (isStructurizr) {
      this.outlineController.close();
      this.backlinksPanel.clear();
    }

    if ((isDrawio && drawioMode !== 'text') || isExcalidraw || isCanvas || isHtml || isImage || isPdf || (isBase && preferPreviewForBase)) {
      this.layoutController.setView('preview', { persist: false });
      this.outlineController.close();
      this.backlinksPanel.clear();
      return;
    }

    if (isMermaid || isPlantUml) {
      this.outlineController.close();
      this.backlinksPanel.clear();
    }
  }

  prepareFilePreview(className) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) return null;

    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    if (className) previewElement.classList.add(className);
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);
    return { previewElement, renderHost };
  }

  commitFilePreview(renderHost, content) {
    if (renderHost) {
      renderHost.replaceChildren(content);
      renderHost.style.minHeight = '';
    }
  }

  renderCanvasFilePreview(filePath) {
    const preview = this.prepareFilePreview('is-canvas-file-preview');
    if (!preview) return;
    const { previewElement, renderHost } = preview;

    if (renderHost) renderHost.style.minHeight = '';
    this.canvasEmbed?.mount(filePath, renderHost);
    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.drawioEmbed.reconcileEmbeds(previewElement);
    this.excalidrawEmbed.reconcileEmbeds(previewElement, { isLargeDocument: false });
  }

  renderExcalidrawFilePreview(filePath) {
    const preview = this.prepareFilePreview('is-excalidraw-file-preview');
    if (!preview) return;
    const { previewElement, renderHost } = preview;

    const placeholder = document.createElement('div');
    placeholder.className = 'excalidraw-embed-placeholder';
    placeholder.dataset.embedKey = `${filePath}#file-preview`;
    placeholder.dataset.embedLabel = this.getDisplayName(filePath);
    placeholder.dataset.embedTarget = filePath;
    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Loading Excalidraw preview…';
    placeholder.appendChild(loadingShell);
    this.commitFilePreview(renderHost, placeholder);

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.drawioEmbed.reconcileEmbeds(previewElement);
    this.excalidrawEmbed.reconcileEmbeds(previewElement, { isLargeDocument: false });
    this.drawioEmbed.hydrateVisibleEmbeds();
    this.excalidrawEmbed.hydrateVisibleEmbeds();
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  renderDrawioFilePreview(filePath) {
    const preview = this.prepareFilePreview('is-drawio-file-preview');
    if (!preview) return;
    const { previewElement, renderHost } = preview;

    const placeholder = document.createElement('div');
    placeholder.className = 'drawio-embed-placeholder';
    placeholder.dataset.drawioKey = `${filePath}#file-preview`;
    placeholder.dataset.drawioLabel = this.getDisplayName(filePath);
    placeholder.dataset.drawioMode = 'edit';
    placeholder.dataset.drawioTarget = filePath;
    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Loading draw.io preview…';
    placeholder.appendChild(loadingShell);

    this.commitFilePreview(renderHost, placeholder);

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.drawioEmbed.reconcileEmbeds(previewElement);
    this.drawioEmbed.hydrateVisibleEmbeds();
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  renderImageFilePreview(filePath) {
    const preview = this.prepareFilePreview('is-image-file-preview');
    if (!preview) return;
    const { previewElement, renderHost } = preview;

    const shell = document.createElement('figure');
    shell.className = 'image-file-preview-shell';

    const image = document.createElement('img');
    image.className = 'image-file-preview-image';
    image.alt = this.getDisplayName(filePath);
    image.src = resolveApiUrl(`/attachment?path=${encodeURIComponent(filePath)}`);
    shell.appendChild(image);

    this.commitFilePreview(renderHost, shell);

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  renderPdfFilePreview(filePath) {
    const preview = this.prepareFilePreview('is-pdf-file-preview');
    if (!preview) return;
    const { previewElement, renderHost } = preview;

    if (renderHost) {
      this.pdfPreview.render({
        filePath,
        renderHost,
      });
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.backlinksPanel.clear();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  renderHtmlFilePreview({ content = '' } = {}) {
    const wasMaximized = this.htmlPreviewShell?.classList.contains('is-maximized') ?? false;
    const preview = this.prepareFilePreview('is-html-file-preview');
    if (!preview) return;
    const { previewElement, renderHost } = preview;

    const source = String(content ?? '');
    const iframe = document.createElement('iframe');
    iframe.className = 'html-file-preview-frame';
    iframe.title = 'HTML preview';
    iframe.referrerPolicy = 'no-referrer';
    iframe.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    iframe.setAttribute('sandbox', '');
    // ponytail: full iframe replacement resets script consent whenever the content changes.
    iframe.srcdoc = createHtmlPreviewDocument(source);

    const shell = document.createElement('div');
    shell.className = 'html-file-preview-shell';

    if (hasHtmlScripts(source)) {
      const scriptGate = document.createElement('div');
      scriptGate.className = 'html-file-preview-script-gate';
      scriptGate.textContent = 'Scripts are disabled by default. Run them only if you trust this HTML file.';

      const runScriptsButton = document.createElement('button');
      runScriptsButton.type = 'button';
      runScriptsButton.className = 'ui-button ui-button--secondary ui-button--compact';
      runScriptsButton.textContent = 'Run scripts';
      runScriptsButton.addEventListener('click', () => {
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.srcdoc = createHtmlPreviewDocument(source, true);
        scriptGate.remove();
      });
      scriptGate.append(runScriptsButton);
      shell.append(scriptGate);
    }
    shell.append(iframe);
    this.htmlPreviewShell = shell;
    this.setHtmlPreviewMaximized(wasMaximized);

    this.commitFilePreview(renderHost, shell);

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.backlinksPanel.clear();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  async renderBaseFilePreview(filePath, { source = null } = {}) {
    const preview = this.prepareFilePreview('is-base-file-preview');
    if (!preview) return;
    const { previewElement, renderHost } = preview;

    if (renderHost) {
      renderHost.style.minHeight = '';
    }

    await this.basesPreview.renderStandalone({
      filePath,
      renderHost,
      source: typeof source === 'string'
        ? source
        : (this.getSession()?.getText?.() ?? null),
    });

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  async renderStructurizrFilePreview(filePath, { source = null } = {}) {
    const preview = this.prepareFilePreview('is-structurizr-file-preview');
    if (!preview) return;
    const { previewElement, renderHost } = preview;
    if (renderHost) {
      renderHost.style.minHeight = '';
    }

    await this.structurizrPreview.render({
      filePath,
      renderHost,
      source: typeof source === 'string' ? source : (this.getSession()?.getText?.() ?? ''),
    });

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.backlinksPanel.clear();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  renderTextFilePreview({ content = '' } = {}) {
    const preview = this.prepareFilePreview();
    if (!preview) return;
    const { previewElement, renderHost } = preview;

    const shell = document.createElement('div');
    shell.className = 'preview-shell';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = String(content ?? '');
    pre.appendChild(code);
    shell.appendChild(pre);

    this.commitFilePreview(renderHost, shell);

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.backlinksPanel.clear();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  }

  createResizeHandler(restoreSidebarState) {
    let resizeTimer = null;
    return () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        restoreSidebarState?.();
        this.schedulePreviewLayoutSync({ delayMs: 0 });
      }, 100);
    };
  }

  initializePreviewLayoutObserver(onSchedule = () => {}) {
    if (typeof ResizeObserver !== 'function' || !this.elements.previewContent) {
      return null;
    }

    const observer = new ResizeObserver(() => {
      onSchedule();
    });
    observer.observe(this.elements.previewContent);
    return observer;
  }

  resetPreviewLayoutSync() {
    clearTimeout(this.previewLayoutSyncTimer);
    this.previewLayoutSyncTimer = null;
    this.pendingPreviewLayoutSync = false;
    this.previewHydrationPaused = false;
  }

  schedulePreviewLayoutSync({ delayMs = 120 } = {}) {
    if (this.previewHydrationPaused) {
      this.pendingPreviewLayoutSync = true;
      return;
    }

    clearTimeout(this.previewLayoutSyncTimer);

    this.previewLayoutSyncTimer = setTimeout(() => {
      this.previewLayoutSyncTimer = null;

      const hasSession = Boolean(this.getSession());
      const isDrawioPreview = this.elements.previewContent?.classList?.contains?.('is-drawio-file-preview') ?? false;
      const isExcalidrawPreview = this.elements.previewContent?.classList?.contains?.('is-excalidraw-file-preview') ?? false;
      if ((!hasSession && !isDrawioPreview && !isExcalidrawPreview) || !this.elements.previewContent) {
        return;
      }

      if (this.elements.previewContent.dataset.renderPhase === 'shell') {
        return;
      }

      if (this.previewHydrationPaused) {
        this.pendingPreviewLayoutSync = true;
        return;
      }

      this.videoEmbed?.syncLayout();
      this.drawioEmbed.syncLayout();
      this.excalidrawEmbed.syncLayout();
      if ((isDrawioPreview || isExcalidrawPreview) && !hasSession) {
        return;
      }

      this.scrollSyncController.invalidatePreviewBlocks();
      this.scrollSyncController.warmPreviewBlocks({
        onReady: () => {
          if (!this.getSession()) {
            return;
          }

          this.scrollSyncController.realignAfterLayoutChange();
          this.outlineController.scheduleActiveHeadingUpdate();
        },
      });
    }, delayMs);
  }

  handleEditorScrollActivityChange(isActive) {
    const nextPaused = Boolean(isActive);
    this.previewHydrationPaused = nextPaused;
    this.previewRenderer.setHydrationPaused(nextPaused);
    this.drawioEmbed.setHydrationPaused(nextPaused);
    this.excalidrawEmbed.setHydrationPaused(nextPaused);

    if (nextPaused) {
      clearTimeout(this.previewLayoutSyncTimer);
      this.previewLayoutSyncTimer = null;
      this.pendingPreviewLayoutSync = true;
      return;
    }

    if (this.pendingPreviewLayoutSync) {
      this.pendingPreviewLayoutSync = false;
      this.schedulePreviewLayoutSync({ delayMs: 0 });
    }
  }
}
