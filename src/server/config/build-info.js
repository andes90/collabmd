import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : '';
}

function listDirectoryEntries(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true })
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
}

function updateDirectoryFingerprint(hash, rootDir, currentDir) {
  for (const entry of listDirectoryEntries(currentDir)) {
    const absolutePath = resolve(currentDir, entry.name);
    const relativePath = relative(rootDir, absolutePath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      hash.update(`dir:${relativePath}\n`);
      updateDirectoryFingerprint(hash, rootDir, absolutePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    hash.update(`file:${relativePath}\n`);
    hash.update(readFileSync(absolutePath));
    hash.update('\n');
  }
}

function computeDirectoryFingerprint(directoryPath) {
  const hash = createHash('sha256');
  updateDirectoryFingerprint(hash, directoryPath, directoryPath);
  return hash.digest('hex').slice(0, 16);
}

function loadPackageVersion(projectRoot) {
  const packageJsonPath = resolve(projectRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return normalizeOptionalString(packageJson.version) || '0.0.0';
}

export function loadBuildInfo({
  explicitBuildId = process.env.COLLABMD_BUILD_ID,
  projectRoot,
  publicDir,
} = {}) {
  const packageVersion = loadPackageVersion(projectRoot);
  const normalizedExplicitBuildId = normalizeOptionalString(explicitBuildId);

  if (normalizedExplicitBuildId) {
    return {
      id: normalizedExplicitBuildId,
      packageVersion,
    };
  }

  try {
    const fingerprint = computeDirectoryFingerprint(publicDir);
    return {
      id: `${packageVersion}-${fingerprint}`,
      packageVersion,
    };
  } catch {
    return {
      id: packageVersion,
      packageVersion,
    };
  }
}
