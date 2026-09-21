import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { mangleVaultIdForEnv, parseVaultList, resolveCliVaultDir, resolveConfiguredVaultDir, resolveConfiguredVaults, resolveVaultNames, resolveVaultRepoUrls } from '../../src/server/config/env.js';

test('vault discovery lists immediate real folders, optionally requiring a marker', (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'collabmd-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['beta/.collabmd', 'alpha/nested', 'file-marker', '.hidden']) {
    mkdirSync(resolve(root, name), { recursive: true });
  }
  writeFileSync(resolve(root, 'note.md'), '# Not a vault');
  writeFileSync(resolve(root, 'file-marker/.collabmd'), '');
  symlinkSync(resolve(root, 'beta'), resolve(root, 'linked'));
  const env = { COLLABMD_VAULT_DIR: root, COLLABMD_VAULT_DISCOVERY: 'all' };
  assert.deepEqual(resolveConfiguredVaults({}, env).map(({ id }) => id), ['alpha', 'beta', 'file-marker']);
  env.COLLABMD_VAULT_DISCOVERY = 'marked';
  assert.deepEqual(resolveConfiguredVaults({}, env), [{ id: 'beta', dir: resolve(root, 'beta') }]);
  env.COLLABMD_VAULT_DISCOVERY = 'invalid';
  assert.throws(() => resolveConfiguredVaults({}, env), /must be "all" or "marked"/);
  env.COLLABMD_VAULTS = `chosen=${root}`;
  assert.equal(resolveConfiguredVaults({}, env)[0].id, 'chosen');
  assert.equal(resolveConfiguredVaults({ vaultDir: resolve(root, 'alpha') }, env)[0].id, 'alpha');
  delete env.COLLABMD_VAULTS;
  env.COLLABMD_VAULT_DISCOVERY = 'marked';
  env.COLLABMD_VAULT_DIR = resolve(root, 'alpha');
  assert.throws(() => resolveConfiguredVaults({}, env), /No vaults found/);
});

test('vault display names preserve IDs, fall back to IDs, and reject ambiguous settings', () => {
  assert.deepEqual(resolveVaultNames([{ id: 'cool-project' }, { id: 'other' }], {
    COLLABMD_VAULT_NAME_COOL_PROJECT: ' Cool project ',
  }), [{ id: 'cool-project', name: 'Cool project' }, { id: 'other', name: 'other' }]);
  assert.throws(() => resolveVaultNames([{ id: 'a-b' }, { id: 'a_b' }], {
    COLLABMD_VAULT_NAME_A_B: 'Ambiguous',
  }), /Ambiguous vault name/);
});

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
