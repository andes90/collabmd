import test from 'node:test';
import assert from 'node:assert/strict';

import { createSignedCookieManager } from '../../src/server/auth/session-cookie.js';

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

test('signed cookie manager caches reads per request across strategy payloads', () => {
  const manager = createSignedCookieManager({
    cookieName: 'session',
    secret: 'test-secret',
  });
  const setCookie = manager.create({ headers: {} }, { strategy: 'password' });
  const req = { headers: { cookie: String(setCookie).split(';')[0] } };

  const first = manager.read(req);
  assert.deepEqual(first, { strategy: 'password' });
  assert.ok(first === manager.read(req));
});

test('sets and clears secure cookies behind HTTPS proxies and on direct TLS', () => {
  const manager = createSignedCookieManager({ cookieName: 'session', secret: 'test-secret' });
  for (const req of [
    { headers: { 'x-forwarded-proto': 'HTTPS, http' } },
    { headers: { 'cf-visitor': '{"scheme":"https"}' } },
    { headers: {}, socket: { encrypted: true } },
  ]) {
    assert.match(manager.create(req, {}), /; Secure\b/u);
    assert.match(manager.clear(req), /; Secure\b/u);
  }
  assert.doesNotMatch(manager.create({ headers: {} }, {}), /; Secure\b/u);
});

test('refreshes the cached cookie when the cookie header changes', () => {
  const manager = createSignedCookieManager({ cookieName: 'session', secret: 'test-secret' });
  const req = { headers: {} };
  assert.equal(manager.read(req), null);
  const first = createCookieHeader(manager, { id: 1 });
  const second = createCookieHeader(manager, { id: 2 });
  req.headers.cookie = first;
  assert.equal(manager.read(req).id, 1);
  req.headers.cookie = second;
  assert.equal(manager.read(req).id, 2);
  delete req.headers.cookie;
  assert.equal(manager.read(req), null);
});
