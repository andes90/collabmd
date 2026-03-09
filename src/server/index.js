#!/usr/bin/env node

import { loadConfig } from './config/env.js';
import { createAppServer } from './create-app-server.js';

let shutdownPromise = null;
const server = createAppServer(loadConfig());

function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  console.log(`[server] Received ${signal}, shutting down`);

  const forceExitTimer = setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref?.();

  shutdownPromise = server.close()
    .then(() => {
      clearTimeout(forceExitTimer);
      process.exit(0);
    })
    .catch((error) => {
      clearTimeout(forceExitTimer);
      console.error('[server] Shutdown error:', error.message);
      process.exit(1);
    });

  return shutdownPromise;
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

server.listen().then(({ host, port, wsPath }) => {
  console.log('');
  console.log('  CollabMD Vault Server');
  console.log(`  http://${host}:${port}`);
  console.log(`  ws route: ${wsPath}`);
  console.log(`  vault: ${server.config.vaultDir}`);
  console.log(`  files: ${server.vaultFileCount} vault files`);
  if (server.config.auth.strategy === 'password') {
    console.log(`  auth: password (${server.config.auth.password})`);
  } else if (server.config.auth.strategy === 'oidc') {
    console.log('  auth: oidc (not implemented yet)');
  } else {
    console.log('  auth: none');
  }
  console.log('');
}).catch((error) => {
  console.error('[server] Failed to start:', error.message);
  process.exit(1);
});
