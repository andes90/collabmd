import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { loadConfig } from '../../../src/server/config/env.js';
import { createAppServer } from '../../../src/server/create-app-server.js';

async function removeTempRoot(tempRoot, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(tempRoot, { force: true, recursive: true });
      return;
    } catch (error) {
      const isRetriable = error?.code === 'ENOTEMPTY' || error?.code === 'EBUSY';
      if (!isRetriable || attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

export async function startTestServer(overrides = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-test-'));
  const vaultDir = join(tempRoot, 'vault');
  await mkdir(vaultDir, { recursive: true });

  // Seed a default test file
  await writeFile(join(vaultDir, 'test.md'), '# Test\n\nHello from test vault.\n', 'utf-8');

  const baseConfig = loadConfig({
    auth: overrides.auth,
    vaultDir,
  });
  const config = {
    ...baseConfig,
    host: '127.0.0.1',
    nodeEnv: 'test',
    vaultDir,
    port: 0,
    wsRoomIdleGraceMs: 0,
    ...overrides,
    auth: {
      ...baseConfig.auth,
      ...(overrides.auth ?? {}),
    },
  };
  const server = createAppServer(config);
  const { port } = await server.listen();

  return {
    baseUrl: `http://${config.host}:${port}`,
    close: async () => {
      await server.close();
      await removeTempRoot(tempRoot);
    },
    port,
    server,
    tempRoot,
    vaultDir,
    wsUrl: (filePath) => `ws://${config.host}:${port}${config.wsBasePath}/${encodeURIComponent(filePath)}`,
  };
}

export async function waitForCondition(assertion, {
  intervalMs = 25,
  timeoutMs = 5000,
} = {}) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const result = await assertion();
    if (result) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}
