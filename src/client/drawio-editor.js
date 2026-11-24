import './styles/surfaces/embedded-editor-base.css';
import './styles/surfaces/drawio-editor.css';

import {
  createDrawioFrameLoadPayload,
  createDrawioFrameLoadSignature,
} from './domain/drawio-frame-load.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';
import { isPlainQuickSwitcherShortcut } from './domain/keyboard-shortcuts.js';
import { DrawioLeaseClient } from './infrastructure/drawio-lease-client.js';
import { createDrawioSaveQueue } from './infrastructure/drawio-save-queue.js';
import { getRuntimeConfig } from './infrastructure/runtime-config.js';
import { vaultApiClient } from './infrastructure/vault-api-client.js';

const AUTOSAVE_DEBOUNCE_MS = 1000;
const IFRAME_BOOT_TIMEOUT_MS = 15000;
const INITIAL_LEASE_WAIT_MS = 4000;
const parentOrigin = window.location.origin;
const params = new URLSearchParams(window.location.search);
const filePath = params.get('file') || '';
const leaseRoom = params.get('leaseRoom') || '';
const requestedMode = params.get('mode') === 'view' ? 'view' : 'edit';
const hostMode = params.get('hostMode') || '';
const instanceId = params.get('instanceId') || '';
const themeParam = params.get('theme') === 'light' ? 'light' : 'dark';
const isExportImageMode = hostMode === 'export-image';
const requestedPreviewWidth = Number.parseInt(params.get('previewWidth') || '', 10);

let runtimeConfig = getRuntimeConfig();
let currentXml = '';
let currentTheme = themeParam;
let currentLeaseState = null;
let waitingForInitialLease = requestedMode === 'edit' && Boolean(leaseRoom);
let drawioFrame = null;
let drawioOrigin = null;
let drawioFrameReady = false;
let drawioFrameBootTimer = null;
let drawioMessageHandler = null;
let saveTimer = null;
let lastFrameLoadSignature = '';
let lastSavedVersion = 0;
let hasPostedReadyToParent = false;
let exportRequested = false;

const loadingState = document.getElementById('loadingState');
const rootElement = document.getElementById('root');

const state = {
  bannerText: '',
  canClaim: false,
  isEditor: false,
};

const rootShell = document.createElement('div');
rootShell.className = 'drawio-shell';

const banner = document.createElement('div');
banner.className = 'drawio-banner';
banner.innerHTML = `
  <div class="drawio-banner-status">
    <span class="drawio-banner-pill" id="drawioModePill">Loading</span>
    <span class="drawio-banner-copy" id="drawioBannerText">Connecting…</span>
  </div>
  <div class="drawio-banner-actions">
    <button type="button" class="drawio-toolbar-btn" id="claimEditBtn" hidden>Claim edit</button>
  </div>
`;

const frameShell = document.createElement('div');
frameShell.className = 'drawio-frame-shell';

const drawioLeaseClient = leaseRoom
  ? new DrawioLeaseClient({
    filePath,
    onStateChange: (nextState) => handleLeaseState(nextState),
    roomName: leaseRoom,
  })
  : null;

const saveQueue = createDrawioSaveQueue(async (xml) => {
  if (!drawioLeaseClient?.currentState.isEditor) throw new Error('Waiting for the editing lease to save');
  await vaultApiClient.writeFile({ content: xml, path: filePath });
  currentXml = xml;
  lastSavedVersion = drawioLeaseClient?.publishSave?.() ?? lastSavedVersion;
});

function postToParent(type, payload = {}) {
  if (window.parent === window) {
    return;
  }

  window.parent.postMessage({ source: 'drawio-editor', instanceId, type, ...payload }, parentOrigin);
}

function handleQuickSwitcherKeyDown(event) {
  if (!isPlainQuickSwitcherShortcut(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  postToParent('request-toggle-quick-switcher');
}

function parseMessagePayload(rawValue) {
  if (typeof rawValue === 'string') {
    try {
      return JSON.parse(rawValue);
    } catch {
      return null;
    }
  }

  return rawValue && typeof rawValue === 'object' ? rawValue : null;
}

function setBodyTheme(theme) {
  document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

function setLoadingCopy(message, { isError = false } = {}) {
  if (!loadingState) {
    return;
  }

  loadingState.className = isError ? 'drawio-error' : 'drawio-loading';
  loadingState.textContent = message;
}

function updateBanner() {
  const pill = document.getElementById('drawioModePill');
  const bannerText = document.getElementById('drawioBannerText');
  const claimEditButton = document.getElementById('claimEditBtn');
  if (!pill || !bannerText || !claimEditButton) {
    return;
  }

  pill.textContent = state.isEditor ? 'Editing' : 'Read-only';
  bannerText.textContent = state.bannerText || (state.isEditor ? 'Editing' : 'Read-only mode');
  claimEditButton.hidden = !state.canClaim;
  claimEditButton.disabled = !state.canClaim;
}

function clearFrameBootTimer() {
  if (!drawioFrameBootTimer) {
    return;
  }

  window.clearTimeout(drawioFrameBootTimer);
  drawioFrameBootTimer = null;
}

function teardownDrawioFrame() {
  clearFrameBootTimer();
  if (drawioMessageHandler) {
    window.removeEventListener('message', drawioMessageHandler);
    drawioMessageHandler = null;
  }
  drawioFrame?.remove();
  drawioFrame = null;
  drawioOrigin = null;
  drawioFrameReady = false;
  lastFrameLoadSignature = '';
  hasPostedReadyToParent = false;
  exportRequested = false;
}

function buildDrawioFrameUrl() {
  const fallbackUrl = 'https://embed.diagrams.net';
  let url;
  try {
    url = new URL(runtimeConfig.drawioBaseUrl || fallbackUrl);
  } catch {
    url = new URL(fallbackUrl);
  }
  url.searchParams.set('embed', '1');
  url.searchParams.set('proto', 'json');
  url.searchParams.set('spin', '1');
  url.searchParams.set('ui', currentTheme === 'light' ? 'simple' : 'dark');
  url.searchParams.set('libraries', '1');
  return url;
}

function postAction(action, payload = {}) {
  if (!drawioOrigin || !drawioFrame?.contentWindow) {
    return false;
  }

  drawioFrame.contentWindow.postMessage(JSON.stringify({
    action,
    ...payload,
  }), drawioOrigin);
  return true;
}

function loadDiagramIntoFrame() {
  if (!drawioFrameReady || waitingForInitialLease) return false;

  const payload = createDrawioFrameLoadPayload({
    currentTheme,
    currentXml,
    isEditor: state.isEditor,
    isExportImageMode,
  });
  const signature = createDrawioFrameLoadSignature(payload);
  if (signature === lastFrameLoadSignature) {
    return false;
  }

  const posted = postAction('load', payload);
  if (posted) {
    lastFrameLoadSignature = signature;
    if (!hasPostedReadyToParent) {
      hasPostedReadyToParent = true;
      postToParent('ready', { filePath, instanceMode: state.isEditor ? 'edit' : 'view' });
    }
  }
  return posted;
}

function finishInitialLeaseWait() {
  waitingForInitialLease = false;
  if (drawioFrameReady) {
    clearFrameBootTimer();
    loadDiagramIntoFrame();
  }
}

function updateFrameMode() {
  if (!drawioFrame) {
    return;
  }

  drawioFrame.classList.toggle('is-read-only', !state.isEditor);
  if (drawioFrameReady) {
    loadDiagramIntoFrame();
  }
}

function renderError(message, { fallbackToText = false } = {}) {
  console.error('[drawio] Failed to initialize:', message);
  teardownDrawioFrame();
  rootElement.replaceChildren(rootShell);
  frameShell.replaceChildren();
  frameShell.appendChild(Object.assign(document.createElement('div'), {
    className: 'drawio-error',
    textContent: message,
  }));
  state.bannerText = message;
  state.isEditor = false;
  state.canClaim = false;
  updateBanner();
  postToParent(fallbackToText ? 'fallback-text' : 'error', { filePath, message });
}

function requestPreviewImageExport() {
  if (exportRequested || !drawioFrameReady) {
    return;
  }

  exportRequested = true;
  postAction('export', {
    border: 0,
    currentPage: true,
    format: 'png',
    grid: false,
    keepTheme: true,
    scale: 2,
    shadow: false,
    size: 'diagram',
    transparent: false,
    ...(Number.isFinite(requestedPreviewWidth) && requestedPreviewWidth > 0
      ? { width: requestedPreviewWidth }
      : {}),
  });
}

async function flushSave() {
  try {
    await saveQueue.flush();
    return true;
  } catch (error) {
    state.bannerText = 'Changes are waiting to be saved. Keep this diagram open.';
    updateBanner();
    console.error('[drawio] Failed to save diagram:', error);
    return false;
  }
}

function scheduleSave(xml, { immediate = false } = {}) {
  if (!state.isEditor || !xml) {
    return;
  }

  saveQueue.enqueue(xml);
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (immediate) {
    void flushSave();
    return;
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void flushSave();
  }, AUTOSAVE_DEBOUNCE_MS);
}

async function reloadLatestXml(savedVersion) {
  if (!filePath || saveQueue.hasPendingWrites()) {
    return;
  }

  const response = await vaultApiClient.readFile(filePath);
  if (state.isEditor || saveQueue.hasPendingWrites() || savedVersion !== lastSavedVersion) return;

  const nextXml = String(response?.content ?? '');
  if (nextXml === currentXml) {
    return;
  }

  currentXml = nextXml;
  if (drawioFrameReady) {
    loadDiagramIntoFrame();
  }
}

async function syncDrawioFrame() {
  if (!await flushSave()) return;

  const url = buildDrawioFrameUrl();
  if (drawioFrame?.src === url.href) {
    updateFrameMode();
    return;
  }
  attachDrawioFrame(url);
}

function attachDrawioFrame(url = buildDrawioFrameUrl()) {
  teardownDrawioFrame();

  const iframe = document.createElement('iframe');
  iframe.className = 'drawio-frame';
  iframe.title = 'draw.io';
  iframe.allow = 'clipboard-read; clipboard-write';
  iframe.src = url.href;
  drawioOrigin = url.origin;
  frameShell.replaceChildren(iframe);
  drawioFrame = iframe;
  updateFrameMode();

  drawioMessageHandler = (event) => {
    if (event.origin !== drawioOrigin || event.source !== drawioFrame?.contentWindow) {
      return;
    }

    const payload = parseMessagePayload(event.data);
    if (!payload?.event) {
      return;
    }

    if (payload.event === 'ready' || payload.event === 'init') {
      if (drawioFrameReady) return;
      drawioFrameReady = true;
      clearFrameBootTimer();
      if (waitingForInitialLease) {
        // An unavailable collaboration connection still permits read-only viewing.
        drawioFrameBootTimer = window.setTimeout(finishInitialLeaseWait, INITIAL_LEASE_WAIT_MS);
      } else {
        loadDiagramIntoFrame();
      }
      return;
    }

    if (payload.event === 'load') {
      if (isExportImageMode) {
        requestPreviewImageExport();
      }
      return;
    }

    if (payload.event === 'autosave') {
      scheduleSave(String(payload.xml || ''));
      return;
    }

    if (payload.event === 'save') {
      scheduleSave(String(payload.xml || ''), { immediate: true });
      return;
    }

    if (payload.event === 'export') {
      if (isExportImageMode && typeof payload.data === 'string' && payload.data) {
        postToParent('export-image', {
          data: payload.data,
          filePath,
          format: payload.format || 'svg',
        });
        return;
      }

      if (isExportImageMode) {
        renderError('Failed to export draw.io preview');
      }
      return;
    }

    if (payload.event === 'exit') {
      if (hostMode === 'file-preview' && !state.isEditor) {
        postToParent('request-open-file', { filePath });
      }
    }
  };

  window.addEventListener('message', drawioMessageHandler);
  drawioFrameBootTimer = window.setTimeout(() => {
    renderError('Failed to initialize draw.io editor', { fallbackToText: hostMode === 'file-preview' });
  }, IFRAME_BOOT_TIMEOUT_MS);
}

function handleLeaseState(nextState) {
  const previousState = currentLeaseState;
  currentLeaseState = nextState;
  state.isEditor = Boolean(nextState?.isEditor);
  state.canClaim = Boolean(nextState?.canClaim);

  if (!nextState.synced) {
    state.bannerText = 'Waiting for the editing connection…';
  } else if (state.isEditor) {
    state.bannerText = 'Changes save automatically.';
  } else if (nextState?.hasHealthyHolder) {
    const holderName = nextState.holderName || 'Another user';
    state.bannerText = `${holderName} is editing this diagram. Read-only mode. Updates appear after they save.`;
  } else if (nextState?.isStale) {
    state.bannerText = 'Editor disconnected. Claim edit to continue editing.';
  } else {
    state.bannerText = 'Read-only mode. Updates appear after save.';
  }

  updateBanner();

  if (waitingForInitialLease && nextState.synced) finishInitialLeaseWait();
  const modeChanged = previousState?.isEditor !== nextState.isEditor;
  const savedVersionChanged = nextState.savedVersion !== lastSavedVersion;
  lastSavedVersion = nextState.savedVersion;
  if (modeChanged) {
    drawioFrame?.classList.toggle('is-read-only', !state.isEditor);
    void syncDrawioFrame();
  }
  if (!state.isEditor && savedVersionChanged) {
    void reloadLatestXml(nextState.savedVersion).catch((error) => {
      console.error('[drawio] Failed to refresh diagram:', error);
    });
  }
}

function handleParentMessage(event) {
  if (event.origin !== parentOrigin || event.source !== window.parent) return;

  const payload = event.data;
  if (!payload || payload.source !== 'collabmd-host') {
    return;
  }

  if (payload.type === 'prepare-disconnect' && event.ports[0]) {
    const port = event.ports[0];
    void flushSave().then((saved) => {
      port.postMessage(saved);
      port.close();
    });
    return;
  }

  if (payload.type === 'set-theme') {
    currentTheme = payload.theme === 'light' ? 'light' : 'dark';
    setBodyTheme(currentTheme);
    void syncDrawioFrame();
  }
}

async function claimEdit() {
  if (!drawioLeaseClient) {
    return;
  }

  drawioLeaseClient.tryAcquireLease();
}

window.addEventListener('keydown', handleQuickSwitcherKeyDown, { capture: true });

async function init() {
  setBodyTheme(currentTheme);

  try {
    await ensureClientAuthenticated();
    runtimeConfig = getRuntimeConfig();

    if (!filePath) {
      throw new Error('Missing draw.io file path');
    }

    const response = await vaultApiClient.readFile(filePath);
    currentXml = String(response?.content ?? '');

    loadingState?.remove();
    rootElement.replaceChildren(rootShell);
    rootShell.replaceChildren(banner, frameShell);

    document.getElementById('claimEditBtn')?.addEventListener('click', () => {
      void claimEdit();
    });

    window.addEventListener('message', handleParentMessage);
    window.addEventListener('beforeunload', (event) => {
      if (!saveQueue.hasPendingWrites()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('pagehide', () => {
      if (!saveQueue.hasPendingWrites()) drawioLeaseClient?.releaseLease();
    });

    if (requestedMode === 'view' || !drawioLeaseClient) {
      state.isEditor = false;
      state.canClaim = false;
      state.bannerText = isExportImageMode ? 'Rendering preview…' : 'Read-only mode';
      if (!isExportImageMode) {
        updateBanner();
      }
      attachDrawioFrame();
      return;
    }

    await drawioLeaseClient.connect({
      initialUser: {
        name: params.get('userName') || localStorage.getItem('collabmd-user-name') || '',
        peerId: params.get('peerId') || '',
      },
      requestedMode: 'edit',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderError(message, { fallbackToText: hostMode === 'file-preview' });
    setLoadingCopy(`Failed to load draw.io: ${message}`, { isError: true });
  }
}

void init();
