import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getVaultFileKind,
  isDiagramFilePath,
  isStructurizrFilePath,
} from '../../src/domain/file-kind.js';
import { createStructurizrStarter } from '../../src/client/domain/vault-paths.js';
import { StructurizrWorkspaceService } from '../../src/server/infrastructure/structurizr/structurizr-workspace-service.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('Structurizr DSL is a renderable diagram workspace root', () => {
  assert.equal(getVaultFileKind('workspace.dsl'), 'structurizr');
  assert.equal(isStructurizrFilePath('includes/model.dsl'), true);
  assert.equal(isDiagramFilePath('workspace.dsl'), true);
});

test('Structurizr ignores manifest paths outside its mirror', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-structurizr-manifest-'));
  const vaultDir = join(tempRoot, 'vault');
  const mirrorDir = join(tempRoot, 'mirror');
  await mkdir(vaultDir);
  await mkdir(mirrorDir);
  await writeFile(join(tempRoot, 'keep.md'), 'keep');
  await writeFile(join(vaultDir, 'workspace.dsl'), 'workspace "Test" {}\n');
  await writeFile(join(mirrorDir, '.collabmd-manifest.json'), JSON.stringify({ paths: ['../keep.md', '..\\keep.md', join(tempRoot, 'keep.md'), null] }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ ok: true });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(tempRoot, { force: true, recursive: true });
  });
  const service = new StructurizrWorkspaceService({ mirrorDir, serverUrl: 'http://structurizr.test', vaultDir });
  await service.sync({ rootPath: 'workspace.dsl' });
  assert.equal(await readFile(join(tempRoot, 'keep.md'), 'utf8'), 'keep');
});

test('Structurizr rejects symlinked metadata roots and mirror output files', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-structurizr-link-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const vaultDir = join(tempRoot, 'vault');
  const outside = join(tempRoot, 'outside');
  await mkdir(vaultDir);
  await mkdir(outside);
  await writeFile(join(vaultDir, 'workspace.dsl'), 'workspace "Test" {}');
  await symlink(outside, join(vaultDir, '.collabmd'));
  const service = new StructurizrWorkspaceService({
    mirrorDir: join(vaultDir, '.collabmd/structurizr'), vaultDir, serverUrl: 'http://structurizr.test',
  });
  await assert.rejects(service.sync({ rootPath: 'workspace.dsl' }), { requestCode: 'STRUCTURIZR_MIRROR_INVALID' });
  assert.deepEqual(await readdir(outside), []);
  await rm(join(vaultDir, '.collabmd'));
  await mkdir(service.mirrorDir, { recursive: true });
  await writeFile(join(outside, 'keep.dsl'), 'keep');
  await symlink(join(outside, 'keep.dsl'), join(service.mirrorDir, 'workspace.dsl'));
  await assert.rejects(service.sync({ rootPath: 'workspace.dsl' }), { requestCode: 'STRUCTURIZR_MIRROR_INVALID' });
  assert.equal(await readFile(join(outside, 'keep.dsl'), 'utf8'), 'keep');
});

test('Structurizr workspace sync mirrors includes and preserves the last valid source', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-structurizr-test-'));
  const vaultDir = join(tempRoot, 'vault');
  const mirrorDir = join(tempRoot, 'mirror');
  await mkdir(join(vaultDir, 'includes'), { recursive: true });
  await writeFile(join(vaultDir, 'workspace.dsl'), createStructurizrStarter('workspace.dsl').content);
  await writeFile(join(vaultDir, 'includes', 'model.dsl'), 'model {\n}\n');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const source = await readFile(join(mirrorDir, 'workspace.dsl'), 'utf8').catch(() => '');
    return source.includes('invalid source')
      ? jsonResponse({ success: false, message: 'invalid source' }, 400)
      : jsonResponse({ ok: true });
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(tempRoot, { force: true, recursive: true });
  });

  const service = new StructurizrWorkspaceService({
    mirrorDir,
    serverUrl: 'http://structurizr.test',
    vaultDir,
  });
  const validSource = await readFile(join(vaultDir, 'workspace.dsl'), 'utf8');

  await service.sync({ content: validSource, rootPath: 'workspace.dsl' });
  assert.equal(await readFile(join(mirrorDir, 'includes/model.dsl'), 'utf8'), 'model {\n}\n');
  assert.equal(await readFile(join(mirrorDir, 'workspace.dsl'), 'utf8'), validSource);

  await assert.rejects(
    service.sync({ content: 'invalid source', rootPath: 'workspace.dsl' }),
    (error) => error.requestCode === 'STRUCTURIZR_DSL_INVALID' && error.statusCode === 422,
  );
  assert.equal(await readFile(join(mirrorDir, 'workspace.dsl'), 'utf8'), validSource);
});

test('Structurizr sync rejects executable DSL in safe mode', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-structurizr-safe-'));
  const vaultDir = join(tempRoot, 'vault');
  const mirrorDir = join(tempRoot, 'mirror');
  await mkdir(vaultDir, { recursive: true });
  await writeFile(join(vaultDir, 'workspace.dsl'), 'workspace "Test" {}\n');

  t.after(() => rm(tempRoot, { force: true, recursive: true }));

  const service = new StructurizrWorkspaceService({
    mirrorDir,
    serverUrl: 'http://structurizr.test',
    vaultDir,
  });

  await assert.rejects(
    service.sync({ content: '!script println("unsafe")', rootPath: 'workspace.dsl' }),
    (error) => error.requestCode === 'STRUCTURIZR_EXECUTABLE_DSL_DISABLED' && error.statusCode === 422,
  );
});
