import { resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  SUPPORTED_AUTH_STRATEGIES,
  createRandomAuthPassword,
  createRandomSessionSecret,
} from '../auth/create-auth-service.js';
import { OIDC_PROVIDER_GENERIC, OIDC_PROVIDER_GOOGLE } from '../auth/auth-constants.js';
import { loadBuildInfo } from './build-info.js';
import { isPerfLoggingEnabled } from './perf-logging.js';

function parsePositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function parseOptionalPositiveInt(rawValue, {
  fallbackValue = null,
  variableName = 'value',
} = {}) {
  const normalized = String(rawValue ?? '').trim();
  if (!normalized) {
    return fallbackValue;
  }

  if (!/^[1-9]\d*$/u.test(normalized)) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  const parsed = Number(normalized);
  if (Number.isSafeInteger(parsed) && parsed > 0) {
    return parsed;
  }

  throw new Error(`${variableName} must be a positive integer.`);
}

function parsePort(rawPort, fallbackPort) {
  return parsePositiveInt(rawPort, fallbackPort);
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : '';
}

function resolveDrawioBaseUrl(value) {
  return normalizeOptionalString(value) || 'https://embed.diagrams.net';
}

function normalizeAppBasePath(basePath) {
  const normalized = normalizeOptionalString(basePath);
  if (!normalized || normalized === '/') {
    return '';
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(normalized)) {
    try {
      return normalizeAppBasePath(new URL(normalized).pathname);
    } catch {
      return '';
    }
  }

  const trimmed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeRoutePath(routePath, fallbackPath) {
  if (!routePath || routePath === '/') {
    return fallbackPath;
  }

  const trimmed = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeWsBasePath(basePath) {
  return normalizeRoutePath(basePath, '/ws');
}

function normalizePublicBaseUrl(rawValue) {
  const normalized = normalizeOptionalString(rawValue);
  if (!normalized) {
    return '';
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    throw new Error('PUBLIC_BASE_URL must be an absolute URL.');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
    throw new Error('PUBLIC_BASE_URL must use https unless it points to localhost.');
  }

  if ((parsedUrl.pathname && parsedUrl.pathname !== '/') || parsedUrl.search || parsedUrl.hash) {
    throw new Error('PUBLIC_BASE_URL must not include a path, query string, or hash.');
  }

  return parsedUrl.origin;
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

function normalizeCsvList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }

  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeEmailAllowlist(value) {
  return normalizeCsvList(value)
    .map((entry) => entry.toLowerCase());
}

function normalizeDomainAllowlist(value) {
  return normalizeCsvList(value)
    .map((entry) => entry.replace(/^@+/, '').toLowerCase())
    .filter(Boolean);
}

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export function resolveConfiguredVaultDir(overrides = {}, env = process.env) {
  return overrides.vaultDir
    || env.COLLABMD_VAULT_DIR
    || resolve(projectRoot, 'data/vault');
}

export function resolveCliVaultDir(positionals = [], env = process.env) {
  return resolve(positionals[0] || env.COLLABMD_VAULT_DIR || '.');
}

function getDefaultHost(nodeEnv) {
  return nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1';
}

function resolveOptionalPath(filePath) {
  const normalized = normalizeOptionalString(filePath);
  return normalized ? resolve(normalized) : '';
}

function loadGitConfig(overrides = {}) {
  const remoteOverrides = overrides.remote ?? {};
  const identityOverrides = overrides.identity ?? {};
  const enabled = overrides.enabled ?? (process.env.COLLABMD_GIT_ENABLED !== 'false');
  const repoUrl = normalizeOptionalString(
    remoteOverrides.repoUrl
    ?? process.env.COLLABMD_GIT_REPO_URL,
  );
  const identityName = normalizeOptionalString(
    identityOverrides.name
    ?? process.env.COLLABMD_GIT_USER_NAME
    ?? process.env.GIT_AUTHOR_NAME
    ?? process.env.GIT_COMMITTER_NAME,
  );
  const identityEmail = normalizeOptionalString(
    identityOverrides.email
    ?? process.env.COLLABMD_GIT_USER_EMAIL
    ?? process.env.GIT_AUTHOR_EMAIL
    ?? process.env.GIT_COMMITTER_EMAIL,
  );
  const sshPrivateKeyFile = resolveOptionalPath(
    remoteOverrides.sshPrivateKeyFile
    ?? process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE,
  );
  const sshPrivateKeyBase64 = normalizeOptionalString(
    remoteOverrides.sshPrivateKeyBase64
    ?? process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64,
  );
  const sshKnownHostsFile = resolveOptionalPath(
    remoteOverrides.sshKnownHostsFile
    ?? process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE,
  );
  const remoteEnabled = repoUrl.length > 0;

  if (remoteEnabled && !sshPrivateKeyFile && !sshPrivateKeyBase64) {
    throw new Error(
      'Remote git bootstrap requires COLLABMD_GIT_SSH_PRIVATE_KEY_FILE or COLLABMD_GIT_SSH_PRIVATE_KEY_B64.',
    );
  }

  return {
    cleanup: overrides.cleanup ?? null,
    commandEnv: overrides.commandEnv ?? null,
    enabled,
    identity: {
      email: identityEmail,
      name: identityName,
    },
    remote: {
      enabled: remoteEnabled,
      repoUrl,
      sshKnownHostsFile,
      sshPrivateKeyBase64,
      sshPrivateKeyFile,
    },
  };
}

function loadOidcConfig(overrides = {}, { basePath = '' } = {}) {
  const clientId = normalizeOptionalString(
    overrides.clientId
    ?? process.env.AUTH_OIDC_CLIENT_ID,
  );
  const clientSecret = normalizeOptionalString(
    overrides.clientSecret
    ?? process.env.AUTH_OIDC_CLIENT_SECRET,
  );
  const publicBaseUrl = normalizePublicBaseUrl(
    overrides.publicBaseUrl
    ?? process.env.PUBLIC_BASE_URL,
  );
  const issuer = normalizeOptionalString(
    overrides.issuer
    ?? process.env.AUTH_OIDC_ISSUER_URL,
  ) || 'https://accounts.google.com';
  const flowCookieName = normalizeOptionalString(
    overrides.flowCookieName
    ?? process.env.AUTH_OIDC_FLOW_COOKIE_NAME,
  ) || 'collabmd_auth_flow';
  const allowedEmails = normalizeEmailAllowlist(
    overrides.allowedEmails
    ?? process.env.AUTH_OIDC_ALLOWED_EMAILS,
  );
  const allowedDomains = normalizeDomainAllowlist(
    overrides.allowedDomains
    ?? process.env.AUTH_OIDC_ALLOWED_DOMAINS,
  );

  if (!publicBaseUrl) {
    throw new Error('OIDC auth requires PUBLIC_BASE_URL.');
  }
  if (!clientId) {
    throw new Error('OIDC auth requires AUTH_OIDC_CLIENT_ID.');
  }
  if (!clientSecret) {
    throw new Error('OIDC auth requires AUTH_OIDC_CLIENT_SECRET.');
  }

  return {
    allowedDomains,
    allowedEmails,
    callbackUrl: `${publicBaseUrl}${basePath}/api/auth/oidc/callback`,
    clientId,
    clientSecret,
    flowCookieName,
    issuer,
    provider: issuer === 'https://accounts.google.com' ? OIDC_PROVIDER_GOOGLE : OIDC_PROVIDER_GENERIC,
    publicBaseUrl,
  };
}

export function loadConfig(overrides = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const vaultDir = resolveConfiguredVaultDir(overrides);
  const basePath = normalizeAppBasePath(process.env.BASE_PATH || '');
  const publicDir = resolve(projectRoot, 'dist/client');
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
  const oidc = authStrategy === AUTH_STRATEGY_OIDC
    ? loadOidcConfig(authOverrides.oidc, { basePath })
    : null;
  const git = loadGitConfig(overrides.git);
  const build = loadBuildInfo({
    explicitBuildId: process.env.COLLABMD_BUILD_ID,
    projectRoot,
    publicDir,
  });

  return {
    auth: {
      generatedPassword: passwordWasGenerated ? password : '',
      oidc,
      password,
      passwordWasGenerated,
      sessionCookieName: authOverrides.sessionCookieName || process.env.AUTH_SESSION_COOKIE_NAME || 'collabmd_auth',
      sessionMaxAgeMs: parseOptionalPositiveInt(
        authOverrides.sessionMaxAgeMs ?? process.env.AUTH_SESSION_MAX_AGE_MS,
        { variableName: 'AUTH_SESSION_MAX_AGE_MS' },
      ),
      sessionSecret: authOverrides.sessionSecret || process.env.AUTH_SESSION_SECRET || createRandomSessionSecret(),
      strategy: authStrategy,
    },
    basePath,
    build,
    drawioBaseUrl: resolveDrawioBaseUrl(process.env.COLLABMD_DRAWIO_BASE_URL || process.env.DRAWIO_BASE_URL),
    host: process.env.HOST || getDefaultHost(nodeEnv),
    httpHeadersTimeoutMs: parsePositiveInt(process.env.HTTP_HEADERS_TIMEOUT_MS, 60_000),
    httpKeepAliveTimeoutMs: parsePositiveInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000),
    httpRequestTimeoutMs: parsePositiveInt(process.env.HTTP_REQUEST_TIMEOUT_MS, 30_000),
    git,
    gitEnabled: git.enabled,
    perfLoggingEnabled: overrides.perfLoggingEnabled ?? isPerfLoggingEnabled(process.env.COLLABMD_PERF_LOGGING),
    port: parsePort(process.env.PORT, 1234),
    nodeEnv,
    plantumlServerUrl: process.env.PLANTUML_SERVER_URL || 'https://www.plantuml.com/plantuml',
    publicDir,
    vaultDir,
    publicWsBaseUrl: process.env.PUBLIC_WS_BASE_URL || '',
    testWsRoomHydrateDelayMs: parsePositiveInt(process.env.TEST_WS_ROOM_HYDRATE_DELAY_MS, 0),
    wsHeartbeatIntervalMs: parsePositiveInt(process.env.WS_HEARTBEAT_INTERVAL_MS, 30_000),
    wsRoomIdleGraceMs: parsePositiveInt(process.env.WS_ROOM_IDLE_GRACE_MS, 60_000),
    wsBasePath: normalizeWsBasePath(process.env.WS_BASE_PATH || '/ws'),
    wsMaxBufferedAmountBytes: parsePositiveInt(
      process.env.WS_MAX_BUFFERED_AMOUNT_BYTES,
      16_777_216,
    ),
    wsMaxPayloadBytes: parsePositiveInt(process.env.WS_MAX_PAYLOAD_BYTES, 16_777_216),
  };
}
