/**
 * Structured execution feedback: storage and signal extraction.
 *
 * Every agent execution can produce one or more structured, source-labelled
 * feedback records (human / user / AI critique / self-reflection / peer /
 * reward / metric). A `FeedbackRepo` stores those records durably (in-memory
 * or SQLite) so scoring, optimizers and pipelines can learn from them without
 * coupling the agent runtime to storage.
 */

import type {
    ExecutionFeedback,
    ExecutionSignal,
    FeedbackSource,
} from './types.js';

// ── Signal extraction ─────────────────────────────────────────────────────────

/** Build a normalised `ExecutionSignal` from a partial observation. */
export function createExecutionSignal(
    partial: Omit<ExecutionSignal, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): ExecutionSignal {
    return {
        ...(partial as object),
        id: partial.id ?? crypto.randomUUID(),
        createdAt: partial.createdAt ?? new Date().toISOString(),
    } as unknown as ExecutionSignal;
}

// ── FeedbackRepo ──────────────────────────────────────────────────────────────

/** Filter accepted by every `FeedbackRepo` implementation. */
export interface FeedbackFilter {
    readonly agentId?: string;
    readonly runId?: string;
    readonly sessionId?: string;
    readonly source?: FeedbackSource | readonly FeedbackSource[];
    readonly taskType?: string;
    readonly since?: string; // ISO-8601 inclusive lower bound
    readonly limit?: number;
    readonly offset?: number;
}

/** Storage contract for structured execution feedback. */
export interface FeedbackRepo {
    /** Record new feedback. Generates `id` and `createdAt` when omitted. */
    append(
        entry: Omit<ExecutionFeedback, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ): Promise<ExecutionFeedback>;
    /** Query stored feedback. */
    list(filter?: FeedbackFilter): Promise<ExecutionFeedback[]>;
    /** Count stored feedback matching the filter. */
    count(filter?: FeedbackFilter): Promise<number>;
    /** Fetch a single feedback record. */
    get(id: string): Promise<ExecutionFeedback | null>;
    /** Delete a single feedback record. */
    delete(id: string): Promise<boolean>;
}

// ── In-memory ────────────────────────────────────────────────────────────────

export class InMemoryFeedbackRepo implements FeedbackRepo {
    private _entries: ExecutionFeedback[] = [];

    async append(
        entry: Omit<ExecutionFeedback, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ): Promise<ExecutionFeedback> {
        const full: ExecutionFeedback = {
            ...entry,
            id: entry.id ?? crypto.randomUUID(),
            createdAt: entry.createdAt ?? new Date().toISOString(),
        };
        this._entries.push(full);
        return full;
    }

    async list(filter: FeedbackFilter = {}): Promise<ExecutionFeedback[]> {
        let rows = [...this._entries];
        if (filter.agentId) rows = rows.filter((e) => e.agentId === filter.agentId);
        if (filter.runId) rows = rows.filter((e) => e.runId === filter.runId);
        if (filter.sessionId) rows = rows.filter((e) => e.sessionId === filter.sessionId);
        if (filter.taskType) rows = rows.filter((e) => e.signal?.taskType === filter.taskType);
        if (filter.source) {
            const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
            rows = rows.filter((e) => sources.includes(e.source));
        }
        if (filter.since) rows = rows.filter((e) => e.createdAt >= filter.since!);
        const offset = filter.offset ?? 0;
        const limit = filter.limit ?? rows.length;
        return rows.slice(offset, offset + limit);
    }

    async count(filter: FeedbackFilter = {}): Promise<number> {
        return (await this.list(filter)).length;
    }

    async get(id: string): Promise<ExecutionFeedback | null> {
        return this._entries.find((e) => e.id === id) ?? null;
    }

    async delete(id: string): Promise<boolean> {
        const before = this._entries.length;
        this._entries = this._entries.filter((e) => e.id !== id);
        return this._entries.length < before;
    }
}

// ── SQLite ────────────────────────────────────────────────────────────────────

const MISSING_SDK =
    '[personaforge] SQLite feedback repo requires better-sqlite3.\n' +
    '  Install: npm install better-sqlite3';

interface Stmt<T = unknown> {
    get(...a: unknown[]): T | undefined;
    run(...a: unknown[]): { changes: number };
    all(...a: unknown[]): T[];
}
interface Db {
    exec(sql: string): void;
    prepare<T = unknown>(sql: string): Stmt<T>;
}
type DbCtor = new (path: string) => Db;

function loadSqlite(): DbCtor {
    try {
        return require('better-sqlite3') as DbCtor;
    } catch {
        throw new Error(MISSING_SDK);
    }
}

interface FeedbackRow {
    id: string;
    agent_id: string | null;
    run_id: string;
    session_id: string | null;
    source: string;
    score: number | null;
    rating: number | null;
    reward: number | null;
    comment: string | null;
    signal_id: string | null;
    signal: string | null;
    metrics: string | null;
    tags: string | null;
    metadata: string | null;
    created_at: string;
}

export class SqliteFeedbackRepo implements FeedbackRepo {
    private readonly _db: Db;

    constructor(path = ':memory:') {
        const Db = loadSqlite();
        this._db = new Db(path);
        if (path !== ':memory:') {
            this._db.exec(`
                PRAGMA journal_mode = WAL;
                PRAGMA busy_timeout = 5000;
                PRAGMA synchronous = NORMAL;
            `);
        }
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS improvement_feedback (
                id         TEXT PRIMARY KEY,
                agent_id   TEXT,
                run_id     TEXT NOT NULL,
                session_id TEXT,
                source     TEXT NOT NULL,
                score      REAL,
                rating     INTEGER,
                reward     REAL,
                comment    TEXT,
                signal_id  TEXT,
                signal     TEXT,
                metrics    TEXT,
                tags       TEXT,
                metadata   TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_impfb_agent   ON improvement_feedback(agent_id);
            CREATE INDEX IF NOT EXISTS idx_impfb_run     ON improvement_feedback(run_id);
            CREATE INDEX IF NOT EXISTS idx_impfb_source  ON improvement_feedback(source);
            CREATE INDEX IF NOT EXISTS idx_impfb_created ON improvement_feedback(created_at);
        `);
    }

    private _rowToFeedback(r: FeedbackRow): ExecutionFeedback {
        return {
            id: r.id,
            agentId: r.agent_id ?? undefined,
            runId: r.run_id,
            sessionId: r.session_id ?? undefined,
            source: r.source as ExecutionFeedback['source'],
            score: r.score ?? undefined,
            rating: r.rating === null ? undefined : (r.rating as -1 | 0 | 1),
            reward: r.reward ?? undefined,
            comment: r.comment ?? undefined,
            signalId: r.signal_id ?? undefined,
            signal: r.signal ? (JSON.parse(r.signal) as ExecutionSignal) : undefined,
            metrics: r.metrics ? (JSON.parse(r.metrics) as Record<string, number>) : undefined,
            tags: r.tags ? (JSON.parse(r.tags) as string[]) : undefined,
            metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
            createdAt: r.created_at,
        };
    }

    private _sql(filter: FeedbackFilter): { sql: string; params: unknown[] } {
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.agentId) { where.push('agent_id = ?'); params.push(filter.agentId); }
        if (filter.runId) { where.push('run_id = ?'); params.push(filter.runId); }
        if (filter.sessionId) { where.push('session_id = ?'); params.push(filter.sessionId); }
        if (filter.source) {
            const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
            where.push(`source IN (${sources.map(() => '?').join(', ')})`);
            params.push(...sources);
        }
        if (filter.since) { where.push('created_at >= ?'); params.push(filter.since); }
        if (filter.taskType) {
            where.push("json_extract(signal, '$.taskType') = ?");
            params.push(filter.taskType);
        }
        const sql = `SELECT * FROM improvement_feedback${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
        return { sql, params };
    }

    async append(
        entry: Omit<ExecutionFeedback, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ): Promise<ExecutionFeedback> {
        const id = entry.id ?? crypto.randomUUID();
        const createdAt = entry.createdAt ?? new Date().toISOString();
        this._db.prepare(
            `INSERT INTO improvement_feedback
             (id, agent_id, run_id, session_id, source, score, rating, reward, comment,
              signal_id, signal, metrics, tags, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id,
            entry.agentId ?? null,
            entry.runId,
            entry.sessionId ?? null,
            entry.source,
            entry.score ?? null,
            entry.rating ?? null,
            entry.reward ?? null,
            entry.comment ?? null,
            entry.signalId ?? null,
            entry.signal ? JSON.stringify(entry.signal) : null,
            entry.metrics ? JSON.stringify(entry.metrics) : null,
            entry.tags ? JSON.stringify(entry.tags) : null,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            createdAt,
        );
        return { ...entry, id, createdAt };
    }

    async list(filter: FeedbackFilter = {}): Promise<ExecutionFeedback[]> {
        const { sql, params } = this._sql(filter);
        const offset = filter.offset ?? 0;
        const limit = filter.limit ?? 10_000;
        const rows = this._db.prepare<FeedbackRow>(
            `${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).all(...params, limit, offset);
        return rows.map((r) => this._rowToFeedback(r));
    }

    async count(filter: FeedbackFilter = {}): Promise<number> {
        const { sql, params } = this._sql(filter);
        const row = this._db.prepare<{ n: number }>(
            `SELECT COUNT(*) AS n FROM (${sql})`
        ).get(...params);
        return row?.n ?? 0;
    }

    async get(id: string): Promise<ExecutionFeedback | null> {
        const row = this._db.prepare<FeedbackRow>(
            'SELECT * FROM improvement_feedback WHERE id = ?'
        ).get(id);
        return row ? this._rowToFeedback(row) : null;
    }

    async delete(id: string): Promise<boolean> {
        const r = this._db.prepare('DELETE FROM improvement_feedback WHERE id = ?').run(id);
        return r.changes > 0;
    }
}
