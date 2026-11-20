import { generatePeerId, normalizeUserName, USER_COLORS } from './room.js';

export function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export function pickFallbackColor(seed) {
  return USER_COLORS[hashString(seed) % USER_COLORS.length];
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

export function buildRenderableCollaboratorsMap(collaborators) {
  const renderable = new Map();
  if (!(collaborators instanceof Map)) {
    return renderable;
  }

  collaborators.forEach((collaborator, key) => {
    if (!collaborator?.isCurrentUser) {
      renderable.set(key, collaborator);
    }
  });

  return renderable;
}

function serializeCollaboratorForRenderSignature(key, collaborator = {}) {
  const pointer = collaborator.pointer || {};
  const viewport = collaborator.viewport || {};
  const selectedElementIds = collaborator.selectedElementIds && typeof collaborator.selectedElementIds === 'object'
    ? Object.keys(collaborator.selectedElementIds).sort()
    : [];

  return [
    key,
    collaborator.button || 'up',
    collaborator.color?.background || '',
    collaborator.color?.stroke || '',
    collaborator.id || '',
    pointer.tool || '',
    pointer.x ?? null,
    pointer.y ?? null,
    selectedElementIds,
    collaborator.socketId || '',
    collaborator.username || '',
    viewport.scrollX ?? null,
    viewport.scrollY ?? null,
    viewport.zoom ?? null,
  ];
}

export function getCollaboratorsRenderSignature(collaborators) {
  if (!(collaborators instanceof Map) || collaborators.size === 0) {
    return '';
  }

  return JSON.stringify([...collaborators.entries()]
    .sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)))
    .map(([key, collaborator]) => serializeCollaboratorForRenderSignature(key, collaborator)));
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
