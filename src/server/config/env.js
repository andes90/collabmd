import { resolve } from 'path';
import { fileURLToPath } from 'url';

function parsePort(rawPort, fallbackPort) {
  const parsed = Number.parseInt(rawPort ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackPort;
}

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') {
    return '/ws';
  }

  const trimmed = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function getDefaultHost(nodeEnv) {
  return nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1';
}

export function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';

  return {
    host: process.env.HOST || getDefaultHost(nodeEnv),
    port: parsePort(process.env.PORT, 1234),
    nodeEnv,
    publicDir: resolve(projectRoot, 'public'),
    persistenceDir: resolve(projectRoot, process.env.PERSISTENCE_DIR || 'data/rooms'),
    publicWsBaseUrl: process.env.PUBLIC_WS_BASE_URL || '',
    roomNamespace: process.env.ROOM_NAMESPACE || 'collabmd',
    wsBasePath: normalizeBasePath(process.env.WS_BASE_PATH || '/ws'),
  };
}
