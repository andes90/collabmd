import {
  createAgentSetup,
  createAgentTokenExport,
} from '../domain/agent-connection-setup.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

export class AgentConnectionController {
  constructor({ apiClient, closeToolbarMenu, content, dialog, runtimeConfig, toastController, trigger }) {
    this.apiClient = apiClient;
    this.closeToolbarMenu = closeToolbarMenu;
    this.content = content;
    this.dialog = dialog;
    this.runtimeConfig = runtimeConfig;
    this.toastController = toastController;
    this.trigger = trigger;
    this.secretToken = '';
    this.config = {
      authRequired: runtimeConfig.auth?.strategy !== 'none',
      endpoint: runtimeConfig.agentAccess?.endpoint || '',
      managed: Boolean(runtimeConfig.agentAccess?.managed),
    };
    this.endpoint = new URL(this.config.endpoint, window.location.origin).toString();

    this.trigger?.classList.toggle('hidden', !runtimeConfig.agentAccess?.enabled);
    this.trigger?.addEventListener('click', () => void this.open());
    this.dialog?.addEventListener('close', () => {
      this.secretToken = '';
      this.content?.replaceChildren();
      this.trigger?.focus?.();
    });
    this.dialog?.addEventListener('click', (event) => void this.handleClick(event));
    this.dialog?.addEventListener('submit', (event) => void this.handleSubmit(event));
  }

  async open() {
    this.closeToolbarMenu?.();
    this.dialog?.showModal?.();
    this.renderStatus('Loading Agent Access…');
    try {
      const connections = this.config.managed
        ? (await this.apiClient.listConnections()).connections
        : [];
      this.renderOverview(connections);
    } catch (error) {
      this.renderStatus(error.message || 'Failed to load Agent Access', { error: true });
    }
  }

  renderStatus(message, { error = false } = {}) {
    if (!this.content) return;
    this.content.innerHTML = `<p class="agent-connection-status${error ? ' is-error' : ''}" role="status">${escapeHtml(message)}</p>`;
  }

  renderOverview(connections = []) {
    const connectionMarkup = connections.length > 0
      ? connections.map((connection) => `
        <article class="agent-connection-card">
          <div>
            <strong>${escapeHtml(connection.label)}</strong>
            <span>${escapeHtml(connection.clientKind)} · ${escapeHtml(connection.scopes.join(', '))}</span>
            <small>Expires ${escapeHtml(formatDate(connection.expiresAt))}</small>
          </div>
          <button class="ui-button ui-button--secondary ui-button--compact" type="button" data-agent-revoke="${escapeHtml(connection.id)}">Revoke</button>
        </article>
      `).join('')
      : `
        <div class="agent-connection-empty">
          <strong>Connect your first agent</strong>
          <p>Choose its access, create a secure token, then copy the setup into your agent.</p>
        </div>
      `;
    const management = this.config.managed
      ? `<button class="ui-button ui-button--primary" type="button" data-agent-create>${connections.length > 0 ? 'New connection' : 'Start setup'}</button>`
      : `
        <section class="agent-connection-empty">
          <strong>No authentication required</strong>
          <ol class="agent-connection-steps">
            <li>Copy the connection details below into your agent.</li>
            <li>Add this CollabMD MCP endpoint and restart the agent.</li>
            <li>Anyone who can reach this no-auth workspace can use its read and edit tools.</li>
          </ol>
        </section>
      `;
    const connectionsSection = this.config.managed
      ? `
        <section class="agent-connection-section">
          <h3>Connections</h3>
          <div class="agent-connection-list">${connectionMarkup}</div>
        </section>
      `
      : '';
    this.content.innerHTML = `
      ${connectionsSection}
      ${this.config.managed ? '' : management}
      <details class="agent-connection-details">
        <summary>Connection details</summary>
        <code>${escapeHtml(this.endpoint)}</code>
        <p>Streamable HTTP · ${this.config.authRequired ? 'Bearer token' : 'No authentication'} · Read and edit tools</p>
      </details>
      <div class="agent-connection-actions">
        ${this.config.managed ? management : '<button class="ui-button ui-button--primary" type="button" data-agent-copy-setup="generic">Copy connection details</button>'}
        <button class="ui-button ui-button--ghost" type="button" data-agent-close>Close</button>
      </div>
      <p class="agent-connection-live" role="status" aria-live="polite"></p>
    `;
  }

  renderCreate() {
    this.content.innerHTML = `
      <form class="agent-connection-form" data-agent-create-form>
        <header class="agent-connection-step-header">
          <span>Step 1 of 2</span>
          <h3>Choose an agent and its access</h3>
          <p>You can revoke this connection at any time.</p>
        </header>
        <label class="app-dialog-field">
          <span class="app-dialog-label">Agent</span>
          <select class="ui-input" name="clientKind">
            <option value="codex">Codex</option>
            <option value="pi">Pi</option>
            <option value="generic">Generic MCP</option>
          </select>
        </label>
        <label class="app-dialog-field">
          <span class="app-dialog-label">Connection name</span>
          <input class="ui-input" name="label" maxlength="80" value="My Codex" required>
        </label>
        <fieldset class="agent-connection-scopes">
          <legend>Access</legend>
          <label><input type="checkbox" checked disabled> Read Vault Content</label>
          <label><input type="checkbox" name="edit" checked> Edit and create supported text files</label>
        </fieldset>
        <p class="agent-connection-note">Token expires after 30 days and can be revoked here. Delete, rename, Git, and publish are not exposed.</p>
        <div class="agent-connection-actions">
          <button class="ui-button ui-button--secondary" type="button" data-agent-back>Back</button>
          <button class="ui-button ui-button--primary" type="submit">Create secure token</button>
        </div>
        <p class="agent-connection-live" role="status" aria-live="polite"></p>
      </form>
    `;
  }

  renderToken({ connection, token }) {
    this.secretToken = token;
    const setup = createAgentSetup({
      authRequired: this.config.authRequired,
      clientKind: connection.clientKind,
      endpoint: this.endpoint,
    });
    const clientName = connection.clientKind === 'codex'
      ? 'Codex'
      : connection.clientKind === 'pi' ? 'Pi' : 'your MCP client';
    this.content.innerHTML = `
      <header class="agent-connection-step-header">
        <span>Step 2 of 2</span>
        <h3>Finish setup in ${escapeHtml(clientName)}</h3>
        <p class="agent-connection-warning">The token is shown once. Finish these steps before closing.</p>
      </header>
      <ol class="agent-connection-steps agent-connection-steps--setup">
        <li>
          <div><strong>Save the access token</strong><span>Run the copied command in the terminal that starts ${escapeHtml(clientName)}.</span></div>
          <button class="ui-button ui-button--primary" type="button" data-agent-copy-token>Copy token command</button>
        </li>
        <li>
          <div><strong>Add this workspace</strong><span>Paste the setup into ${escapeHtml(clientName)}.</span></div>
          <button class="ui-button ui-button--secondary" type="button" data-agent-copy-setup="${escapeHtml(connection.clientKind)}">Copy ${escapeHtml(clientName)} setup</button>
        </li>
      </ol>
      <details class="agent-connection-details">
        <summary>View manual setup</summary>
        <input class="ui-input agent-connection-token" value="${escapeHtml(token)}" readonly aria-label="Agent Connection token">
        <pre><code>${escapeHtml(setup)}</code></pre>
      </details>
      <div class="agent-connection-actions">
        <button class="ui-button ui-button--primary" type="button" data-agent-close>Done</button>
      </div>
      <p class="agent-connection-live" role="status" aria-live="polite"></p>
    `;
  }

  async refresh() {
    const connections = this.config.managed
      ? (await this.apiClient.listConnections()).connections
      : [];
    this.renderOverview(connections);
  }

  setLiveMessage(message) {
    const live = this.content?.querySelector('.agent-connection-live');
    if (live) live.textContent = message;
  }

  async copy(text, message) {
    await navigator.clipboard.writeText(text);
    this.setLiveMessage(message);
  }

  async handleClick(event) {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.agentClose != null) {
      this.dialog.close();
      return;
    }
    if (target.dataset.agentCreate != null) {
      this.renderCreate();
      return;
    }
    if (target.dataset.agentBack != null) {
      await this.refresh();
      return;
    }
    if (target.dataset.agentCopyToken != null) {
      await this.copy(createAgentTokenExport(this.secretToken), 'Token command copied — run it in the agent terminal.');
      return;
    }
    if (target.dataset.agentCopySetup != null) {
      await this.copy(createAgentSetup({
        authRequired: this.config.authRequired,
        clientKind: target.dataset.agentCopySetup,
        endpoint: this.endpoint,
      }), 'Setup copied — add it to your agent.');
      return;
    }
    if (target.dataset.agentRevoke) {
      if (!window.confirm('Revoke this Agent Connection?')) return;
      try {
        await this.apiClient.revokeConnection(target.dataset.agentRevoke);
        await this.refresh();
        this.setLiveMessage('Agent Connection revoked');
      } catch (error) {
        this.toastController?.show(error.message || 'Failed to revoke Agent Connection');
      }
    }
  }

  async handleSubmit(event) {
    const form = event.target.closest('[data-agent-create-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await this.apiClient.createConnection({
        clientKind: data.get('clientKind'),
        label: data.get('label'),
        scopes: data.get('edit') === 'on' ? ['vault:read', 'vault:edit'] : ['vault:read'],
      });
      this.renderToken(result);
    } catch (error) {
      this.setLiveMessage(error.message || 'Failed to create Agent Connection');
      submit.disabled = false;
    }
  }
}
