import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';

import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  createAuthService,
} from '../../src/server/auth/create-auth-service.js';
import { loadConfig } from '../../src/server/config/env.js';

function withAuthEnvCleared(fn) {
  const previousStrategy = process.env.AUTH_STRATEGY;
  const previousPassword = process.env.AUTH_PASSWORD;
  const previousSessionMaxAge = process.env.AUTH_SESSION_MAX_AGE_MS;
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const previousOidcClientId = process.env.AUTH_OIDC_CLIENT_ID;
  const previousOidcClientSecret = process.env.AUTH_OIDC_CLIENT_SECRET;
  const previousOidcIssuerUrl = process.env.AUTH_OIDC_ISSUER_URL;
  const previousOidcAllowedEmails = process.env.AUTH_OIDC_ALLOWED_EMAILS;
  const previousOidcAllowedDomains = process.env.AUTH_OIDC_ALLOWED_DOMAINS;
  const previousGitRepoUrl = process.env.COLLABMD_GIT_REPO_URL;
  const previousGitPrivateKeyFile = process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE;
  const previousGitPrivateKeyBase64 = process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64;
  const previousGitKnownHostsFile = process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE;
  const previousGitUserName = process.env.COLLABMD_GIT_USER_NAME;
  const previousGitUserEmail = process.env.COLLABMD_GIT_USER_EMAIL;
  const previousAuthorName = process.env.GIT_AUTHOR_NAME;
  const previousAuthorEmail = process.env.GIT_AUTHOR_EMAIL;
  const previousCommitterName = process.env.GIT_COMMITTER_NAME;
  const previousCommitterEmail = process.env.GIT_COMMITTER_EMAIL;

  delete process.env.AUTH_STRATEGY;
  delete process.env.AUTH_PASSWORD;
  delete process.env.AUTH_SESSION_MAX_AGE_MS;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.AUTH_OIDC_CLIENT_ID;
  delete process.env.AUTH_OIDC_CLIENT_SECRET;
  delete process.env.AUTH_OIDC_ISSUER_URL;
  delete process.env.AUTH_OIDC_ALLOWED_EMAILS;
  delete process.env.AUTH_OIDC_ALLOWED_DOMAINS;
  delete process.env.COLLABMD_GIT_REPO_URL;
  delete process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE;
  delete process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64;
  delete process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE;
  delete process.env.COLLABMD_GIT_USER_NAME;
  delete process.env.COLLABMD_GIT_USER_EMAIL;
  delete process.env.GIT_AUTHOR_NAME;
  delete process.env.GIT_AUTHOR_EMAIL;
  delete process.env.GIT_COMMITTER_NAME;
  delete process.env.GIT_COMMITTER_EMAIL;

  try {
    return fn();
  } finally {
    if (previousStrategy === undefined) {
      delete process.env.AUTH_STRATEGY;
    } else {
      process.env.AUTH_STRATEGY = previousStrategy;
    }

    if (previousPassword === undefined) {
      delete process.env.AUTH_PASSWORD;
    } else {
      process.env.AUTH_PASSWORD = previousPassword;
    }

    if (previousSessionMaxAge === undefined) {
      delete process.env.AUTH_SESSION_MAX_AGE_MS;
    } else {
      process.env.AUTH_SESSION_MAX_AGE_MS = previousSessionMaxAge;
    }

    if (previousPublicBaseUrl === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    }

    if (previousOidcClientId === undefined) {
      delete process.env.AUTH_OIDC_CLIENT_ID;
    } else {
      process.env.AUTH_OIDC_CLIENT_ID = previousOidcClientId;
    }

    if (previousOidcClientSecret === undefined) {
      delete process.env.AUTH_OIDC_CLIENT_SECRET;
    } else {
      process.env.AUTH_OIDC_CLIENT_SECRET = previousOidcClientSecret;
    }

    if (previousOidcIssuerUrl === undefined) {
      delete process.env.AUTH_OIDC_ISSUER_URL;
    } else {
      process.env.AUTH_OIDC_ISSUER_URL = previousOidcIssuerUrl;
    }

    if (previousOidcAllowedEmails === undefined) {
      delete process.env.AUTH_OIDC_ALLOWED_EMAILS;
    } else {
      process.env.AUTH_OIDC_ALLOWED_EMAILS = previousOidcAllowedEmails;
    }

    if (previousOidcAllowedDomains === undefined) {
      delete process.env.AUTH_OIDC_ALLOWED_DOMAINS;
    } else {
      process.env.AUTH_OIDC_ALLOWED_DOMAINS = previousOidcAllowedDomains;
    }

    if (previousGitRepoUrl === undefined) {
      delete process.env.COLLABMD_GIT_REPO_URL;
    } else {
      process.env.COLLABMD_GIT_REPO_URL = previousGitRepoUrl;
    }

    if (previousGitPrivateKeyFile === undefined) {
      delete process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE;
    } else {
      process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE = previousGitPrivateKeyFile;
    }

    if (previousGitPrivateKeyBase64 === undefined) {
      delete process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64;
    } else {
      process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64 = previousGitPrivateKeyBase64;
    }

    if (previousGitKnownHostsFile === undefined) {
      delete process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE;
    } else {
      process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE = previousGitKnownHostsFile;
    }

    if (previousGitUserName === undefined) {
      delete process.env.COLLABMD_GIT_USER_NAME;
    } else {
      process.env.COLLABMD_GIT_USER_NAME = previousGitUserName;
    }

    if (previousGitUserEmail === undefined) {
      delete process.env.COLLABMD_GIT_USER_EMAIL;
    } else {
      process.env.COLLABMD_GIT_USER_EMAIL = previousGitUserEmail;
    }

    if (previousAuthorName === undefined) {
      delete process.env.GIT_AUTHOR_NAME;
    } else {
      process.env.GIT_AUTHOR_NAME = previousAuthorName;
    }

    if (previousAuthorEmail === undefined) {
      delete process.env.GIT_AUTHOR_EMAIL;
    } else {
      process.env.GIT_AUTHOR_EMAIL = previousAuthorEmail;
    }

    if (previousCommitterName === undefined) {
      delete process.env.GIT_COMMITTER_NAME;
    } else {
      process.env.GIT_COMMITTER_NAME = previousCommitterName;
    }

    if (previousCommitterEmail === undefined) {
      delete process.env.GIT_COMMITTER_EMAIL;
    } else {
      process.env.GIT_COMMITTER_EMAIL = previousCommitterEmail;
    }
  }
}

function extractCookieHeader(setCookieHeader) {
  const rawValue = Array.isArray(setCookieHeader)
    ? setCookieHeader[0]
    : setCookieHeader;
  return String(rawValue || '').split(';')[0];
}

function decodeFlowCookiePayload(setCookieHeader) {
  return decodeSignedCookiePayload(setCookieHeader);
}

function decodeSignedCookiePayload(setCookieHeader) {
  const token = extractCookieHeader(setCookieHeader).split('=')[1] || '';
  const encodedPayload = token.split('.')[0] || '';
  const normalized = encodedPayload
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function createSignedIdToken({
  email = 'user@example.com',
  exp = Math.floor(Date.now() / 1000) + 3600,
  issuer,
  name = 'Google User',
  nonce,
  subject = 'google-sub',
}, privateKey) {
  const header = Buffer.from(JSON.stringify({
    alg: 'RS256',
    kid: 'test-key',
    typ: 'JWT',
  })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: 'test-client-id',
    email,
    email_verified: true,
    exp,
    iat: Math.floor(Date.now() / 1000),
    iss: issuer,
    name,
    nonce,
    picture: 'https://example.com/avatar.png',
    sub: subject,
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function startFakeOidcIssuer() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const publicJwk = publicKey.export({ format: 'jwk' });
  let nextNonce = '';
  let nextClaims = {};
  let lastAuthorizationUrl = null;
  let lastTokenRequestBody = '';

  const server = createServer(async (req, res) => {
    const origin = `http://${req.headers.host}`;

    if (req.url === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        authorization_endpoint: `${origin}/authorize`,
        id_token_signing_alg_values_supported: ['RS256'],
        issuer: origin,
        jwks_uri: `${origin}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        token_endpoint: `${origin}/token`,
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      }));
      return;
    }

    if (req.url === '/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        keys: [{
          ...publicJwk,
          alg: 'RS256',
          kid: 'test-key',
          use: 'sig',
        }],
      }));
      return;
    }

    if (req.url === '/token' && req.method === 'POST') {
      lastTokenRequestBody = await readRequestBody(req);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        access_token: 'access-token',
        expires_in: 3600,
        id_token: createSignedIdToken({
          ...nextClaims,
          issuer: origin,
          nonce: nextNonce,
        }, privateKey),
        token_type: 'Bearer',
      }));
      return;
    }

    if (req.url?.startsWith('/authorize')) {
      lastAuthorizationUrl = new URL(req.url, origin);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const issuer = `http://127.0.0.1:${port}`;

  return {
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
    getLastAuthorizationUrl: () => lastAuthorizationUrl,
    getLastTokenRequestBody: () => lastTokenRequestBody,
    issuer,
    setNextClaims: (value) => {
      nextClaims = { ...(value ?? {}) };
    },
    setNextNonce: (value) => {
      nextNonce = value;
    },
  };
}

test('loadConfig defaults auth to none', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.auth.strategy, AUTH_STRATEGY_NONE);
  assert.equal(config.auth.password, '');
}));

test('password auth generates a password when one is not provided', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    auth: {
      strategy: AUTH_STRATEGY_PASSWORD,
    },
    vaultDir: process.cwd(),
  });

  assert.equal(config.auth.strategy, AUTH_STRATEGY_PASSWORD);
  assert.equal(typeof config.auth.password, 'string');
  assert.equal(config.auth.password.length > 0, true);
  assert.equal(config.auth.passwordWasGenerated, true);
}));

test('loadConfig requires OIDC base URL and credentials', () => withAuthEnvCleared(() => {
  assert.throws(() => {
    loadConfig({
      auth: {
        strategy: AUTH_STRATEGY_OIDC,
      },
      vaultDir: process.cwd(),
    });
  }, /PUBLIC_BASE_URL/);

  assert.throws(() => {
    loadConfig({
      auth: {
        oidc: {
          publicBaseUrl: 'https://notes.example.com',
        },
        strategy: AUTH_STRATEGY_OIDC,
      },
      vaultDir: process.cwd(),
    });
  }, /AUTH_OIDC_CLIENT_ID/);
}));

test('oidc auth exposes google runtime config when configured', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    auth: {
      oidc: {
        allowedDomains: ['company.com'],
        allowedEmails: ['ceo@outside.com'],
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        publicBaseUrl: 'https://notes.example.com',
      },
      strategy: AUTH_STRATEGY_OIDC,
    },
    basePath: '/collabmd',
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  assert.equal(authService.getClientConfig().strategy, AUTH_STRATEGY_OIDC);
  assert.equal(authService.getClientConfig().implemented, true);
  assert.equal(authService.getClientConfig().provider, 'google');
  assert.equal(authService.getClientConfig().loginEndpoint, '/api/auth/oidc/login');
  assert.deepEqual(config.auth.oidc.allowedDomains, ['company.com']);
  assert.deepEqual(config.auth.oidc.allowedEmails, ['ceo@outside.com']);
  assert.equal(config.auth.oidc.callbackUrl, 'https://notes.example.com/api/auth/oidc/callback');
}));

test('loadConfig parses an optional auth session max age', () => withAuthEnvCleared(() => {
  process.env.AUTH_SESSION_MAX_AGE_MS = '2592000000';

  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.auth.sessionMaxAgeMs, 2592000000);
}));

test('loadConfig rejects malformed auth session max age values', () => withAuthEnvCleared(() => {
  for (const invalidValue of ['30d', '1e3', '2592000000ms']) {
    process.env.AUTH_SESSION_MAX_AGE_MS = invalidValue;
    assert.throws(
      () => loadConfig({ vaultDir: process.cwd() }),
      /AUTH_SESSION_MAX_AGE_MS must be a positive integer\./,
    );
  }
}));

test('password auth returns transport-agnostic session results and API authorization decisions', () => {
  const config = loadConfig({
    auth: {
      password: 'shared-secret',
      strategy: AUTH_STRATEGY_PASSWORD,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);
  const request = {
    headers: {},
  };

  const missingPassword = authService.createSession(request, {});
  assert.equal(missingPassword.statusCode, 400);
  assert.equal(missingPassword.body.error, 'Missing password');
  assert.equal(missingPassword.setCookie, null);

  const unauthorized = authService.authorizeApiRequest(request);
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.code, 'AUTH_REQUIRED');

  const sessionResult = authService.createSession(request, {
    password: 'shared-secret',
  });
  assert.equal(sessionResult.statusCode, 200);
  assert.equal(sessionResult.body.ok, true);
  assert.equal(typeof sessionResult.setCookie, 'string');

  const authorizedRequest = {
    headers: {
      cookie: sessionResult.setCookie,
    },
  };
  assert.deepEqual(authService.authorizeApiRequest(authorizedRequest), { ok: true });
});

test('oidc auth completes login, returns user status, and authorizes API requests', async (t) => {
  const issuer = await startFakeOidcIssuer();
  t.after(() => issuer.close());

  const config = loadConfig({
    auth: {
      oidc: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        issuer: issuer.issuer,
        publicBaseUrl: 'http://127.0.0.1:3000',
      },
      strategy: AUTH_STRATEGY_OIDC,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  const loginRequestUrl = new URL('http://127.0.0.1:3000/api/auth/oidc/login?returnTo=%2F%23file%3Dtest.md');
  const loginResult = await authService.beginOidcLogin({ headers: {} }, loginRequestUrl);
  assert.equal(loginResult.statusCode, 302);
  assert.match(loginResult.redirectTo, new RegExp(`^${issuer.issuer}/authorize\\?`));
  assert.equal(typeof loginResult.setCookie, 'string');

  const flowPayload = decodeFlowCookiePayload(loginResult.setCookie);
  assert.equal(flowPayload.returnTo, '/#file=test.md');
  assert.equal(typeof flowPayload.state, 'string');
  assert.equal(typeof flowPayload.pkceCodeVerifier, 'string');
  assert.equal(new URL(loginResult.redirectTo).searchParams.get('hd'), null);
  issuer.setNextNonce(flowPayload.nonce);

  const callbackResult = await authService.completeOidcLogin({
    headers: {
      cookie: extractCookieHeader(loginResult.setCookie),
    },
  }, new URL(`http://127.0.0.1:3000/api/auth/oidc/callback?code=test-code&state=${encodeURIComponent(flowPayload.state)}`));

  assert.equal(callbackResult.statusCode, 302);
  assert.equal(callbackResult.redirectTo, '/#file=test.md');
  assert.equal(Array.isArray(callbackResult.setCookie), true);
  assert.match(issuer.getLastTokenRequestBody(), /grant_type=authorization_code/);
  assert.match(issuer.getLastTokenRequestBody(), /code_verifier=/);

  const sessionCookie = extractCookieHeader(callbackResult.setCookie[0]);
  const sessionPayload = decodeSignedCookiePayload(callbackResult.setCookie[0]);
  const authenticatedRequest = {
    headers: {
      cookie: sessionCookie,
    },
  };
  const statusResult = authService.getStatus(authenticatedRequest);
  assert.equal(statusResult.body.authenticated, true);
  assert.equal(statusResult.body.user.email, 'user@example.com');
  assert.equal(statusResult.body.user.name, 'Google User');
  assert.equal(Number.isFinite(sessionPayload.expiresAt), true);
  assert.match(callbackResult.setCookie[0], /Expires=/);
  assert.equal(authService.getAuthenticatedUser(authenticatedRequest).sub, 'google-sub');
  assert.deepEqual(authService.authorizeApiRequest(authenticatedRequest), { ok: true });
});

test('oidc auth honors a configured longer session max age', async (t) => {
  const issuer = await startFakeOidcIssuer();
  t.after(() => issuer.close());

  const configuredSessionMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
  const config = loadConfig({
    auth: {
      oidc: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        issuer: issuer.issuer,
        publicBaseUrl: 'http://127.0.0.1:3000',
      },
      sessionMaxAgeMs: configuredSessionMaxAgeMs,
      strategy: AUTH_STRATEGY_OIDC,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  const loginResult = await authService.beginOidcLogin(
    { headers: {} },
    new URL('http://127.0.0.1:3000/api/auth/oidc/login?returnTo=%2F'),
  );
  const flowPayload = decodeFlowCookiePayload(loginResult.setCookie);
  issuer.setNextNonce(flowPayload.nonce);
  issuer.setNextClaims({
    exp: Math.floor((Date.now() + 60_000) / 1000),
  });

  const callbackCompletedAt = Date.now();
  const callbackResult = await authService.completeOidcLogin({
    headers: {
      cookie: extractCookieHeader(loginResult.setCookie),
    },
  }, new URL(`http://127.0.0.1:3000/api/auth/oidc/callback?code=test-code&state=${encodeURIComponent(flowPayload.state)}`));

  assert.equal(callbackResult.statusCode, 302);
  const sessionPayload = decodeSignedCookiePayload(callbackResult.setCookie[0]);
  assert.match(callbackResult.setCookie[0], /Expires=/);
  assert.equal(sessionPayload.expiresAt >= callbackCompletedAt + configuredSessionMaxAgeMs - 5_000, true);
});

test('oidc auth adds the Google hosted-domain hint when exactly one allowed domain is configured', async (t) => {
  const issuer = await startFakeOidcIssuer();
  t.after(() => issuer.close());

  const config = loadConfig({
    auth: {
      oidc: {
        allowedDomains: ['company.com'],
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        issuer: issuer.issuer,
        publicBaseUrl: 'http://127.0.0.1:3000',
      },
      strategy: AUTH_STRATEGY_OIDC,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  const loginResult = await authService.beginOidcLogin(
    { headers: {} },
    new URL('http://127.0.0.1:3000/api/auth/oidc/login?returnTo=%2F'),
  );
  assert.equal(new URL(loginResult.redirectTo).searchParams.get('hd'), 'company.com');
});

test('oidc auth rejects users outside the allowed email and domain lists', async (t) => {
  const issuer = await startFakeOidcIssuer();
  t.after(() => issuer.close());

  const config = loadConfig({
    auth: {
      oidc: {
        allowedDomains: ['company.com'],
        allowedEmails: ['vip@outside.com'],
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        issuer: issuer.issuer,
        publicBaseUrl: 'http://127.0.0.1:3000',
      },
      strategy: AUTH_STRATEGY_OIDC,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  const loginResult = await authService.beginOidcLogin(
    { headers: {} },
    new URL('http://127.0.0.1:3000/api/auth/oidc/login?returnTo=%2F'),
  );
  const flowPayload = decodeFlowCookiePayload(loginResult.setCookie);
  issuer.setNextNonce(flowPayload.nonce);
  issuer.setNextClaims({
    email: 'person@gmail.com',
    name: 'Rejected User',
  });

  const callbackResult = await authService.completeOidcLogin({
    headers: {
      cookie: extractCookieHeader(loginResult.setCookie),
    },
  }, new URL(`http://127.0.0.1:3000/api/auth/oidc/callback?code=test-code&state=${encodeURIComponent(flowPayload.state)}`));

  assert.equal(callbackResult.statusCode, 302);
  assert.match(callbackResult.redirectTo, /auth_error=This\+account\+is\+not\+in\+the\+allowed\+email\+or\+domain\+list\./);
});

test('oidc auth allows an exact email allowlist match outside the allowed domains', async (t) => {
  const issuer = await startFakeOidcIssuer();
  t.after(() => issuer.close());

  const config = loadConfig({
    auth: {
      oidc: {
        allowedDomains: ['company.com'],
        allowedEmails: ['vip@outside.com'],
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        issuer: issuer.issuer,
        publicBaseUrl: 'http://127.0.0.1:3000',
      },
      strategy: AUTH_STRATEGY_OIDC,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  const loginResult = await authService.beginOidcLogin(
    { headers: {} },
    new URL('http://127.0.0.1:3000/api/auth/oidc/login?returnTo=%2F'),
  );
  const flowPayload = decodeFlowCookiePayload(loginResult.setCookie);
  issuer.setNextNonce(flowPayload.nonce);
  issuer.setNextClaims({
    email: 'vip@outside.com',
    name: 'Allowed By Email',
  });

  const callbackResult = await authService.completeOidcLogin({
    headers: {
      cookie: extractCookieHeader(loginResult.setCookie),
    },
  }, new URL(`http://127.0.0.1:3000/api/auth/oidc/callback?code=test-code&state=${encodeURIComponent(flowPayload.state)}`));

  assert.equal(callbackResult.statusCode, 302);
  assert.equal(callbackResult.redirectTo, '/');
});

test('oidc auth rejects callbacks with missing state and clears cookies', async (t) => {
  const issuer = await startFakeOidcIssuer();
  t.after(() => issuer.close());

  const config = loadConfig({
    auth: {
      oidc: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        issuer: issuer.issuer,
        publicBaseUrl: 'http://127.0.0.1:3000',
      },
      strategy: AUTH_STRATEGY_OIDC,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  const loginResult = await authService.beginOidcLogin(
    { headers: {} },
    new URL('http://127.0.0.1:3000/api/auth/oidc/login?returnTo=%2F'),
  );
  const callbackResult = await authService.completeOidcLogin({
    headers: {
      cookie: extractCookieHeader(loginResult.setCookie),
    },
  }, new URL('http://127.0.0.1:3000/api/auth/oidc/callback?code=test-code'));

  assert.equal(callbackResult.statusCode, 302);
  assert.match(callbackResult.redirectTo, /auth_error=/);
  assert.equal(Array.isArray(callbackResult.setCookie), true);
  assert.match(callbackResult.setCookie[0], /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
});

test('loadConfig rejects unsupported auth strategies', () => {
  assert.throws(() => {
    loadConfig({
      auth: {
        strategy: 'saml',
      },
      vaultDir: process.cwd(),
    });
  }, /Unsupported auth strategy/);
});

test('loadConfig keeps remote bootstrap disabled when git repo env is absent', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.git.remote.enabled, false);
  assert.equal(config.git.remote.repoUrl, '');
}));

test('loadConfig rejects remote bootstrap without a private key source', () => withAuthEnvCleared(() => {
  process.env.COLLABMD_GIT_REPO_URL = 'git@github.com:example/private.git';

  assert.throws(() => {
    loadConfig({
      vaultDir: process.cwd(),
    });
  }, /Remote git bootstrap requires/);
}));

test('loadConfig captures git bootstrap env and prefers file over base64 when both are set', () => withAuthEnvCleared(() => {
  process.env.COLLABMD_GIT_REPO_URL = 'git@github.com:example/private.git';
  process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE = './secrets/id_ed25519';
  process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64 = Buffer.from('dummy private key', 'utf8').toString('base64');
  process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE = './secrets/known_hosts';
  process.env.COLLABMD_GIT_USER_NAME = 'CollabMD Bot';
  process.env.COLLABMD_GIT_USER_EMAIL = 'bot@example.com';

  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.git.remote.enabled, true);
  assert.equal(config.git.remote.repoUrl, 'git@github.com:example/private.git');
  assert.equal(config.git.identity.name, 'CollabMD Bot');
  assert.equal(config.git.identity.email, 'bot@example.com');
  assert.match(config.git.remote.sshPrivateKeyFile, /secrets\/id_ed25519$/);
  assert.equal(config.git.remote.sshPrivateKeyBase64.length > 0, true);
  assert.match(config.git.remote.sshKnownHostsFile, /secrets\/known_hosts$/);
}));

test('loadConfig falls back to standard git author env for identity', () => withAuthEnvCleared(() => {
  process.env.GIT_AUTHOR_NAME = 'Standard Author';
  process.env.GIT_AUTHOR_EMAIL = 'author@example.com';

  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.git.identity.name, 'Standard Author');
  assert.equal(config.git.identity.email, 'author@example.com');
}));
