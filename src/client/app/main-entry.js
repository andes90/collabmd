import { CollabMdAppShell } from '../bootstrap/collabmd-app-shell.js';
import { ensureClientAuthenticated } from '../infrastructure/auth-client.js';
import '../styles/style.css';

async function start() {
  await ensureClientAuthenticated();
  const app = new CollabMdAppShell();
  await app.initialize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void start();
  }, { once: true });
} else {
  void start();
}
