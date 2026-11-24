import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class SqliteStore {
  constructor({ dbPath }) {
    this.dbPath = dbPath;
    this.db = null;
    this.statements = new Map();
  }

  async open({ pragmas = ['journal_mode = WAL'], schema = '' } = {}) {
    if (this.db) return;
    await mkdir(dirname(this.dbPath), { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    this.db = new DatabaseSync(this.dbPath);
    for (const pragma of pragmas) {
      this.db.exec(`PRAGMA ${pragma}`);
    }
    if (schema) {
      this.db.exec(schema);
    }
  }

  prepare(key, sql) {
    if (!this.statements.has(key)) {
      this.statements.set(key, this.db.prepare(sql));
    }
    return this.statements.get(key);
  }

  async close() {
    this.statements.clear();
    this.db?.close();
    this.db = null;
  }
}
