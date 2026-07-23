/**
 * @personaforge/session — FallbackSessionStore
 *
 * Wraps a primary `SessionStore` (Redis, SQLite, Postgres …) with automatic
 * degradation to an in-memory store when the primary fails to connect or
 * throws on reads/writes.
 *
 * ## Usage
 * ```ts
 * import { createFallbackSessionStore } from './index.js';
 * import { createRedisStore } from './index.js';
 *
 * const store = createFallbackSessionStore(
 *   createRedisStore({ redis: process.env.REDIS_URL }),
 *   { fallback: 'in-memory', onFallback: (err) => logger.warn('Session fallback', err) },
 * );
 * ```
 *
 * ## Behaviour
 * - Every method on the primary store is attempted first.
 * - On the very first error, the store enters degraded mode and routes all
 *   subsequent calls to the in-memory fallback until `recover()` is called.
 * - `onFallback` is invoked **once** when the store first degrades.
 * - `isDegraded()` lets operators query current health.
 * - `recover()` forces a re-check against the primary on the next call.
 *
 * ## Limitations
 * - Sessions written to the in-memory fallback are **not** replayed to the
 *   primary on recovery. This is intentional: the store is designed for
 *   graceful degradation (keep the agent running), not strong consistency.
 * - In-memory sessions are lost on process restart.
 */

import type { SessionStore, SessionData, SessionMessage } from './types.js';
import { InMemorySessionStore } from './in-memory.js';

export interface FallbackSessionStoreOptions {
  /**
   * Strategy to use on primary failure.
   * Currently only `'in-memory'` is supported.
   */
  readonly fallback: 'in-memory';
  /**
   * Called once when the store first enters degraded mode.
   * Use this to emit metrics, log warnings, or page on-call.
   */
  readonly onFallback?: (error: unknown) => void;
  /**
   * Called when the store successfully recovers to the primary.
   */
  readonly onRecover?: () => void;
}

/**
 * A `SessionStore` that delegates to a primary store and falls back to
 * an in-memory store on any failure.
 */
export class FallbackSessionStore implements SessionStore {
  private _degraded = false;
  private readonly _fallback: InMemorySessionStore;
  private _onFallbackFired = false;

  constructor(
    private readonly _primary: SessionStore,
    private readonly _opts: FallbackSessionStoreOptions,
  ) {
    this._fallback = new InMemorySessionStore();
  }

  /** Whether the store is currently using the fallback. */
  isDegraded(): boolean {
    return this._degraded;
  }

  /**
   * Force the store to attempt the primary again on the next operation.
   * Call this after the primary connection issue has been resolved.
   */
  recover(): void {
    this._degraded = false;
    this._onFallbackFired = false;
  }

  private _handleError(err: unknown): void {
    if (!this._degraded) {
      this._degraded = true;
    }
    if (!this._onFallbackFired) {
      this._onFallbackFired = true;
      this._opts.onFallback?.(err);
    }
  }

  private async _attempt<T>(fn: () => Promise<T>, fallbackFn: () => Promise<T>): Promise<T> {
    if (this._degraded) return fallbackFn();
    try {
      return await fn();
    } catch (err) {
      this._handleError(err);
      return fallbackFn();
    }
  }

  async get(id: string): Promise<SessionData | undefined> {
    return this._attempt(
      () => this._primary.get(id),
      () => this._fallback.get(id),
    );
  }

  async create(data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string): Promise<SessionData> {
    return this._attempt(
      () => this._primary.create(data),
      () => this._fallback.create(data),
    );
  }

  async update(id: string, data: { messages: SessionMessage[] }): Promise<void> {
    return this._attempt(
      () => this._primary.update(id, data),
      () => this._fallback.update(id, data),
    );
  }

  async getMessages(id: string): Promise<SessionMessage[]> {
    return this._attempt(
      () => this._primary.getMessages(id),
      () => this._fallback.getMessages(id),
    );
  }

  async appendMessage(id: string, message: SessionMessage): Promise<void> {
    return this._attempt(
      () => this._primary.appendMessage(id, message),
      () => this._fallback.appendMessage(id, message),
    );
  }

  async delete(id: string): Promise<void> {
    return this._attempt(
      () => this._primary.delete(id),
      () => this._fallback.delete(id),
    );
  }
}

/**
 * Wrap a `SessionStore` with automatic in-memory fallback on failure.
 *
 * ```ts
 * const store = createFallbackSessionStore(
 *   createRedisStore({ redis: process.env.REDIS_URL }),
 *   { fallback: 'in-memory', onFallback: (e) => console.warn('Redis down', e) },
 * );
 * ```
 */
export function createFallbackSessionStore(
  primary: SessionStore,
  options: FallbackSessionStoreOptions,
): FallbackSessionStore {
  return new FallbackSessionStore(primary, options);
}
