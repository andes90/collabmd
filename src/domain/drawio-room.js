const DRAWIO_FILE_EXTENSION = '.drawio';
const DRAWIO_LEASE_ROOM_PREFIX = '__drawio__:';
const DRAWIO_LEASE_STALE_MS = 45_000;
const DRAWIO_LEASE_HEARTBEAT_MS = 15_000;

function normalizeFilePath(filePath) {
  return String(filePath ?? '').trim();
}

export {
  DRAWIO_FILE_EXTENSION,
  DRAWIO_LEASE_HEARTBEAT_MS,
  DRAWIO_LEASE_ROOM_PREFIX,
  DRAWIO_LEASE_STALE_MS,
};

export function createDrawioLeaseRoomName(filePath) {
  const normalized = normalizeFilePath(filePath);
  if (!normalized) {
    return '';
  }

  return `${DRAWIO_LEASE_ROOM_PREFIX}${encodeURIComponent(normalized)}`;
}

export function parseDrawioLeaseRoomName(roomName) {
  const normalized = String(roomName ?? '').trim();
  if (!normalized.startsWith(DRAWIO_LEASE_ROOM_PREFIX)) {
    return null;
  }

  const encodedPath = normalized.slice(DRAWIO_LEASE_ROOM_PREFIX.length);
  if (!encodedPath) {
    return null;
  }

  try {
    const filePath = decodeURIComponent(encodedPath);
    return filePath ? { filePath, roomName: normalized } : null;
  } catch {
    return null;
  }
}

export function isDrawioLeaseRoom(roomName) {
  return parseDrawioLeaseRoomName(roomName) !== null;
}
