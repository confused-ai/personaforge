/**
 * Durable Run Record — persistent execution metadata for every agent run.
 *
 * Every run (success, failure, or in-flight) is recorded as a `RunRecord`.
 * The store provides durable persistence so runs survive process restarts,
 * enabling crash recovery, run replay, and observability dashboards.
 *
 * @example
 * ```ts
 * import { createSqliteRunStore } from 'personaforge/production';
 * const store = createSqliteRunStore('./agent.db');
 * await store.save({ runId: 'run_abc', tenantId: 'acme', status: 'running', ... });
 * ```
 */

import type { Message } from '../core/types.js';

// ── Run Status ──────────────────────────────────────────────────────────────

export type RunStatus =
    | 'running'
    | 'paused'
    | 'awaiting_approval'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'timed_out';

// ── Run Record ──────────────────────────────────────────────────────────────

export interface RunRecord {
    readonly runId: string;
    readonly tenantId?: string;
    readonly userId?: string;
    readonly agentId?: string;
    readonly agentVersion?: string;
    readonly sessionId?: string;
    readonly parentRunId?: string;
    readonly status: RunStatus;
    readonly input?: string;
    readonly output?: string;
    readonly messages?: Message[];
    readonly startTime: string;
    readonly endTime?: string;
    readonly durationMs?: number;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
    readonly costUsd?: number;
    readonly model?: string;
    readonly provider?: string;
    readonly finishReason?: string;
    readonly error?: string;
    readonly errorCode?: string;
    readonly metadata?: Record<string, unknown>;
    readonly traceId?: string;
}

// ── Run Store Interface ─────────────────────────────────────────────────────

export interface RunStore {
    /** Persist a run record (insert or update). */
    save(record: RunRecord): Promise<void>;

    /** Load a run record by runId. */
    get(runId: string): Promise<RunRecord | null>;

    /** List runs, optionally filtered. */
    list(filter?: RunFilter): Promise<RunRecord[]>;

    /** Delete a run record. */
    delete(runId: string): Promise<void>;

    /** List incomplete runs (running/paused/awaiting_approval) for recovery. */
    listIncomplete(): Promise<RunRecord[]>;

    /** Count runs matching filter. */
    count(filter?: RunFilter): Promise<number>;

    /** Optional: close underlying connections. */
    close?(): Promise<void>;
}

export interface RunFilter {
    tenantId?: string;
    userId?: string;
    agentId?: string;
    sessionId?: string;
    status?: RunStatus | RunStatus[];
    limit?: number;
    offset?: number;
    startTime?: string;
    endTime?: string;
}

// ── In-Memory Run Store (default, no persistence) ───────────────────────────

export class InMemoryRunStore implements RunStore {
    private records = new Map<string, RunRecord>();

    async save(record: RunRecord): Promise<void> {
        this.records.set(record.runId, { ...record });
    }

    async get(runId: string): Promise<RunRecord | null> {
        return this.records.get(runId) ?? null;
    }

    async list(filter?: RunFilter): Promise<RunRecord[]> {
        let out = Array.from(this.records.values());
        if (filter) {
            if (filter.tenantId) out = out.filter((r) => r.tenantId === filter.tenantId);
            if (filter.userId) out = out.filter((r) => r.userId === filter.userId);
            if (filter.agentId) out = out.filter((r) => r.agentId === filter.agentId);
            if (filter.sessionId) out = out.filter((r) => r.sessionId === filter.sessionId);
            if (filter.status) {
                const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                out = out.filter((r) => statuses.includes(r.status));
            }
            if (filter.startTime) out = out.filter((r) => r.startTime >= filter.startTime!);
            if (filter.endTime) out = out.filter((r) => r.startTime <= filter.endTime!);
        }
        out.sort((a, b) => b.startTime.localeCompare(a.startTime));
        if (filter?.offset) out = out.slice(filter.offset);
        if (filter?.limit) out = out.slice(0, filter.limit);
        return out;
    }

    async delete(runId: string): Promise<void> {
        this.records.delete(runId);
    }

    async listIncomplete(): Promise<RunRecord[]> {
        return Array.from(this.records.values()).filter(
            (r) => r.status === 'running' || r.status === 'paused' || r.status === 'awaiting_approval',
        );
    }

    async count(filter?: RunFilter): Promise<number> {
        const results = await this.list(filter);
        return results.length;
    }
}

// ── SQLite Run Store ────────────────────────────────────────────────────────

interface Sqlite3Db {
    exec(sql: string): void;
    prepare(sql: string): {
        run(...params: unknown[]): unknown;
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
    };
}

type Sqlite3Ctor = new (path: string) => Sqlite3Db;

const MISSING_BETTER_SQLITE3 =
    '[personaforge/production] SqliteRunStore requires better-sqlite3.\n' +
    '  Install: npm install better-sqlite3';

export class SqliteRunStore implements RunStore {
    private db: Sqlite3Db;

    private constructor(db: Sqlite3Db) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS personaforge_runs (
                run_id            TEXT NOT NULL PRIMARY KEY,
                tenant_id         TEXT,
                user_id           TEXT,
                agent_id          TEXT,
                agent_version     TEXT,
                session_id        TEXT,
                parent_run_id     TEXT,
                status            TEXT NOT NULL DEFAULT 'running',
                input             TEXT,
                output            TEXT,
                start_time        TEXT NOT NULL,
                end_time          TEXT,
                duration_ms       INTEGER,
                prompt_tokens     INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                total_tokens      INTEGER DEFAULT 0,
                cost_usd          REAL DEFAULT 0,
                model             TEXT,
                provider          TEXT,
                finish_reason     TEXT,
                error             TEXT,
                error_code        TEXT,
                metadata          TEXT,
                trace_id          TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_runs_tenant   ON personaforge_runs (tenant_id);
            CREATE INDEX IF NOT EXISTS idx_runs_status   ON personaforge_runs (status);
            CREATE INDEX IF NOT EXISTS idx_runs_agent    ON personaforge_runs (agent_id);
            CREATE INDEX IF NOT EXISTS idx_runs_session  ON personaforge_runs (session_id);
            CREATE INDEX IF NOT EXISTS idx_runs_start    ON personaforge_runs (start_time DESC);
        `);
    }

    static create(filePath: string): SqliteRunStore {
        let Database: Sqlite3Ctor;
        try {
            Database = require('better-sqlite3') as Sqlite3Ctor;
        } catch {
            throw new Error(MISSING_BETTER_SQLITE3);
        }
        return new SqliteRunStore(new Database(filePath));
    }

    static fromDb(db: Sqlite3Db): SqliteRunStore {
        return new SqliteRunStore(db);
    }

    async save(record: RunRecord): Promise<void> {
        this.db.prepare(`
            INSERT INTO personaforge_runs (
                run_id, tenant_id, user_id, agent_id, agent_version, session_id, parent_run_id,
                status, input, output, start_time, end_time, duration_ms,
                prompt_tokens, completion_tokens, total_tokens, cost_usd,
                model, provider, finish_reason, error, error_code, metadata, trace_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
                status=excluded.status, output=excluded.output, end_time=excluded.end_time,
                duration_ms=excluded.duration_ms, prompt_tokens=excluded.prompt_tokens,
                completion_tokens=excluded.completion_tokens, total_tokens=excluded.total_tokens,
                cost_usd=excluded.cost_usd, finish_reason=excluded.finish_reason,
                error=excluded.error, error_code=excluded.error_code,
                metadata=excluded.metadata, updated_at=CURRENT_TIMESTAMP
        `).run(
            record.runId, record.tenantId ?? null, record.userId ?? null,
            record.agentId ?? null, record.agentVersion ?? null,
            record.sessionId ?? null, record.parentRunId ?? null,
            record.status, record.input ?? null, record.output ?? null,
            record.startTime, record.endTime ?? null, record.durationMs ?? null,
            record.promptTokens ?? 0, record.completionTokens ?? 0,
            record.totalTokens ?? 0, record.costUsd ?? 0,
            record.model ?? null, record.provider ?? null,
            record.finishReason ?? null, record.error ?? null,
            record.errorCode ?? null,
            record.metadata ? JSON.stringify(record.metadata) : null,
            record.traceId ?? null,
        );
    }

    async get(runId: string): Promise<RunRecord | null> {
        const row = this.db.prepare(
            'SELECT * FROM personaforge_runs WHERE run_id = ?',
        ).get(runId) as Record<string, unknown> | undefined;
        return row ? rowToRunRecord(row) : null;
    }

    async list(filter?: RunFilter): Promise<RunRecord[]> {
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (filter?.tenantId) { clauses.push('tenant_id = ?'); params.push(filter.tenantId); }
        if (filter?.userId) { clauses.push('user_id = ?'); params.push(filter.userId); }
        if (filter?.agentId) { clauses.push('agent_id = ?'); params.push(filter.agentId); }
        if (filter?.sessionId) { clauses.push('session_id = ?'); params.push(filter.sessionId); }
        if (filter?.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
            params.push(...statuses);
        }
        if (filter?.startTime) { clauses.push('start_time >= ?'); params.push(filter.startTime); }
        if (filter?.endTime) { clauses.push('start_time <= ?'); params.push(filter.endTime); }
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        const limit = filter?.limit ? ` LIMIT ${filter.limit}` : '';
        const offset = filter?.offset ? ` OFFSET ${filter.offset}` : '';
        const rows = this.db.prepare(
            `SELECT * FROM personaforge_runs${where} ORDER BY start_time DESC${limit}${offset}`,
        ).all(...params) as Record<string, unknown>[];
        return rows.map(rowToRunRecord);
    }

    async delete(runId: string): Promise<void> {
        this.db.prepare('DELETE FROM personaforge_runs WHERE run_id = ?').run(runId);
    }

    async listIncomplete(): Promise<RunRecord[]> {
        const rows = this.db.prepare(
            "SELECT * FROM personaforge_runs WHERE status IN ('running', 'paused', 'awaiting_approval') ORDER BY start_time ASC",
        ).all() as Record<string, unknown>[];
        return rows.map(rowToRunRecord);
    }

    async count(filter?: RunFilter): Promise<number> {
        const records = await this.list(filter);
        return records.length;
    }

    async close(): Promise<void> {
        this.db.exec('CLOSE');
    }
}

function rowToRunRecord(row: Record<string, unknown>): RunRecord {
    return {
        runId: row.run_id as string,
        tenantId: (row.tenant_id as string) ?? undefined,
        userId: (row.user_id as string) ?? undefined,
        agentId: (row.agent_id as string) ?? undefined,
        agentVersion: (row.agent_version as string) ?? undefined,
        sessionId: (row.session_id as string) ?? undefined,
        parentRunId: (row.parent_run_id as string) ?? undefined,
        status: row.status as RunStatus,
        input: (row.input as string) ?? undefined,
        output: (row.output as string) ?? undefined,
        startTime: row.start_time as string,
        endTime: (row.end_time as string) ?? undefined,
        durationMs: (row.duration_ms as number) ?? undefined,
        promptTokens: (row.prompt_tokens as number) ?? undefined,
        completionTokens: (row.completion_tokens as number) ?? undefined,
        totalTokens: (row.total_tokens as number) ?? undefined,
        costUsd: (row.cost_usd as number) ?? undefined,
        model: (row.model as string) ?? undefined,
        provider: (row.provider as string) ?? undefined,
        finishReason: (row.finish_reason as string) ?? undefined,
        error: (row.error as string) ?? undefined,
        errorCode: (row.error_code as string) ?? undefined,
        metadata: row.metadata ? (JSON.parse(row.metadata as string) as Record<string, unknown>) : undefined,
        traceId: (row.trace_id as string) ?? undefined,
    };
}

/** Factory: create SQLite run store. */
export function createSqliteRunStore(filePath: string): RunStore {
    return SqliteRunStore.create(filePath);
}
