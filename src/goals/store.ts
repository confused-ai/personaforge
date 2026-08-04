/**
 * Goal store — durable, thread-scoped objectives.
 *
 * A goal is a standing instruction the agent keeps working toward across loop
 * iterations until a judge model decides it's satisfied or a run budget is
 * exhausted. Objectives persist in thread state, so they survive reloads and
 * are still judged when a new message arrives mid-run.
 */

export type GoalStatus = 'active' | 'done' | 'paused';

export interface GoalEvaluation {
    readonly objective: string;
    readonly iteration: number;
    readonly maxRuns: number;
    readonly passed: boolean;
    readonly status: GoalStatus;
    readonly reason?: string;
    readonly duration?: number;
    readonly timedOut?: boolean;
    readonly maxRunsReached?: boolean;
    readonly suppressFeedback?: boolean;
}

export interface ObjectiveRecord {
    readonly objective: string;
    readonly threadId?: string;
    readonly resourceId?: string;
    /** Per-objective budget override (falls back to the agent `goal.maxRuns`). */
    readonly maxRuns?: number;
    readonly runsUsed: number;
    readonly status: GoalStatus;
    readonly activeDurationMs?: number;
    readonly updatedAt: string;
    /** Optional per-objective judge prompt override. */
    readonly prompt?: string;
}

export interface GoalStore {
    getObjective(threadId: string): Promise<ObjectiveRecord | null>;
    setObjective(record: ObjectiveRecord): Promise<void>;
    updateOptions(threadId: string, patch: Partial<Pick<ObjectiveRecord, 'maxRuns' | 'prompt'>>): Promise<void>;
    clear(threadId: string): Promise<void>;
    listIncomplete(): Promise<ObjectiveRecord[]>;
}

/** Default in-memory goal store. */
export class InMemoryGoalStore implements GoalStore {
    private goals = new Map<string, ObjectiveRecord>();

    async getObjective(threadId: string): Promise<ObjectiveRecord | null> {
        return this.goals.get(threadId) ?? null;
    }

    async setObjective(record: ObjectiveRecord): Promise<void> {
        this.goals.set(record.threadId ?? record.objective, record);
    }

    async updateOptions(threadId: string, patch: Partial<Pick<ObjectiveRecord, 'maxRuns' | 'prompt'>>): Promise<void> {
        const current = this.goals.get(threadId);
        if (!current) return;
        this.goals.set(threadId, { ...current, ...patch, updatedAt: new Date().toISOString() });
    }

    async clear(threadId: string): Promise<void> {
        this.goals.delete(threadId);
    }

    async listIncomplete(): Promise<ObjectiveRecord[]> {
        return Array.from(this.goals.values()).filter((g) => g.status === 'active');
    }
}

/**
 * SQLite-backed goal store. Survives restarts. Requires better-sqlite3.
 */
export class SqliteGoalStore implements GoalStore {
    private db: {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
            run: (...params: unknown[]) => unknown;
            get: (...params: unknown[]) => unknown;
            all: (...params: unknown[]) => unknown[];
        };
    };

    private constructor(db: SqliteGoalStore['db']) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_goals (
                thread_id TEXT PRIMARY KEY,
                objective TEXT NOT NULL,
                resource_id TEXT,
                max_runs INTEGER,
                runs_used INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                active_duration_ms INTEGER,
                prompt TEXT,
                updated_at TEXT NOT NULL
            );
        `);
    }

    static create(filePath: string): SqliteGoalStore {
        let Database: (p: string) => SqliteGoalStore['db'];
        try {
            Database = require('better-sqlite3') as typeof Database;
        } catch {
            throw new Error('SqliteGoalStore requires better-sqlite3. Install: npm install better-sqlite3');
        }
        return new SqliteGoalStore(Database(filePath));
    }

    async getObjective(threadId: string): Promise<ObjectiveRecord | null> {
        const row = this.db.prepare(`SELECT * FROM agent_goals WHERE thread_id = ?`).get(threadId) as Record<string, unknown> | undefined;
        return row ? rowToObjective(row) : null;
    }

    async setObjective(record: ObjectiveRecord): Promise<void> {
        this.db.prepare(
            `INSERT INTO agent_goals (thread_id, objective, resource_id, max_runs, runs_used, status, active_duration_ms, prompt, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(thread_id) DO UPDATE SET
               objective=excluded.objective, resource_id=excluded.resource_id, max_runs=excluded.max_runs,
               runs_used=excluded.runs_used, status=excluded.status, active_duration_ms=excluded.active_duration_ms,
               prompt=excluded.prompt, updated_at=excluded.updated_at`
        ).run(
            record.threadId ?? record.objective,
            record.objective,
            record.resourceId ?? null,
            record.maxRuns ?? null,
            record.runsUsed,
            record.status,
            record.activeDurationMs ?? null,
            record.prompt ?? null,
            record.updatedAt,
        );
    }

    async updateOptions(threadId: string, patch: Partial<Pick<ObjectiveRecord, 'maxRuns' | 'prompt'>>): Promise<void> {
        const current = await this.getObjective(threadId);
        if (!current) return;
        await this.setObjective({ ...current, ...patch, updatedAt: new Date().toISOString() });
    }

    async clear(threadId: string): Promise<void> {
        this.db.prepare(`DELETE FROM agent_goals WHERE thread_id = ?`).run(threadId);
    }

    async listIncomplete(): Promise<ObjectiveRecord[]> {
        const rows = this.db.prepare(`SELECT * FROM agent_goals WHERE status = 'active'`).all() as Record<string, unknown>[];
        return rows.map(rowToObjective);
    }
}

function rowToObjective(row: Record<string, unknown>): ObjectiveRecord {
    return {
        objective: row.objective as string,
        threadId: row.thread_id as string,
        resourceId: (row.resource_id as string | null) ?? undefined,
        maxRuns: (row.max_runs as number | null) ?? undefined,
        runsUsed: row.runs_used as number,
        status: row.status as GoalStatus,
        activeDurationMs: (row.active_duration_ms as number | null) ?? undefined,
        prompt: (row.prompt as string | null) ?? undefined,
        updatedAt: row.updated_at as string,
    };
}

export function createSqliteGoalStore(filePath: string): GoalStore {
    return SqliteGoalStore.create(filePath);
}
