import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { mangleVaultIdForEnv, parseVaultList, resolveCliVaultDir, resolveConfiguredVaultDir, resolveConfiguredVaults, resolveVaultRepoUrls } from '../../src/server/config/env.js';

test('resolveCliVaultDir prefers the positional directory over COLLABMD_VAULT_DIR', () => {
  const positionals = ['./docs/vault'];
  const env = { COLLABMD_VAULT_DIR: '/tmp/collabmd-env-vault' };

  assert.equal(resolveCliVaultDir(positionals, env), resolve('./docs/vault'));
});

test('resolveCliVaultDir falls back to COLLABMD_VAULT_DIR when no directory argument is provided', () => {
  const env = { COLLABMD_VAULT_DIR: '/tmp/collabmd-env-vault' };

  assert.equal(resolveCliVaultDir([], env), resolve('/tmp/collabmd-env-vault'));
});

test('resolveConfiguredVaultDir honors COLLABMD_VAULT_DIR when no explicit override is provided', () => {
  const env = { COLLABMD_VAULT_DIR: '/tmp/collabmd-config-vault' };

  assert.equal(resolveConfiguredVaultDir({}, env), '/tmp/collabmd-config-vault');
});

test('parseVaultList supports named and bare entries', () => {
  assert.deepEqual(parseVaultList('docs=/tmp/vault-docs, /tmp/vault-other'), [
    { id: 'docs', dir: resolve('/tmp/vault-docs') },
    { id: 'vault-other', dir: resolve('/tmp/vault-other') },
  ]);
});

test('resolveConfiguredVaults falls back to a single vault from COLLABMD_VAULT_DIR', () => {
  assert.deepEqual(resolveConfiguredVaults({}, { COLLABMD_VAULT_DIR: '/tmp/collabmd-config-vault' }), [
    { id: 'collabmd-config-vault', dir: '/tmp/collabmd-config-vault' },
  ]);
});

test('resolveConfiguredVaults rejects duplicate ids', () => {
  assert.throws(
    () => resolveConfiguredVaults({}, { COLLABMD_VAULTS: 'a=/tmp/va, a=/tmp/vb' }),
    /Duplicate vault id "a"/,
  );
});

test('resolveConfiguredVaults rejects nested directories', () => {
  assert.throws(
    () => resolveConfiguredVaults({}, { COLLABMD_VAULTS: 'a=/tmp/va, b=/tmp/va/sub' }),
    /must not nest/,
  );
});

test('resolveConfiguredVaults rejects invalid ids', () => {
  assert.throws(
    () => resolveConfiguredVaults({}, { COLLABMD_VAULTS: 'has space=/tmp/va' }),
    /Invalid vault id/,
  );
});

test('resolveConfiguredVaults prefers an explicit vaultDir over COLLABMD_VAULTS', () => {
  assert.deepEqual(
    resolveConfiguredVaults({ vaultDir: '/tmp/cli-vault' }, { COLLABMD_VAULTS: 'a=/tmp/va, b=/tmp/vb' }),
    [{ id: 'cli-vault', dir: '/tmp/cli-vault' }],
  );
});

test('mangleVaultIdForEnv uppercases and replaces unsafe characters', () => {
  assert.equal(mangleVaultIdForEnv('my-docs.v2'), 'MY_DOCS_V2');
});

test('resolveVaultRepoUrls prefers per-vault vars and falls back to the shared URL for the primary', () => {
  const vaults = resolveVaultRepoUrls(
    [{ dir: '/tmp/va', id: 'docs' }, { dir: '/tmp/vb', id: 'notes' }],
    {},
    { COLLABMD_GIT_REPO_URL: 'git@example.com:org/shared.git', COLLABMD_GIT_REPO_URL_NOTES: 'git@example.com:org/notes.git' },
  );
  assert.deepEqual(vaults, [
    { dir: '/tmp/va', id: 'docs', repoUrl: 'git@example.com:org/shared.git' },
    { dir: '/tmp/vb', id: 'notes', repoUrl: 'git@example.com:org/notes.git' },
  ]);
});

test('resolveVaultRepoUrls leaves unmapped vaults local', () => {
  const vaults = resolveVaultRepoUrls([{ dir: '/tmp/va', id: 'docs' }], {}, {});
  assert.deepEqual(vaults, [{ dir: '/tmp/va', id: 'docs', repoUrl: '' }]);
});

test('resolveVaultRepoUrls rejects ambiguous mangled suffixes', () => {
  assert.throws(
    () => resolveVaultRepoUrls(
      [{ dir: '/tmp/va', id: 'a-b' }, { dir: '/tmp/vb', id: 'a_b' }],
      {},
      { COLLABMD_GIT_REPO_URL_A_B: 'git@example.com:org/ambiguous.git' },
    ),
    /Ambiguous git remote/,
  );
});
