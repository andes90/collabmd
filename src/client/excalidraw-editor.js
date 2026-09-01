import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  CaptureUpdateAction,
  Excalidraw,
  reconcileElements,
  restoreAppState,
  restoreElements,
  sceneCoordsToViewportCoords,
} from '@excalidraw/excalidraw';
import { getElementBounds } from '@excalidraw/element';
import '@excalidraw/excalidraw/index.css';

import { createEditableContentRevision } from '../domain/editable-content-revision.js';
import {
  buildRenderableCollaboratorsMap,
  findCollaboratorByPeerId,
  getCollaboratorsRenderSignature,
  mergeAwarenessUserPatch,
  resolveLocalAwarenessUser,
} from './domain/excalidraw-collaboration.js';
import './styles/surfaces/embedded-editor-base.css';
import './styles/features/comment-markdown.css';
import './styles/features/comment-overview.css';
import './styles/features/comments-drawer.css';
import './styles/surfaces/excalidraw-editor.css';
import {
  applySceneUpdateWithFiles,
} from './domain/excalidraw-api-scene-sync.js';
import {
  normalizeDocumentMode,
  normalizeScene,
  parseSceneJson,
  sceneToInitialData,
} from './domain/excalidraw-scene.js';
import {
  createCommentOverviewThread,
  formatAnchorLabel,
  getLatestMessage,
} from './presentation/comment-ui/comment-ui-shared.js';
import {
  buildReconciledExcalidrawSceneUpdate,
} from './domain/excalidraw-scene-reconcile.js';
import {
  createExcalidrawDiagnosticRing,
  summarizeExcalidrawScene,
} from './domain/excalidraw-diagnostics.js';
import { isPlainQuickSwitcherShortcut } from './domain/keyboard-shortcuts.js';
import {
  createExcalidrawElementLink,
  parseExcalidrawElementLink,
} from './domain/excalidraw-element-link.js';
import { resolveAppPath, resolveAppUrl } from './domain/runtime-paths.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';
import {
  EXCALIDRAW_ROOM_CONNECTION_STATE,
  ExcalidrawRoomClient,
} from './infrastructure/excalidraw-room-client.js';
import { vaultApiClient } from './infrastructure/vault-api-client.js';

const params = new URLSearchParams(window.location.search);
const isTestMode = params.get('test') === '1';
const diagnostics = createExcalidrawDiagnosticRing({
  enabled: params.get('excalidrawDebug') === '1',
});
const parentOrigin = window.location.origin;
const appPath = resolveAppPath('/');
const appUrl = resolveAppUrl('/');
const syncTimeoutMs = Number.parseInt(params.get('syncTimeoutMs') || '', 10);

let currentDocument = {
  filePath: params.get('file') || '',
  mode: normalizeDocumentMode(params.get('mode')),
};
let excalidrawAPI = null;
let currentTheme = params.get('theme') || 'dark';
let localAwarenessUser = resolveLocalAwarenessUser({
  params,
  storedUserName: localStorage.getItem('collabmd-user-name'),
});
let appliedSceneJson = '';
let appliedSceneRevisionPromise = createEditableContentRevision(appliedSceneJson);

function setAppliedSceneJson(value) {
  appliedSceneJson = value;
  appliedSceneRevisionPromise = createEditableContentRevision(value);
}

let collabReady = false;
let pendingRemoteSceneJson = '';
let pendingRemoteSceneAuthoritative = false;
let pendingCollaborators = null;
let activeCollaborators = new Map();
let followedSocketId = null;
let pendingHostFollowPeerId = null;
let suppressViewportBroadcast = false;
let pendingViewportSuppressionReleases = 0;
let lastAppliedFollowViewportSignature = '';
let lastRenderedCollaboratorsSignature = '';
let apiStateCleanupCallbacks = [];
let collaboratorRenderFrame = 0;
let queuedCollaborators = null;
let initialViewportFitPending = true;
let viewportFitGeneration = 0;
let previewViewportFitTimerId = 0;
let previewViewportFitRetryTimerId = 0;
let roomClient = null;
let roomClientGeneration = 0;
let reactRoot = null;
let editorRenderKey = 0;
let skipRoomDisconnectOnUnmount = false;
let roomConnectionState = EXCALIDRAW_ROOM_CONNECTION_STATE.CONNECTING;
let diagramCommentThreads = [];
let pendingDiagramCommentFocus = null;
let diagramCommentFocusRequestId = 0;
let parkRequestedWhileBlocked = false;
const pendingDisconnectRequestIds = new Set();
const reportedFileConflictSignatures = new Set();

function getMountedExcalidrawAPI() {
  return excalidrawAPI && !excalidrawAPI.isDestroyed ? excalidrawAPI : null;
}

function requestDiagramCommentFocus(threadId) {
  const normalizedThreadId = String(threadId ?? '').trim();
  if (!normalizedThreadId) {
    return;
  }

  pendingDiagramCommentFocus = {
    requestId: ++diagramCommentFocusRequestId,
    threadId: normalizedThreadId,
  };
  renderExcalidrawApp();
}

if (diagnostics.enabled) {
  window.__COLLABMD_EXCALIDRAW_DEBUG__ = diagnostics;
}

function getDocumentViewState(mode = currentDocument.mode) {
  const normalizedMode = normalizeDocumentMode(mode);
  const authorityReadOnly = roomConnectionState !== EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE;
  return {
    viewModeEnabled: normalizedMode === 'preview' || authorityReadOnly,
    zenModeEnabled: normalizedMode === 'preview',
  };
}

function getAuthorityBannerText() {
  if (normalizeDocumentMode(currentDocument.mode) === 'preview') {
    return '';
  }

  if (roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.FALLBACK_READONLY) {
    return 'Showing the saved diagram. Editing will resume after live sync completes.';
  }

  if (roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY) {
    return 'Connection lost. Editing is paused while the diagram reconnects.';
  }

  if (roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.CONNECTING) {
    return 'Connecting to the live diagram…';
  }

  return '';
}

function getSelectedDiagramElement() {
  const api = getMountedExcalidrawAPI();
  const selectedElementIds = api?.getAppState?.()?.selectedElementIds || {};
  const selectedElements = api?.getSceneElementsIncludingDeleted?.()
    ?.filter((element) => selectedElementIds[element.id] && !element.isDeleted) ?? [];
  return selectedElements.length === 1 ? selectedElements[0] : null;
}

function normalizeDiagramLabelText(value, maxLength = 72) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function getDiagramElementContent(element, api = getMountedExcalidrawAPI()) {
  const directText = normalizeDiagramLabelText(element?.text);
  if (directText) {
    return directText;
  }

  const sceneElements = api?.getSceneElementsIncludingDeleted?.() || [];
  const boundElementIds = new Set(
    Array.isArray(element?.boundElements)
      ? element.boundElements.map((boundElement) => boundElement?.id).filter(Boolean)
      : [],
  );
  if (boundElementIds.size === 0) {
    return '';
  }

  return normalizeDiagramLabelText(
    sceneElements
      .filter((sceneElement) => boundElementIds.has(sceneElement.id) && !sceneElement.isDeleted)
      .map((sceneElement) => sceneElement.text)
      .filter((text) => typeof text === 'string' && text.trim())
      .join(' '),
  );
}

function formatDiagramAnchorLabel(type, content = '') {
  const normalizedType = typeof type === 'string' && type.trim() ? type.trim() : 'element';
  const typeLabel = normalizedType === 'element'
    ? 'Diagram element'
    : `${normalizedType.charAt(0).toUpperCase()}${normalizedType.slice(1)} element`;
  const normalizedContent = normalizeDiagramLabelText(content);
  return normalizedContent ? `${typeLabel} · ${normalizedContent}` : typeLabel;
}

function getDiagramAnchorLabel(thread) {
  const snapshot = thread?.anchorSnapshot;
  const element = getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()
    ?.find((candidate) => candidate.id === thread?.elementId && !candidate.isDeleted);
  const elementContent = normalizeDiagramLabelText(snapshot?.text) || getDiagramElementContent(element);
  const firstMessageContent = thread?.messages?.[0]?.body;
  return formatDiagramAnchorLabel(snapshot?.type || element?.type, elementContent || firstMessageContent);
}

const diagramCommentTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
});

function formatDiagramCommentTimestamp(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  try {
    return diagramCommentTimeFormatter.format(new Date(value));
  } catch {
    return '';
  }
}

function renderDiagramCommentOverviewThread(thread, activeThreadId, onOpen) {
  const latestMessage = getLatestMessage(thread?.messages ?? []);
  const messageCount = Array.isArray(thread?.messages) ? thread.messages.length : 0;
  const button = createCommentOverviewThread({
    authorName: latestMessage?.userName || thread?.createdByName || 'Anonymous',
    buttonClassName: 'comment-overview-thread comments-drawer-item',
    footerClassName: 'comment-overview-thread-footer comments-drawer-item-footer',
    headerClassName: 'comment-overview-thread-header comments-drawer-item-header',
    lineClassName: 'comment-overview-thread-line comments-drawer-item-title',
    lineLabel: formatAnchorLabel(thread),
    messageCount,
    previewBody: latestMessage?.body || '',
    previewClassName: 'comment-markdown comment-overview-thread-preview comments-drawer-item-preview',
    quote: thread?.anchorQuote || thread?.anchorSnapshot?.text || 'Diagram element',
    quoteClassName: 'comment-overview-thread-quote comments-drawer-item-quote',
    timestamp: formatDiagramCommentTimestamp(latestMessage?.createdAt),
  });
  button.classList.toggle('is-active', thread.id === activeThreadId);

  return React.createElement('button', {
    className: button.className,
    dangerouslySetInnerHTML: { __html: button.innerHTML },
    key: thread.id,
    onClick: () => onOpen(thread.id),
    type: 'button',
  });
}

function DiagramCommentIcon({ add = false }) {
  const paths = [React.createElement('path', {
    d: 'M3 4.75A1.75 1.75 0 0 1 4.75 3h6.5A1.75 1.75 0 0 1 13 4.75v4.5A1.75 1.75 0 0 1 11.25 11H8.9L6.5 13v-2H4.75A1.75 1.75 0 0 1 3 9.25v-4.5Z',
    fill: 'none',
    key: 'bubble',
    stroke: 'currentColor',
    strokeLinejoin: 'round',
    strokeWidth: '1.35',
  })];
  if (add) {
    paths.push(React.createElement('path', {
      d: 'M8 5.5v3.5M6.25 7.25h3.5',
      fill: 'none',
      key: 'plus',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeWidth: '1.35',
    }));
  }

  return React.createElement('svg', {
    'aria-hidden': 'true',
    className: 'diagram-comment-icon',
    fill: 'none',
    focusable: 'false',
    viewBox: '0 0 16 16',
  }, paths);
}

function getDiagramCommentMarkerPosition(thread, api = getMountedExcalidrawAPI()) {
  if (!api || thread?.anchorKind !== 'diagram-element') {
    return null;
  }

  let scenePoint = thread.anchorPoint;
  const element = api.getSceneElementsIncludingDeleted?.()
    ?.find((candidate) => candidate.id === thread.elementId && !candidate.isDeleted);
  if (element) {
    try {
      const bounds = getElementBounds(element, api.getSceneElementsMapIncludingDeleted?.());
      scenePoint = {
        x: bounds[2],
        y: bounds[1],
      };
    } catch {
      scenePoint = thread.anchorPoint;
    }
  }

  const x = Number(scenePoint?.x);
  const y = Number(scenePoint?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const appState = api.getAppState?.();
  if (!appState?.zoom || !Number.isFinite(appState.scrollX) || !Number.isFinite(appState.scrollY)) {
    return null;
  }

  return sceneCoordsToViewportCoords(
    { sceneX: x, sceneY: y },
    {
      offsetLeft: Number.isFinite(appState.offsetLeft) ? appState.offsetLeft : 0,
      offsetTop: Number.isFinite(appState.offsetTop) ? appState.offsetTop : 0,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
    },
  );
}

function getDiagramElementTargets(elementId, elementType = 'element', api = getMountedExcalidrawAPI()) {
  const normalizedElementId = String(elementId ?? '').trim();
  const elements = api?.getSceneElementsIncludingDeleted?.()
    ?.filter((element) => !element.isDeleted) || [];
  if (!normalizedElementId) {
    return [];
  }

  if (elementType === 'group') {
    const groupElements = elements.filter((element) => element.groupIds?.includes(normalizedElementId));
    if (groupElements.length > 0) {
      return groupElements;
    }
  }

  return elements.filter((element) => element.id === normalizedElementId);
}

function focusDiagramElement(elementId, elementType = 'element') {
  const api = getMountedExcalidrawAPI();
  const elements = getDiagramElementTargets(elementId, elementType, api);
  if (!api || elements.length === 0) {
    return;
  }

  api.updateScene({
    appState: {
      selectedElementIds: Object.fromEntries(elements.map((element) => [element.id, true])),
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });

  if (typeof api.setViewport !== 'function') {
    return;
  }

  suppressViewportBroadcast = true;
  try {
    api.setViewport({
      animation: false,
      fit: 'contain',
      offsets: { ui: true },
      target: elements,
    });
  } finally {
    releaseViewportBroadcastSuppressionAfterPaint();
  }

}

function focusDiagramCommentThread(thread) {
  focusDiagramElement(thread?.elementId);
}

function applyDocumentMode(mode = currentDocument.mode) {
  document.body.dataset.documentMode = normalizeDocumentMode(mode);
}

function createRoomClient(filePath) {
  const generation = ++roomClientGeneration;
  const client = new ExcalidrawRoomClient({
    filePath,
    onCollaboratorsChange: (collaborators) => {
      if (generation !== roomClientGeneration) {
        return;
      }

      if (!collabReady) {
        pendingCollaborators = collaborators;
        return;
      }

      queueCollaboratorsRender(collaborators);
    },
    onCommentThreadsChange: (threads) => {
      if (generation !== roomClientGeneration) {
        return;
      }

      diagramCommentThreads = Array.isArray(threads) ? threads : [];
      if (reactRoot) {
        renderExcalidrawApp();
      }
    },
    onConnectionStateChange: (event) => {
      if (generation !== roomClientGeneration) {
        return;
      }

      handleRoomConnectionStateChange(event);
    },
    onRemoteSceneJson: (sceneJson, { authoritative = false } = {}) => {
      if (generation !== roomClientGeneration) {
        return;
      }

      applySceneFromJson(sceneJson, { authoritative });
    },
    syncTimeoutMs: Number.isFinite(syncTimeoutMs) ? syncTimeoutMs : undefined,
    vaultClient: vaultApiClient,
  });

  return {
    client,
    generation,
  };
}

function handleExcalidrawLinkOpen(element, event) {
  if (window.parent === window) {
    return;
  }

  const target = parseExcalidrawElementLink(element?.link, {
    appPath,
    origin: parentOrigin,
  });
  if (!target) {
    return;
  }

  event?.preventDefault?.();
  postToParent('open-element-link', { href: element.link });
}

function buildExcalidrawProps({ initialData, renderTopRightUI, viewModeEnabled } = {}) {
  const props = {
    onMount: handleEditorMount,
    onInitialize: (api) => {
      initializeEditor(api);
    },
    onUnmount: () => {
      clearEditorApiStateBindings();
      clearPreviewViewportFitTimers();
      if (skipRoomDisconnectOnUnmount) {
        skipRoomDisconnectOnUnmount = false;
      } else {
        disconnectRealtimeRoom({ preserveEditorBindings: true });
      }
      excalidrawAPI = null;
      collabReady = false;
    },
    aiEnabled: false,
    generateLinkForSelection: (elementId, elementType) => createExcalidrawElementLink(
      currentDocument.filePath,
      elementId,
      { appUrl, elementType },
    ),
    isCollaborating: true,
    onChange: (elements, appState, files) => {
      scheduleSyncToRoom(elements, appState, files);
      roomClient?.syncLocalSelectionAwareness(appState);
    },
    onLinkOpen: handleExcalidrawLinkOpen,
    onPointerUpdate: (payload) => {
      roomClient?.scheduleLocalPointerAwareness(payload);
    },
    onPointerDown: () => {
      initialViewportFitPending = false;
      stopFollowingFromLocalInteraction();
    },
    renderTopRightUI,
    historyOptions: {
      traversal: 'single-entry',
    },
    onHistoryAction: handleHistoryAction,
    theme: currentTheme,
    ...getDocumentViewState(),
    ...(typeof viewModeEnabled === 'boolean' ? { viewModeEnabled } : {}),
    UIOptions: {
      canvasActions: {
        export: false,
        loadScene: false,
        saveToActiveFile: false,
        toggleTheme: false,
      },
    },
  };

  if (initialData) {
    props.initialData = initialData;
  }

  return props;
}

const diagramCommentsContext = React.createContext(null);
const presentationContext = React.createContext(null);

function PresentationToolbar() {
  const context = React.useContext(presentationContext);
  if (!context) {
    return null;
  }

  const label = context.active ? 'Exit presentation' : 'Start presentation';
  const icon = context.active ? '×' : '▶';
  let title = context.active ? 'Exit presentation' : 'Present frames';
  if (context.frameCount === 0) {
    title = 'Add a frame to create slides';
  }

  return React.createElement('button', {
    'aria-label': label,
    'aria-pressed': context.active,
    className: `diagram-comment-button excalidraw-presentation-toggle sidebar-trigger${context.active ? ' is-active' : ''}`,
    'data-testid': 'excalidraw-presentation-toggle',
    disabled: context.frameCount === 0,
    onClick: context.toggle,
    title,
    type: 'button',
  }, React.createElement('span', { 'aria-hidden': 'true' }, icon));
}

function DiagramCommentsToolbar() {
  const context = React.useContext(diagramCommentsContext);
  if (!context?.visible || !context.room) {
    return null;
  }

  const addCommentButton = context.selectedElement
    ? React.createElement('button', {
      'aria-label': 'Add comment',
      className: 'diagram-comment-add sidebar-trigger',
      'data-testid': 'diagram-add-comment',
      disabled: !context.canWrite,
      key: 'add',
      onClick: context.openComposer,
      title: context.canWrite ? 'Add comment to selected element' : 'Reconnect to add a comment',
      type: 'button',
    }, React.createElement(DiagramCommentIcon, { add: true }))
    : null;

  return React.createElement('div', {
    'aria-label': 'Diagram comments',
    className: 'diagram-comments-toolbar',
    role: 'toolbar',
  }, [
    addCommentButton,
    React.createElement('button', {
      'aria-expanded': context.drawerOpen,
      'aria-label': 'Comments',
      className: `diagram-comment-button sidebar-trigger${context.drawerOpen ? ' active' : ''}`,
      'data-testid': 'diagram-comments-toggle',
      key: 'toggle',
      onClick: context.toggleDrawer,
      title: context.drawerOpen ? 'Close comments' : 'Open comments',
      type: 'button',
    }, [
      React.createElement(DiagramCommentIcon, { key: 'icon' }),
      context.threads.length > 0
        ? React.createElement('span', {
          className: 'diagram-comment-count',
          key: 'count',
        }, String(context.threads.length))
        : null,
    ]),
  ]);
}

const DiagramCommentsExcalidraw = React.memo(function DiagramCommentsExcalidraw({ initialData = null, renderKey = 0, viewModeEnabled }) {
  const renderTopRightUI = React.useCallback(
    () => React.createElement('div', {
      className: 'excalidraw-editor-toolbar',
    }, [
      React.createElement(PresentationToolbar, { key: 'presentation' }),
      React.createElement(DiagramCommentsToolbar, { key: 'comments' }),
    ]),
    [],
  );

  return React.createElement(Excalidraw, {
    key: `editor-${renderKey}`,
    ...buildExcalidrawProps({ initialData, renderTopRightUI, viewModeEnabled }),
  });
});

function useCloseDiagramCommentsOnCanvas(drawerOpen, setDrawerOpen) {
  React.useEffect(() => {
    if (!drawerOpen) {
      return undefined;
    }

    const closeOnCanvasPointerDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('canvas.excalidraw__canvas')) {
        return;
      }

      setDrawerOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setDrawerOpen(false);
    };

    document.addEventListener('pointerdown', closeOnCanvasPointerDown, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnCanvasPointerDown, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [drawerOpen, setDrawerOpen]);
}

function DiagramCommentsEditor({ apiId = '', canWrite = false, focusRequest = null, initialData = null, room = null, threads = [], visible = false }) {
  const [activeThreadId, setActiveThreadId] = React.useState(null);
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [replyDraft, setReplyDraft] = React.useState('');
  const [presentationFrameId, setPresentationFrameId] = React.useState(null);
  const [, setViewportRevision] = React.useState(0);
  const presentationFrames = (
    getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.() || []
  ).filter((element) => element?.type === 'frame' && !element.isDeleted);
  const presentationIndex = presentationFrames.findIndex((frame) => frame.id === presentationFrameId);
  const presentationMode = presentationFrameId !== null;

  React.useEffect(() => {
    const api = getMountedExcalidrawAPI();
    if (!api) {
      return undefined;
    }

    const refresh = () => setViewportRevision((revision) => revision + 1);
    const cleanups = [
      api.onChange?.(refresh),
      api.onScrollChange?.(refresh),
    ].filter((cleanup) => typeof cleanup === 'function');
    window.addEventListener('resize', refresh);
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      window.removeEventListener('resize', refresh);
    };
  }, [apiId]);

  useCloseDiagramCommentsOnCanvas(drawerOpen, setDrawerOpen);

  const goToPresentationFrame = React.useCallback((index) => {
    const targetIndex = Math.min(Math.max(index, 0), presentationFrames.length - 1);
    const frame = presentationFrames[targetIndex];
    const api = getMountedExcalidrawAPI();
    if (!api || !frame) {
      return;
    }

    setPresentationFrameId(frame.id);
    api.setViewport({
      animation: true,
      fit: 'contain',
      offsets: { ui: true },
      target: frame,
    });
  }, [presentationFrames]);

  const togglePresentation = React.useCallback(() => {
    if (presentationMode) {
      setPresentationFrameId(null);
      return;
    }

    setDrawerOpen(false);
    setComposerOpen(false);
    setActiveThreadId(null);
    goToPresentationFrame(0);
  }, [goToPresentationFrame, presentationMode]);

  React.useEffect(() => {
    if (!presentationFrameId || presentationIndex >= 0) {
      return;
    }

    if (presentationFrames.length > 0) {
      goToPresentationFrame(0);
    } else {
      setPresentationFrameId(null);
    }
  }, [goToPresentationFrame, presentationFrameId, presentationFrames.length, presentationIndex]);

  React.useEffect(() => {
    if (!presentationMode) {
      return undefined;
    }

    const handlePresentationKeyDown = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setPresentationFrameId(null);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        goToPresentationFrame(presentationIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        goToPresentationFrame(presentationIndex - 1);
      }
    };

    document.addEventListener('keydown', handlePresentationKeyDown, true);
    return () => document.removeEventListener('keydown', handlePresentationKeyDown, true);
  }, [goToPresentationFrame, presentationIndex, presentationMode]);

  React.useEffect(() => {
    if (activeThreadId && !threads.some((thread) => thread.id === activeThreadId)) {
      setActiveThreadId(null);
    }
  }, [activeThreadId, threads]);

  React.useEffect(() => {
    const threadId = focusRequest?.threadId;
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      return;
    }

    setDrawerOpen(true);
    setComposerOpen(false);
    setActiveThreadId(threadId);
    setReplyDraft('');
    focusDiagramCommentThread(thread);
  }, [focusRequest?.requestId, threads]);

  const selectedElement = getSelectedDiagramElement();
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const openComposer = () => {
    if (!canWrite || !selectedElement) {
      return;
    }

    setDrawerOpen(true);
    setComposerOpen(true);
    setActiveThreadId(null);
  };
  const openThread = (threadId) => {
    setDrawerOpen(true);
    setComposerOpen(false);
    setActiveThreadId(threadId);
    setReplyDraft('');
  };
  const submitComposer = (event) => {
    event.preventDefault();
    const selectedElementForAnchor = getSelectedDiagramElement();
    const elementContent = getDiagramElementContent(selectedElementForAnchor);
    const threadId = room.createCommentThread({
      body: draft,
      element: elementContent
        ? { ...selectedElementForAnchor, text: elementContent }
        : selectedElementForAnchor,
    });
    if (!threadId) {
      return;
    }

    setDraft('');
    setComposerOpen(false);
    setActiveThreadId(threadId);
  };
  const submitReply = (event) => {
    event.preventDefault();
    if (!activeThread) {
      return;
    }

    const messageId = room.replyToCommentThread(activeThread.id, replyDraft);
    if (!messageId) {
      return;
    }

    setReplyDraft('');
  };
  const resolveThread = () => {
    if (!activeThread || !room.deleteCommentThread(activeThread.id)) {
      return;
    }

    setActiveThreadId(null);
  };
  const renderComposer = () => React.createElement('form', {
    className: 'diagram-comment-form',
    onSubmit: submitComposer,
  }, [
    React.createElement('p', {
      className: 'diagram-comment-anchor-label',
      key: 'anchor',
    }, selectedElement
      ? `On ${formatDiagramAnchorLabel(selectedElement.type, getDiagramElementContent(selectedElement))}`
      : 'On selected element'),
    React.createElement('textarea', {
      'aria-label': 'Comment',
      autoFocus: true,
      className: 'diagram-comment-input',
      key: 'input',
      maxLength: 2000,
      onChange: (event) => setDraft(event.target.value),
      placeholder: 'Add context, feedback, or a question…',
      rows: 4,
      value: draft,
    }),
    React.createElement('div', {
      className: 'diagram-comment-form-actions',
      key: 'actions',
    }, [
      React.createElement('button', {
        className: 'diagram-comment-button is-secondary',
        key: 'cancel',
        onClick: () => setComposerOpen(false),
        type: 'button',
      }, 'Cancel'),
      React.createElement('button', {
        className: 'diagram-comment-button is-primary',
        disabled: !draft.trim() || !canWrite,
        key: 'submit',
        type: 'submit',
      }, 'Post comment'),
    ]),
  ]);
  const renderThread = () => React.createElement(React.Fragment, null, [
    React.createElement('button', {
      className: 'diagram-comment-back',
      key: 'back',
      onClick: () => setActiveThreadId(null),
      type: 'button',
    }, '← All comments'),
    React.createElement('p', {
      className: 'diagram-comment-anchor-label',
      key: 'label',
    }, getDiagramAnchorLabel(activeThread)),
    React.createElement('div', {
      className: 'diagram-comment-messages',
      key: 'messages',
    }, activeThread.messages?.map((message) => React.createElement('article', {
      className: 'diagram-comment-message',
      key: message.id,
    }, [
      React.createElement('div', {
        className: 'diagram-comment-message-meta',
        key: 'meta',
      }, message.userName || 'Anonymous'),
      React.createElement('p', {
        className: 'diagram-comment-message-body',
        key: 'body',
      }, message.body),
    ]))),
    React.createElement('form', {
      className: 'diagram-comment-form',
      key: 'reply-form',
      onSubmit: submitReply,
    }, [
      React.createElement('textarea', {
        'aria-label': 'Reply',
        className: 'diagram-comment-input',
        disabled: !canWrite,
        key: 'reply-input',
        maxLength: 2000,
        onChange: (event) => setReplyDraft(event.target.value),
        placeholder: canWrite ? 'Reply…' : 'Reconnect to reply',
        rows: 3,
        value: replyDraft,
      }),
      React.createElement('div', {
        className: 'diagram-comment-form-actions',
        key: 'reply-actions',
      }, [
        React.createElement('button', {
          className: 'diagram-comment-button is-primary',
          disabled: !replyDraft.trim() || !canWrite,
          type: 'submit',
        }, 'Reply'),
        React.createElement('button', {
          className: 'diagram-comment-button is-danger',
          disabled: !canWrite,
          onClick: resolveThread,
          type: 'button',
        }, 'Resolve'),
      ]),
    ]),
  ]);
  const renderDrawer = () => {
    if (!drawerOpen) {
      return null;
    }

    const isListView = !composerOpen && !activeThread;
    const content = composerOpen
      ? renderComposer()
      : activeThread
        ? renderThread()
          : threads.length > 0
          ? threads.map((thread) => renderDiagramCommentOverviewThread(thread, activeThreadId, openThread))
          : React.createElement('div', {
            className: 'comments-drawer-empty ui-empty-state ui-empty-state--compact',
          }, [
            React.createElement('p', {
              className: 'ui-empty-state-title',
              key: 'title',
            }, 'No comments yet'),
            React.createElement('p', {
              className: 'ui-empty-state-copy',
              key: 'copy',
            }, 'Select an element and add the first comment.'),
          ]);
    const drawerAddButton = selectedElement && !composerOpen
      ? React.createElement('button', {
        'aria-label': 'Add comment',
        className: 'diagram-comment-add',
        disabled: !canWrite,
        key: 'add',
        onClick: openComposer,
        title: canWrite ? 'Add comment to selected element' : 'Reconnect to add a comment',
        type: 'button',
      }, React.createElement(DiagramCommentIcon, { add: true }))
      : null;

    return React.createElement('aside', {
      'aria-label': 'Diagram comments',
      className: 'diagram-comments-drawer',
      'data-testid': 'diagram-comments-drawer',
    }, [
      React.createElement('div', {
        className: 'comments-drawer-header diagram-comments-drawer-header',
        key: 'header',
      }, [
        React.createElement('span', {
          className: 'comments-drawer-title',
          key: 'title',
        }, composerOpen ? 'New comment' : activeThread ? 'Comment thread' : 'Comments'),
        React.createElement('div', {
          className: 'diagram-comments-drawer-header-actions',
          key: 'actions',
        }, [
          drawerAddButton,
          React.createElement('button', {
            'aria-label': 'Close comments',
            className: 'diagram-comment-close',
            key: 'close',
            onClick: () => setDrawerOpen(false),
            type: 'button',
          }, '×'),
        ]),
      ]),
      React.createElement('div', {
        className: `diagram-comments-drawer-content${isListView ? ' comments-drawer-list is-list' : ''}`,
        key: 'content',
      }, content),
    ]);
  };

  const commentsVisible = visible && !presentationMode;
  const renderCommentsOverlay = commentsVisible && room
    ? React.createElement('div', {
      'aria-label': 'Diagram comments overlay',
      className: 'diagram-comments-overlay',
      key: 'overlay',
    }, [
      React.createElement('div', {
        className: 'diagram-comment-markers',
        key: 'markers',
      }, threads.map((thread) => {
        const position = getDiagramCommentMarkerPosition(thread);
        if (!position) {
          return null;
        }

        return React.createElement('button', {
          'aria-label': `Open comment on ${getDiagramAnchorLabel(thread)}`,
          className: `diagram-comment-marker${thread.id === activeThreadId ? ' is-active' : ''}`,
          'data-comment-thread-id': thread.id,
          key: thread.id,
          onClick: () => openThread(thread.id),
          style: {
            left: `${position.x}px`,
            top: `${position.y}px`,
          },
          type: 'button',
        }, React.createElement(DiagramCommentIcon));
      })),
      renderDrawer(),
    ])
    : null;

  const renderPresentationNavigation = presentationMode
    ? React.createElement('div', {
      'aria-label': 'Presentation navigation',
      className: 'excalidraw-presentation-navigation',
      key: 'presentation-navigation',
      role: 'toolbar',
    }, [
      React.createElement('button', {
        'aria-label': 'Previous slide',
        className: 'diagram-comment-button',
        disabled: presentationIndex <= 0,
        key: 'previous',
        onClick: () => goToPresentationFrame(presentationIndex - 1),
        type: 'button',
      }, '←'),
      React.createElement('span', {
        'aria-live': 'polite',
        className: 'excalidraw-presentation-status',
        key: 'status',
      }, `${presentationFrames[presentationIndex]?.name || `Slide ${presentationIndex + 1}`} · ${presentationIndex + 1} / ${presentationFrames.length}`),
      React.createElement('button', {
        'aria-label': 'Next slide',
        className: 'diagram-comment-button',
        disabled: presentationIndex >= presentationFrames.length - 1,
        key: 'next',
        onClick: () => goToPresentationFrame(presentationIndex + 1),
        type: 'button',
      }, '→'),
    ])
    : null;

  return React.createElement(presentationContext.Provider, {
    value: {
      active: presentationMode,
      frameCount: presentationFrames.length,
      toggle: togglePresentation,
    },
  }, React.createElement(diagramCommentsContext.Provider, {
    value: {
      canWrite,
      drawerOpen,
      openComposer,
      room,
      selectedElement,
      threads,
      toggleDrawer: () => setDrawerOpen((open) => !open),
      visible: commentsVisible,
    },
  }, [
    React.createElement(DiagramCommentsExcalidraw, {
      initialData,
      key: 'excalidraw',
      renderKey: editorRenderKey,
      viewModeEnabled: presentationMode || getDocumentViewState().viewModeEnabled,
    }),
    renderCommentsOverlay,
    renderPresentationNavigation,
  ]));
}

function renderExcalidrawApp({ initialData } = {}) {
  if (!reactRoot) {
    return;
  }

  reactRoot.render(
    React.createElement(
      'div',
      { className: 'excalidraw-editor-shell' },
      React.createElement(DiagramCommentsEditor, {
        apiId: getMountedExcalidrawAPI()?.id || '',
        canWrite: roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE,
        focusRequest: pendingDiagramCommentFocus,
        initialData,
        room: roomClient,
        threads: diagramCommentThreads,
        visible: normalizeDocumentMode(currentDocument.mode) !== 'preview',
      }),
      getAuthorityBannerText()
        ? React.createElement('div', {
          className: 'excalidraw-authority-banner',
          role: 'status',
        }, getAuthorityBannerText())
        : null,
    ),
  );
}

function recordSceneDiagnostic(event, details = {}, sceneJson = '') {
  if (!diagnostics.enabled) {
    return;
  }

  let sceneSummary = {};
  if (sceneJson) {
    try {
      sceneSummary = summarizeExcalidrawScene(parseSceneJson(sceneJson));
    } catch {
      sceneSummary = {};
    }
  }

  diagnostics.record(event, {
    ...sceneSummary,
    connectionState: roomConnectionState,
    generation: roomClientGeneration,
    hasPendingWrites: roomClient?.hasPendingWrites?.() || false,
    ...details,
  });
}

function handleHistoryAction({ action = '', outcome = '' } = {}) {
  recordSceneDiagnostic('history-action', { action, outcome });
  const api = getMountedExcalidrawAPI();
  if (outcome !== 'no-visible-change' || !api) {
    return;
  }

  const label = action === 'redo' ? 'Redo' : 'Undo';
  api.setToast?.({
    message: `${label} skipped: a collaborator changed that item`,
  });
}

function handleRoomConnectionStateChange({
  canWrite = false,
  hasPendingWrites = false,
  previousState = EXCALIDRAW_ROOM_CONNECTION_STATE.CLOSED,
  state,
} = {}) {
  roomConnectionState = state || EXCALIDRAW_ROOM_CONNECTION_STATE.CLOSED;
  recordSceneDiagnostic('authority-state', {
    canWrite,
    hasPendingWrites,
    previousState,
    state: roomConnectionState,
  }, roomClient?.getLastSceneJson?.() || '');
  postToParent('excalidraw-authority-state', {
    canWrite,
    hasPendingWrites,
    previousState,
    state: roomConnectionState,
  });

  if (reactRoot) {
    renderExcalidrawApp();
  }

  if (
    roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE
    && previousState === EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY
  ) {
    getMountedExcalidrawAPI()?.setToast?.({ message: 'Live diagram reconnected' });
  }

  if (roomConnectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE) {
    void resolvePendingDisconnectRequests();
  }
}

function applySurfaceTheme(theme = currentTheme) {
  document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

function getNativeHistoryButton(type) {
  const button = document.querySelector(`[data-testid="button-${type}"]`);
  return button instanceof HTMLButtonElement ? button : null;
}

function getNativeHistoryState() {
  const undoButton = getNativeHistoryButton('undo');
  const redoButton = getNativeHistoryButton('redo');

  return {
    canRedo: Boolean(redoButton) && !redoButton.disabled,
    canUndo: Boolean(undoButton) && !undoButton.disabled,
    head: null,
    length: null,
  };
}

function triggerNativeHistory(type) {
  const button = getNativeHistoryButton(type);
  if (!button || button.disabled) {
    return false;
  }

  button.click();
  return true;
}

function applyLocalUserPatch(nextUser = {}) {
  localAwarenessUser = mergeAwarenessUserPatch({
    currentUser: localAwarenessUser,
    nextUser,
  });
  roomClient?.setLocalUser(localAwarenessUser);
}

if (isTestMode) {
  window.__COLLABMD_EXCALIDRAW_TEST__ = {
    disconnectTransport: () => roomClient?.provider?.disconnect?.(),
    getElementBounds: (elementId) => {
      const element = getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()?.find((entry) => entry.id === elementId && !entry.isDeleted);
      if (!element) {
        return null;
      }

      return {
        centerX: element.x + (element.width / 2),
        centerY: element.y + (element.height / 2),
        height: element.height,
        width: element.width,
        x: element.x,
        y: element.y,
      };
    },
    getElementCount: () => (
      getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()?.filter((element) => !element.isDeleted).length ?? 0
    ),
    getElementIds: () => (
      getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()
        ?.filter((element) => !element.isDeleted)
        .map((element) => element.id)
        .sort() ?? []
    ),
    getSelectedElementIds: () => (
      Object.keys(getMountedExcalidrawAPI()?.getAppState?.()?.selectedElementIds || {}).sort()
    ),
    getElementStatus: (elementId) => (
      getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.()
        ?.find((entry) => entry.id === elementId && !entry.isDeleted)?.status ?? null
    ),
    getFileIds: () => (
      Object.keys(getMountedExcalidrawAPI()?.getFiles?.() || {}).sort()
    ),
    getFileVersion: (fileId) => getMountedExcalidrawAPI()?.getFiles?.()?.[fileId]?.version ?? null,
    getEditorId: () => getMountedExcalidrawAPI()?.id || null,
    getForkCapabilities: () => ({
      replaceFiles: typeof getMountedExcalidrawAPI()?.replaceFiles === 'function',
    }),
    getAuthorityState: () => roomConnectionState,
    getCommentThreads: () => roomClient?.getCommentThreads?.() || [],
    getDiagnosticTrace: () => diagnostics.exportTrace(),
    getHistoryState: () => getNativeHistoryState(),
    getLocalUserName: () => localAwarenessUser?.name || '',
    getLocalPeerId: () => localAwarenessUser?.peerId || '',
    getViewport: () => {
      const appState = getMountedExcalidrawAPI()?.getAppState?.();
      return appState ? {
        offsetLeft: appState.offsetLeft,
        offsetTop: appState.offsetTop,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom?.value ?? null,
      } : null;
    },
    isViewMode: () => Boolean(getMountedExcalidrawAPI()?.getAppState?.().viewModeEnabled),
    selectElement: (elementId) => {
      const api = getMountedExcalidrawAPI();
      if (!api || !elementId) {
        return false;
      }

      api.updateScene({
        appState: {
          selectedElementIds: { [elementId]: true },
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      return true;
    },
    getSceneJson: () => roomClient?.getLastSceneJson?.() || '',
    isAuthoritativeReady: () => (
      Boolean(getMountedExcalidrawAPI())
      && collabReady
      && roomClient?.canWriteToRoom === true
      && roomClient?.waitingForAuthoritativeSync === false
      && roomClient?.isApplyingSharedSnapshot?.() === false
    ),
    isReady: () => collabReady && Boolean(getMountedExcalidrawAPI()),
    redoShared: () => triggerNativeHistory('redo'),
    reconnectTransport: () => roomClient?.provider?.connect?.(),
    setScene: (scene) => {
      applyLocalScene(normalizeScene(scene), {
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    setViewport: (viewport) => {
      const api = getMountedExcalidrawAPI();
      if (!api) {
        return;
      }

      const currentAppState = api.getAppState();
      api.updateScene({
        appState: {
          scrollX: Number.isFinite(viewport?.scrollX) ? viewport.scrollX : currentAppState.scrollX,
          scrollY: Number.isFinite(viewport?.scrollY) ? viewport.scrollY : currentAppState.scrollY,
          zoom: Number.isFinite(viewport?.zoom) && viewport.zoom > 0
            ? { value: viewport.zoom }
            : currentAppState.zoom,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    undoShared: () => triggerNativeHistory('undo'),
  };
}

function applyCollaborators(collaborators) {
  activeCollaborators = collaborators instanceof Map ? collaborators : new Map();
  const renderableCollaborators = buildRenderableCollaboratorsMap(activeCollaborators);
  const renderSignature = getCollaboratorsRenderSignature(renderableCollaborators);

  const api = getMountedExcalidrawAPI();
  if (!api) {
    pendingCollaborators = activeCollaborators;
    return;
  }

  if (renderSignature !== lastRenderedCollaboratorsSignature) {
    lastRenderedCollaboratorsSignature = renderSignature;
    api.updateScene({
      collaborators: renderableCollaborators,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  if (pendingHostFollowPeerId) {
    applyHostFollowRequest(pendingHostFollowPeerId);
    return;
  }

  applyFollowedViewport(activeCollaborators);
}

function queueCollaboratorsRender(collaborators) {
  queuedCollaborators = collaborators;
  if (collaboratorRenderFrame) {
    return;
  }

  collaboratorRenderFrame = requestAnimationFrame(() => {
    collaboratorRenderFrame = 0;
    const nextCollaborators = queuedCollaborators;
    queuedCollaborators = null;
    applyCollaborators(nextCollaborators);
  });
}

function isEditingTextElement() {
  return Boolean(getMountedExcalidrawAPI()?.getAppState?.()?.editingTextElement);
}

function flushPendingRemoteScene() {
  if (!pendingRemoteSceneJson || !getMountedExcalidrawAPI() || !collabReady || isEditingTextElement()) {
    return false;
  }

  const sceneJson = pendingRemoteSceneJson;
  const authoritative = pendingRemoteSceneAuthoritative;
  pendingRemoteSceneJson = '';
  pendingRemoteSceneAuthoritative = false;
  applySceneFromJson(sceneJson, {
    authoritative,
    force: true,
  });
  return true;
}

function applySceneFromJson(rawJson, {
  authoritative = false,
  force = false,
} = {}) {
  const scene = parseSceneJson(rawJson);
  const normalizedJson = JSON.stringify(scene);
  if (!force && normalizedJson === appliedSceneJson && !pendingRemoteSceneJson) {
    return;
  }

  setAppliedSceneJson(normalizedJson);
  recordSceneDiagnostic('remote-scene-received', {}, normalizedJson);

  if (!getMountedExcalidrawAPI() || !collabReady) {
    pendingRemoteSceneJson = normalizedJson;
    pendingRemoteSceneAuthoritative ||= authoritative;
    return;
  }

  if (!force && isEditingTextElement()) {
    pendingRemoteSceneJson = normalizedJson;
    pendingRemoteSceneAuthoritative ||= authoritative;
    return;
  }

  pendingRemoteSceneAuthoritative = false;
  updateApiScene(scene, { authoritative });
}

function releaseViewportBroadcastSuppressionAfterPaint() {
  pendingViewportSuppressionReleases += 1;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pendingViewportSuppressionReleases = Math.max(0, pendingViewportSuppressionReleases - 1);
      if (pendingViewportSuppressionReleases === 0) {
        suppressViewportBroadcast = false;
      }
    });
  });
}

function buildApiSceneUpdate(scene, {
  appStateOverrides = {},
  api = getMountedExcalidrawAPI(),
  authoritative = false,
} = {}) {
  if (!api) {
    return null;
  }

  const currentAppState = api.getAppState();
  const currentElements = api.getSceneElementsIncludingDeleted?.() || api.getSceneElements();

  return buildReconciledExcalidrawSceneUpdate({
    appStateOverrides,
    authoritative,
    currentAppState,
    currentElements,
    documentViewState: getDocumentViewState(),
    reconcileElementsFn: reconcileElements,
    restoreAppStateFn: restoreAppState,
    restoreElementsFn: restoreElements,
    scene,
    theme: currentTheme,
  });
}

function logFileConflictOnce(conflictingFileIds = []) {
  const signature = `${currentDocument.filePath}::${[...conflictingFileIds].sort().join(',')}`;
  if (reportedFileConflictSignatures.has(signature)) {
    return;
  }

  reportedFileConflictSignatures.add(signature);
  console.warn(
    `[excalidraw:${currentDocument.filePath}] The installed Excalidraw API cannot replace conflicting binary file payload(s) without a remount: ${conflictingFileIds.join(', ')}`,
  );
  recordSceneDiagnostic('binary-file-conflict', {
    fileCount: conflictingFileIds.length,
    reason: 'replace-files-api-unavailable',
  });
}

function requestEditorRemount(scene) {
  if (!reactRoot) {
    return false;
  }

  const normalizedScene = normalizeScene(scene);
  const normalizedJson = JSON.stringify(normalizedScene);
  pendingRemoteSceneJson = normalizedJson;
  setAppliedSceneJson(normalizedJson);
  pendingCollaborators = activeCollaborators;
  initialViewportFitPending = true;
  clearPreviewViewportFitTimers();
  clearEditorApiStateBindings();
  skipRoomDisconnectOnUnmount = true;
  editorRenderKey += 1;
  renderExcalidrawApp({
    initialData: sceneToInitialData(normalizedScene, { theme: currentTheme }),
  });
  return true;
}

function applySceneToMountedApi(scene, {
  appStateOverrides = {},
  authoritative = false,
  captureUpdate = CaptureUpdateAction.NEVER,
  trackedSharedSnapshot = false,
} = {}) {
  const api = getMountedExcalidrawAPI();
  if (!api) {
    return { skipped: true };
  }

  const nextSceneUpdate = buildApiSceneUpdate(scene, {
    appStateOverrides,
    api,
    authoritative,
  });
  let applyResult;

  if (trackedSharedSnapshot) {
    roomClient?.beginApplyingSharedSnapshot();
  }

  try {
    applyResult = applySceneUpdateWithFiles(api, {
      captureUpdate,
      files: scene?.files || {},
      sceneUpdate: nextSceneUpdate,
    }, {
      onFileConflict: ({ conflictingFileIds }) => {
        logFileConflictOnce(conflictingFileIds);
      },
    });
  } finally {
    if (trackedSharedSnapshot) {
      roomClient?.endApplyingSharedSnapshot();
    }
  }

  if (applyResult?.requiresRemount) {
    requestEditorRemount(scene);
    return applyResult;
  }

  scheduleInitialViewportFit();
  return applyResult;
}

function updateApiScene(scene, {
  appStateOverrides = {},
  authoritative = false,
  captureUpdate = CaptureUpdateAction.NEVER,
  trackedSharedSnapshot = true,
} = {}) {
  applySceneToMountedApi(scene, {
    appStateOverrides,
    authoritative,
    captureUpdate,
    trackedSharedSnapshot,
  });
}

function applyLocalScene(scene, {
  captureUpdate = CaptureUpdateAction.IMMEDIATELY,
} = {}) {
  const normalizedScene = normalizeScene(scene);
  const normalizedJson = JSON.stringify(normalizedScene);

  setAppliedSceneJson(normalizedJson);

  if (!getMountedExcalidrawAPI() || !collabReady) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  applySceneToMountedApi(normalizedScene, {
    captureUpdate,
  });
  roomClient?.commitSceneJson(normalizedJson, {
    origin: 'excalidraw-local-scene-apply',
  });
}

function onRoomTextUpdate() {
  applySceneFromJson(roomClient?.getLastSceneJson?.() || '');
}

function getLiveSceneElementsForSync(fallbackElements = []) {
  return getMountedExcalidrawAPI()?.getSceneElementsIncludingDeleted?.() || fallbackElements;
}

function postToParent(type, payload = {}) {
  window.parent.postMessage({ source: 'excalidraw-editor', type, ...payload }, parentOrigin);
}

function stopFollowingFromLocalInteraction() {
  if (!pendingHostFollowPeerId && !followedSocketId) {
    return;
  }

  applyHostFollowRequest(null);
  postToParent('stop-following');
}

function handleQuickSwitcherKeyDown(event) {
  stopFollowingFromLocalInteraction();
  if (!isPlainQuickSwitcherShortcut(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  postToParent('request-toggle-quick-switcher');
}

function getSceneElementsForPreviewFit() {
  const api = getMountedExcalidrawAPI();
  return (
    api?.getSceneElementsIncludingDeleted?.()
      ?.filter((element) => !element.isDeleted) ?? []
  );
}

function scheduleViewportFit({
  delayMs = 0,
  forcePreview = false,
  consumeInitialFit = false,
} = {}) {
  const normalizedMode = normalizeDocumentMode(currentDocument.mode);
  const api = getMountedExcalidrawAPI();
  if (!api || (forcePreview && normalizedMode !== 'preview')) {
    return;
  }

  if (!forcePreview && !initialViewportFitPending) {
    return;
  }

  if (!forcePreview && api.getAppState?.().cursorButton === 'down') {
    initialViewportFitPending = false;
    return;
  }

  const elements = getSceneElementsForPreviewFit();
  if (elements.length === 0) {
    return;
  }
  if (consumeInitialFit) {
    initialViewportFitPending = false;
  }

  if (!forcePreview && delayMs === 0) {
    api.setViewport({
      target: elements,
      animation: false,
      fit: 'contain',
    });
    return;
  }

  const generation = ++viewportFitGeneration;

  if (previewViewportFitTimerId) {
    window.clearTimeout(previewViewportFitTimerId);
  }

  previewViewportFitTimerId = window.setTimeout(() => {
    previewViewportFitTimerId = 0;
    if (generation !== viewportFitGeneration) {
      return;
    }

    requestAnimationFrame(() => {
      if (generation !== viewportFitGeneration) {
        return;
      }

      requestAnimationFrame(() => {
        if (generation !== viewportFitGeneration) {
          return;
        }

        const api = getMountedExcalidrawAPI();
        if (!api) {
          return;
        }
        if (!forcePreview && api.getAppState?.().cursorButton === 'down') {
          return;
        }

        const latestElements = getSceneElementsForPreviewFit();
        if (latestElements.length === 0) {
          return;
        }

        if (forcePreview) {
          suppressViewportBroadcast = true;
        }

        api.setViewport({
          target: latestElements,
          animation: false,
          fit: 'contain',
        });

        if (forcePreview) {
          releaseViewportBroadcastSuppressionAfterPaint();
        }
      });
    });
  }, delayMs);
}

function scheduleInitialViewportFit() {
  scheduleViewportFit({ consumeInitialFit: true });
}

function schedulePreviewViewportFit() {
  if (previewViewportFitRetryTimerId) {
    window.clearTimeout(previewViewportFitRetryTimerId);
  }

  scheduleViewportFit({ forcePreview: true, delayMs: 80 });
  previewViewportFitRetryTimerId = window.setTimeout(() => {
    previewViewportFitRetryTimerId = 0;
    scheduleViewportFit({ forcePreview: true });
  }, 240);
}

function clearPreviewViewportFitTimers() {
  viewportFitGeneration += 1;

  if (previewViewportFitTimerId) {
    window.clearTimeout(previewViewportFitTimerId);
    previewViewportFitTimerId = 0;
  }

  if (previewViewportFitRetryTimerId) {
    window.clearTimeout(previewViewportFitRetryTimerId);
    previewViewportFitRetryTimerId = 0;
  }
}

function syncLocalViewportToRoom() {
  const api = getMountedExcalidrawAPI();
  if (!collabReady || !api || !roomClient || suppressViewportBroadcast) {
    return;
  }

  const appState = api.getAppState();
  roomClient.scheduleLocalViewportAwareness({
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom?.value,
  });
}

function setFollowedSocket(nextSocketId, { force = false } = {}) {
  const normalizedSocketId = nextSocketId ? String(nextSocketId) : null;
  const didChange = followedSocketId !== normalizedSocketId;
  followedSocketId = normalizedSocketId;
  if (didChange) {
    lastAppliedFollowViewportSignature = '';
  }

  if (followedSocketId) {
    applyFollowedViewport(activeCollaborators, { force: force || didChange });
  }
}

function applyFollowedViewport(collaborators = activeCollaborators, { force = false } = {}) {
  const api = getMountedExcalidrawAPI();
  if (!api || !followedSocketId) {
    return;
  }

  const collaborator = collaborators?.get?.(String(followedSocketId));
  const viewport = collaborator?.viewport;
  if (!viewport) {
    return;
  }

  const nextSignature = `${followedSocketId}:${viewport.scrollX}:${viewport.scrollY}:${viewport.zoom}`;
  if (!force && nextSignature === lastAppliedFollowViewportSignature) {
    return;
  }

  lastAppliedFollowViewportSignature = nextSignature;
  suppressViewportBroadcast = true;
  api.updateScene({
    appState: {
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: { value: viewport.zoom },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  releaseViewportBroadcastSuppressionAfterPaint();
}

function applyHostFollowRequest(peerId) {
  pendingHostFollowPeerId = peerId || null;
  const api = getMountedExcalidrawAPI();
  if (!api) {
    return;
  }

  if (!peerId) {
    api.updateScene({
      appState: { userToFollow: null },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setFollowedSocket(null, { force: true });
    pendingHostFollowPeerId = null;
    return;
  }

  const collaborator = findCollaboratorByPeerId(activeCollaborators, peerId);
  if (!collaborator?.socketId) {
    return;
  }

  api.updateScene({
    appState: {
      userToFollow: {
        socketId: collaborator.socketId,
        username: collaborator.username || '',
      },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  setFollowedSocket(collaborator.socketId, { force: true });
  pendingHostFollowPeerId = null;
}

function clearEditorApiStateBindings() {
  apiStateCleanupCallbacks.forEach((cleanup) => cleanup());
  apiStateCleanupCallbacks = [];
}

function resetRealtimeRoomState() {
  collabReady = false;
  pendingRemoteSceneJson = '';
  pendingCollaborators = null;
  activeCollaborators = new Map();
  diagramCommentThreads = [];
  pendingDiagramCommentFocus = null;
  followedSocketId = null;
  pendingHostFollowPeerId = null;
  suppressViewportBroadcast = false;
  pendingViewportSuppressionReleases = 0;
  lastAppliedFollowViewportSignature = '';
  lastRenderedCollaboratorsSignature = '';
  if (collaboratorRenderFrame) {
    cancelAnimationFrame(collaboratorRenderFrame);
  }
  collaboratorRenderFrame = 0;
  queuedCollaborators = null;
}

function disconnectRealtimeRoom({ preserveEditorBindings = false } = {}) {
  const activeRoomClient = roomClient;
  const previousState = roomConnectionState;
  roomClient = null;
  roomClientGeneration += 1;
  roomConnectionState = EXCALIDRAW_ROOM_CONNECTION_STATE.CLOSED;
  pendingDisconnectRequestIds.clear();
  parkRequestedWhileBlocked = false;

  resetRealtimeRoomState();
  if (!preserveEditorBindings) {
    clearEditorApiStateBindings();
  }

  activeRoomClient?.disconnect();
  recordSceneDiagnostic('room-disconnected', {
    previousState,
    state: roomConnectionState,
  });
  postToParent('excalidraw-authority-state', {
    canWrite: false,
    hasPendingWrites: false,
    previousState,
    state: roomConnectionState,
  });
}

let didDisconnectRealtimeRoom = false;

function disconnectRealtimeRoomOnce() {
  if (didDisconnectRealtimeRoom) {
    return;
  }

  didDisconnectRealtimeRoom = true;
  disconnectRealtimeRoom();
}

async function waitForPendingRoomWrites({
  intervalMs = 10,
  maxWaitMs = 150,
} = {}) {
  const startedAt = performance.now();

  while ((performance.now() - startedAt) < maxWaitMs) {
    const ws = roomClient?.provider?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount === 0) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
}

function waitForAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function waitForAppliedSceneRevision(revision, {
  afterRevision = '',
  maxWaitMs = 4500,
} = {}) {
  const startedAt = performance.now();
  while ((performance.now() - startedAt) < maxWaitMs) {
    const appliedRevision = await appliedSceneRevisionPromise;
    if (
      !pendingRemoteSceneJson
      && (appliedRevision === revision || (afterRevision && appliedRevision !== afterRevision))
    ) {
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      const paintedRevision = await appliedSceneRevisionPromise;
      if (
        !pendingRemoteSceneJson
        && (paintedRevision === revision || (afterRevision && paintedRevision !== afterRevision))
      ) {
        return paintedRevision;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 16));
  }
  return '';
}

async function prepareRealtimeRoomDisconnect() {
  if (!roomClient) {
    return true;
  }

  if (roomClient.getConnectionState() !== EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE) {
    return false;
  }

  roomClient.flushSceneSync();
  await waitForPendingRoomWrites();
  return roomClient?.getConnectionState() === EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE;
}

async function resolvePendingDisconnectRequests() {
  if (pendingDisconnectRequestIds.size === 0 && !parkRequestedWhileBlocked) {
    return;
  }

  const canDisconnect = await prepareRealtimeRoomDisconnect();
  if (!canDisconnect) {
    return;
  }

  const requestIds = [...pendingDisconnectRequestIds];
  pendingDisconnectRequestIds.clear();
  requestIds.forEach((requestId) => {
    postToParent('disconnect-ready', { requestId });
  });

  if (parkRequestedWhileBlocked) {
    parkRequestedWhileBlocked = false;
    disconnectRealtimeRoom({ preserveEditorBindings: true });
  }
}

async function connectDocumentClient(filePath) {
  const { client, generation } = createRoomClient(filePath);
  roomClient = client;
  const scene = await client.connect({ initialUser: localAwarenessUser });

  if (generation !== roomClientGeneration || roomClient !== client) {
    client.disconnect();
    return null;
  }

  return scene;
}

window.addEventListener('pagehide', disconnectRealtimeRoomOnce);
window.addEventListener('beforeunload', (event) => {
  if (roomConnectionState !== EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY) {
    return;
  }

  event.preventDefault();
  event.returnValue = '';
});

window.addEventListener('message', (event) => {
  if (event.origin !== parentOrigin) {
    return;
  }

  if (event.source !== window.parent) {
    return;
  }

  const message = event.data;
  if (!message || message.source !== 'collabmd-host') {
    return;
  }

  if (message.type === 'set-theme') {
    currentTheme = message.theme || 'dark';
    applySurfaceTheme(currentTheme);
    const api = getMountedExcalidrawAPI();
    if (api) {
      api.updateScene({
        appState: { theme: currentTheme },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    renderExcalidrawApp();
    return;
  }

  if (message.type === 'set-user') {
    applyLocalUserPatch(message.user);
    return;
  }

  if (message.type === 'open-comment-thread') {
    requestDiagramCommentFocus(message.threadId);
    return;
  }

  if (message.type === 'focus-element') {
    focusDiagramElement(message.elementId, message.elementType);
    return;
  }

  if (message.type === 'follow-user') {
    applyHostFollowRequest(message.peerId || null);
    return;
  }

  if (message.type === 'fit-preview-viewport') {
    schedulePreviewViewportFit();
    return;
  }

  if (message.type === 'flush-agent-writes') {
    void (async () => {
      roomClient?.flushSceneSync();
      await waitForPendingRoomWrites({ maxWaitMs: 1000 });
      const serverFlush = await roomClient?.waitForServerFlush?.({ timeoutMs: 1000 });
      postToParent('agent-writes-flushed', {
        requestId: message.requestId || '',
        revision: await appliedSceneRevisionPromise,
        status: serverFlush?.status || 'unavailable',
      });
    })();
    return;
  }

  if (message.type === 'wait-for-agent-revision') {
    void (async () => {
      const revision = String(message.revision || '');
      const paintedRevision = revision && await waitForAppliedSceneRevision(revision, {
        afterRevision: String(message.afterRevision || ''),
      });
      postToParent(paintedRevision ? 'agent-revision-painted' : 'agent-revision-not-painted', {
        requestId: message.requestId || '',
        revision: paintedRevision || revision,
      });
    })();
    return;
  }

  if (message.type === 'prepare-disconnect') {
    void (async () => {
      const requestId = message.requestId || '';
      if (await prepareRealtimeRoomDisconnect()) {
        postToParent('disconnect-ready', { requestId });
        return;
      }

      pendingDisconnectRequestIds.add(requestId);
      postToParent('disconnect-blocked', {
        requestId,
        state: roomConnectionState,
      });
    })();
    return;
  }

  if (message.type === 'cancel-disconnect') {
    pendingDisconnectRequestIds.delete(message.requestId || '');
    return;
  }

  if (message.type === 'discard-and-disconnect') {
    const requestId = message.requestId || '';
    pendingDisconnectRequestIds.delete(requestId);
    recordSceneDiagnostic('disconnect-discarded', {
      reason: 'user-confirmed',
      state: roomConnectionState,
    });
    disconnectRealtimeRoom({ preserveEditorBindings: true });
    postToParent('disconnect-ready', {
      discarded: true,
      requestId,
    });
    return;
  }

  if (message.type === 'park-room') {
    void (async () => {
      if (await prepareRealtimeRoomDisconnect()) {
        disconnectRealtimeRoom({ preserveEditorBindings: true });
        return;
      }

      parkRequestedWhileBlocked = true;
      postToParent('park-blocked', { state: roomConnectionState });
    })();
  }
});

function scheduleSyncToRoom(elements, appState, files) {
  if (!collabReady || !roomClient) {
    return;
  }

  const liveElements = getLiveSceneElementsForSync(elements);
  const scheduled = roomClient.scheduleSceneSync(liveElements, appState, files);
  if (diagnostics.enabled) {
    recordSceneDiagnostic(scheduled ? 'local-scene-scheduled' : 'local-scene-rejected', {
      canWrite: roomClient.canWriteToRoom,
      hasPendingWrites: roomClient.hasPendingWrites(),
    }, JSON.stringify({
      appState,
      elements: liveElements,
      files,
    }));
  }
}

function initializeEditor(api) {
  excalidrawAPI = api;
  apiStateCleanupCallbacks.forEach((cleanup) => cleanup());
  apiStateCleanupCallbacks = [];

  apiStateCleanupCallbacks.push(api.onStateChange(['scrollX', 'scrollY', 'zoom'], () => {
    syncLocalViewportToRoom();
  }));
  apiStateCleanupCallbacks.push(api.onStateChange('userToFollow', (userToFollow) => {
    if (userToFollow?.socketId) {
      setFollowedSocket(userToFollow.socketId, { force: true });
      return;
    }

    setFollowedSocket(null, { force: true });
  }));
  apiStateCleanupCallbacks.push(api.onStateChange('selectedElementIds', () => {
    renderExcalidrawApp();
  }));
  apiStateCleanupCallbacks.push(api.onStateChange('editingTextElement', (editingTextElement) => {
    if (!editingTextElement) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          flushPendingRemoteScene();
        });
      });
    }
  }));

  const sceneJson = pendingRemoteSceneJson || roomClient?.getLastSceneJson?.() || '';
  const authoritative = pendingRemoteSceneAuthoritative;
  const initialScene = parseSceneJson(sceneJson);
  pendingRemoteSceneJson = '';
  pendingRemoteSceneAuthoritative = false;
  setAppliedSceneJson(JSON.stringify(initialScene));
  updateApiScene(initialScene, { authoritative });

  if (pendingCollaborators) {
    const renderableCollaborators = buildRenderableCollaboratorsMap(pendingCollaborators);
    lastRenderedCollaboratorsSignature = getCollaboratorsRenderSignature(renderableCollaborators);
    api.updateScene({
      collaborators: renderableCollaborators,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    pendingCollaborators = null;
  }

  collabReady = true;
  syncLocalViewportToRoom();
  onRoomTextUpdate();
  if (pendingHostFollowPeerId) {
    applyHostFollowRequest(pendingHostFollowPeerId);
  }

  scheduleInitialViewportFit();
  postToParent('ready');
  renderExcalidrawApp();
}

function handleEditorMount({ excalidrawAPI: api }) {
  excalidrawAPI = api;
}

window.addEventListener('keydown', handleQuickSwitcherKeyDown, { capture: true });

async function init() {
  const loadingElement = document.getElementById('loadingState');

  try {
    applySurfaceTheme(currentTheme);
    applyDocumentMode();
    await ensureClientAuthenticated();
    const initialScene = await connectDocumentClient(currentDocument.filePath);
    if (!initialScene) {
      throw new Error('Failed to connect initial Excalidraw document');
    }
    const initialData = sceneToInitialData(initialScene, { theme: currentTheme });

    loadingElement?.remove();
    reactRoot = createRoot(document.getElementById('root'));
    renderExcalidrawApp({ initialData });
  } catch (error) {
    console.error('[excalidraw] Failed to initialize:', error);
    postToParent('error', {
      message: error instanceof Error ? error.message : 'Failed to load Excalidraw',
    });

    if (loadingElement) {
      loadingElement.className = 'loading-state error';
      loadingElement.textContent = `Failed to load Excalidraw: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

void init();
