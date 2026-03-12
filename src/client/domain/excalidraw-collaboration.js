import { normalizeUserName } from './excalidraw-scene.js';

export const USER_COLOR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
  '#6366f1', '#10b981', '#f43f5e', '#0ea5e9', '#a855f7',
];

export function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export function generatePeerId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function pickFallbackColor(seed) {
  return USER_COLOR_PALETTE[hashString(seed) % USER_COLOR_PALETTE.length];
}

export function ensureColorLight(color, colorLight) {
  if (colorLight && /^#[0-9a-fA-F]{8}$/.test(colorLight)) {
    return colorLight;
  }

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}33`;
  }

  return '#0ea5e933';
}

export function resolveLocalAwarenessUser({
  params,
  storedUserName,
  generatePeerIdFn = generatePeerId,
}) {
  const name = normalizeUserName(params.get('userName'))
    || normalizeUserName(storedUserName)
    || 'User';
  const peerId = params.get('userPeerId') || generatePeerIdFn();
  const color = params.get('userColor') || pickFallbackColor(`${name}-${peerId}`);
  const colorLight = ensureColorLight(color, params.get('userColorLight'));

  return {
    color,
    colorLight,
    name,
    peerId,
  };
}

export function mergeAwarenessUserPatch({
  currentUser,
  nextUser = {},
  generatePeerIdFn = generatePeerId,
}) {
  const patchedName = normalizeUserName(nextUser.name) || currentUser?.name || 'User';
  const patchedPeerId = nextUser.peerId || currentUser?.peerId || generatePeerIdFn();
  const patchedColor = nextUser.color || currentUser?.color || pickFallbackColor(`${patchedName}-${patchedPeerId}`);
  const patchedColorLight = ensureColorLight(
    patchedColor,
    nextUser.colorLight || currentUser?.colorLight,
  );

  return {
    color: patchedColor,
    colorLight: patchedColorLight,
    name: patchedName,
    peerId: patchedPeerId,
  };
}

export function normalizeCollaboratorViewport(viewport) {
  if (!viewport || typeof viewport !== 'object') {
    return undefined;
  }

  const scrollX = Number(viewport.scrollX);
  const scrollY = Number(viewport.scrollY);
  const zoom = Number(viewport.zoom);
  if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY) || !Number.isFinite(zoom) || zoom <= 0) {
    return undefined;
  }

  return {
    scrollX,
    scrollY,
    zoom,
  };
}

export function buildCollaboratorsMap(awareness) {
  const collaborators = new Map();
  if (!awareness) {
    return collaborators;
  }

  awareness.getStates().forEach((state, clientId) => {
    const user = state?.user;
    if (!user) {
      return;
    }

    const pointer = state.pointer && Number.isFinite(state.pointer.x) && Number.isFinite(state.pointer.y)
      ? {
        x: state.pointer.x,
        y: state.pointer.y,
        tool: state.pointer.tool === 'laser' ? 'laser' : 'pointer',
      }
      : undefined;
    const viewport = normalizeCollaboratorViewport(state.viewport);

    collaborators.set(String(clientId), {
      button: state.pointerButton === 'down' ? 'down' : 'up',
      color: {
        background: ensureColorLight(user.color || '#0ea5e9', user.colorLight),
        stroke: user.color || '#0ea5e9',
      },
      id: user.peerId || String(clientId),
      isCurrentUser: clientId === awareness.clientID,
      pointer,
      viewport,
      selectedElementIds: state.selectedElementIds || undefined,
      socketId: String(clientId),
      username: user.name || 'User',
    });
  });

  return collaborators;
}

export function findCollaboratorByPeerId(collaborators, peerId) {
  if (!(collaborators instanceof Map) || !peerId) {
    return null;
  }

  for (const collaborator of collaborators.values()) {
    if (collaborator?.id === peerId) {
      return collaborator;
    }
  }

  return null;
}
