import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createHostedError, HOSTED_ROLE_ADMIN } from '../../domain/hosted-workspace-contract.js';

function rowToTeam(row) {
  if (!row) {
    return null;
  }
  return {
    claimedAt: row.claimed_at,
    id: row.id,
    name: row.name,
    setupCompletedAt: row.setup_completed_at,
  };
}

function rowToMembership(row) {
  if (!row) {
    return null;
  }
  return {
    email: row.email,
    id: row.id,
    joinedAt: row.joined_at,
    name: row.name,
    picture: row.picture,
    role: row.role,
    updatedAt: row.updated_at,
  };
}

function rowToInvitation(row) {
  if (!row) {
    return null;
  }
  return {
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    email: row.email,
    expiresAt: row.expires_at,
    id: row.id,
    invitedByEmail: row.invited_by_email,
    invitedByName: row.invited_by_name,
    revokedAt: row.revoked_at,
    role: row.role,
    updatedAt: row.updated_at,
  };
}

function rowToWorkspaceClaim(row) {
  if (!row) {
    return null;
  }
  return {
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    email: row.email,
    expiresAt: row.expires_at,
    id: row.id,
    tokenHash: row.token_hash,
  };
}

function rowToVaultSource(row) {
  if (!row) {
    return null;
  }
  return {
    configuredAt: row.configured_at,
    configuredByEmail: row.configured_by_email,
    configuredByName: row.configured_by_name,
    defaultBranch: row.default_branch,
    id: row.id,
    installationAccountLogin: row.installation_account_login,
    installationId: row.installation_id,
    provider: row.provider,
    repositoryFullName: row.repository_full_name,
    repositoryId: row.repository_id,
    repositoryName: row.repository_name,
    repositoryOwner: row.repository_owner,
    visibility: row.visibility,
  };
}

function parseMetadata(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function rowToAuditEvent(row) {
  if (!row) {
    return null;
  }
  return {
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    createdAt: row.created_at,
    id: row.id,
    metadata: parseMetadata(row.metadata_json),
    targetEmail: row.target_email,
    targetRole: row.target_role,
    type: row.type,
  };
}

export class HostedMetadataStore {
  constructor({ dbPath }) {
    this.dbPath = dbPath;
    this.db = null;
    this.statements = new Map();
  }

  async initialize() {
    if (this.db) {
      return;
    }

    await mkdir(dirname(this.dbPath), { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
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
    `);
  }

  async close() {
    this.statements.clear();
    this.db?.close();
    this.db = null;
  }

  prepare(key, sql) {
    if (!this.statements.has(key)) {
      this.statements.set(key, this.db.prepare(sql));
    }
    return this.statements.get(key);
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

  async getTeam() {
    return rowToTeam(this.prepare('getTeam', 'SELECT * FROM team LIMIT 1').get());
  }

  async updateTeam(team) {
    this.prepare(
      'updateTeam',
      'UPDATE team SET name = ?, setup_completed_at = ? WHERE id = ?',
    ).run(team.name, team.setupCompletedAt, team.id);
  }

  async getVaultSource() {
    return rowToVaultSource(this.prepare('getVaultSource', 'SELECT * FROM vault_source LIMIT 1').get());
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
    return rowToWorkspaceClaim(this.prepare(
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

  async getMembershipByEmail(email) {
    return rowToMembership(this.prepare(
      'getMembershipByEmail',
      'SELECT * FROM memberships WHERE email = ?',
    ).get(email));
  }

  getMembershipById(id) {
    return rowToMembership(this.prepare(
      'getMembershipById',
      'SELECT * FROM memberships WHERE id = ?',
    ).get(id));
  }

  async listMemberships() {
    return this.prepare(
      'listMemberships',
      'SELECT * FROM memberships ORDER BY role = ? DESC, email ASC',
    ).all(HOSTED_ROLE_ADMIN).map(rowToMembership);
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
      if (!actor) {
        throw createHostedError(403, 'Team membership is required.', 'HOSTED_MEMBERSHIP_REQUIRED');
      }
      const isSelfLeave = !requireAdmin && actorId === membershipId && role === null;
      if (!isSelfLeave && actor.role !== HOSTED_ROLE_ADMIN) {
        throw createHostedError(403, 'Team Admin role is required.', 'HOSTED_ADMIN_REQUIRED');
      }

      const membership = this.getMembershipById(membershipId);
      if (!membership) {
        throw createHostedError(404, 'Membership was not found.', 'HOSTED_MEMBERSHIP_NOT_FOUND');
      }
      if (membership.role === HOSTED_ROLE_ADMIN && role !== HOSTED_ROLE_ADMIN
        && this.countAdminsExcept(membership.email) < 1) {
        throw createHostedError(409, 'A team must always have at least one Team Admin.', 'HOSTED_LAST_ADMIN');
      }

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

  async upsertPendingInvitation(invitation) {
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
  }

  async getInvitationById(id) {
    return rowToInvitation(this.prepare(
      'getInvitationById',
      'SELECT * FROM invitations WHERE id = ?',
    ).get(id));
  }

  async getPendingInvitationByEmail(email, now) {
    return rowToInvitation(this.prepare(
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
    ).all(now).map(rowToInvitation);
  }

  async updateInvitation(invitation) {
    this.prepare(
      'updateInvitation',
      `UPDATE invitations
       SET role = ?, revoked_at = ?, accepted_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      invitation.role,
      invitation.revokedAt,
      invitation.acceptedAt,
      invitation.updatedAt,
      invitation.id,
    );
  }

  async acceptInvitation({ auditEvent, invitation, membership }) {
    this.transaction(() => {
      this.prepare(
        'acceptInvitationUpdate',
        'UPDATE invitations SET accepted_at = ?, updated_at = ? WHERE id = ?',
      ).run(invitation.acceptedAt, invitation.updatedAt, invitation.id);
      this.insertMembership(membership);
      this.insertAuditEvent(auditEvent);
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

  async listAuditEvents() {
    return this.prepare(
      'listAuditEvents',
      'SELECT * FROM audit_events ORDER BY created_at DESC',
    ).all().map(rowToAuditEvent);
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
