import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER_BYTES = 5 * 1024 * 1024;

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function createCleanup(...handlers) {
  let settled = false;

  return async function cleanup() {
    if (settled) {
      return;
    }

    settled = true;
    await Promise.allSettled(handlers.map((handler) => handler?.()));
  };
}

function createGitEnv(commandEnv = {}, extraEnv = {}) {
  return {
    ...process.env,
    ...(commandEnv ?? {}),
    ...(extraEnv ?? {}),
  };
}

async function execGit(args, {
  commandEnv = {},
  cwd = undefined,
  execFileImpl = execFile,
} = {}) {
  const result = await execFileImpl('git', args, {
    cwd,
    encoding: 'utf8',
    env: createGitEnv(commandEnv),
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    timeout: GIT_TIMEOUT_MS,
  });

  return String(result.stdout ?? '');
}

async function pathExists(pathValue) {
  try {
    await stat(pathValue);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function isDirectory(pathValue) {
  try {
    const stats = await stat(pathValue);
    return stats.isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function ensureDirectory(pathValue) {
  await mkdir(pathValue, { recursive: true });
}

async function isDirectoryEmpty(pathValue) {
  const entries = await readdir(pathValue);
  return entries.length === 0;
}

async function isGitRepository(vaultDir, options = {}) {
  try {
    const output = await execGit(['rev-parse', '--is-inside-work-tree'], {
      ...options,
      cwd: vaultDir,
    });
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

function parseRemoteDefaultBranch(output) {
  const lines = String(output ?? '').split(/\r?\n/u);

  for (const line of lines) {
    const match = line.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/u);
    if (match) {
      return match[1];
    }
  }

  throw new Error('Failed to resolve remote default branch.');
}

async function resolveRemoteDefaultBranch(repoUrl, options = {}) {
  const output = await execGit(['ls-remote', '--symref', repoUrl, 'HEAD'], options);
  return parseRemoteDefaultBranch(output);
}

async function getOriginUrl(vaultDir, options = {}) {
  return (await execGit(['remote', 'get-url', 'origin'], {
    ...options,
    cwd: vaultDir,
  })).trim();
}

async function hasCleanWorkingTree(vaultDir, options = {}) {
  const status = await execGit(['status', '--porcelain=v1', '--untracked-files=all'], {
    ...options,
    cwd: vaultDir,
  });

  return status.trim().length === 0;
}

async function localBranchExists(vaultDir, branchName, options = {}) {
  try {
    await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      ...options,
      cwd: vaultDir,
    });
    return true;
  } catch {
    return false;
  }
}

async function cloneIntoVault(vaultDir, repoUrl, options = {}) {
  await ensureDirectory(vaultDir);
  await execGit(['clone', repoUrl, '.'], {
    ...options,
    cwd: vaultDir,
  });
}

async function ensureLocalGitIgnore(vaultDir) {
  const excludeFilePath = join(vaultDir, '.git', 'info', 'exclude');
  let existingContent = '';

  try {
    existingContent = await readFile(excludeFilePath, 'utf8');
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

  const prefix = existingContent.length > 0 && !existingContent.endsWith('\n')
    ? '\n'
    : '';
  await writeFile(
    excludeFilePath,
    `${existingContent}${prefix}.collabmd/\n`,
    'utf8',
  );
}

async function updateExistingCheckout(vaultDir, repoUrl, options = {}) {
  const originUrl = await getOriginUrl(vaultDir, options);
  if (originUrl !== repoUrl) {
    throw new Error(
      `Refusing to reuse "${vaultDir}" because origin "${originUrl}" does not match configured repo "${repoUrl}".`,
    );
  }

  if (!(await hasCleanWorkingTree(vaultDir, options))) {
    return {
      syncSkipped: true,
    };
  }

  const defaultBranch = await resolveRemoteDefaultBranch(repoUrl, options);

  await execGit(['fetch', '--prune', 'origin'], {
    ...options,
    cwd: vaultDir,
  });

  if (await localBranchExists(vaultDir, defaultBranch, options)) {
    await execGit(['checkout', defaultBranch], {
      ...options,
      cwd: vaultDir,
    });
  } else {
    await execGit(['checkout', '-b', defaultBranch, '--track', `origin/${defaultBranch}`], {
      ...options,
      cwd: vaultDir,
    });
  }

  await execGit(['pull', '--ff-only', 'origin', defaultBranch], {
    ...options,
    cwd: vaultDir,
  });

  return {
    syncSkipped: false,
  };
}

async function createPrivateKeyFile(config) {
  if (config.remote.sshPrivateKeyFile) {
    const providedContent = await readFile(config.remote.sshPrivateKeyFile, 'utf8');
    if (!providedContent.trim()) {
      throw new Error('COLLABMD_GIT_SSH_PRIVATE_KEY_FILE points to an empty file.');
    }

    return {
      cleanup: async () => {},
      path: config.remote.sshPrivateKeyFile,
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'collabmd-git-key-'));
  const tempFile = join(tempDir, 'id_ed25519');
  const decodedKey = Buffer.from(config.remote.sshPrivateKeyBase64, 'base64').toString('utf8').trim();

  if (!decodedKey) {
    await rm(tempDir, { force: true, recursive: true });
    throw new Error('COLLABMD_GIT_SSH_PRIVATE_KEY_B64 did not decode into a usable key.');
  }

  await writeFile(tempFile, `${decodedKey}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  return {
    cleanup: createCleanup(async () => {
      await rm(tempDir, { force: true, recursive: true });
    }),
    path: tempFile,
  };
}

function buildGitSshCommand({
  knownHostsFile,
  privateKeyPath,
}) {
  const commandParts = [
    'ssh',
    '-i',
    quoteShellArg(privateKeyPath),
    '-o',
    quoteShellArg('IdentitiesOnly=yes'),
    '-o',
    quoteShellArg('BatchMode=yes'),
    '-o',
    quoteShellArg('LogLevel=ERROR'),
  ];

  if (knownHostsFile) {
    commandParts.push('-o', quoteShellArg(`StrictHostKeyChecking=yes`));
    commandParts.push('-o', quoteShellArg(`UserKnownHostsFile=${knownHostsFile}`));
  } else {
    commandParts.push('-o', quoteShellArg('StrictHostKeyChecking=accept-new'));
  }

  return commandParts.join(' ');
}

function buildGitIdentityEnv(identity = {}) {
  const name = String(identity.name ?? '').trim();
  const email = String(identity.email ?? '').trim();

  if (!name || !email) {
    return {};
  }

  return {
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_NAME: name,
  };
}

async function prepareGitCommandEnv(config) {
  const identityEnv = buildGitIdentityEnv(config.identity);

  if (!config.remote.enabled) {
    return {
      cleanup: async () => {},
      commandEnv: Object.keys(identityEnv).length > 0 ? identityEnv : null,
    };
  }

  const privateKeyFile = await createPrivateKeyFile(config);
  const cleanup = createCleanup(privateKeyFile.cleanup);

  return {
    cleanup,
    commandEnv: {
      ...identityEnv,
      GIT_SSH_COMMAND: buildGitSshCommand({
        knownHostsFile: config.remote.sshKnownHostsFile,
        privateKeyPath: privateKeyFile.path,
      }),
      GIT_TERMINAL_PROMPT: '0',
    },
  };
}

async function ensureRepositoryIdentity(vaultDir, config, options = {}) {
  const name = String(config.identity?.name ?? '').trim();
  const email = String(config.identity?.email ?? '').trim();

  if (!name || !email) {
    return;
  }

  await execGit(['config', 'user.name', name], {
    ...options,
    cwd: vaultDir,
  });
  await execGit(['config', 'user.email', email], {
    ...options,
    cwd: vaultDir,
  });
}

export async function prepareConfigForStartup(config, options = {}) {
  const gitConfig = config.git ?? {
    cleanup: null,
    commandEnv: null,
    enabled: config.gitEnabled !== false,
    remote: {
      enabled: false,
      repoUrl: '',
      sshKnownHostsFile: '',
      sshPrivateKeyBase64: '',
      sshPrivateKeyFile: '',
    },
  };
  let runtimeCleanup = async () => {};

  try {
    const runtime = await prepareGitCommandEnv(gitConfig);
    runtimeCleanup = runtime.cleanup;

    config.git = {
      ...gitConfig,
      cleanup: runtime.cleanup,
      commandEnv: runtime.commandEnv,
    };
    config.gitEnabled = config.git.enabled;

    if (!config.git.remote.enabled) {
      return config;
    }

    if (await pathExists(config.vaultDir)) {
      if (!(await isDirectory(config.vaultDir))) {
        throw new Error(`Vault path "${config.vaultDir}" exists but is not a directory.`);
      }

      if (await isGitRepository(config.vaultDir, options)) {
        const checkoutState = await updateExistingCheckout(config.vaultDir, config.git.remote.repoUrl, {
          ...options,
          commandEnv: config.git.commandEnv,
        });
        await ensureLocalGitIgnore(config.vaultDir);
        await ensureRepositoryIdentity(config.vaultDir, config.git, {
          ...options,
          commandEnv: config.git.commandEnv,
        });

        if (checkoutState?.syncSkipped) {
          console.warn(
            `Skipping git sync for "${config.vaultDir}" because the existing checkout has uncommitted changes.`,
          );
        }

        return config;
      }

      if (await isDirectoryEmpty(config.vaultDir)) {
        await cloneIntoVault(config.vaultDir, config.git.remote.repoUrl, {
          ...options,
          commandEnv: config.git.commandEnv,
        });
        await ensureLocalGitIgnore(config.vaultDir);
        await ensureRepositoryIdentity(config.vaultDir, config.git, {
          ...options,
          commandEnv: config.git.commandEnv,
        });
        return config;
      }

      throw new Error(
        `Refusing to initialize "${config.vaultDir}" because it is not empty and is not a git repository.`,
      );
    }

    await ensureDirectory(dirname(config.vaultDir));
    await cloneIntoVault(config.vaultDir, config.git.remote.repoUrl, {
      ...options,
      commandEnv: config.git.commandEnv,
    });
    await ensureLocalGitIgnore(config.vaultDir);
    await ensureRepositoryIdentity(config.vaultDir, config.git, {
      ...options,
      commandEnv: config.git.commandEnv,
    });
    return config;
  } catch (error) {
    await runtimeCleanup();
    throw error;
  }
}
