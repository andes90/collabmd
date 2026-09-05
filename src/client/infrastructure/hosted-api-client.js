import { resolveApiUrl } from '../domain/runtime-paths.js';
import { parseApiResponse } from './api-client-utils.js';

function request(path, { body = null, fallback = 'Request failed', method = 'GET' } = {}) {
  return fetch(resolveApiUrl(path), {
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    headers: { 'Content-Type': 'application/json' },
    method,
  }).then((response) => parseApiResponse(response, fallback));
}

export const hostedApiClient = {
  acceptInvitation() {
    return request('/hosted/invitations/accept', { fallback: 'Failed to accept invitation', method: 'POST' });
  },

  claimWorkspace({ teamName, token }) {
    return request('/hosted/claim', { body: { teamName, token }, fallback: 'Failed to claim workspace', method: 'POST' });
  },

  completeSetup() {
    return request('/hosted/setup/complete', { fallback: 'Failed to complete setup', method: 'POST' });
  },

  createInvitation({ email, role }) {
    return request('/hosted/invitations', { body: { email, role }, fallback: 'Failed to create invitation', method: 'POST' });
  },

  getStatus() {
    return request('/hosted/status', { fallback: 'Failed to load workspace status' });
  },

  listAuditEvents() {
    return request('/hosted/audit', { fallback: 'Failed to load access history' });
  },

  listInvitations() {
    return request('/hosted/invitations', { fallback: 'Failed to load invitations' });
  },

  listMemberships() {
    return request('/hosted/memberships', { fallback: 'Failed to load collaborators' });
  },

  removeMembership(membershipId) {
    return request(`/hosted/memberships/${encodeURIComponent(membershipId)}`, { fallback: 'Failed to remove collaborator', method: 'DELETE' });
  },

  revokeInvitation(invitationId) {
    return request(`/hosted/invitations/${encodeURIComponent(invitationId)}`, { fallback: 'Failed to revoke invitation', method: 'DELETE' });
  },

  updateInvitationRole(invitationId, role) {
    return request(`/hosted/invitations/${encodeURIComponent(invitationId)}`, { body: { role }, fallback: 'Failed to update invitation', method: 'PATCH' });
  },

  updateMembershipRole(membershipId, role) {
    return request(`/hosted/memberships/${encodeURIComponent(membershipId)}`, { body: { role }, fallback: 'Failed to update role', method: 'PATCH' });
  },
};
