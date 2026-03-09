import { CollabMdApp } from './application/collabmd-app.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';

async function start() {
  await ensureClientAuthenticated();
  const app = new CollabMdApp();
  app.initialize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void start();
  }, { once: true });
} else {
  void start();
}
