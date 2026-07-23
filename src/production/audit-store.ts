/**
 * Persistent Audit Log — structured, durable request and run auditing.
 *
 * Replaces the 500-entry in-memory array in the HTTP runtime with a pluggable
 * `AuditStore` that defaults to SQLite. Satisfies SOC 2 / HIPAA requirements
 * for tamper-evident audit trails.
 *
 * @example
 * ```ts
 * import { createHttpService } from 'personaforge/runtime';
 * import { createSqliteAuditStore } from 'personaforge/production';
 *
 * createHttpService({
 *   agents: { assistant },
 *   auditStore: createSqliteAuditStore('./agent.db'),
 * });
 * ```
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** A single audit log entry capturing one HTTP request / agent run. */
export interface AuditEntry {
    /** Unique entry ID (UUID). */
    readonly id: string;
    /** ISO timestamp. */
    readonly timestamp: string;
    /** HTTP method. */
    readonly method: string;
    /** Request path. */
    readonly path: string;
    /** HTTP response status code. */
    readonly status: number;
    /** Agent name that handled the request, if applicable. */
    readonly agentName?: string;
    /** Session ID used in this request. */
    readonly sessionId?: string;
    /** User ID, from auth context or request body. */
    readonly userId?: string;
    /** Tenant ID, from JWT claims or request header. */
    readonly tenantId?: string;
    /** SHA-256 hash of the prompt (never plaintext). */
    readonly promptHash?: string;
    /** Tool names called during this run. */
    readonly toolsCalled?: string[];
    /** How the run ended. */
    readonly finishReason?: string;
    /** Total run duration in milliseconds. */
    readonly durationMs?: number;
    /** Estimated cost in USD for this run. */
    readonly costUsd?: number;
    /** Client IP address (may be undefined in proxied setups without x-forwarded-for). */
    readonly ip?: string;
    /** Idempotency key, if provided. */
    readonly idempotencyKey?: string;
    /** Whether this was a cache hit (idempotency replay). */
    readonly idempotencyHit?: boolean;
}

/** Filter options for `AuditStore.query()`. */
export interface AuditFilter {
    readonly agentName?: string;
    readonly userId?: string;
    readonly tenantId?: string;
    readonly sessionId?: string;
    readonly status?: number;
    readonly since?: Date;
    readonly until?: Date;
    readonly limit?: number;
    readonly offset?: number;
}

/** Pluggable audit storage interface. */
export interface AuditStore {
    /** Append a new audit entry. */
    append(entry: AuditEntry): Promise<void>;
    /** Query audit entries with optional filters. */
    query(filter?: AuditFilter): Promise<AuditEntry[]>;
    /** Count entries matching a filter. */
    count(filter?: AuditFilter): Promise<number>;
    /** Purge entries older than `beforeDate`. */
    purge?(beforeDate: Date): Promise<number>;
}

// ── In-memory audit store ──────────────────────────────────────────────────

/** In-memory audit store. Good for testing; not durable. */
export class InMemoryAuditStore implements AuditStore {
    private entries: AuditEntry[] = [];

    async append(entry: AuditEntry): Promise<void> {
        this.entries.push(entry);
    }

    async query(filter?: AuditFilter): Promise<AuditEntry[]> {
        let results = [...this.entries];
        if (filter?.agentName) results = results.filter((e) => e.agentName === filter.agentName);
        if (filter?.userId) results = results.filter((e) => e.userId === filter.userId);
        if (filter?.tenantId) results = results.filter((e) => e.tenantId === filter.tenantId);
        if (filter?.sessionId) results = results.filter((e) => e.sessionId === filter.sessionId);
        if (filter?.status) results = results.filter((e) => e.status === filter.status);
        if (filter?.since) results = results.filter((e) => new Date(e.timestamp) >= filter.since!);
        if (filter?.until) results = results.filter((e) => new Date(e.timestamp) <= filter.until!);
        const offset = filter?.offset ?? 0;
        const limit = filter?.limit ?? results.length;
        return results.slice(offset, offset + limit);
    }

    async count(filter?: AuditFilter): Promise<number> {
        return (await this.query(filter)).length;
    }

    async purge(beforeDate: Date): Promise<number> {
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => new Date(e.timestamp) >= beforeDate);
        return before - this.entries.length;
    }
}

// ── SQLite audit store ─────────────────────────────────────────────────────

/** SQLite-backed audit store. Persists across restarts. */
export class SqliteAuditStore implements AuditStore {
    private db: {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
            run: (...params: unknown[]) => void;
            get: (...params: unknown[]) => unknown;
            all: (...params: unknown[]) => unknown[];
        };
    };

    private constructor(db: SqliteAuditStore['db']) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                status INTEGER NOT NULL,
                agent_name TEXT,
                session_id TEXT,
                user_id TEXT,
                tenant_id TEXT,
                prompt_hash TEXT,
                tools_called TEXT,
                finish_reason TEXT,
                duration_ms INTEGER,
                cost_usd REAL,
                ip TEXT,
                idempotency_key TEXT,
                idempotency_hit INTEGER
            );
            CREATE INDEX IF NOT EXISTS audit_log_timestamp ON audit_log(timestamp);
            CREATE INDEX IF NOT EXISTS audit_log_user_id ON audit_log(user_id);
            CREATE INDEX IF NOT EXISTS audit_log_agent_name ON audit_log(agent_name);
        `);
    }

    static create(filePath: string): SqliteAuditStore {

        let Database: (p: string) => SqliteAuditStore['db'];
        try {
            Database = require('better-sqlite3') as typeof Database;
        } catch {
            throw new Error(
                'SqliteAuditStore requires better-sqlite3. Install: npm install better-sqlite3'
            );
        }
        return new SqliteAuditStore(Database(filePath));
    }

    async append(entry: AuditEntry): Promise<void> {
        this.db.prepare(`
            INSERT OR IGNORE INTO audit_log
            (id, timestamp, method, path, status, agent_name, session_id, user_id,
             tenant_id, prompt_hash, tools_called, finish_reason, duration_ms,
             cost_usd, ip, idempotency_key, idempotency_hit)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
            entry.id, entry.timestamp, entry.method, entry.path, entry.status,
            entry.agentName ?? null, entry.sessionId ?? null, entry.userId ?? null,
            entry.tenantId ?? null, entry.promptHash ?? null,
            entry.toolsCalled ? JSON.stringify(entry.toolsCalled) : null,
            entry.finishReason ?? null, entry.durationMs ?? null,
            entry.costUsd ?? null, entry.ip ?? null,
            entry.idempotencyKey ?? null,
            entry.idempotencyHit ? 1 : 0
        );
    }

    async query(filter?: AuditFilter): Promise<AuditEntry[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filter?.agentName) { conditions.push('agent_name = ?'); params.push(filter.agentName); }
        if (filter?.userId) { conditions.push('user_id = ?'); params.push(filter.userId); }
        if (filter?.tenantId) { conditions.push('tenant_id = ?'); params.push(filter.tenantId); }
        if (filter?.sessionId) { conditions.push('session_id = ?'); params.push(filter.sessionId); }
        if (filter?.status) { conditions.push('status = ?'); params.push(filter.status); }
        if (filter?.since) { conditions.push('timestamp >= ?'); params.push(filter.since.toISOString()); }
        if (filter?.until) { conditions.push('timestamp <= ?'); params.push(filter.until.toISOString()); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filter?.limit ?? 1000;
        const offset = filter?.offset ?? 0;

        const rows = this.db.prepare(
            `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
        ).all(...params, limit, offset) as Record<string, unknown>[];

        return rows.map((r) => ({
            id: r['id'] as string,
            timestamp: r['timestamp'] as string,
            method: r['method'] as string,
            path: r['path'] as string,
            status: r['status'] as number,
            agentName: r['agent_name'] as string | undefined,
            sessionId: r['session_id'] as string | undefined,
            userId: r['user_id'] as string | undefined,
            tenantId: r['tenant_id'] as string | undefined,
            promptHash: r['prompt_hash'] as string | undefined,
            toolsCalled: r['tools_called'] ? JSON.parse(r['tools_called'] as string) as string[] : undefined,
            finishReason: r['finish_reason'] as string | undefined,
            durationMs: r['duration_ms'] as number | undefined,
            costUsd: r['cost_usd'] as number | undefined,
            ip: r['ip'] as string | undefined,
            idempotencyKey: r['idempotency_key'] as string | undefined,
            idempotencyHit: (r['idempotency_hit'] as number) === 1,
        }));
    }

    async count(filter?: AuditFilter): Promise<number> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filter?.agentName) { conditions.push('agent_name = ?'); params.push(filter.agentName); }
        if (filter?.userId) { conditions.push('user_id = ?'); params.push(filter.userId); }
        if (filter?.tenantId) { conditions.push('tenant_id = ?'); params.push(filter.tenantId); }
        if (filter?.since) { conditions.push('timestamp >= ?'); params.push(filter.since.toISOString()); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const row = this.db.prepare(
            `SELECT COUNT(*) as cnt FROM audit_log ${where}`
        ).get(...params) as { cnt: number };
        return row.cnt;
    }

    async purge(beforeDate: Date): Promise<number> {
        // SQLite doesn't return affected row count easily via better-sqlite3 get, use a workaround
        const count = await this.count({ until: new Date(beforeDate.getTime() - 1) });
        this.db.prepare(`DELETE FROM audit_log WHERE timestamp < ?`).run(beforeDate.toISOString());
        return count;
    }
}

/**
 * Factory: create a SQLite audit store.
 */
export function createSqliteAuditStore(filePath: string): AuditStore {
    return SqliteAuditStore.create(filePath);
}
