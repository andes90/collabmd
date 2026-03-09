import { resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_PASSWORD,
  SUPPORTED_AUTH_STRATEGIES,
  createRandomAuthPassword,
  createRandomSessionSecret,
} from '../auth/create-auth-service.js';

function parsePositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function parsePort(rawPort, fallbackPort) {
  return parsePositiveInt(rawPort, fallbackPort);
}

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') {
    return '/ws';
  }

  const trimmed = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeAuthStrategy(rawStrategy) {
  const normalized = String(rawStrategy ?? AUTH_STRATEGY_NONE).trim().toLowerCase();
  if (!SUPPORTED_AUTH_STRATEGIES.has(normalized)) {
    throw new Error(
      `Unsupported auth strategy "${rawStrategy}". Supported values: ${Array.from(SUPPORTED_AUTH_STRATEGIES).join(', ')}`,
    );
  }

  return normalized;
}

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function getDefaultHost(nodeEnv) {
  return nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1';
}

export function loadConfig(overrides = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const vaultDir = overrides.vaultDir
    || process.env.COLLABMD_VAULT_DIR
    || resolve(projectRoot, 'data/vault');
  const authOverrides = overrides.auth ?? {};
  const authStrategy = normalizeAuthStrategy(
    authOverrides.strategy
    ?? process.env.AUTH_STRATEGY
    ?? AUTH_STRATEGY_NONE,
  );
  const passwordWasGenerated = authStrategy === AUTH_STRATEGY_PASSWORD
    && !(authOverrides.password || process.env.AUTH_PASSWORD);
  const password = authStrategy === AUTH_STRATEGY_PASSWORD
    ? (authOverrides.password || process.env.AUTH_PASSWORD || createRandomAuthPassword())
    : '';

  return {
    auth: {
      generatedPassword: passwordWasGenerated ? password : '',
      password,
      passwordWasGenerated,
      sessionCookieName: authOverrides.sessionCookieName || process.env.AUTH_SESSION_COOKIE_NAME || 'collabmd_auth',
      sessionSecret: authOverrides.sessionSecret || process.env.AUTH_SESSION_SECRET || createRandomSessionSecret(),
      strategy: authStrategy,
    },
    host: process.env.HOST || getDefaultHost(nodeEnv),
    httpHeadersTimeoutMs: parsePositiveInt(process.env.HTTP_HEADERS_TIMEOUT_MS, 60_000),
    httpKeepAliveTimeoutMs: parsePositiveInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000),
    httpRequestTimeoutMs: parsePositiveInt(process.env.HTTP_REQUEST_TIMEOUT_MS, 30_000),
    port: parsePort(process.env.PORT, 1234),
    nodeEnv,
    plantumlServerUrl: process.env.PLANTUML_SERVER_URL || 'https://www.plantuml.com/plantuml',
    publicDir: resolve(projectRoot, 'public'),
    vaultDir,
    publicWsBaseUrl: process.env.PUBLIC_WS_BASE_URL || '',
    wsHeartbeatIntervalMs: parsePositiveInt(process.env.WS_HEARTBEAT_INTERVAL_MS, 30_000),
    wsRoomIdleGraceMs: parsePositiveInt(process.env.WS_ROOM_IDLE_GRACE_MS, 15_000),
    wsBasePath: normalizeBasePath(process.env.WS_BASE_PATH || '/ws'),
    wsMaxBufferedAmountBytes: parsePositiveInt(
      process.env.WS_MAX_BUFFERED_AMOUNT_BYTES,
      16_777_216,
    ),
    wsMaxPayloadBytes: parsePositiveInt(process.env.WS_MAX_PAYLOAD_BYTES, 16_777_216),
  };
}
