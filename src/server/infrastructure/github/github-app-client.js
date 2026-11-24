import { sign } from 'node:crypto';

import { createRequestError } from '../../shared/http-errors.js';

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function normalizeBaseUrl(value) {
  return String(value ?? 'https://api.github.com').trim().replace(/\/+$/u, '') || 'https://api.github.com';
}

function createGitHubAppJwt({ appId, privateKey }, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = base64UrlJson({
    alg: 'RS256',
    typ: 'JWT',
  });
  const payload = base64UrlJson({
    exp: nowSeconds + 540,
    iat: nowSeconds - 60,
    iss: String(appId),
  });
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
}

function parseRepositoryOwner(repository = {}) {
  const ownerLogin = String(repository.owner?.login ?? '').trim();
  if (ownerLogin) {
    return ownerLogin;
  }

  return String(repository.full_name ?? '').split('/')[0] || '';
}

function normalizeRepository(repository = {}) {
  const fullName = String(repository.full_name ?? '').trim();
  const owner = parseRepositoryOwner(repository);
  const name = String(repository.name ?? '').trim();
  const visibility = String(repository.visibility ?? (repository.private ? 'private' : 'public')).trim() || 'private';

  return {
    defaultBranch: String(repository.default_branch ?? '').trim(),
    fullName,
    id: String(repository.id ?? '').trim(),
    name,
    owner,
    visibility,
  };
}

export class GitHubAppClient {
  constructor({
    apiBaseUrl = 'https://api.github.com',
    appId,
    appSlug = '',
    fetchImpl = globalThis.fetch,
    htmlBaseUrl = 'https://github.com',
    privateKey,
  } = {}) {
    this.apiBaseUrl = normalizeBaseUrl(apiBaseUrl);
    this.appId = String(appId ?? '').trim();
    this.appSlug = String(appSlug ?? '').trim();
    this.fetchImpl = fetchImpl;
    this.htmlBaseUrl = normalizeBaseUrl(htmlBaseUrl);
    this.privateKey = String(privateKey ?? '').replace(/\\n/g, '\n').trim();
  }

  isConfigured() {
    return Boolean(this.appId && this.privateKey && this.fetchImpl);
  }

  createAppJwt() {
    if (!this.isConfigured()) {
      throw createRequestError(503, 'GitHub App setup is not configured.', {
        code: 'HOSTED_GITHUB_APP_NOT_CONFIGURED',
      });
    }

    return createGitHubAppJwt({
      appId: this.appId,
      privateKey: this.privateKey,
    });
  }

  createInstallationSetupUrl({ state } = {}) {
    if (!this.appSlug) {
      throw createRequestError(503, 'GitHub App slug is not configured.', {
        code: 'HOSTED_GITHUB_APP_NOT_CONFIGURED',
      });
    }

    const setupUrl = new URL(`/apps/${encodeURIComponent(this.appSlug)}/installations/new`, this.htmlBaseUrl);
    if (state) {
      setupUrl.searchParams.set('state', state);
    }
    return setupUrl.href;
  }

  async request(path, {
    authToken,
    body = null,
    method = 'GET',
  } = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'collabmd',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      method,
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      throw createRequestError(
        response.status,
        payload?.message || 'GitHub API request failed.',
        { code: 'HOSTED_GITHUB_API_FAILED' },
      );
    }

    return payload ?? {};
  }

  async createInstallationAccessToken(installationId, { appJwt = null } = {}) {
    const normalizedInstallationId = String(installationId ?? '').trim();
    if (!normalizedInstallationId) {
      throw createRequestError(400, 'GitHub installation id is required.', {
        code: 'HOSTED_GITHUB_INSTALLATION_REQUIRED',
      });
    }

    const payload = await this.request(`/app/installations/${encodeURIComponent(normalizedInstallationId)}/access_tokens`, {
      authToken: appJwt || this.createAppJwt(),
      method: 'POST',
    });
    const token = String(payload?.token ?? '').trim();
    if (!token) {
      throw createRequestError(502, 'GitHub did not return an installation access token.', {
        code: 'HOSTED_GITHUB_TOKEN_MISSING',
      });
    }
    return token;
  }

  async getInstallation(installationId, { appJwt = null } = {}) {
    const normalizedInstallationId = String(installationId ?? '').trim();
    if (!normalizedInstallationId) {
      throw createRequestError(400, 'GitHub installation id is required.', {
        code: 'HOSTED_GITHUB_INSTALLATION_REQUIRED',
      });
    }

    return this.request(`/app/installations/${encodeURIComponent(normalizedInstallationId)}`, {
      authToken: appJwt || this.createAppJwt(),
    });
  }

  async listInstallationRepositories(installationToken) {
    const payload = await this.request('/installation/repositories', {
      authToken: installationToken,
    });
    return Array.isArray(payload?.repositories) ? payload.repositories : [];
  }

  async resolveVaultSourceFromInstallation(installationId) {
    const normalizedInstallationId = String(installationId ?? '').trim();
    if (!normalizedInstallationId) {
      throw createRequestError(400, 'GitHub installation id is required.', {
        code: 'HOSTED_GITHUB_INSTALLATION_REQUIRED',
      });
    }

    const appJwt = this.createAppJwt();
    const [installation, installationToken] = await Promise.all([
      this.getInstallation(normalizedInstallationId, { appJwt }),
      this.createInstallationAccessToken(normalizedInstallationId, { appJwt }),
    ]);
    const repositories = await this.listInstallationRepositories(installationToken);
    if (repositories.length !== 1) {
      throw createRequestError(
        409,
        'GitHub App installation must grant access to exactly one selected repository.',
        { code: 'HOSTED_GITHUB_REPOSITORY_SELECTION_REQUIRED' },
      );
    }

    const repository = normalizeRepository(repositories[0]);
    return {
      installation: {
        accountLogin: String(installation?.account?.login ?? repository.owner).trim(),
        id: normalizedInstallationId,
      },
      repository,
    };
  }
}
