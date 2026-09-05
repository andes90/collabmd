import { createFragment, escapeHtml } from '../domain/vault-utils.js';

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function roleOptions(currentRole) {
  return ['collaborator', 'admin'].map((role) => (
    `<option value="${role}"${role === currentRole ? ' selected' : ''}>${role === 'admin' ? 'Admin' : 'Collaborator'}</option>`
  )).join('');
}

export class TeamSettingsController {
  constructor({ apiClient, closeToolbarMenu, content, dialog, toastController, trigger }) {
    this.apiClient = apiClient;
    this.closeToolbarMenu = closeToolbarMenu;
    this.content = content;
    this.dialog = dialog;
    this.toastController = toastController;
    this.trigger = trigger;
    this.trigger?.classList.add('hidden');
    this.trigger?.addEventListener('click', () => void this.open());
    this.dialog?.addEventListener('close', () => {
      this.content?.replaceChildren();
      this.trigger?.focus?.();
    });
    this.dialog?.addEventListener('click', (event) => void this.handleClick(event));
    this.dialog?.addEventListener('submit', (event) => void this.handleSubmit(event));
    this.dialog?.addEventListener('change', (event) => void this.handleChange(event));
  }

  setTriggerVisible(visible) {
    this.trigger?.classList.toggle('hidden', !visible);
  }

  async open() {
    this.closeToolbarMenu?.();
    this.dialog?.showModal?.();
    this.renderStatus('Loading team settings…');
    await this.refresh();
  }

  async loadOverview() {
    const [membershipsResult, invitationsResult, auditResult] = await Promise.all([
      this.apiClient.listMemberships(),
      this.apiClient.listInvitations(),
      this.apiClient.listAuditEvents(),
    ]);
    this.renderOverview({
      auditEvents: auditResult.events ?? [],
      invitations: invitationsResult.invitations ?? [],
      memberships: membershipsResult.memberships ?? [],
    });
  }

  renderStatus(message, { error = false } = {}) {
    if (!this.content) return;
    this.content.replaceChildren(createFragment(`<p class="team-settings-status${error ? ' is-error' : ''}" role="status">${escapeHtml(message)}</p>`));
  }

  renderOverview({ auditEvents = [], invitations = [], memberships = [] }) {
    if (!this.content) return;
    const memberMarkup = memberships.length > 0
      ? memberships.map((membership) => `
        <li class="team-settings-row">
          <div class="team-settings-row-main">
            <strong>${escapeHtml(membership.name || membership.email)}</strong>
            <span>${escapeHtml(membership.email)}</span>
            <small>Joined ${formatDate(membership.joinedAt)}</small>
          </div>
          <label class="team-settings-row-role">Role
            <select class="ui-input ui-input--compact" data-membership-role="${escapeHtml(membership.id)}">
              ${roleOptions(membership.role)}
            </select>
          </label>
          <button class="ui-button ui-button--secondary ui-button--compact" type="button" data-membership-remove="${escapeHtml(membership.id)}" data-membership-email="${escapeHtml(membership.email)}">Remove</button>
        </li>`).join('')
      : '<p class="team-settings-empty">No collaborators yet.</p>';
    const invitationMarkup = invitations.length > 0
      ? invitations.map((invitation) => `
        <li class="team-settings-row">
          <div class="team-settings-row-main">
            <strong>${escapeHtml(invitation.email)}</strong>
            <span>Invited by ${escapeHtml(invitation.invitedByName || invitation.invitedByEmail)}</span>
            <small>Expires ${formatDate(invitation.expiresAt)}</small>
          </div>
          <label class="team-settings-row-role">Role
            <select class="ui-input ui-input--compact" data-invitation-role="${escapeHtml(invitation.id)}">
              ${roleOptions(invitation.role)}
            </select>
          </label>
          <button class="ui-button ui-button--secondary ui-button--compact" type="button" data-invitation-revoke="${escapeHtml(invitation.id)}" data-invitation-email="${escapeHtml(invitation.email)}">Revoke</button>
        </li>`).join('')
      : '<p class="team-settings-empty">No pending invitations.</p>';
    const auditMarkup = auditEvents.length > 0
      ? auditEvents.map((event) => `
        <li class="team-settings-row team-settings-row--audit">
          <div class="team-settings-row-main">
            <strong>${escapeHtml(event.type)}</strong>
            <span>${escapeHtml(event.targetEmail || '')}${event.targetRole ? ` · ${escapeHtml(event.targetRole)}` : ''}</span>
            <small>By ${escapeHtml(event.actorName || event.actorEmail)} · ${formatDate(event.createdAt)}</small>
          </div>
        </li>`).join('')
      : '<p class="team-settings-empty">No access history yet.</p>';
    this.content.replaceChildren(createFragment(`
      <section class="team-settings-section">
        <h3>Collaborators</h3>
        <ul class="team-settings-list">${memberMarkup}</ul>
      </section>
      <section class="team-settings-section">
        <h3>Pending invitations</h3>
        <ul class="team-settings-list">${invitationMarkup}</ul>
        <form class="team-settings-invite-form" data-invite-form>
          <label class="app-dialog-field">
            <span class="app-dialog-label">Email</span>
            <input class="ui-input" name="email" type="email" maxlength="254" autocomplete="off" spellcheck="false" required placeholder="teammate@example.com">
          </label>
          <label class="app-dialog-field">
            <span class="app-dialog-label">Role</span>
            <select class="ui-input" name="role">
              <option value="collaborator">Collaborator</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button class="ui-button ui-button--primary" type="submit">Invite</button>
        </form>
        <p class="team-settings-note">Share this workspace URL with the invited person. They sign in with the matching Google email, then accept the invitation. Email delivery is not set up yet.</p>
      </section>
      <section class="team-settings-section">
        <h3>Access history</h3>
        <ul class="team-settings-list team-settings-list--audit">${auditMarkup}</ul>
      </section>
      <div class="team-settings-actions">
        <button class="ui-button ui-button--ghost" type="button" data-team-close>Close</button>
      </div>
      <p class="team-settings-live" role="status" aria-live="polite"></p>
    `));
  }

  setLiveMessage(message) {
    const live = this.content?.querySelector('.team-settings-live');
    if (live) live.textContent = message;
  }

  async refresh() {
    try {
      await this.loadOverview();
    } catch (error) {
      this.renderStatus(error.message || 'Failed to load team settings', { error: true });
    }
  }

  async handleClick(event) {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.teamClose != null) {
      this.dialog.close();
      return;
    }
    if (target.dataset.membershipRemove) {
      if (!window.confirm(`Remove ${target.dataset.membershipEmail} from the team? They lose workspace access immediately.`)) return;
      try {
        await this.apiClient.removeMembership(target.dataset.membershipRemove);
        await this.refresh();
        this.setLiveMessage('Collaborator removed');
      } catch (error) {
        this.toastController?.show(error.message || 'Failed to remove collaborator');
      }
      return;
    }
    if (target.dataset.invitationRevoke) {
      if (!window.confirm(`Revoke the invitation for ${target.dataset.invitationEmail}?`)) return;
      try {
        await this.apiClient.revokeInvitation(target.dataset.invitationRevoke);
        await this.refresh();
        this.setLiveMessage('Invitation revoked');
      } catch (error) {
        this.toastController?.show(error.message || 'Failed to revoke invitation');
      }
    }
  }

  async handleChange(event) {
    const membershipSelect = event.target.closest('[data-membership-role]');
    if (membershipSelect) {
      try {
        await this.apiClient.updateMembershipRole(membershipSelect.dataset.membershipRole, membershipSelect.value);
        await this.refresh();
        this.setLiveMessage('Role updated');
      } catch (error) {
        this.toastController?.show(error.message || 'Failed to update role');
        await this.refresh();
      }
      return;
    }
    const invitationSelect = event.target.closest('[data-invitation-role]');
    if (invitationSelect) {
      try {
        await this.apiClient.updateInvitationRole(invitationSelect.dataset.invitationRole, invitationSelect.value);
        await this.refresh();
        this.setLiveMessage('Invitation role updated');
      } catch (error) {
        this.toastController?.show(error.message || 'Failed to update invitation');
        await this.refresh();
      }
    }
  }

  async handleSubmit(event) {
    const form = event.target.closest('[data-invite-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await this.apiClient.createInvitation({
        email: String(data.get('email') ?? '').trim(),
        role: data.get('role'),
      });
      await this.refresh();
      this.setLiveMessage('Invitation created — share the workspace URL with the invited person.');
    } catch (error) {
      this.setLiveMessage(error.message || 'Failed to create invitation');
      submit.disabled = false;
    }
  }
}
