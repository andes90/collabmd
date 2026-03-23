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

export function getClientRuntimeConfig() {
  const rawConfig = {
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

  if (normalizedPath.startsWith('/api')) {
    return resolveAppPath(normalizedPath, config);
  }

  return resolveAppPath(`/api${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`, config);
}

export function resolveWsBaseUrl(config = getClientRuntimeConfig()) {
  const params = new URLSearchParams(window.location.search);
  const customServerUrl = params.get('server');

  if (customServerUrl) {
    return trimTrailingSlash(customServerUrl);
  }

  if (config.publicWsBaseUrl) {
    return trimTrailingSlash(config.publicWsBaseUrl);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${resolveAppPath(config.wsBasePath, config)}`;
}
