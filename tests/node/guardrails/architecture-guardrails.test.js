import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, extname, relative, resolve } from 'node:path';

const repoRoot = process.cwd();
const srcRoot = resolve(repoRoot, 'src');
const binRoot = resolve(repoRoot, 'bin');

const NODE_BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith('node:')));
const IMPORT_SPECIFIER_RE = /(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gu;

async function collectJsFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(?:js|mjs)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRepoPath(filePath) {
  return relative(repoRoot, filePath).replace(/\\/gu, '/');
}

function extractImportSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) {
    const specifier = match[1] || match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

function resolveRelativeImport(fromFilePath, specifier) {
  let targetPath = resolve(dirname(fromFilePath), specifier);
  if (!extname(targetPath)) {
    targetPath += '.js';
  }
  return toRepoPath(targetPath);
}

function getPackageName(specifier) {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

test('src modules have no circular imports', async () => {
  const files = await collectJsFiles(srcRoot);
  const graph = new Map();

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    const source = await readFile(filePath, 'utf8');
    const localDeps = extractImportSpecifiers(source)
      .filter((specifier) => specifier.startsWith('.'))
      .map((specifier) => resolveRelativeImport(filePath, specifier));
    graph.set(repoPath, localDeps);
  }

  const visited = new Set();
  const activeStack = new Set();
  const cycles = [];

  function visit(node, trail) {
    visited.add(node);
    activeStack.add(node);

    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue;
      if (activeStack.has(dep)) {
        const cycleStart = trail.indexOf(dep);
        cycles.push(trail.slice(cycleStart).concat(dep).join(' -> '));
      } else if (!visited.has(dep)) {
        visit(dep, trail.concat(dep));
      }
    }

    activeStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      visit(node, [node]);
    }
  }

  assert.deepEqual(cycles, []);
});

test('client, server, and shared domain layers do not cross-import illegally', async () => {
  const files = await collectJsFiles(srcRoot);
  const violations = [];

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    const source = await readFile(filePath, 'utf8');

    for (const specifier of extractImportSpecifiers(source)) {
      if (specifier.startsWith('.')) {
        const target = resolveRelativeImport(filePath, specifier);
        if (repoPath.startsWith('src/client/') && target.startsWith('src/server/')) {
          violations.push(`${repoPath} -> ${target}`);
        }
        if (repoPath.startsWith('src/server/') && target.startsWith('src/client/')) {
          violations.push(`${repoPath} -> ${target}`);
        }
        if (repoPath.startsWith('src/domain/') && (target.startsWith('src/client/') || target.startsWith('src/server/'))) {
          violations.push(`${repoPath} -> ${target}`);
        }
      } else if (repoPath.startsWith('src/domain/') && (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier))) {
        violations.push(`${repoPath} -> ${specifier} (Node built-in in shared domain)`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('src modules use the node: prefix for Node built-in imports', async () => {
  const files = await collectJsFiles(srcRoot);
  const violations = [];

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    const source = await readFile(filePath, 'utf8');

    for (const specifier of extractImportSpecifiers(source)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('node:') && NODE_BUILTINS.has(specifier)) {
        violations.push(`${repoPath} -> '${specifier}' (use 'node:${specifier}')`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('server, shared domain, and bin runtime code never imports devDependencies', async () => {
  const pkg = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
  const dependencies = new Set(Object.keys(pkg.dependencies ?? {}));
  const devDependencies = new Set(Object.keys(pkg.devDependencies ?? {}));

  const runtimeFiles = [
    ...await collectJsFiles(resolve(srcRoot, 'server')),
    ...await collectJsFiles(resolve(srcRoot, 'domain')),
    ...await collectJsFiles(binRoot),
  ];

  const violations = [];
  for (const filePath of runtimeFiles) {
    const repoPath = toRepoPath(filePath);
    const source = await readFile(filePath, 'utf8');

    for (const specifier of extractImportSpecifiers(source)) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      const pkgName = getPackageName(specifier);
      if (devDependencies.has(pkgName) && !dependencies.has(pkgName)) {
        violations.push(`${repoPath} imports devDependency '${pkgName}'`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
