import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeamSettingsController } from '../../src/client/presentation/team-settings-controller.js';

function mountDialog() {
  document.body.innerHTML = `
    <button id="trigger">Team Settings</button>
    <dialog id="dialog"><div id="content"></div></dialog>
  `;
  return {
    content: document.getElementById('content'),
    dialog: document.getElementById('dialog'),
    trigger: document.getElementById('trigger'),
  };
}

function createApiClient(overrides = {}) {
  return {
    createInvitation: vi.fn(async ({ email, role }) => ({ invitation: { email, id: 'invite-1', role } })),
    listAuditEvents: vi.fn(async () => ({ events: [] })),
    listInvitations: vi.fn(async () => ({ invitations: [] })),
    listMemberships: vi.fn(async () => ({ memberships: [] })),
    removeMembership: vi.fn(async () => ({ ok: true })),
    revokeInvitation: vi.fn(async () => ({ ok: true })),
    updateInvitationRole: vi.fn(async ({ role } = {}) => ({ invitation: { role } })),
    updateMembershipRole: vi.fn(async () => ({ membership: {} })),
    ...overrides,
  };
}

describe('TeamSettingsController', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('hides the trigger until an admin enables it', () => {
    const elements = mountDialog();
    const controller = new TeamSettingsController({ apiClient: createApiClient(), ...elements });
    expect(elements.trigger.classList.contains('hidden')).toBe(true);
    controller.setTriggerVisible(true);
    expect(elements.trigger.classList.contains('hidden')).toBe(false);
  });

  it('renders collaborators, invitations, and access history', async () => {
    const elements = mountDialog();
    const apiClient = createApiClient({
      listAuditEvents: async () => ({ events: [{ actorEmail: 'a@example.com', actorName: 'A', createdAt: 1700000000000, id: 'audit-1', targetEmail: 'b@example.com', targetRole: 'collaborator', type: 'invitation_accepted' }] }),
      listInvitations: async () => ({ invitations: [{ email: 'c@example.com', expiresAt: 1700000000000, id: 'invite-9', invitedByEmail: 'a@example.com', invitedByName: 'A', role: 'collaborator' }] }),
      listMemberships: async () => ({ memberships: [{ email: 'a@example.com', id: 'member-1', joinedAt: 1700000000000, name: 'A', role: 'admin' }] }),
    });
    new TeamSettingsController({ apiClient, ...elements });

    elements.trigger.click();
    await vi.waitFor(() => {
      expect(elements.content.textContent).toContain('Collaborators');
      expect(elements.content.textContent).toContain('a@example.com');
    });
    expect(elements.content.textContent).toContain('c@example.com');
    expect(elements.content.textContent).toContain('invitation_accepted');
    expect(elements.content.querySelector('[data-invite-form]')).not.toBeNull();
  });

  it('creates an invitation from the form', async () => {
    const elements = mountDialog();
    const apiClient = createApiClient();
    new TeamSettingsController({ apiClient, ...elements });

    elements.trigger.click();
    await vi.waitFor(() => {
      expect(elements.content.querySelector('[data-invite-form]')).not.toBeNull();
    });
    elements.content.querySelector('[name="email"]').value = 'new@example.com';
    elements.content.querySelector('[data-invite-form]').requestSubmit();
    await vi.waitFor(() => {
      expect(apiClient.createInvitation).toHaveBeenCalledWith({ email: 'new@example.com', role: 'collaborator' });
    });
  });

  it('removes a collaborator after confirmation', async () => {
    const elements = mountDialog();
    const apiClient = createApiClient({
      listMemberships: async () => ({ memberships: [{ email: 'b@example.com', id: 'member-2', joinedAt: 1700000000000, name: 'B', role: 'collaborator' }] }),
    });
    new TeamSettingsController({ apiClient, ...elements });
    vi.stubGlobal('confirm', () => true);

    elements.trigger.click();
    await vi.waitFor(() => {
      expect(elements.content.querySelector('[data-membership-remove]')).not.toBeNull();
    });
    elements.content.querySelector('[data-membership-remove]').click();
    await vi.waitFor(() => {
      expect(apiClient.removeMembership).toHaveBeenCalledWith('member-2');
    });
  });
});
