import { resolve } from 'path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'url';

import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  SUPPORTED_AUTH_STRATEGIES,
  createRandomAuthPassword,
  createRandomSessionSecret,
} from '../auth/create-auth-service.js';
import { loadBuildInfo } from './build-info.js';
import { isPerfLoggingEnabled } from './perf-logging.js';

const DEFAULT_SEARCH_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const DEFAULT_SEARCH_MAX_FILE_SIZE = '1M';
const DEFAULT_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;

function parsePositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function normalizeSearchMaxFileSize(rawValue, fallbackValue = DEFAULT_SEARCH_MAX_FILE_SIZE) {
  const normalized = String(rawValue ?? '').trim();
  if (!normalized) {
    return fallbackValue;
  }

  if (!/^[1-9]\d*(?:[KMG])?$/iu.test(normalized)) {
    throw new Error('COLLABMD_SEARCH_MAX_FILE_SIZE must be a positive byte count with an optional K, M, or G suffix.');
  }

  return normalized.toUpperCase();
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

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : '';
}

function parseBooleanFlag(value, fallbackValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallbackValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function resolveDrawioBaseUrl(value) {
  return normalizeOptionalString(value) || 'https://embed.diagrams.net';
}

function resolveStructurizrServerUrl(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return '';
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    throw new Error('STRUCTURIZR_SERVER_URL must be an absolute HTTP or HTTPS URL.');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('STRUCTURIZR_SERVER_URL must use HTTP or HTTPS.');
  }

  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error('STRUCTURIZR_SERVER_URL must not include a query string or hash.');
  }

  return normalized.replace(/\/+$/u, '');
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
    provider: 'google',
    publicBaseUrl,
  };
}

function loadStructurizrConfig(overrides = {}, { vaultDir } = {}) {
  const serverUrl = resolveStructurizrServerUrl(
    overrides.serverUrl
    ?? process.env.COLLABMD_STRUCTURIZR_SERVER_URL
    ?? process.env.STRUCTURIZR_SERVER_URL,
  );
  const mirrorDir = resolveOptionalPath(
    overrides.mirrorDir
    ?? process.env.COLLABMD_STRUCTURIZR_MIRROR_DIR
    ?? process.env.STRUCTURIZR_MIRROR_DIR,
  ) || resolve(vaultDir, '.collabmd/structurizr');

  return {
    enabled: Boolean(serverUrl),
    mirrorDir,
    serverUrl,
    trustedExecutableDsl: overrides.trustedExecutableDsl
      ?? parseBooleanFlag(
        process.env.COLLABMD_STRUCTURIZR_TRUSTED_EXECUTABLE_DSL
        ?? process.env.STRUCTURIZR_TRUSTED_EXECUTABLE_DSL,
        false,
      ),
  };
}

function loadHostedConfig(overrides = {}, { authStrategy, vaultDir } = {}) {
  const enabled = overrides.enabled ?? parseBooleanFlag(process.env.COLLABMD_HOSTED_ENABLED, false);
  const metadataDbPath = resolveOptionalPath(
    overrides.metadataDbPath
    ?? process.env.COLLABMD_HOSTED_METADATA_DB_PATH,
  ) || resolve(vaultDir, '.collabmd/hosted.sqlite');
  const claimOverrides = overrides.claim ?? {};
  const githubAppOverrides = overrides.githubApp ?? {};
  const githubAppPrivateKeyFile = resolveOptionalPath(
    githubAppOverrides.privateKeyFile
    ?? process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY_FILE,
  );
  const githubAppPrivateKeyInput = normalizeOptionalString(
    githubAppOverrides.privateKey
    ?? process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY,
  );
  const githubAppPrivateKey = githubAppPrivateKeyInput
    || (enabled && githubAppPrivateKeyFile ? readFileSync(githubAppPrivateKeyFile, 'utf8') : '');

  if (enabled && authStrategy !== AUTH_STRATEGY_OIDC) {
    throw new Error('Hosted workspace mode requires AUTH_STRATEGY=oidc.');
  }

  return {
    claim: {
      email: normalizeOptionalString(
        claimOverrides.email
        ?? process.env.COLLABMD_HOSTED_CLAIM_EMAIL,
      ),
      token: normalizeOptionalString(
        claimOverrides.token
        ?? process.env.COLLABMD_HOSTED_CLAIM_TOKEN,
      ),
    },
    enabled,
    githubApp: {
      apiBaseUrl: normalizeOptionalString(
        githubAppOverrides.apiBaseUrl
        ?? process.env.COLLABMD_GITHUB_API_BASE_URL,
      ) || 'https://api.github.com',
      appId: normalizeOptionalString(
        githubAppOverrides.appId
        ?? process.env.COLLABMD_GITHUB_APP_ID,
      ),
      appSlug: normalizeOptionalString(
        githubAppOverrides.appSlug
        ?? process.env.COLLABMD_GITHUB_APP_SLUG,
      ),
      flowCookieName: normalizeOptionalString(
        githubAppOverrides.flowCookieName
        ?? process.env.COLLABMD_GITHUB_SETUP_FLOW_COOKIE_NAME,
      ) || 'collabmd_github_setup_flow',
      htmlBaseUrl: normalizeOptionalString(
        githubAppOverrides.htmlBaseUrl
        ?? process.env.COLLABMD_GITHUB_HTML_BASE_URL,
      ) || 'https://github.com',
      privateKey: githubAppPrivateKey,
    },
    metadataDbPath,
  };
}

function loadAgentAccessConfig(overrides = {}, { basePath, oidc, vaultDir } = {}) {
  const enabled = overrides.enabled ?? parseBooleanFlag(
    process.env.COLLABMD_AGENT_ACCESS_ENABLED,
    false,
  );
  const publicHostname = oidc?.publicBaseUrl
    ? new URL(oidc.publicBaseUrl).hostname.toLowerCase()
    : '';
  return {
    allowedHosts: Array.from(new Set([
      'localhost',
      '127.0.0.1',
      '::1',
      publicHostname,
      ...normalizeCsvList(
        overrides.allowedHosts ?? process.env.COLLABMD_AGENT_ALLOWED_HOSTS,
      ).map((host) => host.toLowerCase()),
    ].filter(Boolean))),
    connectionTtlMs: parsePositiveInt(
      overrides.connectionTtlMs ?? process.env.COLLABMD_AGENT_CONNECTION_TTL_MS,
      30 * 24 * 60 * 60 * 1000,
    ),
    dbPath: resolve(
      overrides.dbPath
        ?? process.env.COLLABMD_AGENT_METADATA_DB_PATH
        ?? resolve(vaultDir, '.collabmd/agent-access.sqlite'),
    ),
    requestsPerMinute: parsePositiveInt(
      overrides.requestsPerMinute ?? process.env.COLLABMD_AGENT_REQUESTS_PER_MINUTE,
      120,
    ),
    enabled,
    endpoint: `${basePath}/mcp`,
  };
}

function resolvePublicDir(nodeEnv) {
  if (nodeEnv === 'test' && process.env.COLLABMD_E2E_PUBLIC_DIR) {
    return resolve(process.env.COLLABMD_E2E_PUBLIC_DIR);
  }

  return resolve(projectRoot, 'dist/client');
}

export function loadConfig(overrides = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const vaultDir = resolveConfiguredVaultDir(overrides);
  const basePath = normalizeAppBasePath(process.env.BASE_PATH || '');
  const publicDir = resolvePublicDir(nodeEnv);
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
  const hosted = loadHostedConfig(overrides.hosted, { authStrategy, vaultDir });
  const agentAccess = loadAgentAccessConfig(overrides.agentAccess, {
    basePath,
    oidc,
    vaultDir,
  });
  const structurizr = loadStructurizrConfig(overrides.structurizr, { vaultDir });
  const build = loadBuildInfo({
    explicitBuildId: process.env.COLLABMD_BUILD_ID,
    projectRoot,
    publicDir,
  });

  return {
    agentAccess,
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
    fileWatcherEnabled: overrides.fileWatcherEnabled ?? process.env.COLLABMD_FILE_WATCHER_ENABLED !== 'false',
    host: process.env.HOST || getDefaultHost(nodeEnv),
    httpHeadersTimeoutMs: parsePositiveInt(process.env.HTTP_HEADERS_TIMEOUT_MS, 60_000),
    httpKeepAliveTimeoutMs: parsePositiveInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000),
    httpRequestTimeoutMs: parsePositiveInt(process.env.HTTP_REQUEST_TIMEOUT_MS, 30_000),
    hosted,
    git,
    gitEnabled: git.enabled,
    maxArchiveEntries: parsePositiveInt(process.env.COLLABMD_MAX_ARCHIVE_ENTRIES, 10_000),
    maxBaseQueryRows: parsePositiveInt(process.env.COLLABMD_MAX_BASE_QUERY_ROWS, 5_000),
    maxDownloadFileBytes: parsePositiveInt(process.env.COLLABMD_MAX_DOWNLOAD_FILE_BYTES, 268_435_456),
    maxInitialSyncBytes: parsePositiveInt(process.env.COLLABMD_MAX_INITIAL_SYNC_BYTES, 16_777_216),
    maxPdfUploadBytes: parsePositiveInt(
      overrides.maxPdfUploadBytes ?? process.env.COLLABMD_MAX_PDF_UPLOAD_BYTES,
      DEFAULT_PDF_UPLOAD_BYTES,
    ),
    searchMaxBufferBytes: parsePositiveInt(
      overrides.searchMaxBufferBytes ?? process.env.COLLABMD_SEARCH_MAX_BUFFER_BYTES,
      DEFAULT_SEARCH_MAX_BUFFER_BYTES,
    ),
    searchMaxFileSize: normalizeSearchMaxFileSize(
      overrides.searchMaxFileSize ?? process.env.COLLABMD_SEARCH_MAX_FILE_SIZE,
    ),
    structurizr,
    perfLoggingEnabled: overrides.perfLoggingEnabled ?? isPerfLoggingEnabled(process.env.COLLABMD_PERF_LOGGING),
    port: parsePositiveInt(process.env.PORT, 1234),
    nodeEnv,
    plantumlServerUrl: process.env.PLANTUML_SERVER_URL || 'https://www.plantuml.com/plantuml',
    publicDir,
    vaultDir,
    publicWsBaseUrl: process.env.PUBLIC_WS_BASE_URL || '',
    testWsRoomHydrateDelayMs: parsePositiveInt(process.env.TEST_WS_ROOM_HYDRATE_DELAY_MS, 0),
    wikiLinkAutoCreate: process.env.COLLABMD_WIKI_LINK_AUTO_CREATE !== 'false',
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
