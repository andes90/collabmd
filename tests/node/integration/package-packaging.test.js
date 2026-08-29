import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { extractAssetPath } from '../helpers/asset-path.js';

const execFile = promisify(execFileCallback);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function listRelativeFiles(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(currentPath, entry.name);
    if (entry.isDirectory()) {
      return listRelativeFiles(rootPath, entryPath);
    }

    return [entryPath.slice(rootPath.length + 1).replaceAll('\\', '/')];
  }));

  return nested.flat();
}

async function createPackWorkspace(tempRoot) {
  const workspaceRoot = resolve(tempRoot, 'workspace');
  const rootNodeModulesPath = resolve(rootDir, 'node_modules');
  const workspaceNodeModulesPath = resolve(workspaceRoot, 'node_modules');

  await cp(rootDir, workspaceRoot, {
    filter: (sourcePath) => {
      const relativePath = relative(rootDir, sourcePath);
      if (!relativePath || relativePath === '') {
        return true;
      }

      const topLevelEntry = relativePath.split(/[\\/]/u, 1)[0];
      return !['.git', 'dist', 'node_modules', 'test-results'].includes(topLevelEntry);
    },
    recursive: true,
  });
  await symlink(rootNodeModulesPath, workspaceNodeModulesPath, process.platform === 'win32' ? 'junction' : 'dir');

  return workspaceRoot;
}

async function packProject() {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'collabmd-pack-'));
  const packDir = resolve(tempRoot, 'pack');
  const unpackDir = resolve(tempRoot, 'unpack');
  const workspaceRoot = await createPackWorkspace(tempRoot);
  const npmCacheDir = resolve(tempRoot, 'npm-cache');
  const npmConfigDir = resolve(tempRoot, 'xdg-config');
  const npmHomeDir = resolve(tempRoot, 'home');
  const npmLogDir = resolve(tempRoot, 'npm-logs');
  const npmTempDir = resolve(tempRoot, 'npm-tmp');

  await mkdir(packDir, { recursive: true });
  await mkdir(unpackDir, { recursive: true });
  await mkdir(npmCacheDir, { recursive: true });
  await mkdir(npmConfigDir, { recursive: true });
  await mkdir(npmHomeDir, { recursive: true });
  await mkdir(npmLogDir, { recursive: true });
  await mkdir(npmTempDir, { recursive: true });

  const npmEnv = {
    ...process.env,
    HOME: npmHomeDir,
    USERPROFILE: npmHomeDir,
    XDG_CACHE_HOME: npmCacheDir,
    XDG_CONFIG_HOME: npmConfigDir,
    npm_config_cache: npmCacheDir,
    npm_config_logs_dir: npmLogDir,
    npm_config_loglevel: 'error',
    npm_config_tmp: npmTempDir,
    npm_config_update_notifier: 'false',
    npm_config_userconfig: resolve(npmHomeDir, '.npmrc'),
  };

  const { stdout } = await execFile('npm', ['pack', '--pack-destination', packDir, '--json', '--silent'], {
    cwd: workspaceRoot,
    env: npmEnv,
  });
  const packJsonMatch = stdout.match(/\[\s*\{[\s\S]*\]\s*$/);
  const [packResult] = JSON.parse(packJsonMatch?.[0] || '[]');
  const tarballPath = resolve(packDir, packResult.filename);

  await execFile('tar', ['-xzf', tarballPath, '-C', unpackDir]);

  return {
    cleanup: () => rm(tempRoot, { force: true, recursive: true }),
    packageRoot: resolve(unpackDir, 'package'),
  };
}

test('npm pack includes built public assets and runtime helper scripts required by the packaged install', async () => {
  const artifact = await packProject();

  try {
    const packagedPaths = new Set(await listRelativeFiles(artifact.packageRoot));
    const indexHtml = await readFile(resolve(artifact.packageRoot, 'dist/client/index.html'), 'utf8');
    const excalidrawHtml = await readFile(resolve(artifact.packageRoot, 'dist/client/excalidraw-editor.html'), 'utf8');
    const mainAssetPath = extractAssetPath(indexHtml, /src="\.\/(assets\/[^"]+\.js)"/, 'main asset');
    const mainCssPath = extractAssetPath(indexHtml, /href="\.\/(assets\/[^"]+-[A-Za-z0-9_-]{8,}\.css)"/, 'main stylesheet');
    const excalidrawJsPath = extractAssetPath(excalidrawHtml, /src="\.\/(assets\/[^"]+\.js)"/, 'Excalidraw script');
    const excalidrawCssPath = extractAssetPath(
      excalidrawHtml,
      /href="\.\/(assets\/excalidrawEditor-[^"]+\.css)"/,
      'Excalidraw stylesheet',
    );

    assert.ok(packagedPaths.has('dist/client/index.html'));
    assert.ok(packagedPaths.has('dist/client/excalidraw-editor.html'));
    assert.ok(packagedPaths.has(`dist/client/${mainAssetPath}`));
    assert.ok(packagedPaths.has(`dist/client/${mainCssPath}`));
    assert.ok(packagedPaths.has(`dist/client/${excalidrawJsPath}`));
    assert.ok(packagedPaths.has(`dist/client/${excalidrawCssPath}`));
    assert.ok(
      Array.from(packagedPaths).some((path) => /dist\/client\/assets\/github-dark\.min-[A-Za-z0-9_-]+\.css$/u.test(path)),
      'expected packaged build to include the dark highlight theme asset',
    );
    assert.ok(
      Array.from(packagedPaths).some((path) => /dist\/client\/assets\/github\.min-[A-Za-z0-9_-]+\.css$/u.test(path)),
      'expected packaged build to include the light highlight theme asset',
    );
    assert.ok(packagedPaths.has('docker-compose.yml'));
    assert.ok(packagedPaths.has('scripts/cloudflare-tunnel.mjs'));
    assert.ok(packagedPaths.has('scripts/local-plantuml-compose.mjs'));
  } finally {
    await artifact.cleanup();
  }
});

test('packed tarball can run the CLI help path and includes valid runtime helper scripts', async () => {
  const artifact = await packProject();

  try {
    const { packageRoot } = artifact;
    const packagedCliPath = resolve(packageRoot, 'bin/collabmd.js');
    const dockerComposePath = resolve(packageRoot, 'docker-compose.yml');
    const localPlantUmlScriptPath = resolve(packageRoot, 'scripts/local-plantuml-compose.mjs');
    const cloudflareTunnelScriptPath = resolve(packageRoot, 'scripts/cloudflare-tunnel.mjs');

    await access(packagedCliPath);
    await access(dockerComposePath);
    await access(localPlantUmlScriptPath);
    await access(cloudflareTunnelScriptPath);

    const helpResult = await execFile(process.execPath, [packagedCliPath, '--help'], {
      cwd: packageRoot,
    });

    assert.match(helpResult.stdout, /CollabMD/);
    assert.match(helpResult.stdout, /--local-plantuml/);

    await execFile(process.execPath, ['--check', packagedCliPath], {
      cwd: packageRoot,
    });
    await execFile(process.execPath, ['--check', localPlantUmlScriptPath], {
      cwd: packageRoot,
    });
    await execFile(process.execPath, ['--check', cloudflareTunnelScriptPath], {
      cwd: packageRoot,
    });
  } finally {
    await artifact.cleanup();
  }
});

test('Dockerfile and README document ripgrep for global text search', async () => {
  const dockerfile = await readFile(resolve(rootDir, 'Dockerfile'), 'utf8');
  const readme = await readFile(resolve(rootDir, 'README.md'), 'utf8');

  assert.match(dockerfile, /apk add --no-cache[^\n]*\bripgrep\b/u);
  assert.match(readme, /\bripgrep\b/u);
  assert.match(readme, /Global text search/i);
  assert.match(readme, /brew install ripgrep/u);
});
