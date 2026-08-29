import { cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(helperDir, '../../..');
export const templateVaultDir = resolve(projectRoot, 'test-vault');

export function getRuntimeVaultDir(workerId = process.env.COLLABMD_E2E_WORKER_ID || 'local') {
  return resolve(projectRoot, `.tmp/e2e-vault-${workerId}`);
}

export async function resetE2EVaultSnapshot(vaultDir = getRuntimeVaultDir()) {
  await rm(vaultDir, { force: true, recursive: true });
  await cp(templateVaultDir, vaultDir, { recursive: true });
  await rm(resolve(vaultDir, '.collabmd/yjs'), { force: true, recursive: true });
}
