import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const composeFile = resolve(projectRoot, 'docker-compose.yml');
const services = {
  plantuml: { label: 'PlantUML', portName: 'PLANTUML_HOST_PORT', defaultPort: '18080' },
  structurizr: { label: 'Structurizr', portName: 'STRUCTURIZR_HOST_PORT', defaultPort: '19090' },
};

function getService(service) {
  const config = services[service];
  if (!config) throw new Error(`Unknown local Compose service: ${service}`);
  return config;
}

function getHostPort(service) {
  const { portName, defaultPort } = getService(service);
  const rawValue = process.env[portName] || defaultPort;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${portName}: ${rawValue}`);
  }
  return parsed;
}

export function getLocalComposeServerUrl(service) {
  return `http://127.0.0.1:${getHostPort(service)}`;
}

function runCompose(command, service, env = process.env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('docker', ['compose', '-f', composeFile, command, ...(command === 'up' ? ['-d'] : []), service], {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`docker compose ${command} ${service} exited with code ${code}`));
    });
  });
}

export async function startLocalComposeService(service, { vaultDir = process.env.COLLABMD_VAULT_DIR || '.' } = {}) {
  getService(service);
  let env = process.env;
  if (service === 'structurizr') {
    const hostVaultDir = resolve(vaultDir);
    await mkdir(resolve(hostVaultDir, '.collabmd/structurizr'), { recursive: true });
    env = {
      ...process.env,
      HOST_VAULT_DIR: hostVaultDir,
      STRUCTURIZR_HOST_PORT: String(getHostPort(service)),
    };
  }
  await runCompose('up', service, env);
  return getLocalComposeServerUrl(service);
}

export async function stopLocalComposeService(service) {
  getService(service);
  await runCompose('stop', service);
}

async function main() {
  const service = process.argv[2];
  const command = process.argv[3] || 'up';
  if (!services[service] || !['up', 'down', 'url'].includes(command)) {
    console.error('Usage: node scripts/local-compose.mjs [plantuml|structurizr] [up|down|url]');
    process.exit(1);
  }

  if (command === 'url') {
    console.log(getLocalComposeServerUrl(service));
    return;
  }
  if (command === 'up') {
    const url = await startLocalComposeService(service);
    console.log(`[${service}] Local ${services[service].label} ${service === 'plantuml' ? 'server' : 'renderer'} is available at ${url}`);
    return;
  }
  await stopLocalComposeService(service);
  console.log(`[${service}] Local ${services[service].label} server stopped`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    const service = process.argv[2];
    if (error.code === 'ENOENT') {
      console.error(`[${service}] Docker is not available. Install Docker Desktop or Docker Engine first.`);
    } else {
      console.error(`[${service}] ${error.message}`);
    }
    process.exit(1);
  });
}
