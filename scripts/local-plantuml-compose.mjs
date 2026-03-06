import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const projectRoot = resolve(scriptDir, '..');
const composeFile = resolve(projectRoot, 'docker-compose.yml');

function runCommand(command, args, { env = process.env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export function getLocalPlantUmlHostPort() {
  const rawValue = process.env.PLANTUML_HOST_PORT || '18080';
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PLANTUML_HOST_PORT: ${rawValue}`);
  }

  return parsed;
}

export function getLocalPlantUmlServerUrl() {
  return `http://127.0.0.1:${getLocalPlantUmlHostPort()}`;
}

function getComposeArgs(command) {
  return ['compose', '-f', composeFile, ...command];
}

export async function startLocalPlantUmlComposeService() {
  await runCommand('docker', getComposeArgs(['up', '-d', 'plantuml']));
  return getLocalPlantUmlServerUrl();
}

export async function stopLocalPlantUmlComposeService() {
  await runCommand('docker', getComposeArgs(['stop', 'plantuml']));
}

async function main() {
  const command = process.argv[2] || 'up';

  if (command === 'up') {
    const url = await startLocalPlantUmlComposeService();
    console.log(`[plantuml] Local PlantUML server is available at ${url}`);
    return;
  }

  if (command === 'down') {
    await stopLocalPlantUmlComposeService();
    console.log('[plantuml] Local PlantUML server stopped');
    return;
  }

  if (command === 'url') {
    console.log(getLocalPlantUmlServerUrl());
    return;
  }

  console.error('Usage: node scripts/local-plantuml-compose.mjs [up|down|url]');
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    if (error.code === 'ENOENT') {
      console.error('[plantuml] Docker is not available. Install Docker Desktop or Docker Engine first.');
    } else {
      console.error(`[plantuml] ${error.message}`);
    }

    process.exit(1);
  });
}
