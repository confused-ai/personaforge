/**
 * @personaforge/session — InMemorySessionStore.
 *
 * SRP  — owns only in-memory session lifecycle.
 * DIP  — implements SessionStore interface.
 * DS   — Map<string, SessionData> for O(1) get/set/delete.
 *         Session IDs generated with crypto.randomUUID() (no uuid dep needed).
 *
 * Note: All methods return Promise.resolve() to satisfy the async interface contract
 *       without triggering require-await. The store is synchronous by nature.
 */

import type { SessionStore, SessionData, SessionMessage } from './types.js';

export interface InMemorySessionStoreOptions {
  /**
   * Number of days after which sessions are considered expired and eligible
   * for eviction by `pruneExpired()`. Measured from `updatedAt`.
   * When `undefined` (default) sessions are kept indefinitely.
   */
  retentionDays?: number;
  /**
   * Suppress the "in-memory store in production" warning. Set `true` when the
   * single-process, non-durable semantics are intentional in your deployment.
   */
  silenceProductionWarning?: boolean;
}

/** Emitted once per process — avoids log spam when many stores are created. */
let warnedInMemoryInProduction = false;

export class InMemorySessionStore implements SessionStore {
  /** O(1) average for all operations. */
  private readonly _store = new Map<string, SessionData>();
  private readonly _retentionMs: number | undefined;

  constructor(opts: InMemorySessionStoreOptions = {}) {
    this._retentionMs =
      opts.retentionDays !== undefined ? opts.retentionDays * 86_400_000 : undefined;

    // Multi-node deployments each keep a private copy of this Map — no shared
    // session state. Warn once so it is not silently used as the prod default.
    if (
      !opts.silenceProductionWarning &&
      !warnedInMemoryInProduction &&
      typeof process !== 'undefined' &&
      process.env?.NODE_ENV === 'production'
    ) {
      warnedInMemoryInProduction = true;
      console.warn(
        '[personaforge] InMemorySessionStore is active with NODE_ENV=production. ' +
        'It is process-local and non-durable — sessions are lost on restart and not shared across replicas. ' +
        'Use a Redis/Postgres-backed SessionStore for multi-node deployments, ' +
        'or pass { silenceProductionWarning: true } if this is intentional.',
      );
    }
  }

  get(id: string): Promise<SessionData | undefined> {
    return Promise.resolve(this._store.get(id));
  }

  create(data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string): Promise<SessionData> {
    // When a plain string is passed, use it as the session ID (agentId defaults to 'unknown').
    const id  = typeof data === 'string' ? data : crypto.randomUUID();
    const agentId = typeof data === 'string' ? 'unknown' : data.agentId;
    const userId  = typeof data === 'string' ? undefined  : data.userId;
    const msgs    = typeof data === 'string' ? []          : (data.messages ?? []);
    const now = Date.now();
    const session: SessionData = {
      id,
      agentId,
      messages:  msgs,
      createdAt: now,
      updatedAt: now,
      ...(userId !== undefined && { userId }),
    };
    this._store.set(id, session);
    return Promise.resolve(session);
  }

  update(id: string, data: { messages: SessionMessage[] }): Promise<void> {
    const existing = this._store.get(id);
    if (existing) {
      this._store.set(id, { ...existing, messages: data.messages, updatedAt: Date.now() });
    }
    return Promise.resolve();
  }

  getMessages(id: string): Promise<SessionMessage[]> {
    return Promise.resolve([...(this._store.get(id)?.messages ?? [])]);
  }

  appendMessage(id: string, message: SessionMessage): Promise<void> {
    const existing = this._store.get(id);
    if (existing) {
      this._store.set(id, {
        ...existing,
        messages: [...existing.messages, message],
        updatedAt: Date.now(),
      });
    }
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this._store.delete(id);
    return Promise.resolve();
  }

  /**
   * Remove all sessions whose `updatedAt` is older than `retentionDays`.
   * Returns the number of sessions deleted.
   * No-op when `retentionDays` was not configured.
   */
  pruneExpired(): number {
    if (this._retentionMs === undefined) return 0;
    const cutoff = Date.now() - this._retentionMs;
    let pruned = 0;
    for (const [id, session] of this._store) {
      if (session.updatedAt < cutoff) {
        this._store.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  /** O(1) — Map.size is a property. */
  get size(): number { return this._store.size; }
}

/** Factory function. */
export function createInMemoryStore(opts?: InMemorySessionStoreOptions): InMemorySessionStore {
  return new InMemorySessionStore(opts);
}
