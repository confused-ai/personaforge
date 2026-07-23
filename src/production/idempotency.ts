/**
 * Idempotency store — deduplicates agent.run() calls via X-Idempotency-Key.
 *
 * When a client retries a failed HTTP request (network error, 5xx), the same
 * `X-Idempotency-Key` header causes the server to return the cached response
 * instead of re-executing the agent (preventing duplicate emails, charges, etc.).
 *
 * @example
 * ```ts
 * // In createHttpService options:
 * import { createSqliteIdempotencyStore } from 'personaforge/production';
 *
 * createHttpService({
 *   agents: { assistant },
 *   idempotency: {
 *     store: createSqliteIdempotencyStore('./agent.db'),
 *     ttlMs: 24 * 60 * 60 * 1000, // 24 hours
 *   },
 * });
 * ```
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Processing state for an idempotency record. */
export type IdempotencyState = 'pending' | 'completed';

/** Cached response entry. */
export interface IdempotencyEntry {
    readonly key: string;
    /** Lifecycle state — `pending` while the request is in-flight, `completed` once cached. */
    readonly state: IdempotencyState;
    readonly responseStatus: number;
    readonly responseBody: string;
    readonly createdAt: string;
    readonly expiresAt: string;
}

/** Outcome of an atomic {@link IdempotencyStore.reserve}. */
export interface IdempotencyReservation {
    /** True when this caller atomically created the pending record (won the race). */
    readonly created: boolean;
    /** The existing entry when `created` is false (may be `pending` or `completed`). */
    readonly existing: IdempotencyEntry | null;
}

/** Pluggable idempotency persistence interface. */
export interface IdempotencyStore {
    /**
     * Atomically reserve a key (Stripe-style). Inserts a `pending` record only if
     * the key does not already exist. Returns `{ created: true }` for the caller that
     * won the race; otherwise `{ created: false, existing }` so the caller can return
     * the cached completed response or a 409 "in progress".
     */
    reserve(key: string, ttlMs: number): Promise<IdempotencyReservation>;
    /** Fetch an existing entry, or null if not found / expired. */
    get(key: string): Promise<IdempotencyEntry | null>;
    /** Store/complete a response for a key with a TTL. */
    set(key: string, status: number, body: string, ttlMs: number): Promise<void>;
    /**
     * Release a `pending` reservation that never completed (e.g. the agent threw),
     * so a subsequent retry can re-reserve. No-op if the key is already completed.
     */
    release(key: string): Promise<void>;
    /** Remove expired entries (optional housekeeping). */
    prune?(): Promise<void>;
}

/** Options for idempotency in `createHttpService`. */
export interface IdempotencyOptions {
    /** Storage backend. Defaults to InMemoryIdempotencyStore. */
    store?: IdempotencyStore;
    /** How long to cache a response (ms). Default: 86_400_000 (24 hours). */
    ttlMs?: number;
    /**
     * Header name to read the idempotency key from.
     * Default: `'x-idempotency-key'` (case-insensitive).
     */
    headerName?: string;
}

// ── In-memory store ────────────────────────────────────────────────────────

/** Default in-memory idempotency store. Cleared on restart. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
    private cache = new Map<string, IdempotencyEntry>();

    /**
     * Atomic check-and-set: JS is single-threaded, so the synchronous read+write
     * below cannot be interleaved by a concurrent reserve() on the same key.
     */
    async reserve(key: string, ttlMs: number): Promise<IdempotencyReservation> {
        const existing = this.cache.get(key);
        if (existing && new Date(existing.expiresAt) >= new Date()) {
            return { created: false, existing };
        }
        const now = new Date();
        this.cache.set(key, {
            key,
            state: 'pending',
            responseStatus: 0,
            responseBody: '',
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        });
        return { created: true, existing: null };
    }

    async get(key: string): Promise<IdempotencyEntry | null> {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (new Date(entry.expiresAt) < new Date()) {
            this.cache.delete(key);
            return null;
        }
        return entry;
    }

    async set(key: string, status: number, body: string, ttlMs: number): Promise<void> {
        const now = new Date();
        this.cache.set(key, {
            key,
            state: 'completed',
            responseStatus: status,
            responseBody: body,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        });
    }

    async release(key: string): Promise<void> {
        const entry = this.cache.get(key);
        if (entry && entry.state === 'pending') this.cache.delete(key);
    }

    async prune(): Promise<void> {
        const now = new Date();
        for (const [k, v] of this.cache) {
            if (new Date(v.expiresAt) < now) this.cache.delete(k);
        }
    }
}

// ── SQLite store ───────────────────────────────────────────────────────────

/** SQLite-backed idempotency store. Survives restarts. */
export class SqliteIdempotencyStore implements IdempotencyStore {
    private db: {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
            run: (...params: unknown[]) => { changes: number };
            get: (...params: unknown[]) => unknown;
        };
    };

    private constructor(db: SqliteIdempotencyStore['db']) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS idempotency_cache (
                key TEXT PRIMARY KEY,
                state TEXT NOT NULL DEFAULT 'completed',
                response_status INTEGER NOT NULL,
                response_body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
        `);
        // Best-effort migration for pre-existing tables lacking the state column.
        try {
            this.db.exec(`ALTER TABLE idempotency_cache ADD COLUMN state TEXT NOT NULL DEFAULT 'completed'`);
        } catch {
            /* column already exists */
        }
    }

    static create(filePath: string): SqliteIdempotencyStore {

        let Database: (p: string) => SqliteIdempotencyStore['db'];
        try {
            Database = require('better-sqlite3') as typeof Database;
        } catch {
            throw new Error(
                'SqliteIdempotencyStore requires better-sqlite3. Install: npm install better-sqlite3'
            );
        }
        return new SqliteIdempotencyStore(Database(filePath));
    }

    /**
     * Atomic reserve via `INSERT ... ON CONFLICT DO NOTHING`. SQLite serializes
     * writes, so exactly one concurrent caller observes `changes === 1`.
     */
    async reserve(key: string, ttlMs: number): Promise<IdempotencyReservation> {
        const now = new Date();
        const result = this.db.prepare(
            `INSERT INTO idempotency_cache (key, state, response_status, response_body, created_at, expires_at)
             VALUES (?, 'pending', 0, '', ?, ?)
             ON CONFLICT(key) DO NOTHING`
        ).run(key, now.toISOString(), new Date(now.getTime() + ttlMs).toISOString());
        if (result.changes === 1) {
            return { created: true, existing: null };
        }
        return { created: false, existing: await this.get(key) };
    }

    async get(key: string): Promise<IdempotencyEntry | null> {
        const row = this.db.prepare(
            `SELECT key, state, response_status, response_body, created_at, expires_at
             FROM idempotency_cache WHERE key = ? AND expires_at > ?`
        ).get(key, new Date().toISOString()) as {
            key: string; state?: string; response_status: number; response_body: string;
            created_at: string; expires_at: string;
        } | undefined;
        if (!row) return null;
        return {
            key: row.key,
            state: (row.state as IdempotencyState | undefined) ?? 'completed',
            responseStatus: row.response_status,
            responseBody: row.response_body,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
        };
    }

    async set(key: string, status: number, body: string, ttlMs: number): Promise<void> {
        const now = new Date();
        this.db.prepare(
            `INSERT INTO idempotency_cache (key, state, response_status, response_body, created_at, expires_at)
             VALUES (?, 'completed', ?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               state='completed',
               response_status=excluded.response_status,
               response_body=excluded.response_body,
               expires_at=excluded.expires_at`
        ).run(key, status, body, now.toISOString(), new Date(now.getTime() + ttlMs).toISOString());
    }

    async release(key: string): Promise<void> {
        this.db.prepare(`DELETE FROM idempotency_cache WHERE key = ? AND state = 'pending'`).run(key);
    }

    async prune(): Promise<void> {
        this.db.prepare(`DELETE FROM idempotency_cache WHERE expires_at < ?`).run(new Date().toISOString());
    }
}

/**
 * Factory: create a SQLite idempotency store.
 */
export function createSqliteIdempotencyStore(filePath: string): IdempotencyStore {
    return SqliteIdempotencyStore.create(filePath);
}
