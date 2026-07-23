/**
 * @personaforge/db — AgentDb abstract base class.
 *
 * A single unified interface that covers all agent persistence:
 * sessions, memories, learnings, knowledge, traces, and schedules.
 *
 * Built-in backends: SqliteAgentDb, PostgresAgentDb, MongoAgentDb,
 *                    RedisAgentDb, JsonFileAgentDb, InMemoryAgentDb.
 *
 * Adding a custom backend:
 * ```ts
 * import { AgentDb } from './index.js';
 *
 * class MyDb extends AgentDb {
 *   readonly type = 'mydb';
 *   async init() { ... }
 *   async close() { ... }
 *   // implement every abstract method …
 * }
 * ```
 *
 * Agents accept `db?: AgentDb` — one parameter for all storage needs.
 */

import type {
  SessionRow,
  MemoryRow,
  LearningRow,
  KnowledgeRow,
  TraceRow,
  ScheduleRow,
  SessionQuery,
  MemoryQuery,
  LearningQuery,
  KnowledgeQuery,
  UpsertSessionInput,
  UpsertMemoryInput,
  UpsertLearningInput,
  UpsertKnowledgeInput,
  AgentDbTableNames,
  LearningType,
} from './types.js';

export type {
  SessionRow,
  MemoryRow,
  LearningRow,
  KnowledgeRow,
  TraceRow,
  ScheduleRow,
  SessionQuery,
  MemoryQuery,
  LearningQuery,
  KnowledgeQuery,
  UpsertSessionInput,
  UpsertMemoryInput,
  UpsertLearningInput,
  UpsertKnowledgeInput,
  AgentDbTableNames,
  LearningType,
};

export { DEFAULT_TABLE_NAMES } from './types.js';

// ─── Validation ────────────────────────────────────────────────────────────────

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

/** Validate a SQL table/collection name to prevent injection. */
export function validateTableName(name: string): string {
  if (!TABLE_NAME_RE.test(name)) {
    throw new Error(`[personaforge/db] Invalid table name: "${name}". Must match /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.`);
  }
  return name;
}

/** Validate all table names in a config object. */
export function validateTableNames(names: Required<AgentDbTableNames>): Required<AgentDbTableNames> {
  for (const [, value] of Object.entries(names)) {
    validateTableName(value);
  }
  return names;
}

// ─── Abstract base ─────────────────────────────────────────────────────────────

export abstract class AgentDb {
  /** Human-readable backend name (e.g. 'sqlite', 'postgres'). */
  abstract readonly type: string;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Initialise the backend — create tables, open connections, etc.
   * Called automatically on first use if not called explicitly.
   */
  abstract init(): Promise<void>;

  /**
   * Close all open connections / file handles.
   * Call during graceful shutdown.
   */
  abstract close(): Promise<void>;

  /**
   * Check if the database connection is alive.
   * Defaults to attempting init() — override for lightweight pings.
   */
  async health(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.init();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  abstract upsertSession(input: UpsertSessionInput): Promise<SessionRow>;

  abstract getSession(sessionId: string, userId?: string): Promise<SessionRow | null>;

  abstract getSessions(query: SessionQuery): Promise<SessionRow[]>;

  abstract deleteSession(sessionId: string, userId?: string): Promise<boolean>;

  abstract renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null>;

  // ── Memories (user memories) ───────────────────────────────────────────────

  abstract upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow>;

  abstract getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null>;

  abstract getMemories(query: MemoryQuery): Promise<MemoryRow[]>;

  abstract deleteMemory(memoryId: string, userId?: string): Promise<boolean>;

  abstract clearMemories(userId?: string): Promise<void>;

  // ── Learnings ──────────────────────────────────────────────────────────────

  /**
   * Upsert a learning record.
   * All learning types (user_profile, session_context, user_memory,
   * entity_memory, learned_knowledge, decision_log, custom) are stored in ONE
   * unified table, discriminated by `learningType`.
   */
  abstract upsertLearning(input: UpsertLearningInput): Promise<void>;

  abstract getLearning(query: LearningQuery): Promise<LearningRow | null>;

  abstract getLearnings(query: LearningQuery): Promise<LearningRow[]>;

  abstract deleteLearning(id: string): Promise<boolean>;

  // ── Knowledge ─────────────────────────────────────────────────────────────

  abstract upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow>;

  abstract getKnowledge(id: string): Promise<KnowledgeRow | null>;

  abstract getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]>;

  abstract deleteKnowledge(id: string): Promise<boolean>;

  // ── Traces ─────────────────────────────────────────────────────────────────

  /** Store an observability trace (best-effort — should not throw). */
  abstract upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void>;

  abstract getTrace(traceId: string): Promise<TraceRow | null>;

  abstract getTraces(opts: {
    sessionId?: string;
    agentId?:   string;
    userId?:    string;
    limit?:     number;
    offset?:    number;
  }): Promise<[TraceRow[], number]>;

  // ── Schedules ──────────────────────────────────────────────────────────────

  abstract createSchedule(row: Omit<ScheduleRow, 'created_at' | 'updated_at'>): Promise<ScheduleRow>;

  abstract getSchedule(id: string): Promise<ScheduleRow | null>;

  abstract getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]>;

  abstract updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null>;

  abstract deleteSchedule(id: string): Promise<boolean>;

  // ── Serialisation helpers ─────────────────────────────────────────────────

  toDict(): Record<string, unknown> {
    return { type: this.type };
  }
}
