import {
  getVaultFileKind,
  isDrawioFilePath,
  isExcalidrawFilePath,
  isImageAttachmentFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
  stripVaultFileExtension,
} from '../../../domain/file-kind.js';

export const workspaceFeature = {
  isExcalidrawFile(filePath) {
    return isExcalidrawFilePath(filePath);
  },

  isDrawioFile(filePath) {
    return isDrawioFilePath(filePath);
  },

  isImageFile(filePath) {
    return isImageAttachmentFilePath(filePath);
  },

  isMermaidFile(filePath) {
    return isMermaidFilePath(filePath);
  },

  isPlantUmlFile(filePath) {
    return isPlantUmlFilePath(filePath);
  },

  createDiagramPreviewDocument(language, source = '') {
    return this.workspacePreviewController.createDiagramPreviewDocument(language, source);
  },

  getPreviewSource() {
    const previewDocument = this.getStaticPreviewDocument?.();
    const previewFilePath = previewDocument?.currentFilePath ?? previewDocument?.filePath ?? null;
    if (previewDocument && previewFilePath && previewFilePath === this.currentFilePath) {
      if (this.isMermaidFile(this.currentFilePath)) {
        return this.createDiagramPreviewDocument('mermaid', previewDocument.content);
      }

      if (this.isPlantUmlFile(this.currentFilePath)) {
        return this.createDiagramPreviewDocument('plantuml', previewDocument.content);
      }

      return String(previewDocument.content ?? '');
    }

    return this.workspacePreviewController.getPreviewSource(this.currentFilePath);
  },

  getStaticPreviewDocument() {
    return this._staticPreviewDocument ?? null;
  },

  setStaticPreviewDocument(document) {
    const normalizedFilePath = document?.filePath ?? document?.path ?? null;
    const normalizedCurrentFilePath = document?.currentFilePath ?? normalizedFilePath;
    this._staticPreviewDocument = document
      ? {
        content: String(document.content ?? ''),
        currentFilePath: normalizedCurrentFilePath,
        fileKind: document.fileKind ?? getVaultFileKind(normalizedFilePath),
        filePath: normalizedFilePath,
        hash: document.hash ?? null,
      }
      : null;
  },

  clearStaticPreviewDocument() {
    this._staticPreviewDocument = null;
  },

  supportsFileHistory(filePath) {
    const kind = getVaultFileKind(filePath);
    return kind !== null && kind !== 'image';
  },

  getDisplayName(filePath) {
    return stripVaultFileExtension(String(filePath ?? '')
      .split('/')
      .pop());
  },

  resetPreviewMode() {
    this.workspacePreviewController.resetPreviewMode();
  },

  syncFileChrome(filePath) {
    this.workspacePreviewController.syncFileChrome(filePath);
  },

  renderExcalidrawFilePreview(filePath) {
    this.workspacePreviewController.renderExcalidrawFilePreview(filePath);
  },

  renderDrawioFilePreview(filePath) {
    this.workspacePreviewController.renderDrawioFilePreview(filePath);
  },

  renderImageFilePreview(filePath) {
    this.workspacePreviewController.renderImageFilePreview(filePath);
  },

  renderTextFilePreview(payload) {
    this.workspacePreviewController.renderTextFilePreview(payload);
  },

  createResizeHandler() {
    return this.workspacePreviewController.createResizeHandler(() => this.restoreSidebarState());
  },

  initializePreviewLayoutObserver() {
    this._previewLayoutResizeObserver?.disconnect();
    this._previewLayoutResizeObserver = this.workspacePreviewController.initializePreviewLayoutObserver(
      () => this.schedulePreviewLayoutSync(),
    );
  },

  schedulePreviewLayoutSync({ delayMs = 120 } = {}) {
    this.workspacePreviewController.schedulePreviewLayoutSync({
      delayMs,
      hydrationPaused: this._previewHydrationPaused,
      previewLayoutSyncTimer: this._previewLayoutSyncTimer,
      setPendingPreviewLayoutSync: (value) => {
        this._pendingPreviewLayoutSync = value;
      },
      setPreviewLayoutSyncTimer: (value) => {
        this._previewLayoutSyncTimer = value;
      },
    });
  },

  handleEditorScrollActivityChange(isActive) {
    this.workspacePreviewController.handleEditorScrollActivityChange({
      isActive,
      pendingPreviewLayoutSync: this._pendingPreviewLayoutSync,
      previewLayoutSyncTimer: this._previewLayoutSyncTimer,
      setHydrationPaused: (value) => {
        this._previewHydrationPaused = value;
      },
      setPendingPreviewLayoutSync: (value) => {
        this._pendingPreviewLayoutSync = value;
      },
      setPreviewLayoutSyncTimer: (value) => {
        this._previewLayoutSyncTimer = value;
      },
    });
  },

  async handleHashChange() {
    await this.workspaceRouteController.handleHashChange();
  },

  showEmptyState() {
    clearTimeout(this._previewLayoutSyncTimer);
    this._previewLayoutSyncTimer = null;
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this.workspaceRouteController.showEmptyState();
  },

  showDiffState() {
    clearTimeout(this._previewLayoutSyncTimer);
    this._previewLayoutSyncTimer = null;
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this.workspaceRouteController.showDiffState();
  },

  async openFile(filePath) {
    await this.workspaceRouteController.openFile(filePath);
  },

  cleanupSession() {
    this.workspaceRouteController.cleanupSession();
  },

  handleWikiLinkClick(target) {
    this.wikiLinkFileController.handleWikiLinkClick(target);
  },

  normalizeNewWikiFilePath(target) {
    return this.wikiLinkFileController.normalizeNewWikiFilePath(target);
  },

  async createAndOpenFile(filePath, displayName) {
    await this.wikiLinkFileController.createAndOpenFile(filePath, displayName);
  },

  handleFileSelection(filePath, { closeSidebarOnMobile = false } = {}) {
    this.workspaceRouteController.handleFileSelection(filePath, { closeSidebarOnMobile });
  },
};
