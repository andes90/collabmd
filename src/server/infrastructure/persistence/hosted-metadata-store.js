import { SqliteStore } from './sqlite-store.js';

import {
  createHostedError,
  HOSTED_ROLE_ADMIN,
  requireHostedMembership,
  validateHostedMembershipChange,
} from '../../domain/hosted-workspace.js';

function parseMetadata(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function mapRow(row) {
  if (!row) return null;
  const mapped = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'metadata_json') {
      mapped.metadata = parseMetadata(value);
    } else {
      mapped[key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
    }
  }
  return mapped;
}

export class HostedMetadataStore extends SqliteStore {
  async initialize() {
    await this.open({
      pragmas: ['foreign_keys = ON', 'journal_mode = WAL'],
      schema: `
      CREATE TABLE IF NOT EXISTS team (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        setup_completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS workspace_claims (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        claimed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS memberships (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        picture TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        invited_by_email TEXT NOT NULL,
        invited_by_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        accepted_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        target_email TEXT NOT NULL,
        target_role TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_events_created_id_idx
        ON audit_events(created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS operational_security_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        email TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vault_source (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        repository_owner TEXT NOT NULL,
        repository_name TEXT NOT NULL,
        repository_full_name TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        installation_id TEXT NOT NULL,
        installation_account_login TEXT NOT NULL,
        visibility TEXT NOT NULL,
        configured_by_email TEXT NOT NULL,
        configured_by_name TEXT NOT NULL,
        configured_at INTEGER NOT NULL
      );
    `,
    });
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getTeam() {
    return mapRow(this.prepare('getTeam', 'SELECT * FROM team LIMIT 1').get());
  }

  async updateTeam(team) {
    this.prepare(
      'updateTeam',
      'UPDATE team SET name = ?, setup_completed_at = ? WHERE id = ?',
    ).run(team.name, team.setupCompletedAt, team.id);
  }

  async getVaultSource() {
    return mapRow(this.prepare('getVaultSource', 'SELECT * FROM vault_source LIMIT 1').get());
  }

  insertVaultSource(vaultSource) {
    this.prepare(
      'insertVaultSource',
      `INSERT INTO vault_source (
        id,
        provider,
        repository_id,
        repository_owner,
        repository_name,
        repository_full_name,
        default_branch,
        installation_id,
        installation_account_login,
        visibility,
        configured_by_email,
        configured_by_name,
        configured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      vaultSource.id,
      vaultSource.provider,
      vaultSource.repositoryId,
      vaultSource.repositoryOwner,
      vaultSource.repositoryName,
      vaultSource.repositoryFullName,
      vaultSource.defaultBranch,
      vaultSource.installationId,
      vaultSource.installationAccountLogin,
      vaultSource.visibility,
      vaultSource.configuredByEmail,
      vaultSource.configuredByName,
      vaultSource.configuredAt,
    );
  }

  async configureVaultSource({ auditEvent, team, vaultSource }) {
    this.transaction(() => {
      this.insertVaultSource(vaultSource);
      this.prepare(
        'updateTeam',
        'UPDATE team SET name = ?, setup_completed_at = ? WHERE id = ?',
      ).run(team.name, team.setupCompletedAt, team.id);
      this.insertAuditEvent(auditEvent);
    });
  }

  async createWorkspaceClaim(claim) {
    this.prepare(
      'createWorkspaceClaim',
      `INSERT INTO workspace_claims (id, email, token_hash, created_at, expires_at, claimed_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(claim.id, claim.email, claim.tokenHash, claim.createdAt, claim.expiresAt);
  }

  async getActiveWorkspaceClaim(now) {
    return mapRow(this.prepare(
      'getActiveWorkspaceClaim',
      `SELECT * FROM workspace_claims
       WHERE claimed_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(now));
  }

  async claimWorkspace({ auditEvent, claimId, membership, team }) {
    this.transaction(() => {
      this.prepare(
        'insertTeam',
        'INSERT INTO team (id, name, claimed_at, setup_completed_at) VALUES (?, ?, ?, ?)',
      ).run(team.id, team.name, team.claimedAt, team.setupCompletedAt);
      this.insertMembership(membership);
      this.prepare(
        'markWorkspaceClaimClaimed',
        'UPDATE workspace_claims SET claimed_at = ? WHERE id = ?',
      ).run(team.claimedAt, claimId);
      this.insertAuditEvent(auditEvent);
    });
  }

  insertMembership(membership) {
    this.prepare(
      'insertMembership',
      `INSERT INTO memberships (id, email, name, picture, role, joined_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      membership.id,
      membership.email,
      membership.name,
      membership.picture,
      membership.role,
      membership.joinedAt,
      membership.updatedAt,
    );
  }

  getMembershipByEmail(email) {
    return mapRow(this.prepare(
      'getMembershipByEmail',
      'SELECT * FROM memberships WHERE email = ?',
    ).get(email));
  }

  getMembershipById(id) {
    return mapRow(this.prepare(
      'getMembershipById',
      'SELECT * FROM memberships WHERE id = ?',
    ).get(id));
  }

  async listMemberships() {
    return this.prepare(
      'listMemberships',
      'SELECT * FROM memberships ORDER BY role = ? DESC, email ASC',
    ).all(HOSTED_ROLE_ADMIN).map(mapRow);
  }

  updateMembership(membership) {
    this.prepare(
      'updateMembership',
      'UPDATE memberships SET name = ?, picture = ?, role = ?, updated_at = ? WHERE id = ?',
    ).run(membership.name, membership.picture, membership.role, membership.updatedAt, membership.id);
  }

  deleteMembership(id) {
    this.prepare('deleteMembership', 'DELETE FROM memberships WHERE id = ?').run(id);
  }

  countAdminsExcept(email) {
    const row = this.prepare(
      'countAdminsExcept',
      'SELECT COUNT(*) AS count FROM memberships WHERE role = ? AND email != ?',
    ).get(HOSTED_ROLE_ADMIN, email);
    return Number(row?.count ?? 0);
  }

  async changeMembership({ actorId, membershipId, auditEvent, role = null, requireAdmin = true }) {
    return this.transaction(() => {
      const actor = this.getMembershipById(actorId);
      const membership = this.getMembershipById(membershipId);
      validateHostedMembershipChange({
        actor,
        actorId,
        hasOtherAdmin: membership?.role !== HOSTED_ROLE_ADMIN || this.countAdminsExcept(membership.email) > 0,
        membership,
        membershipId,
        requireAdmin,
        role,
      });

      const updated = role === null ? membership : { ...membership, role, updatedAt: auditEvent.createdAt };
      if (role === null) {
        this.deleteMembership(membershipId);
      } else {
        this.updateMembership(updated);
      }
      this.insertAuditEvent({
        ...auditEvent,
        actorEmail: actor.email,
        actorName: actor.name,
        targetEmail: membership.email,
        targetRole: updated.role,
      });
      return updated;
    });
  }

  async upsertPendingInvitation({ actorId, auditEvent, invitation }) {
    this.transaction(() => {
      requireHostedMembership(this.getMembershipById(actorId), { admin: true });
      if (!this.getTeam()?.setupCompletedAt) {
        throw createHostedError(409, 'Workspace setup must complete before inviting collaborators.', 'HOSTED_SETUP_INCOMPLETE');
      }
      if (this.getMembershipByEmail(invitation.email)) {
        throw createHostedError(409, 'This email is already a collaborator.', 'HOSTED_ALREADY_MEMBER');
      }
      this.prepare(
        'upsertPendingInvitation',
        `INSERT INTO invitations (
          id, email, role, invited_by_email, invited_by_name, created_at, expires_at, revoked_at, accepted_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(email) DO UPDATE SET
          id = excluded.id,
          role = excluded.role,
          invited_by_email = excluded.invited_by_email,
          invited_by_name = excluded.invited_by_name,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          revoked_at = NULL,
          accepted_at = NULL,
          updated_at = excluded.updated_at`,
      ).run(
        invitation.id,
        invitation.email,
        invitation.role,
        invitation.invitedByEmail,
        invitation.invitedByName,
        invitation.createdAt,
        invitation.expiresAt,
        invitation.updatedAt,
      );
      this.insertAuditEvent(auditEvent);
    });
  }

  async getPendingInvitationByEmail(email, now) {
    return mapRow(this.prepare(
      'getPendingInvitationByEmail',
      `SELECT * FROM invitations
       WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       LIMIT 1`,
    ).get(email, now));
  }

  async listPendingInvitations(now) {
    return this.prepare(
      'listPendingInvitations',
      `SELECT * FROM invitations
       WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC`,
    ).all(now).map(mapRow);
  }

  async updateInvitation({ actorId, auditEvent, invitationId, revokedAt = null, role = null }) {
    return this.transaction(() => {
      requireHostedMembership(this.getMembershipById(actorId), { admin: true });
      const invitation = mapRow(this.prepare(
        'updatePendingInvitation',
        `UPDATE invitations
         SET role = COALESCE(?, role), revoked_at = ?, updated_at = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
         RETURNING *`,
      ).get(role, revokedAt, auditEvent.createdAt, invitationId, auditEvent.createdAt));
      if (!invitation) {
        throw createHostedError(404, 'Pending invitation was not found.', 'HOSTED_INVITATION_NOT_FOUND');
      }
      this.insertAuditEvent({ ...auditEvent, targetEmail: invitation.email, targetRole: invitation.role });
      return invitation;
    });
  }

  async acceptInvitation({ auditEvent, invitation, membership }) {
    return this.transaction(() => {
      const accepted = this.prepare(
        'acceptInvitationUpdate',
        `UPDATE invitations SET accepted_at = ?, updated_at = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
         RETURNING role`,
      ).get(invitation.acceptedAt, invitation.updatedAt, invitation.id, invitation.acceptedAt);
      if (!accepted) {
        throw createHostedError(409, 'Invitation is no longer pending.', 'HOSTED_INVITATION_CONFLICT');
      }
      const acceptedMembership = { ...membership, role: accepted.role };
      this.insertMembership(acceptedMembership);
      this.insertAuditEvent({ ...auditEvent, targetRole: accepted.role });
      return acceptedMembership;
    });
  }

  async createAuditEvent(event) {
    this.insertAuditEvent(event);
  }

  insertAuditEvent(event) {
    this.prepare(
      'insertAuditEvent',
      `INSERT INTO audit_events (
        id, type, actor_email, actor_name, target_email, target_role, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.type,
      event.actorEmail,
      event.actorName,
      event.targetEmail,
      event.targetRole,
      JSON.stringify(event.metadata ?? {}),
      event.createdAt,
    );
  }

  async listAuditEvents({ before = null, limit = 51 } = {}) {
    if (before) {
      return this.prepare(
        'listAuditEventsBefore',
        `SELECT * FROM audit_events WHERE (created_at, id) < (?, ?)
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).all(before.createdAt, before.id, limit).map(mapRow);
    }
    return this.prepare(
      'listAuditEvents',
      'SELECT * FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ?',
    ).all(limit).map(mapRow);
  }

  async createOperationalSecurityEvent(event) {
    this.prepare(
      'insertOperationalSecurityEvent',
      `INSERT INTO operational_security_events (id, type, email, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.type,
      event.email,
      JSON.stringify(event.metadata ?? {}),
      event.createdAt,
    );
  }
}
