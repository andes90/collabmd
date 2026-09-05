function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeBasePath(value) {
  const normalized = trimTrailingSlash(String(value ?? '').trim());
  if (!normalized || normalized === '/') {
    return '';
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(normalized)) {
    try {
      return normalizeBasePath(new URL(normalized).pathname);
    } catch {
      return '';
    }
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function normalizeRoutePath(value, fallbackPath) {
  const normalized = trimTrailingSlash(String(value ?? '').trim());
  if (!normalized || normalized === '/') {
    return fallbackPath;
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function applyBasePath(basePath, pathValue) {
  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedPath = String(pathValue ?? '').trim();

  if (!normalizedPath) {
    return normalizedBasePath || '/';
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(normalizedPath)) {
    return normalizedPath;
  }

  if (
    normalizedBasePath
    && (normalizedPath === normalizedBasePath || normalizedPath.startsWith(`${normalizedBasePath}/`))
  ) {
    return normalizedPath;
  }

  if (normalizedPath === '/') {
    return normalizedBasePath || '/';
  }

  if (normalizedPath.startsWith('/')) {
    return normalizedBasePath ? `${normalizedBasePath}${normalizedPath}` : normalizedPath;
  }

  return normalizedBasePath ? `${normalizedBasePath}/${normalizedPath}` : `/${normalizedPath}`;
}

export const ACTIVE_VAULT_STORAGE_KEY = 'collabmd.activeVault';

// ponytail: agent/hosted/auth/plantuml/structurizr/test stay global; everything else is vault-scoped
const VAULT_UNSCOPED_API_PATHS = ['/auth/', '/hosted/', '/agent/', '/test/', '/plantuml/', '/structurizr/'];

function isVaultScopedApiPath(pathname) {
  if (pathname === '/api' || pathname === '/api/' || pathname === '/api/vaults') {
    return false;
  }
  const sub = pathname.startsWith('/api/') ? pathname.slice('/api'.length) : pathname;
  return !VAULT_UNSCOPED_API_PATHS.some((prefix) => sub === prefix.slice(0, -1) || sub.startsWith(prefix));
}

export function getActiveVaultId(config = getClientRuntimeConfig()) {
  const vaults = Array.isArray(config?.vaults) ? config.vaults.map((vault) => vault?.id).filter(Boolean) : [];
  if (vaults.length === 0) {
    return null;
  }
  try {
    const stored = globalThis.window?.localStorage?.getItem(ACTIVE_VAULT_STORAGE_KEY);
    if (stored && vaults.includes(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage failures and fall back to the server default.
  }
  if (config?.activeVault && vaults.includes(config.activeVault)) {
    return config.activeVault;
  }
  return vaults[0] ?? null;
}

export function setActiveVaultId(vaultId) {
  try {
    globalThis.window?.localStorage?.setItem(ACTIVE_VAULT_STORAGE_KEY, String(vaultId ?? ''));
  } catch {
    // Ignore storage failures; the server default still applies.
  }
}
export function getClientRuntimeConfig() {
  const rawConfig = {
    activeVault: '',
    agentAccess: {
      enabled: false,
      endpoint: '',
      managed: false,
    },
    auth: {
      enabled: false,
      implemented: true,
      loginEndpoint: '/api/auth/oidc/login',
      provider: '',
      requiresLogin: false,
      sessionEndpoint: '/api/auth/session',
      statusEndpoint: '/api/auth/status',
      strategy: 'none',
    },
    basePath: '',
    build: {
      id: '',
      packageVersion: '',
    },
    drawioBaseUrl: 'https://embed.diagrams.net',
    environment: 'development',
    gitEnabled: true,
    publicWsBaseUrl: '',
    search: {
      available: false,
      backend: 'ripgrep',
      minQueryLength: 2,
      unavailableReason: 'ripgrep search is unavailable',
      version: '',
    },
    structurizrEnabled: false,
    vaults: [],
    wikiLinkAutoCreate: true,
    wsBasePath: '/ws',
    ...(window.__COLLABMD_CONFIG__ ?? {}),
  };
  const basePath = normalizeBasePath(rawConfig.basePath);
  const authConfig = {
    enabled: false,
    implemented: true,
    loginEndpoint: '/api/auth/oidc/login',
    provider: '',
    requiresLogin: false,
    sessionEndpoint: '/api/auth/session',
    statusEndpoint: '/api/auth/status',
    strategy: 'none',
    ...(rawConfig.auth ?? {}),
  };
  const buildConfig = {
    id: '',
    packageVersion: '',
    ...(rawConfig.build ?? {}),
  };

  return {
    ...rawConfig,
    auth: {
      ...authConfig,
      loginEndpoint: applyBasePath(basePath, authConfig.loginEndpoint),
      sessionEndpoint: applyBasePath(basePath, authConfig.sessionEndpoint),
      statusEndpoint: applyBasePath(basePath, authConfig.statusEndpoint),
    },
    basePath,
    build: buildConfig,
    wsBasePath: normalizeRoutePath(rawConfig.wsBasePath, '/ws'),
  };
}

export function resolveAppPath(pathValue = '/', config = getClientRuntimeConfig()) {
  return applyBasePath(config.basePath, pathValue);
}

export function resolveAppUrl(pathValue = '/', config = getClientRuntimeConfig()) {
  return new URL(resolveAppPath(pathValue, config), window.location.origin).toString();
}

export function resolveApiUrl(pathValue = '/', config = getClientRuntimeConfig()) {
  const normalizedPath = String(pathValue ?? '').trim();
  if (!normalizedPath || normalizedPath === '/') {
    return resolveAppPath('/api', config);
  }

  const apiPath = normalizedPath.startsWith('/api')
    ? normalizedPath
    : `/api${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
  const queryIndex = apiPath.indexOf('?');
  const pathname = queryIndex === -1 ? apiPath : apiPath.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : apiPath.slice(queryIndex);
  const vaultId = getActiveVaultId(config);
  if (vaultId && isVaultScopedApiPath(pathname)) {
    return resolveAppPath(`/api/v/${vaultId}${pathname.slice('/api'.length)}${query}`, config);
  }
  return resolveAppPath(`${pathname}${query}`, config);
}

export function resolveWsServerOverride(config = getClientRuntimeConfig()) {
  if (!['development', 'test'].includes(config.environment)) {
    return '';
  }

  const customServerUrl = new URLSearchParams(window.location.search).get('server');
  if (!customServerUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(customServerUrl, window.location.origin);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsedUrl.protocol)) {
      return '';
    }

    return trimTrailingSlash(parsedUrl.toString());
  } catch {
    return '';
  }
}

export function resolveWsBaseUrl(config = getClientRuntimeConfig()) {
  const vaultId = getActiveVaultId(config);
  const vaultSuffix = vaultId ? `/v/${vaultId}` : '';
  const serverOverride = resolveWsServerOverride(config);
  if (serverOverride) {
    return `${serverOverride}${vaultSuffix}`;
  }

  if (config.publicWsBaseUrl) {
    return `${trimTrailingSlash(config.publicWsBaseUrl)}${vaultSuffix}`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${resolveAppPath(`${config.wsBasePath}${vaultSuffix}`, config)}`;
}
