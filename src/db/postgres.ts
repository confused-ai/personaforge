/**
 * @personaforge/db/postgres — PostgresAgentDb.
 *
 * Uses the `pg` package (node-postgres) with a connection pool.
 * Peer dep: `pg` (optional — install only if you want Postgres).
 */

import { AgentDb, validateTableNames } from './base.js';
import { DEFAULT_TABLE_NAMES } from './types.js';
import { uuid, now } from './utils.js';
import { runMigrations, MIGRATIONS } from './migrations/index.js';
import type {
  SessionRow, MemoryRow, LearningRow, KnowledgeRow, TraceRow, ScheduleRow,
  SessionQuery, MemoryQuery, LearningQuery, KnowledgeQuery,
  UpsertSessionInput, UpsertMemoryInput, UpsertLearningInput, UpsertKnowledgeInput,
  AgentDbTableNames,
} from './types.js';

const MISSING =
  '[personaforge/db] PostgresAgentDb requires pg.\n' +
  '  Install: npm install pg\n' +
  '           npm install -D @types/pg';


type PgPool = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; end(): Promise<void> };
type PgPoolCtor = new (config: Record<string, unknown>) => PgPool;



export interface PostgresAgentDbOptions {
  /** Connection string, e.g. `postgres://user:pass@host:5432/db` */
  connectionString?: string;
  /** Or pass individual pg Pool config fields. */
  host?: string; port?: number; database?: string; user?: string; password?: string;
  /** Override table names. */
  tables?: AgentDbTableNames;
}

export class PostgresAgentDb extends AgentDb {
  readonly type = 'postgres';

  private readonly opts: PostgresAgentDbOptions;
  private readonly t: Required<AgentDbTableNames>;
  private _pool: PgPool | null = null;
  private _ready = false;
  private _initPromise: Promise<void> | null = null;

  constructor(opts: PostgresAgentDbOptions = {}) {
    super();
    this.opts = opts;
    this.t = validateTableNames({ ...DEFAULT_TABLE_NAMES, ...(opts.tables ?? {}) });
  }

  private pool(): PgPool {
    if (this._pool) return this._pool;
    let Pool: PgPoolCtor;
    try { Pool = (require('pg') as { Pool: PgPoolCtor }).Pool; }
    catch { throw new Error(MISSING); }
    const { tables: _t, ...pgConfig } = this.opts;
    void _t;
    this._pool = new Pool(pgConfig as Record<string, unknown>);
    return this._pool;
  }

  private q(sql: string, params?: unknown[]) {
    return this.pool().query(sql, params);
  }

  async init(): Promise<void> {
    if (this._ready) return;
    if (!this._initPromise) this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    await runMigrations(this.pool(), MIGRATIONS);
    this._ready = true;
  }

  async close(): Promise<void> {
    if (this._pool) {
      try {
        await this._pool.end();
      } catch (err) {
        // Pool already closed or connection error — log and continue
        console.warn('[PostgresAgentDb.close] Pool end failed:', err instanceof Error ? err.message : String(err));
      }
      this._pool = null;
    }
    this._ready = false;
    this._initPromise = null;
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    await this.init();
    const ts = now();
    const { rows: [ex] } = await this.q(`SELECT created_at FROM ${this.t.sessions} WHERE session_id = $1`, [input.sessionId]);
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
      created_at:    (ex as { created_at: number } | undefined)?.created_at ?? ts,
      updated_at:    ts,
    };
    await this.q(`
      INSERT INTO ${this.t.sessions}
        (session_id, session_type, agent_id, team_id, workflow_id, user_id,
         agent_data, team_data, workflow_data, session_data, metadata, runs,
         summary, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(session_id) DO UPDATE SET
        session_type=EXCLUDED.session_type, agent_id=EXCLUDED.agent_id,
        team_id=EXCLUDED.team_id, workflow_id=EXCLUDED.workflow_id,
        user_id=EXCLUDED.user_id, agent_data=EXCLUDED.agent_data::jsonb,
        team_data=EXCLUDED.team_data::jsonb, workflow_data=EXCLUDED.workflow_data::jsonb,
        session_data=EXCLUDED.session_data::jsonb, metadata=EXCLUDED.metadata::jsonb,
        runs=EXCLUDED.runs::jsonb, summary=EXCLUDED.summary,
        updated_at=EXCLUDED.updated_at
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
    const params: unknown[] = [sessionId];
    let sql = `SELECT * FROM ${this.t.sessions} WHERE session_id = $1`;
    if (userId !== undefined) { sql += ' AND user_id = $2'; params.push(userId); }
    const { rows } = await this.q(sql, params);
    return rows[0] ? this._serSession(rows[0] as SessionRow) : null;
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    let i = 1;
    if (query.sessionType) { where.push(`session_type = $${i++}`); params.push(query.sessionType); }
    if (query.agentId)     { where.push(`agent_id = $${i++}`);     params.push(query.agentId); }
    if (query.teamId)      { where.push(`team_id = $${i++}`);      params.push(query.teamId); }
    if (query.workflowId)  { where.push(`workflow_id = $${i++}`);  params.push(query.workflowId); }
    if (query.userId)      { where.push(`user_id = $${i++}`);      params.push(query.userId); }
    let sql = `SELECT * FROM ${this.t.sessions}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit  !== undefined) { sql += ` LIMIT $${i++}`;  params.push(query.limit); }
    if (query.offset !== undefined) { sql += ` OFFSET $${i++}`; params.push(query.offset); }
    const { rows } = await this.q(sql, params);
    return rows.map(r => this._serSession(r as SessionRow));
  }

  async deleteSession(sessionId: string, userId?: string): Promise<boolean> {
    await this.init();
    const params: unknown[] = [sessionId];
    let sql = `DELETE FROM ${this.t.sessions} WHERE session_id = $1`;
    if (userId !== undefined) { sql += ' AND user_id = $2'; params.push(userId); }
    const { rows } = await this.q(sql + ' RETURNING session_id', params);
    return rows.length > 0;
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sd = row.session_data ? JSON.parse(row.session_data) as Record<string, unknown> : {};
    sd['session_name'] = name;
    const ts = now();
    await this.q(
      `UPDATE ${this.t.sessions} SET session_data = $1::jsonb, updated_at = $2 WHERE session_id = $3`,
      [JSON.stringify(sd), ts, sessionId],
    );
    return { ...row, session_data: JSON.stringify(sd), updated_at: ts };
  }

  private _serSession(r: SessionRow): SessionRow {
    // pg returns JSONB columns as parsed objects — re-stringify to match row contract
    const toStr = (v: unknown) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
    return { ...r, agent_data: toStr(r.agent_data), team_data: toStr(r.team_data),
      workflow_data: toStr(r.workflow_data), session_data: toStr(r.session_data),
      metadata: toStr(r.metadata), runs: toStr(r.runs) };
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
    await this.init();
    const ts = now();
    const memoryId = input.memoryId ?? uuid();
    const { rows: [ex] } = await this.q(`SELECT created_at FROM ${this.t.memories} WHERE memory_id = $1`, [memoryId]);
    const row: MemoryRow = {
      memory_id:  memoryId,
      user_id:    input.userId   ?? null,
      agent_id:   input.agentId  ?? null,
      team_id:    input.teamId   ?? null,
      memory:     input.memory,
      topics:     input.topics   ? JSON.stringify(input.topics) : null,
      input:      input.input    ?? null,
      feedback:   input.feedback ?? null,
      created_at: (ex as { created_at: number } | undefined)?.created_at ?? ts,
      updated_at: ts,
    };
    await this.q(`
      INSERT INTO ${this.t.memories}
        (memory_id, user_id, agent_id, team_id, memory, topics, input, feedback, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(memory_id) DO UPDATE SET
        memory=EXCLUDED.memory, topics=EXCLUDED.topics::jsonb,
        input=EXCLUDED.input, agent_id=EXCLUDED.agent_id,
        team_id=EXCLUDED.team_id, feedback=EXCLUDED.feedback,
        updated_at=EXCLUDED.updated_at
    `, [
      row.memory_id, row.user_id, row.agent_id, row.team_id, row.memory,
      row.topics, row.input, row.feedback, row.created_at, row.updated_at,
    ]);
    return row;
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    await this.init();
    const params: unknown[] = [memoryId];
    let sql = `SELECT * FROM ${this.t.memories} WHERE memory_id = $1`;
    if (userId !== undefined) { sql += ' AND user_id = $2'; params.push(userId); }
    const { rows } = await this.q(sql, params);
    if (!rows[0]) return null;
    const r = rows[0] as MemoryRow;
    return { ...r, topics: typeof r.topics === 'string' ? r.topics : r.topics ? JSON.stringify(r.topics) : null };
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    let i = 1;
    if (query.userId)  { where.push(`user_id = $${i++}`);  params.push(query.userId); }
    if (query.agentId) { where.push(`agent_id = $${i++}`); params.push(query.agentId); }
    if (query.teamId)  { where.push(`team_id = $${i++}`);  params.push(query.teamId); }
    if (query.search)  { where.push(`memory ILIKE $${i++}`); params.push(`%${query.search}%`); }
    let sql = `SELECT * FROM ${this.t.memories}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit  !== undefined) { sql += ` LIMIT $${i++}`;  params.push(query.limit); }
    if (query.offset !== undefined) { sql += ` OFFSET $${i++}`; params.push(query.offset); }
    const { rows } = await this.q(sql, params);
    return rows.map(r => {
      const row = r as MemoryRow;
      return { ...row, topics: typeof row.topics === 'string' ? row.topics : row.topics ? JSON.stringify(row.topics) : null };
    });
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    await this.init();
    const params: unknown[] = [memoryId];
    let sql = `DELETE FROM ${this.t.memories} WHERE memory_id = $1`;
    if (userId !== undefined) { sql += ' AND user_id = $2'; params.push(userId); }
    const { rows } = await this.q(sql + ' RETURNING memory_id', params);
    return rows.length > 0;
  }

  async clearMemories(userId?: string): Promise<void> {
    await this.init();
    if (userId === undefined) {
      await this.q(`DELETE FROM ${this.t.memories}`);
    } else {
      await this.q(`DELETE FROM ${this.t.memories} WHERE user_id = $1`, [userId]);
    }
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async upsertLearning(input: UpsertLearningInput): Promise<void> {
    await this.init();
    const ts = now();
    const { rows: [ex] } = await this.q(`SELECT created_at FROM ${this.t.learnings} WHERE learning_id = $1`, [input.id]);
    await this.q(`
      INSERT INTO ${this.t.learnings}
        (learning_id, learning_type, namespace, user_id, agent_id, team_id,
         workflow_id, session_id, entity_id, entity_type, content, metadata,
         created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(learning_id) DO UPDATE SET
        content=EXCLUDED.content::jsonb, metadata=EXCLUDED.metadata::jsonb,
        updated_at=EXCLUDED.updated_at
    `, [
      input.id, input.learningType, input.namespace ?? null,
      input.userId ?? null, input.agentId ?? null, input.teamId ?? null,
      input.workflowId ?? null, input.sessionId ?? null,
      input.entityId ?? null, input.entityType ?? null,
      JSON.stringify(input.content),
      input.metadata ? JSON.stringify(input.metadata) : null,
      (ex as { created_at: number } | undefined)?.created_at ?? ts, ts,
    ]);
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    const rows = await this.getLearnings({ ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    let i = 1;
    if (query.learningType) { where.push(`learning_type = $${i++}`); params.push(query.learningType); }
    if (query.userId)       { where.push(`user_id = $${i++}`);       params.push(query.userId); }
    if (query.agentId)      { where.push(`agent_id = $${i++}`);      params.push(query.agentId); }
    if (query.teamId)       { where.push(`team_id = $${i++}`);       params.push(query.teamId); }
    if (query.workflowId)   { where.push(`workflow_id = $${i++}`);   params.push(query.workflowId); }
    if (query.sessionId)    { where.push(`session_id = $${i++}`);    params.push(query.sessionId); }
    if (query.namespace)    { where.push(`namespace = $${i++}`);     params.push(query.namespace); }
    if (query.entityId)     { where.push(`entity_id = $${i++}`);     params.push(query.entityId); }
    if (query.entityType)   { where.push(`entity_type = $${i++}`);   params.push(query.entityType); }
    let sql = `SELECT * FROM ${this.t.learnings}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit !== undefined) { sql += ` LIMIT $${i++}`; params.push(query.limit); }
    const { rows } = await this.q(sql, params);
    return rows.map(r => {
      const row = r as LearningRow;
      return { ...row, content: typeof row.content === 'string' ? row.content : JSON.stringify(row.content) };
    });
  }

  async deleteLearning(id: string): Promise<boolean> {
    await this.init();
    const { rows } = await this.q(`DELETE FROM ${this.t.learnings} WHERE learning_id = $1 RETURNING learning_id`, [id]);
    return rows.length > 0;
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    await this.init();
    const ts = now();
    const { rows: [ex] } = await this.q(`SELECT created_at, access_count FROM ${this.t.knowledge} WHERE id = $1`, [input.id]);
    const existing = ex as Pick<KnowledgeRow, 'created_at' | 'access_count'> | undefined;
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(id) DO UPDATE SET
        name=EXCLUDED.name, description=EXCLUDED.description,
        content=EXCLUDED.content::jsonb, type=EXCLUDED.type, size=EXCLUDED.size,
        linked_to=EXCLUDED.linked_to, status=EXCLUDED.status,
        status_message=EXCLUDED.status_message, external_id=EXCLUDED.external_id,
        metadata=EXCLUDED.metadata::jsonb, updated_at=EXCLUDED.updated_at
    `, [
      row.id, row.name, row.description, row.content, row.type, row.size,
      row.linked_to, row.access_count, row.status, row.status_message,
      row.external_id, row.metadata, row.created_at, row.updated_at,
    ]);
    return row;
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    await this.init();
    const { rows } = await this.q(`SELECT * FROM ${this.t.knowledge} WHERE id = $1`, [id]);
    if (!rows[0]) return null;
    const r = rows[0] as KnowledgeRow;
    return { ...r, content: typeof r.content === 'string' ? r.content : r.content ? JSON.stringify(r.content) : null };
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    let i = 1;
    if (query.linkedTo) { where.push(`linked_to = $${i++}`); params.push(query.linkedTo); }
    if (query.status)   { where.push(`status = $${i++}`);    params.push(query.status); }
    let sql = `SELECT * FROM ${this.t.knowledge}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    const { rows: countRows } = await this.q(sql.replace('SELECT *', 'SELECT count(*)::int AS cnt'), params);
    const total = (countRows[0] as { cnt: number }).cnt;
    if (query.limit  !== undefined) { sql += ` LIMIT $${i++}`;  params.push(query.limit); }
    if (query.offset !== undefined) { sql += ` OFFSET $${i++}`; params.push(query.offset); }
    const { rows } = await this.q(sql, params);
    const toStr = (v: unknown) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
    return [rows.map(r => { const k = r as KnowledgeRow; return { ...k, content: toStr(k.content), metadata: toStr(k.metadata) }; }), total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    await this.init();
    const { rows } = await this.q(`DELETE FROM ${this.t.knowledge} WHERE id = $1 RETURNING id`, [id]);
    return rows.length > 0;
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    try {
      await this.init();
      const ts = now();
      const { rows: [ex] } = await this.q(`SELECT created_at FROM ${this.t.traces} WHERE trace_id = $1`, [trace.trace_id]);
      await this.q(`
        INSERT INTO ${this.t.traces}
          (trace_id, run_id, session_id, user_id, agent_id, team_id, workflow_id,
           name, status, start_time, end_time, duration_ms, metadata, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(trace_id) DO UPDATE SET
          status=EXCLUDED.status, end_time=EXCLUDED.end_time,
          duration_ms=EXCLUDED.duration_ms, updated_at=EXCLUDED.updated_at
      `, [
        trace.trace_id, trace.run_id ?? null, trace.session_id ?? null,
        trace.user_id ?? null, trace.agent_id ?? null, trace.team_id ?? null,
        trace.workflow_id ?? null, trace.name ?? null, trace.status ?? null,
        trace.start_time ?? null, trace.end_time ?? null, trace.duration_ms ?? null,
        trace.metadata ?? null,
        (ex as { created_at: number } | undefined)?.created_at ?? trace.created_at ?? ts, ts,
      ]);
    } catch { /* traces must not break agent flow */ }
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    await this.init();
    const { rows } = await this.q(`SELECT * FROM ${this.t.traces} WHERE trace_id = $1`, [traceId]);
    if (!rows[0]) return null;
    const r = rows[0] as TraceRow;
    return { ...r, metadata: typeof r.metadata === 'string' ? r.metadata : r.metadata ? JSON.stringify(r.metadata) : null };
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    let i = 1;
    if (opts.sessionId) { where.push(`session_id = $${i++}`); params.push(opts.sessionId); }
    if (opts.agentId)   { where.push(`agent_id = $${i++}`);   params.push(opts.agentId); }
    if (opts.userId)    { where.push(`user_id = $${i++}`);    params.push(opts.userId); }
    let sql = `SELECT * FROM ${this.t.traces}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const { rows: cr } = await this.q(sql.replace('SELECT *', 'SELECT count(*)::int AS cnt'), params);
    const total = (cr[0] as { cnt: number }).cnt;
    if (opts.limit  !== undefined) { sql += ` LIMIT $${i++}`;  params.push(opts.limit); }
    if (opts.offset !== undefined) { sql += ` OFFSET $${i++}`; params.push(opts.offset); }
    const { rows } = await this.q(sql, params);
    const toStr = (v: unknown) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
    return [rows.map(r => { const t = r as TraceRow; return { ...t, metadata: toStr(t.metadata) }; }), total];
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [
      full.id, full.name, full.agent_id ?? null, full.cron ?? null, full.enabled,
      full.next_run_at ?? null, full.last_run_at ?? null,
      full.locked_by ?? null, full.locked_at ?? null,
      full.metadata ?? null, full.created_at, full.updated_at,
    ]);
    return full;
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    await this.init();
    const { rows } = await this.q(`SELECT * FROM ${this.t.schedules} WHERE id = $1`, [id]);
    return rows[0] as ScheduleRow ?? null;
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    await this.init();
    let sql = `SELECT * FROM ${this.t.schedules}`;
    const params: unknown[] = [];
    if (opts?.enabled !== undefined) { sql += ' WHERE enabled = $1'; params.push(opts.enabled); }
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit !== undefined) { sql += ` LIMIT $${params.length + 1}`; params.push(opts.limit); }
    const { rows } = await this.q(sql, params);
    return rows as ScheduleRow[];
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    await this.init();
    const sets: string[] = []; const params: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'created_at' || k === 'id') continue;
      sets.push(`${k} = $${i++}`); params.push(v);
    }
    sets.push(`updated_at = $${i++}`); params.push(now());
    params.push(id);
    await this.q(`UPDATE ${this.t.schedules} SET ${sets.join(', ')} WHERE id = $${i}`, params);
    return this.getSchedule(id);
  }

  async deleteSchedule(id: string): Promise<boolean> {
    await this.init();
    const { rows } = await this.q(`DELETE FROM ${this.t.schedules} WHERE id = $1 RETURNING id`, [id]);
    return rows.length > 0;
  }

  override toDict(): Record<string, unknown> {
    const { tables: _t, ...cfg } = this.opts;
    void _t;
    return { type: this.type, ...cfg };
  }
}
