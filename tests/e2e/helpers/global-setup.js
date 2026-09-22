import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const projectRoot = resolve(import.meta.dirname, '../../..');

export default async function setupClientBuild() {
  // Build once per run: dist/client can be emptied by another Vite build at any time.
  const publicDir = await mkdtemp(join(tmpdir(), 'collabmd-e2e-client-'));
  try {
    await promisify(execFile)(process.execPath, [
      resolve(projectRoot, 'node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      publicDir,
    ], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'production' },
    });
  } catch (error) {
    await rm(publicDir, { force: true, recursive: true });
    throw error;
  }

  const previousEnv = {
    COLLABMD_E2E_PUBLIC_DIR: process.env.COLLABMD_E2E_PUBLIC_DIR,
    NODE_ENV: process.env.NODE_ENV,
  };
  // Also covers in-process servers used by auth, vault-link, and visual tests.
  process.env.COLLABMD_E2E_PUBLIC_DIR = publicDir;
  process.env.NODE_ENV = 'test';

  return async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(publicDir, { force: true, recursive: true });
  };
}
