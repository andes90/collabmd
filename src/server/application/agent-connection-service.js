import { createHash, randomBytes, randomUUID } from 'node:crypto';

const ALLOWED_CLIENT_KINDS = new Set(['codex', 'generic', 'pi']);
const ALLOWED_SCOPES = new Set(['vault:edit', 'vault:read']);

function hashToken(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function createAccessError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function publicConnection(connection) {
  return {
    clientKind: connection.clientKind,
    createdAt: connection.createdAt,
    expiresAt: connection.expiresAt,
    id: connection.id,
    label: connection.label,
    revokedAt: connection.revokedAt ?? null,
    scopes: connection.scopes,
  };
}

function normalizeScopes(scopes) {
  const normalized = Array.from(new Set(Array.isArray(scopes) ? scopes : []))
    .map((scope) => String(scope ?? '').trim())
    .filter((scope) => ALLOWED_SCOPES.has(scope));
  if (!normalized.includes('vault:read')) {
    throw createAccessError('AGENT_READ_SCOPE_REQUIRED', 'Read Vault Content scope is required');
  }
  return normalized.sort();
}

export class AgentConnectionService {
  constructor({
    authStrategy,
    connectionTtlMs,
    hostedWorkspaceService = null,
    now = Date.now,
    store,
  }) {
    this.authStrategy = authStrategy;
    this.connectionTtlMs = connectionTtlMs;
    this.hostedWorkspaceService = hostedWorkspaceService;
    this.now = now;
    this.store = store;
  }

  async initialize() {
    await this.store.initialize();
  }

  async resolveManagementSubject(user) {
    if (this.authStrategy === 'none') {
      throw createAccessError(
        'AGENT_MANAGEMENT_UNAVAILABLE',
        'No-auth workspaces expose MCP without managed Agent Connections',
        403,
      );
    }
    if (this.hostedWorkspaceService?.enabled) {
      const access = await this.hostedWorkspaceService.authorizeWorkspaceAccess({ user });
      if (!access.ok) {
        throw createAccessError(access.body.code, access.body.error, access.statusCode);
      }
      return {
        collaborator: access.membership,
        subjectEmail: access.membership.email,
        subjectId: access.membership.id,
        subjectType: 'hosted_membership',
      };
    }
    if (this.authStrategy === 'oidc' && user?.email) {
      return {
        collaborator: user,
        subjectEmail: user.email,
        subjectId: String(user.sub || user.email),
        subjectType: 'oidc_user',
      };
    }
    if (this.authStrategy === 'password') {
      return {
        collaborator: null,
        subjectEmail: '',
        subjectId: 'self-hosted',
        subjectType: 'password_workspace',
      };
    }
    throw createAccessError('AGENT_AUTH_REQUIRED', 'Authentication is required', 401);
  }

  async createConnection({ clientKind, label, scopes, user }) {
    const subject = await this.resolveManagementSubject(user);
    const normalizedLabel = String(label ?? '').trim().slice(0, 80);
    const normalizedClientKind = String(clientKind ?? '').trim().toLowerCase();
    if (!normalizedLabel) throw createAccessError('AGENT_LABEL_REQUIRED', 'Connection label is required');
    if (!ALLOWED_CLIENT_KINDS.has(normalizedClientKind)) {
      throw createAccessError('AGENT_CLIENT_INVALID', 'Unsupported agent client');
    }
    const normalizedScopes = normalizeScopes(scopes);
    const now = this.now();
    const token = `cmd_agent_${randomBytes(32).toString('base64url')}`;
    const connection = {
      clientKind: normalizedClientKind,
      createdAt: now,
      expiresAt: now + this.connectionTtlMs,
      id: randomUUID(),
      label: normalizedLabel,
      scopes: normalizedScopes,
      subjectEmail: subject.subjectEmail,
      subjectId: subject.subjectId,
      subjectType: subject.subjectType,
      tokenHash: hashToken(token),
    };
    await this.store.create(connection);
    await this.hostedWorkspaceService?.recordAgentConnectionEvent?.({
      connection,
      type: 'agent_connection_created',
      user,
    });
    return { connection: publicConnection(connection), token };
  }

  async listConnections(user) {
    const subject = await this.resolveManagementSubject(user);
    return (await this.store.listBySubject(subject.subjectType, subject.subjectId))
      .map(publicConnection);
  }

  async revokeConnection({ connectionId, user }) {
    const subject = await this.resolveManagementSubject(user);
    const revokedAt = this.now();
    const revoked = await this.store.revoke(
      connectionId,
      subject.subjectType,
      subject.subjectId,
      revokedAt,
    );
    if (!revoked) throw createAccessError('AGENT_CONNECTION_NOT_FOUND', 'Agent Connection not found', 404);
    await this.hostedWorkspaceService?.recordAgentConnectionEvent?.({
      connection: { id: connectionId, revokedAt },
      type: 'agent_connection_revoked',
      user,
    });
    return { ok: true };
  }

  async authenticateToken(token) {
    const tokenHash = hashToken(token);
    const connection = await this.store.getByTokenHash(tokenHash);
    const now = this.now();
    if (!connection || connection.revokedAt || connection.expiresAt <= now) {
      throw createAccessError('AGENT_TOKEN_INVALID', 'Agent Connection token is invalid or expired', 401);
    }

    let collaborator = connection.subjectEmail
      ? { email: connection.subjectEmail, name: connection.subjectEmail }
      : null;
    if (connection.subjectType === 'hosted_membership') {
      const access = await this.hostedWorkspaceService.authorizeWorkspaceAccess({ user: collaborator });
      if (!access.ok || access.membership.id !== connection.subjectId) {
        throw createAccessError('AGENT_MEMBERSHIP_REQUIRED', 'Team Membership is no longer active', 403);
      }
      collaborator = access.membership;
    }

    return {
      collaborator,
      connectionId: connection.id,
      scopes: connection.scopes,
    };
  }
}
