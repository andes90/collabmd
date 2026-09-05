import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { HostedWorkspaceService } from '../../src/server/domain/hosted-workspace.js';
import { createSignedCookieManager } from '../../src/server/auth/session-cookie.js';
import { createHostedApiHandler } from '../../src/server/infrastructure/http/create-hosted-api-handler.js';
import { GitHubSetupFlow } from '../../src/server/infrastructure/github/github-setup-flow.js';
import { HostedMetadataStore } from '../../src/server/infrastructure/persistence/hosted-metadata-store.js';

function googleUser(email, name = null) {
  return {
    email,
    emailVerified: true,
    name: name || email.split('@')[0],
    picture: '',
    sub: `sub-${email}`,
  };
}

function createAuthService(getUser) {
  return {
    authorizeApiRequest() {
      return { ok: true };
    },
    getAuthenticatedUser() {
      return getUser();
    },
  };
}

function createRequest({ body = null, headers = {}, method = 'GET' } = {}) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]);
  req.headers = headers;
  req.method = method;
  return req;
}

function createResponse() {
  const res = new EventEmitter();
  res.headers = {};
  res.statusCode = 0;
  res.body = '';
  res.destroyed = false;
  res.writableEnded = false;
  res.setHeader = (key, value) => {
    res.headers[key.toLowerCase()] = value;
  };
  res.getHeader = (key) => res.headers[String(key).toLowerCase()];
  res.writeHead = (statusCode, headers = {}) => {
    res.statusCode = statusCode;
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  };
  res.end = (chunk = '') => {
    res.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
    res.writableEnded = true;
    res.emit('finish');
  };
  return res;
}

async function invoke(handler, {
  body = null,
  headers = {},
  method = 'GET',
  path,
}) {
  const req = createRequest({ body, headers, method });
  const res = createResponse();
  await handler(req, res, new URL(path, 'http://localhost'));
  return {
    body: res.body ? JSON.parse(res.body) : null,
    headers: res.headers,
    statusCode: res.statusCode,
  };
}

async function createHostedApi(t) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-hosted-api-test-'));
  t.after(() => rm(tempRoot, { force: true, recursive: true }));
  let currentUser = googleUser('admin@example.com', 'Admin User');
  const hostedWorkspaceService = new HostedWorkspaceService({
    claim: {
      email: 'admin@example.com',
      token: 'claim-secret',
    },
    enabled: true,
    store: new HostedMetadataStore({
      dbPath: join(tempRoot, 'hosted.sqlite'),
    }),
  });
  await hostedWorkspaceService.initialize();
  t.after(() => hostedWorkspaceService.close());

  const githubAppClient = {
    createInstallationSetupUrl({ state }) {
      const url = new URL('https://github.example/apps/collabmd-test/installations/new');
      url.searchParams.set('state', state);
      return url.href;
    },
    async resolveVaultSourceFromInstallation(installationId) {
      assert.equal(installationId, '98765');
      return {
        installation: {
          accountLogin: 'example-org',
          id: '98765',
        },
        repository: {
          defaultBranch: 'main',
          fullName: 'example-org/docs',
          id: '12345',
          name: 'docs',
          owner: 'example-org',
          visibility: 'private',
        },
      };
    },
  };

  return {
    handler: createHostedApiHandler({
      authService: createAuthService(() => currentUser),
      githubSetupFlow: new GitHubSetupFlow({
        cookieManager: createSignedCookieManager({
          cookieName: 'collabmd_github_setup_flow',
          secret: 'test-secret',
        }),
        githubAppClient,
      }),
      hostedWorkspaceService,
    }),
    hostedWorkspaceService,
    setUser(user) {
      currentUser = user;
    },
  };
}

test('hosted API supports claim, invitation, acceptance, membership, and audit flow', async (t) => {
  const api = await createHostedApi(t);

  let response = await invoke(api.handler, {
    body: {
      teamName: 'Docs Team',
      token: 'claim-secret',
    },
    method: 'POST',
    path: '/api/hosted/claim',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.team.name, 'Docs Team');
  assert.equal(response.body.membership.role, 'admin');

  response = await invoke(api.handler, {
    method: 'POST',
    path: '/api/hosted/vault-source/github/setup',
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body.setupUrl, /^https:\/\/github\.example\/apps\/collabmd-test\/installations\/new/u);
  const setupState = new URL(response.body.setupUrl).searchParams.get('state');
  const setupCookie = String(response.headers['set-cookie']).split(';')[0];

  response = await invoke(api.handler, {
    headers: {
      cookie: setupCookie,
    },
    method: 'GET',
    path: `/api/hosted/vault-source/github/callback?installation_id=98765&state=${encodeURIComponent(setupState)}`,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.setupComplete, true);
  assert.equal(response.body.vaultSource.repositoryFullName, 'example-org/docs');

  response = await invoke(api.handler, {
    method: 'GET',
    path: '/api/hosted/vault-source',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.vaultSource.defaultBranch, 'main');

  response = await invoke(api.handler, {
    body: {
      email: 'writer@example.com',
      role: 'collaborator',
    },
    method: 'POST',
    path: '/api/hosted/invitations',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.invitation.email, 'writer@example.com');
  const invitationId = response.body.invitation.id;

  response = await invoke(api.handler, {
    body: {
      role: 'admin',
    },
    method: 'PATCH',
    path: `/api/hosted/invitations/${encodeURIComponent(invitationId)}`,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.invitation.role, 'admin');

  api.setUser(googleUser('writer@example.com', 'Writer User'));
  response = await invoke(api.handler, {
    method: 'POST',
    path: '/api/hosted/invitations/accept',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.membership.email, 'writer@example.com');
  assert.equal(response.body.membership.role, 'admin');

  response = await invoke(api.handler, {
    method: 'GET',
    path: '/api/hosted/memberships',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.memberships.length, 2);

  response = await invoke(api.handler, {
    method: 'GET',
    path: '/api/hosted/audit',
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.events.some((event) => event.type === 'workspace_claimed'));
  assert.ok(response.body.events.some((event) => event.type === 'vault_source_configured'));
  assert.ok(response.body.events.some((event) => event.type === 'invitation_accepted'));
});

test('hosted API completes setup without a vault source for admins only', async (t) => {
  const api = await createHostedApi(t);

  let response = await invoke(api.handler, {
    body: {
      teamName: 'Docs Team',
      token: 'claim-secret',
    },
    method: 'POST',
    path: '/api/hosted/claim',
  });
  assert.equal(response.statusCode, 200);

  response = await invoke(api.handler, {
    body: {
      email: 'writer@example.com',
      role: 'collaborator',
    },
    method: 'POST',
    path: '/api/hosted/invitations',
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'HOSTED_SETUP_INCOMPLETE');

  response = await invoke(api.handler, {
    method: 'POST',
    path: '/api/hosted/setup/complete',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.setupComplete, true);

  response = await invoke(api.handler, {
    method: 'GET',
    path: '/api/hosted/audit',
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.events.some((event) => event.type === 'workspace_setup_completed'));

  api.setUser(googleUser('writer@example.com', 'Writer User'));
  response = await invoke(api.handler, {
    method: 'POST',
    path: '/api/hosted/setup/complete',
  });
  assert.equal(response.statusCode, 403);

  api.setUser(googleUser('admin@example.com', 'Admin User'));
  response = await invoke(api.handler, {
    body: {
      email: 'writer@example.com',
      role: 'collaborator',
    },
    method: 'POST',
    path: '/api/hosted/invitations',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.invitation.email, 'writer@example.com');
});
