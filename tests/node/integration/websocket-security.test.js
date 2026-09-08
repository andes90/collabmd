import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';

import { createSessionCookieManager } from '../../../src/server/auth/session-cookie.js';
import { startTestServer, waitForCondition } from '../helpers/test-server.js';
import { waitForClose, waitForOpen, waitForUnexpectedResponse } from '../helpers/collaboration-protocol.js';

function createCookie(app, expiresAt = Date.now() + 60_000) {
  const auth = app.server.config.auth;
  return createSessionCookieManager({
    cookieName: auth.sessionCookieName,
    secret: auth.sessionSecret,
  }).createSessionCookie({ headers: {} }, {
    expiresAt,
    strategy: auth.strategy,
    user: { email: 'member@example.com', name: 'Member', sub: 'google-1' },
  }).split(';')[0];
}

function authConfig(strategy) {
  return {
    strategy,
    password: 'test-password',
    ...(strategy === 'oidc' ? {
      oidc: { clientId: 'test-client', clientSecret: 'test-secret', publicBaseUrl: 'https://notes.example.com' },
    } : {}),
  };
}

for (const strategy of ['none', 'password', 'oidc']) {
  test(`WebSocket ${strategy} accepts its origin and nonbrowser clients, rejects other origins`, async (t) => {
    const app = await startTestServer({ auth: authConfig(strategy) });
    t.after(() => app.close());
    const Cookie = strategy === 'none' ? '' : createCookie(app);
    const allowedOrigin = strategy === 'oidc' ? 'https://notes.example.com' : app.baseUrl;
    for (const Origin of ['https://attacker.example.com', 'https://notes.example.com.attacker.test', 'null', 'invalid-origin']) {
      const ws = new WebSocket(app.wsUrl('test.md'), { headers: { Cookie, Origin } });
      assert.equal((await waitForUnexpectedResponse(ws)).statusCode, 403);
      ws.terminate();
    }
    for (const headers of [{ Cookie, Origin: allowedOrigin }, { Cookie }]) {
      const ws = new WebSocket(app.wsUrl('test.md'), { headers });
      await waitForOpen(ws);
      ws.close();
      await waitForClose(ws);
    }
    if (strategy !== 'none') {
      const ws = new WebSocket(app.wsUrl('test.md'));
      assert.equal((await waitForUnexpectedResponse(ws)).statusCode, 401);
      ws.terminate();
    }
  });
}

test('WebSocket honors proxy TLS signals when checking browser origin', async (t) => {
  const app = await startTestServer({ auth: authConfig('none') });
  t.after(() => app.close());
  const httpsOrigin = app.baseUrl.replace(/^http:/, 'https:');
  for (const headers of [
    { Origin: httpsOrigin, 'X-Forwarded-Proto': 'https' },
    { Origin: httpsOrigin, 'X-Forwarded-Proto': 'https, http' },
    { Origin: httpsOrigin, 'CF-Visitor': '{"scheme":"https"}' },
  ]) {
    const ws = new WebSocket(app.wsUrl('test.md'), { headers });
    await waitForOpen(ws);
    ws.close();
    await waitForClose(ws);
  }
  const attacker = new WebSocket(app.wsUrl('test.md'), {
    headers: { Origin: 'https://attacker.example.com', 'X-Forwarded-Proto': 'https' },
  });
  assert.equal((await waitForUnexpectedResponse(attacker)).statusCode, 403);
  attacker.terminate();
});

test('OIDC WebSocket closes at the signed session deadline and rejects reconnect', async (t) => {
  const app = await startTestServer({ auth: authConfig('oidc') });
  t.after(() => app.close());
  const headers = { Cookie: createCookie(app, Date.now() + 600), Origin: 'https://notes.example.com' };
  const ws = new WebSocket(app.wsUrl('test.md'), { headers });
  const closed = waitForClose(ws);
  await waitForOpen(ws);
  await waitForCondition(() => app.server.roomRegistry.get('test.md')?.clients.size === 1);
  assert.equal((await closed).code, 4001);
  await waitForCondition(() => !app.server.roomRegistry.get('test.md')?.clients.size);
  const reconnect = new WebSocket(app.wsUrl('test.md'), { headers });
  assert.equal((await waitForUnexpectedResponse(reconnect)).statusCode, 401);
  reconnect.terminate();
});
