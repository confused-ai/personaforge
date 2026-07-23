/**
 * @personaforge/session — SQLite session store (durable, zero external server).
 *
 * SRP  — owns only SQLite session persistence.
 * DIP  — implements SessionStore; caller depends on the interface.
 * Lazy — better-sqlite3 is loaded inside the factory; zero cost if unused.
 * DS   — SQLite uses B-tree indexes on id (O(log n) get). For agent workloads
 *         where n (sessions) is small, this is effectively O(1).
 *         Messages stored as JSON blob — trade-off: simple schema vs query flexibility.
 */

import type { SessionStore, SessionData, SessionMessage } from './types.js';

const MISSING_SDK_MSG =
  '[personaforge] SQLite session store requires better-sqlite3.\n' +
  '  Install: npm install better-sqlite3';

interface SqliteStatement<TRow = unknown> {
  get(...args: unknown[]): TRow | undefined;
  run(...args: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare<TRow = unknown>(sql: string): SqliteStatement<TRow>;
}

type SqliteConstructor = new (path: string) => SqliteDatabase;

export interface SqliteSessionStoreOptions {
  /** Path to the SQLite file. Defaults to `:memory:`. */
  path?: string;
}

export function createSqliteStore(opts: SqliteSessionStoreOptions = {}): SessionStore {
  // Lazy SDK load — throws with helpful message if not installed

  let Database: SqliteConstructor;
  try {
    Database = require('better-sqlite3') as SqliteConstructor;
  } catch {
    throw new Error(MISSING_SDK_MSG);
  }

  const db = new Database(opts.path ?? ':memory:');

  // DDL — runs once synchronously (better-sqlite3 is synchronous)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL,
      user_id    TEXT,
      messages   TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
  `);

  const stmtGet = db.prepare<{ id: string; agent_id: string; user_id: string | null; messages: string; created_at: number; updated_at: number }>(
    'SELECT * FROM sessions WHERE id = ?'
  );
  const stmtInsert = db.prepare(
    'INSERT INTO sessions (id, agent_id, user_id, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const stmtUpdate = db.prepare(
    'UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?'
  );
  const stmtDelete = db.prepare('DELETE FROM sessions WHERE id = ?');

  function parseMessages(raw: string): SessionMessage[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as SessionMessage[]) : [];
    } catch {
      return [];
    }
  }

  function rowToSession(row: { id: string; agent_id: string; user_id: string | null; messages: string; created_at: number; updated_at: number }): SessionData {
    return {
      id:        row.id,
      agentId:   row.agent_id,
      messages:  parseMessages(row.messages),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.user_id !== null && { userId: row.user_id }),
    };
  }

  return {
    async get(id) {
      const row = stmtGet.get(id);
      return row ? rowToSession(row) : undefined;
    },

    async create(data) {
      const id      = typeof data === 'string' ? data : crypto.randomUUID();
      const agentId = typeof data === 'string' ? 'unknown' : data.agentId;
      const userId  = typeof data === 'string' ? undefined  : data.userId;
      const msgs    = typeof data === 'string' ? []          : (data.messages ?? []);
      const now = Date.now();
      stmtInsert.run(id, agentId, userId ?? null, JSON.stringify(msgs), now, now);
      return {
        id,
        agentId,
        messages: msgs,
        createdAt: now,
        updatedAt: now,
        ...(userId !== undefined && { userId }),
      };
    },

    async update(id, data) {
      stmtUpdate.run(JSON.stringify(data.messages), Date.now(), id);
    },

    async getMessages(id) {
      const row = stmtGet.get(id);
      return row ? parseMessages(row.messages) : [];
    },

    async appendMessage(id, message) {
      db.exec('BEGIN IMMEDIATE');
      let committed = false;
      try {
        const row = stmtGet.get(id);
        if (!row) {
          db.exec('ROLLBACK');
          committed = true;
          return;
        }
        const messages = parseMessages(row.messages);
        messages.push(message);
        stmtUpdate.run(JSON.stringify(messages), Date.now(), id);
        db.exec('COMMIT');
        committed = true;
      } finally {
        if (!committed) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // ignore rollback failures after a failed transaction
          }
        }
      }
    },

    async delete(id) {
      stmtDelete.run(id);
    },
  };
}
