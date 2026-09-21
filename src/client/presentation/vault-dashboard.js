import { findFuzzyMatch } from '../domain/file-search.js';

export function renderVaultDashboard({ container, vaults, getVaultUrl, onSelect }) {
  container.removeAttribute('role');
  container.classList.add('vault-dashboard');
  container.innerHTML = `
    <main class="vault-dashboard-card" aria-labelledby="vaultDashboardTitle">
      <header class="vault-dashboard-header">
        <div class="sidebar-brand">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="17" height="24" rx="3" stroke="var(--color-primary)" stroke-width="2"></rect>
            <rect x="12" y="4" width="17" height="24" rx="3" fill="var(--color-primary)"></rect>
            <path d="M17 12h7m-7 4h7m-7 4h4" stroke="var(--color-primary-contrast)" stroke-width="1.5"></path>
          </svg>
          <span class="sidebar-title">CollabMD</span>
        </div>
        <h1 id="vaultDashboardTitle">Choose a vault</h1>
        <p>Open a project to start collaborating.</p>
      </header>
      <div class="vault-dashboard-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
        <input type="search" class="ui-input" aria-label="Find a vault" placeholder="Find a vault…">
      </div>
      <div class="vault-dashboard-list-heading">
        <h2>Your vaults</h2>
        <span class="ui-pill-badge ui-pill-badge--count ui-pill-badge--muted"></span>
      </div>
      <nav aria-label="Vaults"></nav>
      <p class="ui-empty-state" role="status" hidden>No matching vaults.</p>
      <footer class="vault-dashboard-footer">Press <kbd>Enter</kbd> to open the first match</footer>
    </main>`;
  container.querySelector('.ui-pill-badge').textContent = String(vaults.length);
  const list = container.querySelector('nav');
  const empty = container.querySelector('[role="status"]');
  const entries = vaults.map((vault) => {
    const link = document.createElement('a');
    link.className = 'ui-record-surface vault-dashboard-link';
    link.href = getVaultUrl(vault.id);
    link.innerHTML = `
      <span class="vault-dashboard-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></span>
      <span class="vault-dashboard-name"></span>
      <svg class="vault-dashboard-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"></path></svg>`;
    link.querySelector('.vault-dashboard-name').textContent = vault.name || vault.id;
    link.addEventListener('click', () => onSelect?.(vault.id));
    list.append(link);
    return { link, text: `${vault.name || vault.id} ${vault.id}`.toLowerCase() };
  });
  const input = container.querySelector('input');
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    entries.forEach(({ link, text }) => {
      link.hidden = Boolean(query && !text.includes(query) && !findFuzzyMatch(text, query));
    });
    empty.hidden = entries.some(({ link }) => !link.hidden);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      entries.find(({ link }) => !link.hidden)?.link.click();
    }
  });
  input.focus();
}
