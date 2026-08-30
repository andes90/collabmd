import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export async function ensureCollabMetadataGitExclude(vaultDir) {
  let excludePath = resolve(vaultDir, '.git/info/exclude');
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: vaultDir,
    });
    excludePath = resolve(vaultDir, String(stdout).trim());
  } catch {
    // Preserve support for repositories represented by a local .git directory.
  }
  let existingContent = '';

  try {
    existingContent = await readFile(excludePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const lines = existingContent
    .split(/\r?\n/u)
    .map((line) => line.trim());
  if (lines.includes('.collabmd') || lines.includes('.collabmd/')) {
    return;
  }

  const prefix = existingContent && !existingContent.endsWith('\n') ? '\n' : '';
  await writeFile(excludePath, `${existingContent}${prefix}.collabmd/\n`, 'utf8');
}
