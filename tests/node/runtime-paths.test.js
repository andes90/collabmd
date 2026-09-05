import test from 'node:test';
import assert from 'node:assert/strict';

import { getActiveVaultId, resolveApiUrl, resolveWsBaseUrl, resolveWsServerOverride } from '../../src/client/domain/runtime-paths.js';

test('resolveWsBaseUrl ignores query server overrides outside development and test environments', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: {
      environment: 'production',
      wsBasePath: '/ws',
    },
    location: {
      host: 'app.example.test',
      origin: 'https://app.example.test',
      protocol: 'https:',
      search: '?server=wss%3A%2F%2Fevil.example.test%2Fws',
    },
  };

  try {
    assert.equal(resolveWsServerOverride(), '');
    assert.equal(resolveWsBaseUrl(), 'wss://app.example.test/ws');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('resolveWsBaseUrl accepts explicit development server overrides with safe protocols', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: {
      environment: 'development',
    },
    location: {
      host: 'app.example.test',
      origin: 'http://app.example.test',
      protocol: 'http:',
      search: '?server=ws%3A%2F%2Flocalhost%3A3000%2Fws%2F',
    },
  };

  try {
    assert.equal(resolveWsServerOverride(), 'ws://localhost:3000/ws');
    assert.equal(resolveWsBaseUrl(), 'ws://localhost:3000/ws');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('resolveWsBaseUrl rejects unsupported query server protocols', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: {
      environment: 'test',
      wsBasePath: '/ws',
    },
    location: {
      host: 'app.example.test',
      origin: 'http://app.example.test',
      protocol: 'http:',
      search: '?server=javascript%3Aalert(1)',
    },
  };

  try {
    assert.equal(resolveWsServerOverride(), '');
    assert.equal(resolveWsBaseUrl(), 'ws://app.example.test/ws');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('resolveApiUrl prefixes vault-scoped paths with the active vault', () => {
  const config = { basePath: '', vaults: [{ id: 'alpha' }, { id: 'beta' }], activeVault: 'beta', wsBasePath: '/ws' };
  assert.equal(resolveApiUrl('/files', config), '/api/v/beta/files');
  assert.equal(resolveApiUrl('/file?path=a.md', config), '/api/v/beta/file?path=a.md');
  assert.equal(resolveApiUrl('/api/git/status', config), '/api/v/beta/git/status');
});

test('resolveApiUrl leaves global paths unscoped', () => {
  const config = { basePath: '', vaults: [{ id: 'alpha' }], activeVault: 'alpha', wsBasePath: '/ws' };
  assert.equal(resolveApiUrl('/auth/status', config), '/api/auth/status');
  assert.equal(resolveApiUrl('/hosted/status', config), '/api/hosted/status');
  assert.equal(resolveApiUrl('/agent/tools/x', config), '/api/agent/tools/x');
  assert.equal(resolveApiUrl('/plantuml/render', config), '/api/plantuml/render');
  assert.equal(resolveApiUrl('/vaults', config), '/api/vaults');
});

test('resolveApiUrl skips the vault prefix without a known vault', () => {
  assert.equal(resolveApiUrl('/files', { basePath: '', vaults: [], wsBasePath: '/ws' }), '/api/files');
});

test('getActiveVaultId prefers a stored vault override', () => {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => 'beta', setItem: () => {} } };
  try {
    const config = { vaults: [{ id: 'alpha' }, { id: 'beta' }], activeVault: 'alpha' };
    assert.equal(getActiveVaultId(config), 'beta');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('resolveWsBaseUrl appends the active vault segment', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { host: 'app.example.test', origin: 'http://app.example.test', protocol: 'http:', search: '' },
  };
  try {
    const config = { environment: 'production', vaults: [{ id: 'alpha' }], activeVault: 'alpha', wsBasePath: '/ws' };
    assert.equal(resolveWsBaseUrl(config), 'ws://app.example.test/ws/v/alpha');
  } finally {
    globalThis.window = originalWindow;
  }
});
