import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeamSettingsController } from '../../src/client/presentation/team-settings-controller.js';
import { hostedApiClient } from '../../src/client/infrastructure/hosted-api-client.js';

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

  it('loads older audit pages without losing form input and resets on refresh', async () => {
    const elements = mountDialog();
    const olderPage = Promise.withResolvers();
    const event = (id) => ({ id, actorName: 'Admin', createdAt: 1700000000000, type: id });
    const apiClient = createApiClient({
      listAuditEvents: vi.fn(async (options) => options?.cursor
        ? olderPage.promise
        : { events: [event('latest')], nextCursor: 'older-cursor' }),
    });
    const controller = new TeamSettingsController({ apiClient, ...elements });
    await controller.open();
    const input = elements.content.querySelector('[name="email"]');
    input.value = 'draft@example.com';
    const button = elements.content.querySelector('[data-audit-more]');
    button.focus();
    button.click();
    button.click();
    expect(button.disabled).toBe(true);
    expect(apiClient.listAuditEvents).toHaveBeenCalledTimes(2);
    expect(apiClient.listAuditEvents).toHaveBeenLastCalledWith({ cursor: 'older-cursor' });
    olderPage.resolve({ events: [event('older')], nextCursor: null });
    await vi.waitFor(() => expect(elements.content.querySelector('[data-audit-more]')).toBeNull());
    expect(elements.content.querySelectorAll('.team-settings-row--audit')).toHaveLength(2);
    expect(input.value).toBe('draft@example.com');
    expect(document.activeElement).toBe(elements.content.querySelector('.team-settings-list--audit'));
    await controller.refresh();
    expect(elements.content.querySelectorAll('.team-settings-row--audit')).toHaveLength(1);
    expect(elements.content.querySelector('[data-audit-more]').dataset.auditMore).toBe('older-cursor');
  });

  it('keeps failed audit pages retryable and ignores pages from an earlier refresh', async () => {
    const elements = mountDialog();
    const stalePage = Promise.withResolvers();
    const apiClient = createApiClient({
      listAuditEvents: vi.fn()
        .mockResolvedValueOnce({ events: [], nextCursor: 'cursor' })
        .mockRejectedValueOnce(new Error('Try again'))
        .mockReturnValueOnce(stalePage.promise)
        .mockResolvedValueOnce({ events: [], nextCursor: null }),
    });
    const controller = new TeamSettingsController({ apiClient, ...elements });
    await controller.open();
    const button = elements.content.querySelector('[data-audit-more]');
    await controller.loadMoreAuditEvents(button);
    expect(button.disabled).toBe(false);
    expect(elements.content.textContent).toContain('Try again');
    const pending = controller.loadMoreAuditEvents(button);
    await controller.refresh();
    stalePage.resolve({ events: [{ id: 'stale', type: 'stale event' }], nextCursor: null });
    await pending;
    expect(elements.content.textContent).not.toContain('stale event');
  });

  it('encodes audit cursors and limits through the hosted API client', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events: [], nextCursor: null }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await hostedApiClient.listAuditEvents({ cursor: 'older/cursor?', limit: 17 });
    const url = new URL(fetchMock.mock.calls[0][0], window.location.origin);
    expect(url.pathname).toBe('/api/hosted/audit');
    expect(url.searchParams.get('cursor')).toBe('older/cursor?');
    expect(url.searchParams.get('limit')).toBe('17');
  });
});
