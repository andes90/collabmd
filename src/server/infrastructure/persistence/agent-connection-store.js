import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

function parseScopes(value) {
  try {
    const scopes = JSON.parse(value || '[]');
    return Array.isArray(scopes) ? scopes : [];
  } catch {
    return [];
  }
}

function rowToConnection(row) {
  if (!row) return null;
  return {
    clientKind: row.client_kind,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    label: row.label,
    revokedAt: row.revoked_at,
    scopes: parseScopes(row.scopes_json),
    subjectEmail: row.subject_email,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    tokenHash: row.token_hash,
  };
}

export class AgentConnectionStore {
  constructor({ dbPath }) {
    this.dbPath = dbPath;
    this.db = null;
    this.statements = new Map();
  }

  async initialize() {
    if (this.db) return;
    await mkdir(dirname(this.dbPath), { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_connections (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        subject_email TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL,
        client_kind TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS agent_connections_subject_idx
        ON agent_connections(subject_type, subject_id, created_at DESC);
    `);
  }

  prepare(key, sql) {
    if (!this.statements.has(key)) this.statements.set(key, this.db.prepare(sql));
    return this.statements.get(key);
  }

  async close() {
    this.statements.clear();
    this.db?.close();
    this.db = null;
  }

  async create(connection) {
    this.prepare(
      'create',
      `INSERT INTO agent_connections (
        id, subject_type, subject_id, subject_email, label, client_kind,
        scopes_json, token_hash, created_at, expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      connection.id,
      connection.subjectType,
      connection.subjectId,
      connection.subjectEmail,
      connection.label,
      connection.clientKind,
      JSON.stringify(connection.scopes),
      connection.tokenHash,
      connection.createdAt,
      connection.expiresAt,
    );
    return connection;
  }

  async getByTokenHash(tokenHash) {
    return rowToConnection(this.prepare(
      'getByTokenHash',
      'SELECT * FROM agent_connections WHERE token_hash = ? LIMIT 1',
    ).get(tokenHash));
  }

  async listBySubject(subjectType, subjectId) {
    return this.prepare(
      'listBySubject',
      `SELECT * FROM agent_connections
       WHERE subject_type = ? AND subject_id = ?
       ORDER BY created_at DESC`,
    ).all(subjectType, subjectId).map(rowToConnection);
  }

  async revoke(id, subjectType, subjectId, revokedAt) {
    const result = this.prepare(
      'revoke',
      `UPDATE agent_connections SET revoked_at = ?
       WHERE id = ? AND subject_type = ? AND subject_id = ? AND revoked_at IS NULL`,
    ).run(revokedAt, id, subjectType, subjectId);
    return Number(result.changes) > 0;
  }

}
