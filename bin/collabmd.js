#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve, basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    auth: { type: 'string' },
    'auth-password': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
    'local-plantuml': { type: 'boolean', default: false },
    port: { type: 'string', short: 'p', default: '1234' },
    host: { type: 'string' },
    'no-tunnel': { type: 'boolean', default: false },
    tunnel: { type: 'boolean', default: true },
    version: { type: 'boolean', short: 'v', default: false },
  },
  strict: false,
});

if (values.version) {
  const packagePath = resolve(fileURLToPath(import.meta.url), '../../package.json');
  const { default: pkg } = await import(packagePath, { with: { type: 'json' } });
  console.log(`collabmd v${pkg.version}`);
  process.exit(0);
}

if (values.help) {
  console.log(`
  CollabMD — Collaborative Markdown Vault

  Usage:
    collabmd [directory] [options]

  Arguments:
    directory            Path to vault directory (default: current directory)

  Options:
    -p, --port <port>    Port to listen on (default: 1234)
    --host <host>        Host to bind to (default: HOST env var, otherwise 127.0.0.1)
    --auth <strategy>    Auth strategy: none, password, oidc (default: none)
    --auth-password <pw> Password for --auth password (default: generated per run)
    --local-plantuml     Start the bundled docker-compose PlantUML service and use it
    --no-tunnel          Don't start Cloudflare Tunnel
    -v, --version        Show version
    -h, --help           Show this help

  Examples:
    collabmd                        Serve current directory
    collabmd ~/my-vault             Serve a specific vault
    collabmd --port 3000            Use a custom port
    collabmd --auth password        Require a generated password to join
    collabmd --local-plantuml       Use the local docker-compose PlantUML server
    collabmd --no-tunnel            Local only, no tunnel
`);
  process.exit(0);
}

const vaultPath = resolve(positionals[0] || '.');
const port = parseInt(values.port ?? process.env.PORT ?? '1234', 10) || 1234;
const host = values.host || process.env.HOST || '127.0.0.1';
const enableTunnel = !values['no-tunnel'];
const useLocalPlantUml = values['local-plantuml'];

try {
  const stats = await stat(vaultPath);
  if (!stats.isDirectory()) {
    console.error(`Error: "${vaultPath}" is not a directory.`);
    process.exit(1);
  }
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error(`Error: Directory "${vaultPath}" does not exist.`);
  } else {
    console.error(`Error: Cannot access "${vaultPath}": ${error.message}`);
  }
  process.exit(1);
}

process.env.COLLABMD_VAULT_DIR = vaultPath;
process.env.PORT = String(port);
process.env.HOST = host;

if (values.auth) {
  process.env.AUTH_STRATEGY = values.auth;
}

if (values['auth-password']) {
  process.env.AUTH_PASSWORD = values['auth-password'];
}

if (useLocalPlantUml) {
  const {
    getLocalPlantUmlServerUrl,
    startLocalPlantUmlComposeService,
  } = await import('../scripts/local-plantuml-compose.mjs');

  try {
    const localPlantUmlUrl = getLocalPlantUmlServerUrl();
    console.log(`  PlantUML: starting local docker-compose service at ${localPlantUmlUrl}...`);
    await startLocalPlantUmlComposeService();
    process.env.PLANTUML_SERVER_URL = localPlantUmlUrl;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('Error: Docker is not available. Install Docker Desktop or Docker Engine first.');
    } else {
      console.error(`Error: Failed to start local PlantUML service: ${error.message}`);
    }
    process.exit(1);
  }
}

const { createAppServer } = await import('../src/server/create-app-server.js');
const { loadConfig } = await import('../src/server/config/env.js');

const config = loadConfig({ vaultDir: vaultPath });
if (config.auth.strategy === 'password') {
  process.env.AUTH_PASSWORD = config.auth.password;
  process.env.AUTH_STRATEGY = 'password';
}
const server = createAppServer(config);

let shutdownPromise = null;
let tunnelProcess = null;

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;

  console.log(`\n  Shutting down...`);

  const forceExitTimer = setTimeout(() => {
    tunnelProcess?.kill('SIGKILL');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref?.();

  if (tunnelProcess && tunnelProcess.exitCode === null && !tunnelProcess.killed) {
    tunnelProcess.kill('SIGINT');
  }

  shutdownPromise = server.close()
    .then(() => {
      clearTimeout(forceExitTimer);
      process.exit(0);
    })
    .catch((error) => {
      clearTimeout(forceExitTimer);
      console.error(`  Shutdown error: ${error.message}`);
      process.exit(1);
    });

  return shutdownPromise;
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  const info = await server.listen();
  const vaultName = basename(vaultPath);
  const fileCount = server.vaultFileCount ?? 0;

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║           CollabMD v0.1.0            ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  Vault:  ${vaultPath} (${fileCount} markdown files)`);
  console.log(`  Local:  http://${info.host}:${info.port}`);
  console.log(`  PlantUML: ${config.plantumlServerUrl}`);
  if (config.auth.strategy === 'password') {
    console.log(`  Auth:   password`);
    console.log(`  Secret: ${config.auth.password}`);
    if (config.auth.passwordWasGenerated) {
      console.log('          Generated for this host run only');
    }
  } else if (config.auth.strategy === 'oidc') {
    console.log('  Auth:   oidc (not implemented yet)');
  } else {
    console.log('  Auth:   none');
  }

  if (enableTunnel) {
    console.log('  Tunnel: starting...');

    const scriptDir = resolve(fileURLToPath(import.meta.url), '../../scripts/cloudflare-tunnel.mjs');
    tunnelProcess = spawn(process.execPath, [scriptDir], {
      env: {
        ...process.env,
        TUNNEL_TARGET_HOST: host === '0.0.0.0' ? '127.0.0.1' : host,
        TUNNEL_TARGET_PORT: String(info.port),
      },
      stdio: 'inherit',
    });

    tunnelProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        console.log('  Tunnel: cloudflared not found — skipping tunnel');
        console.log('          Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
      } else {
        console.log(`  Tunnel: failed — ${error.message}`);
      }
    });

    tunnelProcess.on('exit', (code) => {
      if (!shutdownPromise && code !== 0) {
        console.log('  Tunnel: exited unexpectedly');
      }
    });
  } else {
    console.log('  Tunnel: disabled');
  }

  console.log('');
  console.log('  Ready for collaboration. Press Ctrl+C to stop.');
  console.log('');
} catch (error) {
  console.error(`  Failed to start: ${error.message}`);
  process.exit(1);
}
