/**
 * Agent Checkpoint Store — durable step-level persistence for long-running agents.
 *
 * Enables agents to survive process restarts mid-execution. The agentic runner
 * saves state after each step; on restart, execution resumes from the last
 * saved step rather than from scratch.
 *
 * @example
 * ```ts
 * import { createAgent } from 'personaforge';
 * import { createSqliteCheckpointStore } from 'personaforge/production';
 *
 * const agent = createAgent({
 *   name: 'LongTask',
 *   instructions: '...',
 *   checkpointStore: createSqliteCheckpointStore('./agent.db'),
 * });
 *
 * // Run with a stable runId — if the process restarts, resume from last step
 * const result = await agent.run('Analyse 500 documents', { runId: 'batch-001' });
 * ```
 */

import type { Message } from '../core/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** Snapshot of the agentic loop state at a specific step. */
export interface AgentRunState {
    /** All messages in the conversation up to this point. */
    readonly messages: Message[];
    /** Zero-based step index. */
    readonly step: number;
    /** Agent name. */
    readonly agentName: string;
    /** Original user prompt. */
    readonly prompt: string;
    /** ISO timestamp when the run started. */
    readonly startedAt: string;
    /** ISO timestamp of this checkpoint. */
    readonly checkpointAt: string;
}

/** Pluggable checkpoint persistence interface. */
export interface AgentCheckpointStore {
    /** Save (or overwrite) checkpoint for a run at a given step. */
    save(runId: string, step: number, state: AgentRunState): Promise<void>;
    /** Load the latest checkpoint for a run. Returns null if none exists. */
    load(runId: string): Promise<{ step: number; state: AgentRunState } | null>;
    /** Delete checkpoint after a run completes successfully. */
    delete(runId: string): Promise<void>;
    /** List all incomplete run IDs (useful for recovery tooling). */
    listIncomplete?(): Promise<string[]>;
}

// ── In-memory checkpoint store ─────────────────────────────────────────────

/** Default in-memory checkpoint store. Does not survive process restarts. */
export class InMemoryCheckpointStore implements AgentCheckpointStore {
    private checkpoints = new Map<string, { step: number; state: AgentRunState }>();

    async save(runId: string, step: number, state: AgentRunState): Promise<void> {
        this.checkpoints.set(runId, { step, state });
    }

    async load(runId: string): Promise<{ step: number; state: AgentRunState } | null> {
        return this.checkpoints.get(runId) ?? null;
    }

    async delete(runId: string): Promise<void> {
        this.checkpoints.delete(runId);
    }

    async listIncomplete(): Promise<string[]> {
        return Array.from(this.checkpoints.keys());
    }
}

// ── SQLite checkpoint store ────────────────────────────────────────────────

/**
 * SQLite-backed checkpoint store. Survives process restarts.
 * Requires: npm install better-sqlite3
 */
export class SqliteCheckpointStore implements AgentCheckpointStore {
    private db: {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
            run: (...params: unknown[]) => void;
            get: (...params: unknown[]) => unknown;
            all: (...params: unknown[]) => unknown[];
        };
    };

    private constructor(db: SqliteCheckpointStore['db']) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_checkpoints (
                run_id TEXT PRIMARY KEY,
                step INTEGER NOT NULL,
                state TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        `);
    }

    static create(filePath: string): SqliteCheckpointStore {

        let Database: (p: string) => SqliteCheckpointStore['db'];
        try {
            Database = require('better-sqlite3') as typeof Database;
        } catch {
            throw new Error(
                'SqliteCheckpointStore requires better-sqlite3. Install: npm install better-sqlite3'
            );
        }
        return new SqliteCheckpointStore(Database(filePath));
    }

    async save(runId: string, step: number, state: AgentRunState): Promise<void> {
        this.db.prepare(
            `INSERT INTO agent_checkpoints (run_id, step, state, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(run_id) DO UPDATE SET step=excluded.step, state=excluded.state, updated_at=excluded.updated_at`
        ).run(runId, step, JSON.stringify(state), new Date().toISOString());
    }

    async load(runId: string): Promise<{ step: number; state: AgentRunState } | null> {
        const row = this.db.prepare(
            `SELECT step, state FROM agent_checkpoints WHERE run_id = ?`
        ).get(runId) as { step: number; state: string } | undefined;
        if (!row) return null;
        return { step: row.step, state: JSON.parse(row.state) as AgentRunState };
    }

    async delete(runId: string): Promise<void> {
        this.db.prepare(`DELETE FROM agent_checkpoints WHERE run_id = ?`).run(runId);
    }

    async listIncomplete(): Promise<string[]> {
        const rows = this.db.prepare(`SELECT run_id FROM agent_checkpoints ORDER BY updated_at ASC`).all() as { run_id: string }[];
        return rows.map((r) => r.run_id);
    }
}

/**
 * Factory: create a SQLite checkpoint store.
 * @param filePath - Path to the SQLite database file (e.g. `'./agent.db'`)
 */
export function createSqliteCheckpointStore(filePath: string): AgentCheckpointStore {
    return SqliteCheckpointStore.create(filePath);
}
