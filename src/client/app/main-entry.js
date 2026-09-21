import { CollabMdAppShell } from '../bootstrap/collabmd-app-shell.js';
import { ensureClientAuthenticated } from '../infrastructure/auth-client.js';
import { getRuntimeConfig, initializeWorkspaceUrl, setActiveVaultId } from '../infrastructure/runtime-config.js';
import { renderVaultDashboard } from '../presentation/vault-dashboard.js';
import '../styles/style.css';

async function start() {
  await ensureClientAuthenticated();
  const config = getRuntimeConfig();
  const url = new URL(window.location.href);
  if (config.vaultDashboard && config.vaults.length > 1
    && !url.searchParams.has('vault') && !url.searchParams.has('file') && !url.hash) {
    renderVaultDashboard({
      container: document.getElementById('workspaceLoading'),
      vaults: config.vaults,
      getVaultUrl: (vaultId) => {
        const target = new URL(url);
        target.searchParams.set('vault', vaultId);
        return target.toString();
      },
      onSelect: setActiveVaultId,
    });
    return;
  }
  initializeWorkspaceUrl();
  const app = new CollabMdAppShell();
  await app.initialize();
  delete document.documentElement.dataset.workspaceLoading;
  document.getElementById('workspaceLoading')?.remove();
}

function startWorkspace() {
  void start().catch(() => {
    const status = document.getElementById('workspaceLoading');
    if (status) status.textContent = 'Unable to open the workspace. Reload to try again.';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startWorkspace, { once: true });
} else {
  startWorkspace();
}
