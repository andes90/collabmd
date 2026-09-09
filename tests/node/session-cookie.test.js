import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionCookieManager, createSignedCookieManager } from '../../src/server/auth/session-cookie.js';

function createCookieHeader(manager, payload) {
  const setCookie = manager.create({ headers: {} }, payload);
  return String(setCookie).split(';')[0];
}

test('signed cookie reads return the verified payload', () => {
  const manager = createSignedCookieManager({ cookieName: 'session', secret: 'test-secret' });
  const req = { headers: { cookie: createCookieHeader(manager, { user: 'ada' }) } };

  assert.deepEqual(manager.read(req), { user: 'ada' });
});

test('signed cookie reads are verified once per request', () => {
  const manager = createSignedCookieManager({ cookieName: 'session', secret: 'test-secret' });
  const req = { headers: { cookie: createCookieHeader(manager, { user: 'ada' }) } };

  const first = manager.read(req);
  const second = manager.read(req);

  assert.deepEqual(first, { user: 'ada' });
  assert.ok(first === second);
});

test('signed cookie reads reject forged signatures', () => {
  const manager = createSignedCookieManager({ cookieName: 'session', secret: 'test-secret' });
  const cookie = createCookieHeader(manager, { user: 'ada' });
  const forged = `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;

  assert.equal(manager.read({ headers: { cookie: forged } }), null);
  assert.equal(manager.read({ headers: {} }), null);
});

test('session cookie manager round-trips through the signed manager', () => {
  const manager = createSessionCookieManager({
    cookieName: 'session',
    secret: 'test-secret',
  });
  const setCookie = manager.createSessionCookie({ headers: {} }, { strategy: 'password' });
  const req = { headers: { cookie: String(setCookie).split(';')[0] } };

  const first = manager.readSession(req);
  assert.deepEqual(first, { strategy: 'password' });
  assert.ok(first === manager.readSession(req));
});
