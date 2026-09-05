import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';

import {
  HOSTED_ROLE_ADMIN,
  HOSTED_ROLE_COLLABORATOR,
  createHostedError,
  normalizeHostedEmail,
  normalizeHostedRole,
} from './hosted-workspace-contract.js';

export {
  HOSTED_ROLE_ADMIN,
  HOSTED_ROLE_COLLABORATOR,
  normalizeHostedEmail,
  normalizeHostedRole,
} from './hosted-workspace-contract.js';

export const HOSTED_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HOSTED_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function nowMs() {
  return Date.now();
}

export function hashHostedSecret(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function safeEqualHash(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'hex');
  const rightBuffer = Buffer.from(String(right ?? ''), 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function createAuditEvent({
  actor,
  metadata = {},
  targetEmail = actor?.email,
  targetRole = actor?.role ?? '',
  timestamp,
  type,
}) {
  return {
    actorEmail: actor?.email ?? '',
    actorName: actor?.name ?? '',
    createdAt: timestamp,
    id: randomUUID(),
    metadata,
    targetEmail,
    targetRole,
    type,
  };
}

function publicMembership(record = null) {
  if (!record) {
    return null;
  }

  return {
    email: record.email,
    id: record.id,
    joinedAt: record.joinedAt,
    name: record.name,
    picture: record.picture,
    role: record.role,
    updatedAt: record.updatedAt,
  };
}

function publicInvitation(record = null) {
  if (!record) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    email: record.email,
    expiresAt: record.expiresAt,
    id: record.id,
    invitedByEmail: record.invitedByEmail,
    invitedByName: record.invitedByName,
    role: record.role,
    updatedAt: record.updatedAt,
  };
}

function publicAuditEvent(record = null) {
  if (!record) {
    return null;
  }

  return {
    actorEmail: record.actorEmail,
    actorName: record.actorName,
    createdAt: record.createdAt,
    id: record.id,
    metadata: record.metadata,
    targetEmail: record.targetEmail,
    targetRole: record.targetRole,
    type: record.type,
  };
}

function publicVaultSource(record = null) {
  if (!record) {
    return null;
  }

  return {
    configuredAt: record.configuredAt,
    configuredByEmail: record.configuredByEmail,
    configuredByName: record.configuredByName,
    defaultBranch: record.defaultBranch,
    installationAccountLogin: record.installationAccountLogin,
    provider: record.provider,
    repositoryFullName: record.repositoryFullName,
    repositoryId: record.repositoryId,
    repositoryName: record.repositoryName,
    repositoryOwner: record.repositoryOwner,
    visibility: record.visibility,
  };
}

function resolveUser(user = null) {
  const email = normalizeHostedEmail(user?.email);
  if (!email) {
    return null;
  }

  return {
    email,
    name: String(user?.name ?? '').trim() || email,
    picture: typeof user?.picture === 'string' ? user.picture : '',
    sub: String(user?.sub ?? '').trim(),
  };
}

function normalizeGithubVisibility(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'public' || normalized === 'private' || normalized === 'internal') {
    return normalized;
  }
  return 'private';
}

function normalizeGithubVaultSource(input = {}, admin, timestamp) {
  const repository = input.repository ?? {};
  const installation = input.installation ?? {};
  const repositoryId = String(repository.id ?? input.repositoryId ?? '').trim();
  const repositoryOwner = String(repository.owner ?? input.repositoryOwner ?? '').trim();
  const repositoryName = String(repository.name ?? input.repositoryName ?? '').trim();
  const defaultBranch = String(repository.defaultBranch ?? input.defaultBranch ?? '').trim();
  const installationId = String(installation.id ?? input.installationId ?? '').trim();
  const installationAccountLogin = String(
    installation.accountLogin
    ?? input.installationAccountLogin
    ?? repositoryOwner,
  ).trim();
  const repositoryFullName = String(
    repository.fullName
    ?? input.repositoryFullName
    ?? (repositoryOwner && repositoryName ? `${repositoryOwner}/${repositoryName}` : ''),
  ).trim();

  if (!repositoryId || !repositoryOwner || !repositoryName || !repositoryFullName || !defaultBranch) {
    throw createHostedError(400, 'GitHub repository id, owner, name, full name, and default branch are required.', 'HOSTED_GITHUB_REPOSITORY_REQUIRED');
  }

  if (!installationId || !installationAccountLogin) {
    throw createHostedError(400, 'GitHub App installation id and account login are required.', 'HOSTED_GITHUB_INSTALLATION_REQUIRED');
  }

  return {
    configuredAt: timestamp,
    configuredByEmail: admin.email,
    configuredByName: admin.name,
    defaultBranch,
    id: 'vault-source',
    installationAccountLogin,
    installationId,
    provider: 'github',
    repositoryFullName,
    repositoryId,
    repositoryName,
    repositoryOwner,
    visibility: normalizeGithubVisibility(repository.visibility ?? input.visibility),
  };
}

export class HostedWorkspaceService {
  constructor({
    claim = null,
    enabled = false,
    store = null,
  } = {}) {
    this.claim = claim;
    this.enabled = Boolean(enabled);
    this.store = store;
    this.accessListeners = new Set();
    this.initialized = false;
  }

  async initialize() {
    if (!this.enabled || this.initialized) {
      return;
    }

    if (!this.store) {
      throw new Error('Hosted workspace metadata store is required when hosted mode is enabled.');
    }

    await this.store.initialize();
    await this.seedClaim();
    this.initialized = true;
  }

  async close() {
    await this.store?.close?.();
  }

  onAccessChanged(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.accessListeners.add(listener);
    return () => this.accessListeners.delete(listener);
  }

  emitAccessChanged(email) {
    const normalizedEmail = normalizeHostedEmail(email);
    for (const listener of this.accessListeners) {
      try {
        listener({ email: normalizedEmail });
      } catch (error) {
        console.error('[hosted] Access-change listener failed:', error.message);
      }
    }
  }

  async seedClaim() {
    const team = await this.store.getTeam();
    if (team) {
      return;
    }

    const email = normalizeHostedEmail(this.claim?.email);
    const token = String(this.claim?.token ?? '');
    if (!email || !token) {
      return;
    }

    const timestamp = nowMs();
    const existingClaim = await this.store.getActiveWorkspaceClaim(timestamp);
    if (existingClaim) {
      return;
    }

    await this.store.createWorkspaceClaim({
      createdAt: timestamp,
      email,
      expiresAt: timestamp + HOSTED_CLAIM_TTL_MS,
      id: randomUUID(),
      tokenHash: hashHostedSecret(token),
    });
  }

  async getStatus(user = null) {
    if (!this.enabled) {
      return {
        enabled: false,
      };
    }

    await this.initialize();
    const team = await this.store.getTeam();
    const resolvedUser = resolveUser(user);
    const membership = resolvedUser
      ? await this.store.getMembershipByEmail(resolvedUser.email)
      : null;
    const activeClaim = team ? null : await this.store.getActiveWorkspaceClaim(nowMs());
    const vaultSource = team ? await this.store.getVaultSource() : null;

    return {
      activeClaim: Boolean(activeClaim),
      claimed: Boolean(team),
      enabled: true,
      membership: publicMembership(membership),
      setupComplete: Boolean(team?.setupCompletedAt),
      team: team
        ? {
            claimedAt: team.claimedAt,
            id: team.id,
            name: team.name,
            setupCompletedAt: team.setupCompletedAt,
          }
        : null,
      vaultSource: publicVaultSource(vaultSource),
    };
  }

  async claimWorkspace({ teamName = '', token = '', user = null } = {}) {
    await this.initialize();
    const existingTeam = await this.store.getTeam();
    if (existingTeam) {
      throw createHostedError(409, 'Workspace is already claimed.', 'HOSTED_ALREADY_CLAIMED');
    }

    const resolvedUser = resolveUser(user);
    if (!resolvedUser) {
      throw createHostedError(401, 'Google sign-in is required to claim this workspace.', 'HOSTED_AUTH_REQUIRED');
    }

    const activeClaim = await this.store.getActiveWorkspaceClaim(nowMs());
    if (!activeClaim) {
      throw createHostedError(404, 'No active workspace claim is available.', 'HOSTED_CLAIM_NOT_FOUND');
    }

    if (activeClaim.email !== resolvedUser.email) {
      await this.store.createOperationalSecurityEvent({
        createdAt: nowMs(),
        email: resolvedUser.email,
        id: randomUUID(),
        metadata: { claimEmail: activeClaim.email, reason: 'email_mismatch' },
        type: 'workspace_claim_failed',
      });
      throw createHostedError(403, 'This workspace claim is for a different Google account.', 'HOSTED_CLAIM_EMAIL_MISMATCH');
    }

    if (!safeEqualHash(activeClaim.tokenHash, hashHostedSecret(token))) {
      await this.store.createOperationalSecurityEvent({
        createdAt: nowMs(),
        email: resolvedUser.email,
        id: randomUUID(),
        metadata: { reason: 'invalid_token' },
        type: 'workspace_claim_failed',
      });
      throw createHostedError(403, 'Invalid workspace claim token.', 'HOSTED_CLAIM_INVALID');
    }

    const timestamp = nowMs();
    const team = {
      claimedAt: timestamp,
      id: 'team',
      name: String(teamName ?? '').trim() || 'CollabMD Team',
      setupCompletedAt: null,
    };
    const membership = {
      email: resolvedUser.email,
      id: randomUUID(),
      joinedAt: timestamp,
      name: resolvedUser.name,
      picture: resolvedUser.picture,
      role: HOSTED_ROLE_ADMIN,
      updatedAt: timestamp,
    };

    await this.store.claimWorkspace({
      auditEvent: createAuditEvent({
        actor: resolvedUser,
        targetRole: HOSTED_ROLE_ADMIN,
        timestamp,
        type: 'workspace_claimed',
      }),
      claimId: activeClaim.id,
      membership,
      team,
    });

    return {
      membership: publicMembership(membership),
      ok: true,
      team,
    };
  }

  async completeWorkspaceSetup({ user = null } = {}) {
    await this.initialize();
    const team = await this.store.getTeam();
    if (!team) {
      throw createHostedError(409, 'Workspace must be claimed before setup can complete.', 'HOSTED_UNCLAIMED');
    }

    const timestamp = nowMs();
    const updatedTeam = {
      ...team,
      setupCompletedAt: team.setupCompletedAt || timestamp,
    };
    await this.store.updateTeam(updatedTeam);
    if (!team.setupCompletedAt) {
      await this.store.createAuditEvent(createAuditEvent({
        actor: user,
        targetEmail: user?.email ?? '',
        targetRole: user?.role ?? '',
        timestamp,
        type: 'workspace_setup_completed',
      }));
    }
    return updatedTeam;
  }

  async getVaultSource(user) {
    await this.requireAdmin(user);
    return publicVaultSource(await this.store.getVaultSource());
  }

  async configureGithubVaultSource({ github = {}, user = null } = {}) {
    const admin = await this.requireAdmin(user);
    const team = await this.store.getTeam();
    if (!team) {
      throw createHostedError(409, 'Workspace must be claimed before configuring a vault source.', 'HOSTED_UNCLAIMED');
    }
    if (team.setupCompletedAt || await this.store.getVaultSource()) {
      throw createHostedError(409, 'Vault source is already configured.', 'HOSTED_VAULT_SOURCE_ALREADY_CONFIGURED');
    }

    const timestamp = nowMs();
    const vaultSource = normalizeGithubVaultSource(github, admin, timestamp);
    const updatedTeam = {
      ...team,
      setupCompletedAt: timestamp,
    };

    await this.store.configureVaultSource({
      auditEvent: createAuditEvent({
        actor: admin,
        metadata: {
          defaultBranch: vaultSource.defaultBranch,
          provider: vaultSource.provider,
          repositoryFullName: vaultSource.repositoryFullName,
          visibility: vaultSource.visibility,
        },
        timestamp,
        type: 'vault_source_configured',
      }),
      team: updatedTeam,
      vaultSource,
    });

    return {
      setupComplete: true,
      team: updatedTeam,
      vaultSource: publicVaultSource(vaultSource),
    };
  }

  async authorizeWorkspaceAccess({ requireSetupComplete = true, user = null } = {}) {
    if (!this.enabled) {
      return { ok: true };
    }

    await this.initialize();
    const resolvedUser = resolveUser(user);
    if (!resolvedUser) {
      return {
        body: { code: 'HOSTED_AUTH_REQUIRED', error: 'Google sign-in is required.' },
        ok: false,
        statusCode: 401,
      };
    }

    const membership = await this.store.getMembershipByEmail(resolvedUser.email);
    if (!membership) {
      return {
        body: { code: 'HOSTED_MEMBERSHIP_REQUIRED', error: 'Team membership is required.' },
        ok: false,
        statusCode: 403,
      };
    }

    const team = await this.store.getTeam();
    if (requireSetupComplete && !team?.setupCompletedAt) {
      return {
        body: { code: 'HOSTED_SETUP_INCOMPLETE', error: 'Workspace setup is incomplete.' },
        ok: false,
        statusCode: 423,
      };
    }

    return {
      membership,
      ok: true,
      role: membership.role,
    };
  }

  async requireAdmin(user) {
    const access = await this.authorizeWorkspaceAccess({
      requireSetupComplete: false,
      user,
    });
    if (!access.ok) {
      throw createHostedError(access.statusCode, access.body.error, access.body.code);
    }
    if (access.role !== HOSTED_ROLE_ADMIN) {
      throw createHostedError(403, 'Team Admin role is required.', 'HOSTED_ADMIN_REQUIRED');
    }
    return access.membership;
  }

  async listMemberships(user) {
    await this.requireAdmin(user);
    return (await this.store.listMemberships()).map(publicMembership);
  }

  async listInvitations(user) {
    await this.requireAdmin(user);
    return (await this.store.listPendingInvitations(nowMs())).map(publicInvitation);
  }

  async createInvitation({ email, role, user }) {
    const admin = await this.requireAdmin(user);
    const team = await this.store.getTeam();
    if (!team?.setupCompletedAt) {
      throw createHostedError(409, 'Workspace setup must complete before inviting collaborators.', 'HOSTED_SETUP_INCOMPLETE');
    }

    const normalizedEmail = normalizeHostedEmail(email);
    const normalizedRole = normalizeHostedRole(role) || HOSTED_ROLE_COLLABORATOR;
    if (!normalizedEmail) {
      throw createHostedError(400, 'Invitation email is required.', 'HOSTED_EMAIL_REQUIRED');
    }

    if (await this.store.getMembershipByEmail(normalizedEmail)) {
      throw createHostedError(409, 'This email is already a collaborator.', 'HOSTED_ALREADY_MEMBER');
    }

    const timestamp = nowMs();
    const invitation = {
      acceptedAt: null,
      createdAt: timestamp,
      email: normalizedEmail,
      expiresAt: timestamp + HOSTED_INVITATION_TTL_MS,
      id: randomUUID(),
      invitedByEmail: admin.email,
      invitedByName: admin.name,
      revokedAt: null,
      role: normalizedRole,
      updatedAt: timestamp,
    };

    await this.store.upsertPendingInvitation(invitation);
    await this.store.createAuditEvent(createAuditEvent({
      actor: admin,
      targetEmail: normalizedEmail,
      targetRole: normalizedRole,
      timestamp,
      type: 'invitation_created',
    }));

    return publicInvitation(invitation);
  }

  async updateInvitationRole({ invitationId, role, user }) {
    const admin = await this.requireAdmin(user);
    const normalizedRole = normalizeHostedRole(role);
    if (!normalizedRole) {
      throw createHostedError(400, 'Invalid invitation role.', 'HOSTED_INVALID_ROLE');
    }

    const invitation = await this.store.getInvitationById(invitationId);
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= nowMs()) {
      throw createHostedError(404, 'Pending invitation was not found.', 'HOSTED_INVITATION_NOT_FOUND');
    }

    const timestamp = nowMs();
    const updated = {
      ...invitation,
      role: normalizedRole,
      updatedAt: timestamp,
    };
    await this.store.updateInvitation(updated);
    await this.store.createAuditEvent(createAuditEvent({
      actor: admin,
      targetEmail: updated.email,
      targetRole: normalizedRole,
      timestamp,
      type: 'invitation_role_changed',
    }));
    return publicInvitation(updated);
  }

  async revokeInvitation({ invitationId, user }) {
    const admin = await this.requireAdmin(user);
    const invitation = await this.store.getInvitationById(invitationId);
    if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
      throw createHostedError(404, 'Pending invitation was not found.', 'HOSTED_INVITATION_NOT_FOUND');
    }

    const timestamp = nowMs();
    const updated = {
      ...invitation,
      revokedAt: timestamp,
      updatedAt: timestamp,
    };
    await this.store.updateInvitation(updated);
    await this.store.createAuditEvent(createAuditEvent({
      actor: admin,
      targetEmail: updated.email,
      targetRole: updated.role,
      timestamp,
      type: 'invitation_revoked',
    }));
    return { ok: true };
  }

  async acceptInvitation(user) {
    await this.initialize();
    const resolvedUser = resolveUser(user);
    if (!resolvedUser) {
      throw createHostedError(401, 'Google sign-in is required to accept an invitation.', 'HOSTED_AUTH_REQUIRED');
    }

    if (await this.store.getMembershipByEmail(resolvedUser.email)) {
      throw createHostedError(409, 'This email is already a collaborator.', 'HOSTED_ALREADY_MEMBER');
    }

    const invitation = await this.store.getPendingInvitationByEmail(resolvedUser.email, nowMs());
    if (!invitation) {
      throw createHostedError(404, 'Pending invitation was not found.', 'HOSTED_INVITATION_NOT_FOUND');
    }

    const timestamp = nowMs();
    const membership = {
      email: resolvedUser.email,
      id: randomUUID(),
      joinedAt: timestamp,
      name: resolvedUser.name,
      picture: resolvedUser.picture,
      role: invitation.role,
      updatedAt: timestamp,
    };

    await this.store.acceptInvitation({
      auditEvent: createAuditEvent({
        actor: resolvedUser,
        targetRole: invitation.role,
        timestamp,
        type: 'invitation_accepted',
      }),
      invitation: {
        ...invitation,
        acceptedAt: timestamp,
        updatedAt: timestamp,
      },
      membership,
    });

    return publicMembership(membership);
  }

  async updateMembershipRole({ membershipId, role, user }) {
    const admin = await this.requireAdmin(user);
    const normalizedRole = normalizeHostedRole(role);
    if (!normalizedRole) {
      throw createHostedError(400, 'Invalid membership role.', 'HOSTED_INVALID_ROLE');
    }

    const timestamp = nowMs();
    const updated = await this.store.changeMembership({
      actorId: admin.id,
      membershipId,
      role: normalizedRole,
      auditEvent: createAuditEvent({
        actor: admin,
        timestamp,
        type: 'membership_role_changed',
      }),
    });
    this.emitAccessChanged(updated.email);
    return publicMembership(updated);
  }

  async removeMembership({ membershipId, user }) {
    const admin = await this.requireAdmin(user);
    const timestamp = nowMs();
    const membership = await this.store.changeMembership({
      actorId: admin.id,
      membershipId,
      auditEvent: createAuditEvent({
        actor: admin,
        timestamp,
        type: 'membership_removed',
      }),
    });
    this.emitAccessChanged(membership.email);
    return { ok: true };
  }

  async leaveTeam(user) {
    const access = await this.authorizeWorkspaceAccess({
      requireSetupComplete: false,
      user,
    });
    if (!access.ok) {
      throw createHostedError(access.statusCode, access.body.error, access.body.code);
    }

    const membership = access.membership;
    const timestamp = nowMs();
    await this.store.changeMembership({
      actorId: membership.id,
      membershipId: membership.id,
      requireAdmin: false,
      auditEvent: createAuditEvent({
        actor: membership,
        timestamp,
        type: 'membership_left',
      }),
    });
    this.emitAccessChanged(membership.email);
    return { ok: true };
  }

  async recordAgentConnectionEvent({ connection, type, user }) {
    if (!this.enabled) return;
    const access = await this.authorizeWorkspaceAccess({ user });
    if (!access.ok) {
      throw createHostedError(access.statusCode, access.body.error, access.body.code);
    }
    await this.store.createAuditEvent(createAuditEvent({
      actor: access.membership,
      metadata: {
        clientKind: connection.clientKind,
        connectionId: connection.id,
        expiresAt: connection.expiresAt,
        label: connection.label,
        scopes: connection.scopes,
      },
      targetRole: access.membership.role,
      timestamp: nowMs(),
      type,
    }));
  }

  async listAuditEvents(user) {
    await this.requireAdmin(user);
    return (await this.store.listAuditEvents()).map(publicAuditEvent);
  }
}
