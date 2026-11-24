import { randomUUID } from 'node:crypto';

import { normalizeEmailAddress } from '../../auth/auth-common.js';
import { createRequestError } from '../../shared/http-errors.js';

const GITHUB_SETUP_FLOW_TTL_MS = 15 * 60 * 1000;

function createFlowError(statusCode, message, code) {
  return createRequestError(statusCode, message, { code });
}

export class GitHubSetupFlow {
  constructor({
    cookieManager,
    githubAppClient,
  } = {}) {
    this.cookieManager = cookieManager;
    this.githubAppClient = githubAppClient;
  }

  ensureConfigured() {
    if (!this.cookieManager || !this.githubAppClient) {
      throw createFlowError(503, 'GitHub App setup is not configured.', 'HOSTED_GITHUB_APP_NOT_CONFIGURED');
    }
  }

  begin(req, { admin }) {
    this.ensureConfigured();
    const state = randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + GITHUB_SETUP_FLOW_TTL_MS;
    return {
      expiresAt,
      setCookie: this.cookieManager.create(req, {
        adminEmail: normalizeEmailAddress(admin?.email),
        createdAt,
        expiresAt,
        state,
      }, {
        expires: new Date(expiresAt),
      }),
      setupUrl: this.githubAppClient.createInstallationSetupUrl({ state }),
      state,
    };
  }

  readValidFlow(req, requestUrl, { admin }) {
    this.ensureConfigured();
    const flow = this.cookieManager.read(req);
    if (!flow || typeof flow !== 'object') {
      throw createFlowError(400, 'GitHub setup session expired. Start setup again.', 'HOSTED_GITHUB_SETUP_EXPIRED');
    }

    if (Number(flow.expiresAt) <= Date.now()) {
      throw createFlowError(400, 'GitHub setup session expired. Start setup again.', 'HOSTED_GITHUB_SETUP_EXPIRED');
    }

    const expectedState = String(flow.state ?? '');
    const actualState = String(requestUrl.searchParams.get('state') ?? '');
    if (!expectedState || actualState !== expectedState) {
      throw createFlowError(403, 'GitHub setup state did not match.', 'HOSTED_GITHUB_SETUP_STATE_MISMATCH');
    }

    if (normalizeEmailAddress(flow.adminEmail) !== normalizeEmailAddress(admin?.email)) {
      throw createFlowError(403, 'GitHub setup must be completed by the Team Admin who started it.', 'HOSTED_GITHUB_SETUP_ADMIN_MISMATCH');
    }

    return flow;
  }

  async complete(req, requestUrl, { admin }) {
    this.readValidFlow(req, requestUrl, { admin });
    const installationId = String(requestUrl.searchParams.get('installation_id') ?? '').trim();
    if (!installationId) {
      throw createFlowError(400, 'GitHub installation id is required.', 'HOSTED_GITHUB_INSTALLATION_REQUIRED');
    }

    return {
      clearCookie: this.cookieManager.clear(req),
      github: await this.githubAppClient.resolveVaultSourceFromInstallation(installationId),
      installationId,
    };
  }
}
