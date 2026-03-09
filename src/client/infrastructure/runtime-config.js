function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getRuntimeConfig() {
  return {
    auth: {
      enabled: false,
      implemented: true,
      requiresLogin: false,
      sessionEndpoint: '/api/auth/session',
      statusEndpoint: '/api/auth/status',
      strategy: 'none',
    },
    environment: 'development',
    publicWsBaseUrl: '',
    wsBasePath: '/ws',
    ...(window.__COLLABMD_CONFIG__ ?? {}),
  };
}

export function getFileFromHash() {
  const match = window.location.hash.match(/file=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function navigateToFile(filePath) {
  window.location.hash = filePath
    ? `file=${encodeURIComponent(filePath)}`
    : '';
}

export function resolveWsBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  const customServerUrl = params.get('server');

  if (customServerUrl) {
    return trimTrailingSlash(customServerUrl);
  }

  const config = getRuntimeConfig();
  if (config.publicWsBaseUrl) {
    return trimTrailingSlash(config.publicWsBaseUrl);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${config.wsBasePath}`;
}
