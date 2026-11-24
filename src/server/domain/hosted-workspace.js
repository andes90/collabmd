import { createRequestError } from '../shared/http-errors.js';

export const HOSTED_ROLE_ADMIN = 'admin';
export const HOSTED_ROLE_COLLABORATOR = 'collaborator';
const SUPPORTED_ROLES = new Set([HOSTED_ROLE_ADMIN, HOSTED_ROLE_COLLABORATOR]);

export function createHostedError(statusCode, message, code) {
  return createRequestError(statusCode, message, { code });
}

export function normalizeHostedRole(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return SUPPORTED_ROLES.has(normalized) ? normalized : '';
}

export function requireHostedMembership(actor, { admin = false } = {}) {
  if (!actor) {
    throw createHostedError(403, 'Team membership is required.', 'HOSTED_MEMBERSHIP_REQUIRED');
  }
  if (admin && actor.role !== HOSTED_ROLE_ADMIN) {
    throw createHostedError(403, 'Team Admin role is required.', 'HOSTED_ADMIN_REQUIRED');
  }
}

export function validateHostedMembershipChange({ actor, actorId, hasOtherAdmin, membership, membershipId, requireAdmin, role }) {
  const isSelfLeave = !requireAdmin && actorId === membershipId && role === null;
  requireHostedMembership(actor, { admin: !isSelfLeave });
  if (!membership) {
    throw createHostedError(404, 'Membership was not found.', 'HOSTED_MEMBERSHIP_NOT_FOUND');
  }
  if (membership.role === HOSTED_ROLE_ADMIN && role !== HOSTED_ROLE_ADMIN && !hasOtherAdmin) {
    throw createHostedError(409, 'A team must always have at least one Team Admin.', 'HOSTED_LAST_ADMIN');
  }
}
