import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const repoRoot = process.cwd();
const srcRoot = resolve(repoRoot, 'src');

const RELATIVE_IMPORT_PATTERN = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_FROM_PATTERN = /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
const INTERNAL_SPECIFIER_PREFIXES = ['.', '/', 'src/'];

function normalizeImportSpecifier(specifier) {
  return String(specifier ?? '').split(/[?#]/u, 1)[0];
}

const RULES = [
  {
    name: 'shared-domain-isolated',
    appliesTo: 'src/domain/',
    forbidden: ['src/client/', 'src/server/'],
  },
  {
    name: 'client-presentation-no-upward-deps',
    appliesTo: 'src/client/presentation/',
    forbidden: ['src/client/application/', 'src/client/infrastructure/'],
  },
  {
    name: 'client-infrastructure-no-ui-deps',
    appliesTo: 'src/client/infrastructure/',
    forbidden: ['src/client/application/', 'src/client/presentation/'],
  },
  {
    name: 'client-application-no-adapter-imports',
    appliesTo: 'src/client/application/',
    forbidden: ['src/client/presentation/', 'src/client/infrastructure/'],
  },
  {
    name: 'server-domain-no-infrastructure',
    appliesTo: 'src/server/domain/',
    forbidden: ['src/server/infrastructure/'],
    allowFiles: new Set([
      'src/server/domain/git-service.js',
      'src/server/domain/plantuml-renderer.js',
    ]),
  },
  {
    name: 'server-auth-no-infrastructure',
    appliesTo: 'src/server/auth/',
    forbidden: ['src/server/infrastructure/'],
    allowFiles: new Set([
      'src/server/auth/create-auth-service.js',
    ]),
  },
];

const ALLOWED_DEPENDENCIES = new Set([
  'src/server/domain/git-service.js -> src/server/infrastructure/git/git-service.js',
  'src/server/domain/plantuml-renderer.js -> src/server/infrastructure/plantuml/plantuml-renderer.js',
]);

async function collectFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(?:js|mjs)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRepoPath(filePath) {
  return relative(repoRoot, filePath).replace(/\\/g, '/');
}

function extractRelativeSpecifiers(source) {
  const specifiers = [];

  for (const pattern of [RELATIVE_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN, EXPORT_FROM_PATTERN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1];
      if (INTERNAL_SPECIFIER_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
        specifiers.push(specifier);
      }
    }
  }

  return specifiers;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveImport(fromFile, specifier) {
  const normalizedSpecifier = normalizeImportSpecifier(specifier);

  if (normalizedSpecifier.startsWith('src/')) {
    return resolve(repoRoot, normalizedSpecifier);
  }

  if (normalizedSpecifier.startsWith('/')) {
    return resolve(repoRoot, `.${normalizedSpecifier}`);
  }

  const candidate = resolve(dirname(fromFile), normalizedSpecifier);
  const variants = [
    candidate,
    `${candidate}.js`,
    `${candidate}.mjs`,
    resolve(candidate, 'index.js'),
    resolve(candidate, 'index.mjs'),
  ];

  for (const variant of variants) {
    if (await pathExists(variant)) {
      return variant;
    }
  }

  return candidate;
}

function matchesPrefix(value, prefixes) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

test('source files respect architecture boundary rules', async () => {
  const files = await collectFiles(srcRoot);
  const violations = [];

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    const source = await readFile(filePath, 'utf8');
    const specifiers = extractRelativeSpecifiers(source);

    for (const specifier of specifiers) {
      const targetRepoPath = toRepoPath(await resolveImport(filePath, specifier));
      if (!targetRepoPath.startsWith('src/')) {
        continue;
      }

      if (ALLOWED_DEPENDENCIES.has(`${repoPath} -> ${targetRepoPath}`)) {
        continue;
      }

      for (const rule of RULES) {
        if (!repoPath.startsWith(rule.appliesTo)) {
          continue;
        }

        if (rule.allowFiles?.has(repoPath)) {
          continue;
        }

        if (matchesPrefix(targetRepoPath, rule.forbidden)) {
          violations.push(`${rule.name}: ${repoPath} -> ${targetRepoPath}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('internal module specifiers resolve consistently', async () => {
  const files = await collectFiles(srcRoot);
  const unresolved = [];

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    const source = await readFile(filePath, 'utf8');
    const specifiers = extractRelativeSpecifiers(source);

    for (const specifier of specifiers) {
      const resolvedPath = await resolveImport(filePath, specifier);
      if (!await pathExists(resolvedPath)) {
        unresolved.push(`${repoPath} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(unresolved, []);
});
