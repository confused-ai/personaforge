/**
 * Suspended-run store — durable record of runs paused for human approval or
 * tool suspension, so a later request (after a restart / different server) can
 * rediscover a pending run and approve/decline/resume it.
 */

export interface SuspendedToolCall {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    /** true → answer with approveToolCall/declineToolCall. */
    readonly requiresApproval: boolean;
    /** For suspend()-based suspensions, the custom payload the tool asked about. */
    readonly suspendPayload?: unknown;
}

export interface SuspendedRun {
    readonly runId: string;
    readonly agentId: string;
    readonly threadId?: string;
    readonly resourceId?: string;
    readonly status: 'approval' | 'suspended';
    readonly toolCalls: SuspendedToolCall[];
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly resolved?: boolean;
}

export interface SuspendedRunQuery {
    readonly threadId?: string;
    readonly resourceId?: string;
    readonly agentId?: string;
    readonly includeResolved?: boolean;
}

export interface SuspendedRunStore {
    save(run: SuspendedRun): Promise<void>;
    getByRunId(runId: string): Promise<SuspendedRun | null>;
    list(query?: SuspendedRunQuery): Promise<SuspendedRun[]>;
    markResolved(runId: string, update?: Partial<SuspendedRun>): Promise<void>;
    delete(runId: string): Promise<void>;
}

/** Default in-memory store — does not survive restarts. */
export class InMemorySuspendedRunStore implements SuspendedRunStore {
    private runs = new Map<string, SuspendedRun>();

    async save(run: SuspendedRun): Promise<void> {
        this.runs.set(run.runId, run);
    }

    async getByRunId(runId: string): Promise<SuspendedRun | null> {
        return this.runs.get(runId) ?? null;
    }

    async list(query: SuspendedRunQuery = {}): Promise<SuspendedRun[]> {
        let out = Array.from(this.runs.values()).filter((r) => {
            if (query.includeResolved === undefined && r.resolved) return false;
            if (query.agentId && r.agentId !== query.agentId) return false;
            if (query.threadId && r.threadId !== query.threadId) return false;
            if (query.resourceId && r.resourceId !== query.resourceId) return false;
            return true;
        });
        out = out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return out;
    }

    async markResolved(runId: string, update?: Partial<SuspendedRun>): Promise<void> {
        const run = this.runs.get(runId);
        if (!run) throw new Error(`No suspended run found for "${runId}".`);
        // Merge selectively: never let a stale `status`/`toolCalls` from the
        // update overwrite the preserved record.
        const merged: SuspendedRun = {
            ...run,
            status: update?.status ?? run.status,
            threadId: update?.threadId ?? run.threadId,
            resourceId: update?.resourceId ?? run.resourceId,
            resolved: true,
            updatedAt: new Date().toISOString(),
        };
        this.runs.set(runId, merged);
    }

    async delete(runId: string): Promise<void> {
        this.runs.delete(runId);
    }
}

/**
 * SQLite-backed suspended-run store. Survives process restarts.
 * Requires: npm install better-sqlite3
 */
export class SqliteSuspendedRunStore implements SuspendedRunStore {
    private db: {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
            run: (...params: unknown[]) => unknown;
            get: (...params: unknown[]) => unknown;
            all: (...params: unknown[]) => unknown[];
        };
    };

    private constructor(db: SqliteSuspendedRunStore['db']) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS suspended_runs (
                run_id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                thread_id TEXT,
                resource_id TEXT,
                status TEXT NOT NULL,
                tool_calls TEXT NOT NULL,
                resolved INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_suspended_thread ON suspended_runs (thread_id, resource_id);
        `);
    }

    static create(filePath: string): SqliteSuspendedRunStore {
        let Database: (p: string) => SqliteSuspendedRunStore['db'];
        try {
            Database = require('better-sqlite3') as typeof Database;
        } catch {
            throw new Error(
                'SqliteSuspendedRunStore requires better-sqlite3. Install: npm install better-sqlite3'
            );
        }
        return new SqliteSuspendedRunStore(Database(filePath));
    }

    async save(run: SuspendedRun): Promise<void> {
        this.db.prepare(
            `INSERT INTO suspended_runs (run_id, agent_id, thread_id, resource_id, status, tool_calls, resolved, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(run_id) DO UPDATE SET
               agent_id=excluded.agent_id, thread_id=excluded.thread_id, resource_id=excluded.resource_id,
               status=excluded.status, tool_calls=excluded.tool_calls, resolved=excluded.resolved, updated_at=excluded.updated_at`
        ).run(
            run.runId,
            run.agentId,
            run.threadId ?? null,
            run.resourceId ?? null,
            run.status,
            JSON.stringify(run.toolCalls),
            run.resolved ? 1 : 0,
            run.createdAt,
            run.updatedAt,
        );
    }

    async getByRunId(runId: string): Promise<SuspendedRun | null> {
        const row = this.db.prepare(`SELECT * FROM suspended_runs WHERE run_id = ?`).get(runId) as Record<string, unknown> | undefined;
        return row ? rowToRun(row) : null;
    }

    async list(query: SuspendedRunQuery = {}): Promise<SuspendedRun[]> {
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (query.agentId) {
            clauses.push('agent_id = ?');
            params.push(query.agentId);
        }
        if (query.threadId) {
            clauses.push('thread_id = ?');
            params.push(query.threadId);
        }
        if (query.resourceId) {
            clauses.push('resource_id = ?');
            params.push(query.resourceId);
        }
        if (!query.includeResolved) {
            clauses.push('resolved = 0');
        }
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        const rows = this.db.prepare(`SELECT * FROM suspended_runs${where} ORDER BY updated_at DESC`).all(...params) as Record<string, unknown>[];
        return rows.map(rowToRun);
    }

    async markResolved(runId: string, update?: Partial<SuspendedRun>): Promise<void> {
        const existing = await this.getByRunId(runId);
        if (!existing) throw new Error(`No suspended run found for "${runId}".`);
        // Selective merge — never let a stale `status`/`toolCalls` from the
        // update overwrite the preserved record.
        const merged: SuspendedRun = {
            ...existing,
            status: update?.status ?? existing.status,
            threadId: update?.threadId ?? existing.threadId,
            resourceId: update?.resourceId ?? existing.resourceId,
            resolved: true,
            updatedAt: new Date().toISOString(),
        };
        await this.save(merged);
    }

    async delete(runId: string): Promise<void> {
        this.db.prepare(`DELETE FROM suspended_runs WHERE run_id = ?`).run(runId);
    }
}

function rowToRun(row: Record<string, unknown>): SuspendedRun {
    return {
        runId: row.run_id as string,
        agentId: row.agent_id as string,
        threadId: (row.thread_id as string | null) ?? undefined,
        resourceId: (row.resource_id as string | null) ?? undefined,
        status: row.status as SuspendedRun['status'],
        toolCalls: JSON.parse(row.tool_calls as string) as SuspendedToolCall[],
        resolved: (row.resolved as number) === 1,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    };
}

export function createSqliteSuspendedRunStore(filePath: string): SuspendedRunStore {
    return SqliteSuspendedRunStore.create(filePath);
}
