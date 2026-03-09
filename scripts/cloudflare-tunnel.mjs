import { spawn } from 'child_process';
import readline from 'readline';

function getCloudflaredCommand() {
  return process.env.CLOUDFLARED_BIN || 'cloudflared';
}

function getTunnelTargetUrl() {
  if (process.env.TUNNEL_TARGET_URL) {
    return process.env.TUNNEL_TARGET_URL;
  }

  const host = process.env.TUNNEL_TARGET_HOST || process.env.HOST || '127.0.0.1';
  const port = process.env.TUNNEL_TARGET_PORT || process.env.PORT || '1234';

  return `http://${host}:${port}`;
}

function getTunnelArgs(targetUrl) {
  const customArgs = (process.env.CLOUDFLARED_EXTRA_ARGS || '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return ['tunnel', '--url', targetUrl, ...customArgs];
}

const targetUrl = getTunnelTargetUrl();
const cloudflaredCommand = getCloudflaredCommand();
const cloudflaredArgs = getTunnelArgs(targetUrl);
let shutdownStarted = false;
let forceExitTimer = null;
let shareLinkLogged = false;

console.log(`[tunnel] Starting Cloudflare Tunnel for ${targetUrl}`);

function buildShareUrl(publicUrl) {
  if (process.env.AUTH_STRATEGY !== 'password' || !process.env.AUTH_PASSWORD) {
    return null;
  }

  try {
    const shareUrl = new URL(publicUrl);
    shareUrl.hash = new URLSearchParams({
      auth_password: process.env.AUTH_PASSWORD,
    }).toString();
    return shareUrl.toString();
  } catch {
    return null;
  }
}

function maybeLogShareLink(line) {
  if (shareLinkLogged) {
    return;
  }

  const match = String(line).match(/https:\/\/[a-z0-9.-]+\.trycloudflare\.com\b/i);
  if (!match) {
    return;
  }

  const shareUrl = buildShareUrl(match[0]);
  if (!shareUrl) {
    return;
  }

  shareLinkLogged = true;
  console.log(`[tunnel] Share URL: ${shareUrl}`);
  console.log('[tunnel] The password is stored in the URL fragment. It is not sent to the server, but anyone with the full URL can use it.');
}

const child = spawn(cloudflaredCommand, cloudflaredArgs, {
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

const stdoutInterface = readline.createInterface({ input: child.stdout });
stdoutInterface.on('line', (line) => {
  console.log(line);
  maybeLogShareLink(line);
});

const stderrInterface = readline.createInterface({ input: child.stderr });
stderrInterface.on('line', (line) => {
  console.error(line);
  maybeLogShareLink(line);
});

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error(`[tunnel] Could not find "${cloudflaredCommand}". Install Cloudflare Tunnel first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
  } else {
    console.error('[tunnel] Failed to start Cloudflare Tunnel:', error.message);
  }

  process.exit(1);
});

function shutdown(signal) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  console.log(`[tunnel] Received ${signal}, shutting down`);

  if (child.exitCode === null && !child.killed) {
    child.kill(signal);
  }

  forceExitTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }

    process.exit(1);
  }, 5000);
  forceExitTimer.unref?.();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  stdoutInterface.close();
  stderrInterface.close();

  if (forceExitTimer) {
    clearTimeout(forceExitTimer);
  }

  if (shutdownStarted) {
    process.exit(code ?? 0);
    return;
  }

  if (signal) {
    console.error(`[tunnel] Cloudflare Tunnel exited from signal ${signal}`);
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});
