import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : '';
}

function computeDirectoryFingerprint(directoryPath) {
  const hash = createHash('sha256');
  const entries = readdirSync(directoryPath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => {
      const absolutePath = resolve(entry.parentPath, entry.name);
      return {
        absolutePath,
        isDirectory: entry.isDirectory(),
        relativePath: relative(directoryPath, absolutePath).replace(/\\/g, '/'),
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  for (const entry of entries) {
    if (entry.isDirectory) {
      hash.update(`dir:${entry.relativePath}\n`);
    } else {
      hash.update(`file:${entry.relativePath}\n`);
      hash.update(readFileSync(entry.absolutePath));
      hash.update('\n');
    }
  }

  return hash.digest('hex').slice(0, 16);
}

export function loadBuildInfo({
  explicitBuildId = process.env.COLLABMD_BUILD_ID,
  projectRoot,
  publicDir,
} = {}) {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  const packageVersion = normalizeOptionalString(packageJson.version) || '0.0.0';
  const normalizedExplicitBuildId = normalizeOptionalString(explicitBuildId);

  if (normalizedExplicitBuildId) {
    return {
      id: normalizedExplicitBuildId,
      packageVersion,
    };
  }

  try {
    return {
      id: `${packageVersion}-${computeDirectoryFingerprint(publicDir)}`,
      packageVersion,
    };
  } catch {
    return {
      id: packageVersion,
      packageVersion,
    };
  }
}
