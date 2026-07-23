/**
 * @personaforge/db/turso — TursoAgentDb.
 *
 * Edge SQLite using Turso / LibSQL (`@libsql/client`).
 * Works locally (file:) AND against Turso cloud (libsql://).
 *
 * Peer dep: `@libsql/client` (optional — install only if you want Turso).
 */

import { AgentDb, validateTableNames } from './base.js';
import { DEFAULT_TABLE_NAMES } from './types.js';
import { uuid, now } from './utils.js';
import type {
  SessionRow, MemoryRow, LearningRow, KnowledgeRow, TraceRow, ScheduleRow,
  SessionQuery, MemoryQuery, LearningQuery, KnowledgeQuery,
  UpsertSessionInput, UpsertMemoryInput, UpsertLearningInput, UpsertKnowledgeInput,
  AgentDbTableNames,
} from './types.js';

const MISSING =
  '[personaforge/db] TursoAgentDb requires @libsql/client.\n' +
  '  Install: npm install @libsql/client';

// Minimal surface types
interface LibSqlRow { [k: string]: unknown }
interface LibSqlResult { rows: LibSqlRow[]; rowsAffected: number }
interface LibSqlClient {
  execute(sql: string | { sql: string; args: unknown[] }): Promise<LibSqlResult>;
  close(): void;
}
type LibSqlCreator = { createClient(config: Record<string, unknown>): LibSqlClient };



export interface TursoAgentDbOptions {
  /** LibSQL / Turso URL (e.g. `file:agent.db`, `libsql://my-db-org.turso.io`). */
  url: string;
  /** Auth token for Turso cloud. */
  authToken?: string;
  /** Override table names. */
  tables?: AgentDbTableNames;
}

export class TursoAgentDb extends AgentDb {
  readonly type = 'turso';

  private readonly opts: TursoAgentDbOptions;
  private readonly t: Required<AgentDbTableNames>;
  private _client: LibSqlClient | null = null;
  private _ready = false;
  private _initPromise: Promise<void> | null = null;

  constructor(opts: TursoAgentDbOptions) {
    super();
    this.opts = opts;
    this.t = validateTableNames({ ...DEFAULT_TABLE_NAMES, ...(opts.tables ?? {}) });
  }

  private client(): LibSqlClient {
    if (this._client) return this._client;
    let libsql: LibSqlCreator;
    try { libsql = require('@libsql/client') as LibSqlCreator; } catch { throw new Error(MISSING); }
    const cfg: Record<string, unknown> = { url: this.opts.url };
    if (this.opts.authToken) cfg['authToken'] = this.opts.authToken;
    this._client = libsql.createClient(cfg);
    return this._client;
  }

  private async q(sql: string, args: unknown[] = []): Promise<LibSqlResult> {
    return this.client().execute({ sql, args });
  }

  async init(): Promise<void> {
    if (this._ready) return;
    if (!this._initPromise) this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.sessions} (
        session_id    TEXT PRIMARY KEY,
        session_type  TEXT NOT NULL DEFAULT 'agent',
        agent_id      TEXT, team_id TEXT, workflow_id TEXT, user_id TEXT,
        agent_data    TEXT, team_data TEXT, workflow_data TEXT, session_data TEXT,
        metadata      TEXT, runs TEXT, summary TEXT,
        created_at    INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `);
    await this.q(`CREATE INDEX IF NOT EXISTS idx_${this.t.sessions}_user  ON ${this.t.sessions}(user_id)`);
    await this.q(`CREATE INDEX IF NOT EXISTS idx_${this.t.sessions}_agent ON ${this.t.sessions}(agent_id)`);

    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.memories} (
        memory_id  TEXT PRIMARY KEY,
        user_id    TEXT, agent_id TEXT, team_id TEXT,
        memory     TEXT NOT NULL,
        topics     TEXT, input TEXT, feedback TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `);
    await this.q(`CREATE INDEX IF NOT EXISTS idx_${this.t.memories}_user ON ${this.t.memories}(user_id)`);

    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.learnings} (
        learning_id   TEXT PRIMARY KEY,
        learning_type TEXT NOT NULL,
        namespace     TEXT, user_id TEXT, agent_id TEXT, team_id TEXT,
        workflow_id   TEXT, session_id TEXT, entity_id TEXT, entity_type TEXT,
        content       TEXT NOT NULL, metadata TEXT,
        created_at    INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `);
    await this.q(`CREATE INDEX IF NOT EXISTS idx_${this.t.learnings}_type ON ${this.t.learnings}(learning_type)`);

    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.knowledge} (
        id             TEXT PRIMARY KEY,
        name           TEXT, description TEXT, content TEXT, type TEXT,
        size           INTEGER, linked_to TEXT, access_count INTEGER DEFAULT 0,
        status         TEXT, status_message TEXT, external_id TEXT, metadata TEXT,
        created_at     INTEGER, updated_at INTEGER
      )
    `);

    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.traces} (
        trace_id    TEXT PRIMARY KEY,
        run_id      TEXT, session_id TEXT, user_id TEXT, agent_id TEXT,
        team_id     TEXT, workflow_id TEXT, name TEXT, status TEXT,
        start_time  TEXT, end_time TEXT, duration_ms REAL, metadata TEXT,
        created_at  INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `);
    await this.q(`CREATE INDEX IF NOT EXISTS idx_${this.t.traces}_session ON ${this.t.traces}(session_id)`);

    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.schedules} (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL, agent_id TEXT, cron TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        next_run_at INTEGER, last_run_at INTEGER,
        locked_by   TEXT, locked_at INTEGER, metadata TEXT,
        created_at  INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `);
    this._ready = true;
  }

  async close(): Promise<void> {
    this._client?.close();
    this._client = null;
    this._ready = false;
    this._initPromise = null;
  }

  override async health(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.q('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    await this.init();
    const ts = now();
    const existing = (await this.q(`SELECT created_at FROM ${this.t.sessions} WHERE session_id = ?`, [input.sessionId])).rows[0];
    const row: SessionRow = {
      session_id:    input.sessionId,
      session_type:  input.sessionType  ?? 'agent',
      agent_id:      input.agentId      ?? null,
      team_id:       input.teamId       ?? null,
      workflow_id:   input.workflowId   ?? null,
      user_id:       input.userId       ?? null,
      agent_data:    input.agentData    ? JSON.stringify(input.agentData)    : null,
      team_data:     input.teamData     ? JSON.stringify(input.teamData)     : null,
      workflow_data: input.workflowData ? JSON.stringify(input.workflowData) : null,
      session_data:  input.sessionData  ? JSON.stringify(input.sessionData)  : null,
      metadata:      input.metadata     ? JSON.stringify(input.metadata)     : null,
      runs:          input.runs         ? JSON.stringify(input.runs)         : null,
      summary:       input.summary ?? null,
      created_at:    (existing?.['created_at'] as number) ?? ts,
      updated_at:    ts,
    };
    await this.q(`
      INSERT INTO ${this.t.sessions}
        (session_id, session_type, agent_id, team_id, workflow_id, user_id,
         agent_data, team_data, workflow_data, session_data, metadata, runs,
         summary, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET
        session_type=excluded.session_type, agent_id=excluded.agent_id,
        team_id=excluded.team_id, workflow_id=excluded.workflow_id,
        user_id=excluded.user_id, agent_data=excluded.agent_data,
        team_data=excluded.team_data, workflow_data=excluded.workflow_data,
        session_data=excluded.session_data, metadata=excluded.metadata,
        runs=excluded.runs, summary=excluded.summary,
        updated_at=excluded.updated_at
    `, [
      row.session_id, row.session_type, row.agent_id, row.team_id, row.workflow_id,
      row.user_id, row.agent_data, row.team_data, row.workflow_data,
      row.session_data, row.metadata, row.runs, row.summary,
      row.created_at, row.updated_at,
    ]);
    return row;
  }

  async getSession(sessionId: string, userId?: string): Promise<SessionRow | null> {
    await this.init();
    const args: unknown[] = [sessionId];
    let sql = `SELECT * FROM ${this.t.sessions} WHERE session_id = ?`;
    if (userId !== undefined) { sql += ' AND user_id = ?'; args.push(userId); }
    const result = await this.q(sql, args);
    return (result.rows[0] as unknown as SessionRow | undefined) ?? null;
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    await this.init();
    const where: string[] = []; const args: unknown[] = [];
    if (query.sessionType) { where.push('session_type = ?'); args.push(query.sessionType); }
    if (query.agentId)     { where.push('agent_id = ?');     args.push(query.agentId); }
    if (query.teamId)      { where.push('team_id = ?');      args.push(query.teamId); }
    if (query.workflowId)  { where.push('workflow_id = ?');  args.push(query.workflowId); }
    if (query.userId)      { where.push('user_id = ?');      args.push(query.userId); }
    let sql = `SELECT * FROM ${this.t.sessions}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit  !== undefined) { sql += ' LIMIT ?';  args.push(query.limit); }
    if (query.offset !== undefined) { sql += ' OFFSET ?'; args.push(query.offset); }
    return (await this.q(sql, args)).rows as unknown as SessionRow[];
  }

  async deleteSession(sessionId: string, userId?: string): Promise<boolean> {
    await this.init();
    const args: unknown[] = [sessionId];
    let sql = `DELETE FROM ${this.t.sessions} WHERE session_id = ?`;
    if (userId !== undefined) { sql += ' AND user_id = ?'; args.push(userId); }
    return (await this.q(sql, args)).rowsAffected > 0;
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sd = row.session_data ? JSON.parse(row.session_data as string) as Record<string, unknown> : {};
    sd['session_name'] = name;
    const ts = now();
    await this.q(`UPDATE ${this.t.sessions} SET session_data = ?, updated_at = ? WHERE session_id = ?`, [JSON.stringify(sd), ts, sessionId]);
    return { ...row, session_data: JSON.stringify(sd), updated_at: ts };
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
    await this.init();
    const ts = now();
    const memoryId = input.memoryId ?? uuid();
    const existing = (await this.q(`SELECT created_at FROM ${this.t.memories} WHERE memory_id = ?`, [memoryId])).rows[0];
    const row: MemoryRow = {
      memory_id: memoryId,
      user_id: input.userId ?? null, agent_id: input.agentId ?? null, team_id: input.teamId ?? null,
      memory: input.memory,
      topics: input.topics ? JSON.stringify(input.topics) : null,
      input: input.input ?? null, feedback: input.feedback ?? null,
      created_at: (existing?.['created_at'] as number) ?? ts, updated_at: ts,
    };
    await this.q(`
      INSERT INTO ${this.t.memories}
        (memory_id, user_id, agent_id, team_id, memory, topics, input, feedback, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(memory_id) DO UPDATE SET
        memory=excluded.memory, topics=excluded.topics,
        input=excluded.input, feedback=excluded.feedback,
        agent_id=excluded.agent_id, team_id=excluded.team_id,
        updated_at=excluded.updated_at
    `, [
      row.memory_id, row.user_id, row.agent_id, row.team_id,
      row.memory, row.topics, row.input, row.feedback,
      row.created_at, row.updated_at,
    ]);
    return row;
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    await this.init();
    const args: unknown[] = [memoryId];
    let sql = `SELECT * FROM ${this.t.memories} WHERE memory_id = ?`;
    if (userId !== undefined) { sql += ' AND user_id = ?'; args.push(userId); }
    return (await this.q(sql, args)).rows[0] as unknown as MemoryRow | undefined ?? null;
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    await this.init();
    const where: string[] = []; const args: unknown[] = [];
    if (query.userId)  { where.push('user_id = ?');  args.push(query.userId); }
    if (query.agentId) { where.push('agent_id = ?'); args.push(query.agentId); }
    if (query.teamId)  { where.push('team_id = ?');  args.push(query.teamId); }
    if (query.search)  { where.push('memory LIKE ?'); args.push(`%${query.search}%`); }
    let sql = `SELECT * FROM ${this.t.memories}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit  !== undefined) { sql += ' LIMIT ?';  args.push(query.limit); }
    if (query.offset !== undefined) { sql += ' OFFSET ?'; args.push(query.offset); }
    return (await this.q(sql, args)).rows as unknown as MemoryRow[];
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    await this.init();
    const args: unknown[] = [memoryId];
    let sql = `DELETE FROM ${this.t.memories} WHERE memory_id = ?`;
    if (userId !== undefined) { sql += ' AND user_id = ?'; args.push(userId); }
    return (await this.q(sql, args)).rowsAffected > 0;
  }

  async clearMemories(userId?: string): Promise<void> {
    await this.init();
    if (userId === undefined) {
      await this.q(`DELETE FROM ${this.t.memories}`);
    } else {
      await this.q(`DELETE FROM ${this.t.memories} WHERE user_id = ?`, [userId]);
    }
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async upsertLearning(input: UpsertLearningInput): Promise<void> {
    await this.init();
    const ts = now();
    const existing = (await this.q(`SELECT created_at FROM ${this.t.learnings} WHERE learning_id = ?`, [input.id])).rows[0];
    await this.q(`
      INSERT INTO ${this.t.learnings}
        (learning_id, learning_type, namespace, user_id, agent_id, team_id,
         workflow_id, session_id, entity_id, entity_type, content, metadata,
         created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(learning_id) DO UPDATE SET
        content=excluded.content, metadata=excluded.metadata,
        updated_at=excluded.updated_at
    `, [
      input.id, input.learningType, input.namespace ?? null,
      input.userId ?? null, input.agentId ?? null, input.teamId ?? null,
      input.workflowId ?? null, input.sessionId ?? null,
      input.entityId ?? null, input.entityType ?? null,
      JSON.stringify(input.content),
      input.metadata ? JSON.stringify(input.metadata) : null,
      (existing?.['created_at'] as number) ?? ts, ts,
    ]);
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    const rows = await this.getLearnings({ ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    await this.init();
    const where: string[] = []; const args: unknown[] = [];
    if (query.learningType) { where.push('learning_type = ?'); args.push(query.learningType); }
    if (query.userId)       { where.push('user_id = ?');       args.push(query.userId); }
    if (query.agentId)      { where.push('agent_id = ?');      args.push(query.agentId); }
    if (query.teamId)       { where.push('team_id = ?');       args.push(query.teamId); }
    if (query.workflowId)   { where.push('workflow_id = ?');   args.push(query.workflowId); }
    if (query.sessionId)    { where.push('session_id = ?');    args.push(query.sessionId); }
    if (query.namespace)    { where.push('namespace = ?');     args.push(query.namespace); }
    if (query.entityId)     { where.push('entity_id = ?');     args.push(query.entityId); }
    if (query.entityType)   { where.push('entity_type = ?');   args.push(query.entityType); }
    let sql = `SELECT * FROM ${this.t.learnings}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit !== undefined) { sql += ' LIMIT ?'; args.push(query.limit); }
    return (await this.q(sql, args)).rows as unknown as LearningRow[];
  }

  async deleteLearning(id: string): Promise<boolean> {
    await this.init();
    return (await this.q(`DELETE FROM ${this.t.learnings} WHERE learning_id = ?`, [id])).rowsAffected > 0;
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    await this.init();
    const ts = now();
    const existing = (await this.q(`SELECT created_at, access_count FROM ${this.t.knowledge} WHERE id = ?`, [input.id])).rows[0] as Pick<KnowledgeRow, 'created_at' | 'access_count'> | undefined;
    const row: KnowledgeRow = {
      id: input.id, name: input.name ?? null, description: input.description ?? null,
      content: input.content ? (typeof input.content === 'string' ? input.content : JSON.stringify(input.content)) : null,
      type: input.type ?? null, size: input.size ?? null, linked_to: input.linkedTo ?? null,
      access_count: existing?.access_count ?? 0,
      status: input.status ?? null, status_message: input.statusMessage ?? null,
      external_id: input.externalId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: existing?.created_at ?? ts, updated_at: ts,
    };
    await this.q(`
      INSERT INTO ${this.t.knowledge}
        (id, name, description, content, type, size, linked_to, access_count,
         status, status_message, external_id, metadata, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description,
        content=excluded.content, type=excluded.type, size=excluded.size,
        linked_to=excluded.linked_to, status=excluded.status,
        status_message=excluded.status_message, external_id=excluded.external_id,
        metadata=excluded.metadata, updated_at=excluded.updated_at
    `, [
      row.id, row.name, row.description, row.content, row.type, row.size,
      row.linked_to, row.access_count, row.status, row.status_message,
      row.external_id, row.metadata, row.created_at, row.updated_at,
    ]);
    return row;
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    await this.init();
    return (await this.q(`SELECT * FROM ${this.t.knowledge} WHERE id = ?`, [id])).rows[0] as unknown as KnowledgeRow | undefined ?? null;
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    await this.init();
    const where: string[] = []; const args: unknown[] = [];
    if (query.linkedTo) { where.push('linked_to = ?'); args.push(query.linkedTo); }
    if (query.status)   { where.push('status = ?');    args.push(query.status); }
    let sql = `SELECT * FROM ${this.t.knowledge}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    const countSql = sql.replace('SELECT *', 'SELECT count(*) AS cnt');
    const countResult = await this.q(countSql, args);
    const total = (countResult.rows[0]?.['cnt'] as number) ?? 0;
    if (query.limit  !== undefined) { sql += ' LIMIT ?';  args.push(query.limit); }
    if (query.offset !== undefined) { sql += ' OFFSET ?'; args.push(query.offset); }
    return [(await this.q(sql, args)).rows as unknown as KnowledgeRow[], total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    await this.init();
    return (await this.q(`DELETE FROM ${this.t.knowledge} WHERE id = ?`, [id])).rowsAffected > 0;
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    try {
      await this.init();
      const ts = now();
      const existing = (await this.q(`SELECT created_at FROM ${this.t.traces} WHERE trace_id = ?`, [trace.trace_id])).rows[0];
      await this.q(`
        INSERT INTO ${this.t.traces}
          (trace_id, run_id, session_id, user_id, agent_id, team_id, workflow_id,
           name, status, start_time, end_time, duration_ms, metadata, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(trace_id) DO UPDATE SET
          status=excluded.status, end_time=excluded.end_time,
          duration_ms=excluded.duration_ms, updated_at=excluded.updated_at
      `, [
        trace.trace_id, trace.run_id ?? null, trace.session_id ?? null,
        trace.user_id ?? null, trace.agent_id ?? null, trace.team_id ?? null,
        trace.workflow_id ?? null, trace.name ?? null, trace.status ?? null,
        trace.start_time ?? null, trace.end_time ?? null, trace.duration_ms ?? null,
        trace.metadata ?? null,
        (existing?.['created_at'] as number) ?? trace.created_at ?? ts, ts,
      ]);
    } catch { /* traces must not break agent flow */ }
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    await this.init();
    return (await this.q(`SELECT * FROM ${this.t.traces} WHERE trace_id = ?`, [traceId])).rows[0] as unknown as TraceRow | undefined ?? null;
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    await this.init();
    const where: string[] = []; const args: unknown[] = [];
    if (opts.sessionId) { where.push('session_id = ?'); args.push(opts.sessionId); }
    if (opts.agentId)   { where.push('agent_id = ?');   args.push(opts.agentId); }
    if (opts.userId)    { where.push('user_id = ?');    args.push(opts.userId); }
    let sql = `SELECT * FROM ${this.t.traces}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const countResult = await this.q(sql.replace('SELECT *', 'SELECT count(*) AS cnt'), args);
    const total = (countResult.rows[0]?.['cnt'] as number) ?? 0;
    if (opts.limit  !== undefined) { sql += ' LIMIT ?';  args.push(opts.limit); }
    if (opts.offset !== undefined) { sql += ' OFFSET ?'; args.push(opts.offset); }
    return [(await this.q(sql, args)).rows as unknown as TraceRow[], total];
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  async createSchedule(row: Omit<ScheduleRow, 'created_at' | 'updated_at'>): Promise<ScheduleRow> {
    await this.init();
    const ts = now();
    const full: ScheduleRow = { ...row, created_at: ts, updated_at: ts };
    await this.q(`
      INSERT INTO ${this.t.schedules}
        (id, name, agent_id, cron, enabled, next_run_at, last_run_at,
         locked_by, locked_at, metadata, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      full.id, full.name, full.agent_id ?? null, full.cron ?? null,
      full.enabled ? 1 : 0,
      full.next_run_at ?? null, full.last_run_at ?? null,
      full.locked_by ?? null, full.locked_at ?? null,
      full.metadata ?? null, full.created_at, full.updated_at,
    ]);
    return full;
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    await this.init();
    const r = (await this.q(`SELECT * FROM ${this.t.schedules} WHERE id = ?`, [id])).rows[0];
    if (!r) return null;
    return { ...r, enabled: Boolean(r['enabled']) } as unknown as ScheduleRow;
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    await this.init();
    let sql = `SELECT * FROM ${this.t.schedules}`;
    const args: unknown[] = [];
    if (opts?.enabled !== undefined) { sql += ' WHERE enabled = ?'; args.push(opts.enabled ? 1 : 0); }
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit !== undefined) { sql += ' LIMIT ?'; args.push(opts.limit); }
    return (await this.q(sql, args)).rows.map(r => ({ ...r, enabled: Boolean(r['enabled']) }) as unknown as ScheduleRow);
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    await this.init();
    const sets: string[] = ['updated_at = ?']; const args: unknown[] = [now()];
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'created_at' || k === 'id') continue;
      sets.push(`${k} = ?`);
      args.push(k === 'enabled' ? (v ? 1 : 0) : v);
    }
    args.push(id);
    await this.q(`UPDATE ${this.t.schedules} SET ${sets.join(', ')} WHERE id = ?`, args);
    return this.getSchedule(id);
  }

  async deleteSchedule(id: string): Promise<boolean> {
    await this.init();
    return (await this.q(`DELETE FROM ${this.t.schedules} WHERE id = ?`, [id])).rowsAffected > 0;
  }

  override toDict(): Record<string, unknown> {
    return { type: this.type, url: this.opts.url };
  }
}
