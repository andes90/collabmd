import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

import { loadConfig } from '../../src/server/config/env.js';
import { createAuthService, AUTH_STRATEGY_PASSWORD } from '../../src/server/auth/create-auth-service.js';
import { sanitizeVaultPath, resolveVaultFilePath } from '../../src/server/infrastructure/persistence/path-utils.js';
import { createRateLimiter } from '../../src/server/infrastructure/http/rate-limiter.js';
import { startTestServer } from './helpers/test-server.js';

function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      headers,
      method,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf-8'),
          headers: res.headers,
          statusCode: res.statusCode,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function withEnvCleared(fn) {
  const saved = {};
  const keys = ['AUTH_STRATEGY', 'AUTH_PASSWORD', 'AUTH_SESSION_TTL_MS'];
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

// --- Auth default tests ---

test('default auth strategy is password when not explicitly configured', () => withEnvCleared(() => {
  const config = loadConfig({ vaultDir: process.cwd() });
  assert.equal(config.auth.strategy, AUTH_STRATEGY_PASSWORD);
  assert.equal(config.auth.password.length > 0, true);
  assert.equal(config.auth.passwordWasGenerated, true);
}));

test('auth=none requires explicit opt-in', () => withEnvCleared(() => {
  const config = loadConfig({ auth: { strategy: 'none' }, vaultDir: process.cwd() });
  assert.equal(config.auth.strategy, 'none');
}));

test('session TTL defaults to 24 hours', () => withEnvCleared(() => {
  const config = loadConfig({ auth: { strategy: 'password' }, vaultDir: process.cwd() });
  assert.equal(config.auth.sessionTtlMs, 24 * 60 * 60 * 1000);
}));

test('session TTL is configurable via env', () => withEnvCleared(() => {
  process.env.AUTH_SESSION_TTL_MS = '3600000';
  const config = loadConfig({ auth: { strategy: 'password' }, vaultDir: process.cwd() });
  assert.equal(config.auth.sessionTtlMs, 3600000);
}));

// --- Password session expiry tests ---

test('expired password sessions are rejected', async () => {
  const saved = {};
  const keys = ['AUTH_STRATEGY', 'AUTH_PASSWORD', 'AUTH_SESSION_TTL_MS'];
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  try {
    const config = loadConfig({
      auth: { password: 'test-pass', strategy: 'password', sessionTtlMs: 1 },
      vaultDir: process.cwd(),
    });
    const authService = createAuthService(config);
    const req = { headers: {} };

    const session = authService.createSession(req, { password: 'test-pass' });
    assert.equal(session.statusCode, 200);

    const authenticatedReq = { headers: { cookie: session.setCookie } };
    assert.equal(authService.authorizeApiRequest(authenticatedReq).ok, true);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = authService.authorizeApiRequest(authenticatedReq);
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 401);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
});

// --- Path traversal tests ---

test('sanitizeVaultPath rejects null bytes', () => {
  const vaultDir = '/tmp/vault';
  assert.equal(sanitizeVaultPath(vaultDir, 'file\0.md'), null);
  assert.equal(sanitizeVaultPath(vaultDir, '../\0etc/passwd'), null);
  assert.equal(sanitizeVaultPath(vaultDir, 'notes/\0hidden.md'), null);
});

test('sanitizeVaultPath rejects parent directory traversal', () => {
  const vaultDir = '/tmp/vault';
  assert.equal(sanitizeVaultPath(vaultDir, '../etc/passwd'), null);
  assert.equal(sanitizeVaultPath(vaultDir, '../../etc/shadow'), null);
  assert.equal(sanitizeVaultPath(vaultDir, 'subdir/../../etc/passwd'), null);
});

test('sanitizeVaultPath allows valid paths within vault', () => {
  const vaultDir = '/tmp/vault';
  assert.equal(sanitizeVaultPath(vaultDir, 'README.md'), '/tmp/vault/README.md');
  assert.equal(sanitizeVaultPath(vaultDir, 'notes/daily.md'), '/tmp/vault/notes/daily.md');
});

test('resolveVaultFilePath rejects non-vault extensions', () => {
  const vaultDir = '/tmp/vault';
  const result = resolveVaultFilePath(vaultDir, 'secret.txt');
  assert.equal(result.absolute, null);
  assert.match(result.error, /must end in/);
});

// --- Rate limiter tests ---

test('rate limiter allows requests within window', () => {
  const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 1000 });
  const req = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };

  assert.equal(limiter.isAllowed(req), true);
  limiter.record(req);
  assert.equal(limiter.isAllowed(req), true);
  limiter.record(req);
  assert.equal(limiter.isAllowed(req), true);
  limiter.record(req);
  assert.equal(limiter.isAllowed(req), false);
});

test('rate limiter tracks separate IPs independently', () => {
  const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 1000 });
  const req1 = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };
  const req2 = { headers: {}, socket: { remoteAddress: '10.0.0.2' } };

  limiter.record(req1);
  assert.equal(limiter.isAllowed(req1), false);
  assert.equal(limiter.isAllowed(req2), true);
});

test('rate limiter uses X-Forwarded-For when present', () => {
  const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 1000 });
  const req = {
    headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18' },
    socket: { remoteAddress: '10.0.0.1' },
  };

  limiter.record(req);
  assert.equal(limiter.isAllowed(req), false);

  const reqFromSameSocket = {
    headers: {},
    socket: { remoteAddress: '10.0.0.1' },
  };
  assert.equal(limiter.isAllowed(reqFromSameSocket), true);
});

// --- HTTP security header tests ---

test('HTTP responses include Content-Security-Policy', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/health`);
  assert.equal(response.statusCode, 200);
  assert.ok(response.headers['content-security-policy']);
  assert.match(response.headers['content-security-policy'], /default-src 'self'/);
  assert.match(response.headers['content-security-policy'], /object-src 'none'/);
  assert.match(response.headers['content-security-policy'], /base-uri 'self'/);
});

test('HTTP responses include Permissions-Policy', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/health`);
  assert.ok(response.headers['permissions-policy']);
  assert.match(response.headers['permissions-policy'], /camera=\(\)/);
});

test('HTTP responses include standard security headers', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/health`);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(response.headers['referrer-policy'], /strict-origin/);
});

// --- Auth rate limiting integration test ---

test('login endpoint returns 429 after too many attempts', async (t) => {
  const app = await startTestServer({
    auth: { password: 'rate-limit-test', strategy: 'password' },
  });
  t.after(() => app.close());

  for (let i = 0; i < 5; i++) {
    await httpRequest(`${app.baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
  }

  const blocked = await httpRequest(`${app.baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });

  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.body, /Too many login attempts/);
  assert.equal(blocked.headers['retry-after'], '60');
});

// --- WebSocket room name validation tests ---

test('HTTP server rejects WebSocket upgrade with path traversal in room name', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const WebSocket = (await import('ws')).default;

  const traversalWs = new WebSocket(`ws://127.0.0.1:${app.port}/ws/${encodeURIComponent('../../etc/passwd')}`);
  const closePromise = new Promise((resolve) => {
    traversalWs.on('close', (code) => resolve(code));
    traversalWs.on('error', () => resolve('error'));
  });
  const result = await closePromise;
  assert.ok(result === 1008 || result === 'error');
});

// --- Cookie security tests ---

test('password session cookie includes HttpOnly and SameSite attributes', async (t) => {
  const app = await startTestServer({
    auth: { password: 'cookie-test', strategy: 'password' },
  });
  t.after(() => app.close());

  const loginResponse = await httpRequest(`${app.baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'cookie-test' }),
  });

  assert.equal(loginResponse.statusCode, 200);
  const setCookie = String(loginResponse.headers['set-cookie'] ?? '');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
});

// --- Cross-origin protection tests ---

test('cross-origin OPTIONS preflights for writes are rejected', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const response = await httpRequest(`${app.baseUrl}/api/file`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'POST',
    },
  });

  assert.equal(response.statusCode, 403);
});
