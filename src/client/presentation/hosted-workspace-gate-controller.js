import { createFragment, escapeHtml } from '../domain/vault-utils.js';

export class HostedWorkspaceGateController {
  constructor({ apiClient, appRoot = null, gate, runtimeConfig, teamSettingsController }) {
    this.apiClient = apiClient;
    this.appRoot = appRoot;
    this.gate = gate;
    this.content = gate?.querySelector('[data-hosted-gate-content]') ?? null;
    this.teamSettingsController = teamSettingsController;
    this.enabled = runtimeConfig.hosted?.enabled === true;
    this.accessGrantedPromise = new Promise((resolve) => {
      this.resolveAccessGranted = resolve;
    });
    this.gate?.addEventListener('click', (event) => void this.handleClick(event));
    this.gate?.addEventListener('submit', (event) => void this.handleSubmit(event));
  }

  async initialize() {
    if (!this.enabled) {
      this.hide();
      return;
    }
    await this.refresh();
    await this.accessGrantedPromise;
  }

  async refresh() {
    this.show('Loading workspace…');
    let status;
    try {
      status = await this.apiClient.getStatus();
    } catch (error) {
      if (error.status === 401 || error.code === 'HOSTED_AUTH_REQUIRED') {
        this.show('Sign in to access this workspace.', { title: 'Sign-in required' });
      } else {
        this.show(error.message || 'Failed to load workspace status.', { error: true, title: 'Workspace unavailable' });
      }
      this.teamSettingsController?.setTriggerVisible(false);
      return;
    }
    this.applyStatus(status);
  }

  applyStatus(status) {
    const membership = status.membership ?? null;
    const isAdmin = membership?.role === 'admin';
    this.teamSettingsController?.setTriggerVisible(Boolean(isAdmin && status.setupComplete));
    if (!status.claimed) {
      this.renderClaim();
      return;
    }
    if (!status.setupComplete) {
      if (isAdmin) {
        this.renderSetup(status);
      } else {
        this.show('Workspace setup is incomplete. Ask a Team Admin to finish setup.', { title: status.team?.name || 'Workspace setup' });
      }
      return;
    }
    if (!membership) {
      this.renderAccept(status);
      return;
    }
    this.hide();
    this.resolveAccessGranted();
  }

  hide() {
    this.gate?.classList.add('hidden');
    this.content?.replaceChildren();
    if (this.appRoot) this.appRoot.inert = false;
  }

  reveal() {
    if (!this.gate) return;
    this.gate.classList.remove('hidden');
    if (this.appRoot) this.appRoot.inert = true;
    this.content?.querySelector('button, input, select')?.focus?.();
  }

  render(markup) {
    if (!this.gate || !this.content) return;
    this.content.replaceChildren(createFragment(markup));
    this.reveal();
  }

  show(message, { error = false, title = 'Workspace' } = {}) {
    this.render(`
      <h2 class="hosted-gate-title" id="hostedGateTitle">${escapeHtml(title)}</h2>
      <p class="hosted-gate-status${error ? ' is-error' : ''}" role="status">${escapeHtml(message)}</p>
    `);
  }

  renderClaim() {
    this.render(`
      <h2 class="hosted-gate-title" id="hostedGateTitle">Claim this workspace</h2>
      <p class="hosted-gate-copy">Enter the team name and the one-time claim token from provisioning to become the first Team Admin.</p>
      <form class="hosted-gate-form" data-claim-form>
        <label class="app-dialog-field">
          <span class="app-dialog-label">Team name</span>
          <input class="ui-input" name="teamName" maxlength="80" autocomplete="off" spellcheck="false" required>
        </label>
        <label class="app-dialog-field">
          <span class="app-dialog-label">Claim token</span>
          <input class="ui-input" name="token" type="password" autocomplete="off" spellcheck="false" required>
        </label>
        <button class="ui-button ui-button--primary" type="submit">Claim workspace</button>
      </form>
      <p class="hosted-gate-live" role="status" aria-live="polite"></p>
    `);
  }

  renderSetup(status) {
    this.render(`
      <h2 class="hosted-gate-title" id="hostedGateTitle">${escapeHtml(status.team?.name || 'Workspace setup')}</h2>
      <p class="hosted-gate-copy">Workspace setup is not complete. The editor and invitations stay unavailable until setup is done. Connecting a GitHub vault source comes later; for now, completing setup unlocks team management.</p>
      <button class="ui-button ui-button--primary" type="button" data-complete-setup>Complete setup</button>
      <p class="hosted-gate-live" role="status" aria-live="polite"></p>
    `);
  }

  renderAccept(status) {
    this.render(`
      <h2 class="hosted-gate-title" id="hostedGateTitle">${escapeHtml(status.team?.name || 'Workspace')}</h2>
      <p class="hosted-gate-copy">You are signed in but not a team member yet. If a Team Admin invited your Google email, accept below to join.</p>
      <button class="ui-button ui-button--primary" type="button" data-accept-invitation>Accept invitation</button>
      <p class="hosted-gate-live" role="status" aria-live="polite"></p>
    `);
  }

  setLiveMessage(message) {
    const live = this.content?.querySelector('.hosted-gate-live');
    if (live) live.textContent = message;
  }

  async handleClick(event) {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.completeSetup != null) {
      target.disabled = true;
      try {
        await this.apiClient.completeSetup();
        await this.refresh();
      } catch (error) {
        this.setLiveMessage(error.message || 'Failed to complete setup');
        target.disabled = false;
      }
      return;
    }
    if (target.dataset.acceptInvitation != null) {
      target.disabled = true;
      try {
        await this.apiClient.acceptInvitation();
        await this.refresh();
      } catch (error) {
        this.setLiveMessage(error.message || 'No pending invitation was found for your account.');
        target.disabled = false;
      }
    }
  }

  async handleSubmit(event) {
    const form = event.target.closest('[data-claim-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await this.apiClient.claimWorkspace({
        teamName: String(data.get('teamName') ?? '').trim(),
        token: String(data.get('token') ?? ''),
      });
      await this.refresh();
    } catch (error) {
      this.setLiveMessage(error.message || 'Failed to claim workspace');
      submit.disabled = false;
    }
  }
}
