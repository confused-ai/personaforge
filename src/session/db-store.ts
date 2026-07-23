/**
 * @personaforge/session — DbSessionStore.
 *
 * Implements SessionStore backed by any AgentDb backend.
 * Messages are stored in session_data.messages so they survive process restarts.
 *
 * Usage:
 * ```ts
 * import { SqliteAgentDb } from '../db/index.js';
 * import { DbSessionStore } from './index.js';
 *
 * const db    = new SqliteAgentDb({ path: './data/agent.db' });
 * const store = new DbSessionStore(db);
 * ```
 */

import type { AgentDb, SessionRow } from '../db/index.js';
import type { SessionStore, SessionData, SessionMessage } from './types.js';
import { newId } from '../contracts/index.js';

function genId(): string {
  return newId('sess');
}

function now(): number { return Math.floor(Date.now() / 1000); }

interface SessionDataBlob extends Record<string, unknown> {
  messages: SessionMessage[];
  metadata?: Record<string, unknown>;
}

export class DbSessionStore implements SessionStore {
  private readonly _sessionLocks = new Map<string, Promise<void>>();

  constructor(private readonly db: AgentDb) {}

  async get(id: string): Promise<SessionData | undefined> {
    await this.db.init();
    const row = await this.db.getSession(id);
    if (!row) return undefined;
    return this._rowToSession(row);
  }

  async create(
    data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string,
  ): Promise<SessionData> {
    await this.db.init();
    const id      = typeof data === 'string' ? data : genId();
    const agentId = typeof data === 'string' ? 'unknown' : data.agentId;
    const userId  = typeof data === 'string' ? undefined  : data.userId;
    const messages = typeof data === 'string' ? [] : (data.messages ?? []);
    const ts = now();

    await this.db.upsertSession({
      sessionId:   id,
      sessionType: 'agent',
      agentId,
      ...(userId !== undefined && { userId }),
      sessionData: { messages },
    });

    return {
      id,
      agentId,
      messages,
      createdAt: ts,
      updatedAt: ts,
      ...(userId !== undefined && { userId }),
    };
  }

  async update(id: string, data: { messages: SessionMessage[] }): Promise<void> {
    await this._withSessionLock(id, async () => {
      await this._mutateSession(id, (existingBlob) => ({
        ...existingBlob,
        messages: [...data.messages],
      }));
    });
  }

  async getMessages(id: string): Promise<SessionMessage[]> {
    await this.db.init();
    const row = await this.db.getSession(id);
    if (!row?.session_data) return [];
    return [...this._parseSessionData(row.session_data).messages];
  }

  async appendMessage(id: string, message: SessionMessage): Promise<void> {
    await this._withSessionLock(id, async () => {
      await this._mutateSession(id, (existingBlob) => ({
        ...existingBlob,
        messages: [...existingBlob.messages, message],
      }));
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.init();
    await this.db.deleteSession(id);
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private async _withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this._sessionLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });

    this._sessionLocks.set(sessionId, current);
    await previous.catch(() => undefined);

    try {
      return await fn();
    } finally {
      release();
      if (this._sessionLocks.get(sessionId) === current) {
        this._sessionLocks.delete(sessionId);
      }
    }
  }

  private _parseSessionData(raw: string | null | undefined): SessionDataBlob {
    if (!raw) return { messages: [] };
    try {
      const parsed = JSON.parse(raw) as SessionDataBlob;
      return {
        ...parsed,
        messages: Array.isArray(parsed.messages) ? [...parsed.messages] : [],
      };
    } catch {
      return { messages: [] };
    }
  }

  private async _mutateSession(
    id: string,
    mutator: (existingBlob: SessionDataBlob) => SessionDataBlob,
  ): Promise<void> {
    await this.db.init();
    const existing = await this.db.getSession(id);
    if (!existing) return;

    const existingBlob = this._parseSessionData(existing.session_data);
    await this.db.upsertSession({
      sessionId:   id,
      sessionType: existing.session_type,
      ...(existing.agent_id != null && { agentId: existing.agent_id }),
      ...(existing.user_id  != null && { userId:  existing.user_id }),
      sessionData: mutator(existingBlob) satisfies Record<string, unknown>,
    });
  }

  private _rowToSession(row: SessionRow | null): SessionData {
    if (!row) throw new Error('row is null');
    const messages = this._parseSessionData(row.session_data).messages;
    return {
      id:        row.session_id,
      agentId:   row.agent_id   ?? 'unknown',
      messages,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.user_id != null && { userId: row.user_id }),
    };
  }
}

/** Convenience factory. */
export function createDbSessionStore(db: AgentDb): DbSessionStore {
  return new DbSessionStore(db);
}
