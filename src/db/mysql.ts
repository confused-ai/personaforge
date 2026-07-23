/**
 * @personaforge/db/mysql — MysqlAgentDb.
 *
 * Uses the `mysql2` package with a connection pool (promise API).
 * Peer dep: `mysql2` (optional — install only if you want MySQL/MariaDB).
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
  '[personaforge/db] MysqlAgentDb requires mysql2.\n' +
  '  Install: npm install mysql2';


type MysqlPool = { execute(sql: string, params?: unknown[]): Promise<[any[], any]>; end(): Promise<void> };
type MysqlPoolCreator = { createPool(config: Record<string, unknown>): MysqlPool };



export interface MysqlAgentDbOptions {
  /** Connection string, e.g. `mysql://user:pass@host:3306/db`. */
  uri?: string;
  /** Or pass individual pool config fields. */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Override table names. */
  tables?: AgentDbTableNames;
}

export class MysqlAgentDb extends AgentDb {
  readonly type = 'mysql';

  private readonly opts: MysqlAgentDbOptions;
  private readonly t: Required<AgentDbTableNames>;
  private _pool: MysqlPool | null = null;
  private _ready = false;
  private _initPromise: Promise<void> | null = null;

  constructor(opts: MysqlAgentDbOptions = {}) {
    super();
    this.opts = opts;
    this.t = validateTableNames({ ...DEFAULT_TABLE_NAMES, ...(opts.tables ?? {}) });
  }

  private pool(): MysqlPool {
    if (this._pool) return this._pool;
    let mysql2: MysqlPoolCreator;
    try { mysql2 = (require('mysql2/promise') as MysqlPoolCreator); }
    catch { throw new Error(MISSING); }
    const { tables: _t, uri, ...poolConfig } = this.opts;
    void _t;
    this._pool = mysql2.createPool(uri ? { uri, ...poolConfig } as Record<string, unknown> : poolConfig as Record<string, unknown>);
    return this._pool;
  }

  private async q(sql: string, params?: unknown[]): Promise<unknown[]> {
    const [rows] = await this.pool().execute(sql, params);
    return rows as unknown[];
  }

  async init(): Promise<void> {
    if (this._ready) return;
    if (!this._initPromise) this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    // MySQL uses REPLACE ... ON DUPLICATE KEY UPDATE pattern
    // TEXT for JSON fields (MySQL < 8.0 compat), or use JSON type on 8.0+
    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.sessions} (
        session_id    VARCHAR(255) PRIMARY KEY,
        session_type  VARCHAR(50) NOT NULL DEFAULT 'agent',
        agent_id      VARCHAR(255),
        team_id       VARCHAR(255),
        workflow_id   VARCHAR(255),
        user_id       VARCHAR(255),
        agent_data    JSON,
        team_data     JSON,
        workflow_data  JSON,
        session_data  JSON,
        metadata      JSON,
        runs          JSON,
        summary       TEXT,
        created_at    BIGINT NOT NULL,
        updated_at    BIGINT NOT NULL,
        INDEX idx_sessions_user (user_id),
        INDEX idx_sessions_agent (agent_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.memories} (
        memory_id  VARCHAR(255) PRIMARY KEY,
        user_id    VARCHAR(255),
        agent_id   VARCHAR(255),
        team_id    VARCHAR(255),
        memory     TEXT NOT NULL,
        topics     JSON,
        input      TEXT,
        feedback   TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        INDEX idx_memories_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.learnings} (
        learning_id   VARCHAR(255) PRIMARY KEY,
        learning_type VARCHAR(100) NOT NULL,
        namespace     VARCHAR(255),
        user_id       VARCHAR(255),
        agent_id      VARCHAR(255),
        team_id       VARCHAR(255),
        workflow_id   VARCHAR(255),
        session_id    VARCHAR(255),
        entity_id     VARCHAR(255),
        entity_type   VARCHAR(255),
        content       JSON NOT NULL,
        metadata      JSON,
        created_at    BIGINT NOT NULL,
        updated_at    BIGINT NOT NULL,
        INDEX idx_learnings_type (learning_type),
        INDEX idx_learnings_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.knowledge} (
        id             VARCHAR(255) PRIMARY KEY,
        name           VARCHAR(255),
        description    TEXT,
        content        JSON,
        type           VARCHAR(100),
        size           BIGINT,
        linked_to      VARCHAR(255),
        access_count   INT DEFAULT 0,
        status         VARCHAR(100),
        status_message TEXT,
        external_id    VARCHAR(255),
        metadata       JSON,
        created_at     BIGINT,
        updated_at     BIGINT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.traces} (
        trace_id    VARCHAR(255) PRIMARY KEY,
        run_id      VARCHAR(255),
        session_id  VARCHAR(255),
        user_id     VARCHAR(255),
        agent_id    VARCHAR(255),
        team_id     VARCHAR(255),
        workflow_id VARCHAR(255),
        name        VARCHAR(255),
        status      VARCHAR(100),
        start_time  VARCHAR(100),
        end_time    VARCHAR(100),
        duration_ms DOUBLE,
        metadata    JSON,
        created_at  BIGINT NOT NULL,
        updated_at  BIGINT NOT NULL,
        INDEX idx_traces_session (session_id),
        INDEX idx_traces_agent (agent_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.q(`
      CREATE TABLE IF NOT EXISTS ${this.t.schedules} (
        id          VARCHAR(255) PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        agent_id    VARCHAR(255),
        cron        VARCHAR(255),
        enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        next_run_at BIGINT,
        last_run_at BIGINT,
        locked_by   VARCHAR(255),
        locked_at   BIGINT,
        metadata    JSON,
        created_at  BIGINT NOT NULL,
        updated_at  BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    this._ready = true;
  }

  async close(): Promise<void> {
    await this._pool?.end();
    this._pool = null;
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

  // ── JSON helpers — MySQL returns JSON columns as parsed objects ─────────────

  private _strify(v: unknown): string | null {
    return v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    await this.init();
    const ts = now();
    const existing = (await this.q(`SELECT created_at FROM ${this.t.sessions} WHERE session_id = ?`, [input.sessionId]))[0] as { created_at: number } | undefined;
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
      created_at:    existing?.created_at ?? ts,
      updated_at:    ts,
    };
    await this.q(`
      INSERT INTO ${this.t.sessions}
        (session_id, session_type, agent_id, team_id, workflow_id, user_id,
         agent_data, team_data, workflow_data, session_data, metadata, runs,
         summary, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        session_type=VALUES(session_type), agent_id=VALUES(agent_id),
        team_id=VALUES(team_id), workflow_id=VALUES(workflow_id),
        user_id=VALUES(user_id), agent_data=VALUES(agent_data),
        team_data=VALUES(team_data), workflow_data=VALUES(workflow_data),
        session_data=VALUES(session_data), metadata=VALUES(metadata),
        runs=VALUES(runs), summary=VALUES(summary),
        updated_at=VALUES(updated_at)
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
    let sql = `SELECT * FROM ${this.t.sessions} WHERE session_id = ?`;
    if (userId !== undefined) { sql += ' AND user_id = ?'; params.push(userId); }
    const rows = await this.q(sql, params);
    if (!rows[0]) return null;
    return this._serSession(rows[0] as SessionRow);
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    if (query.sessionType) { where.push('session_type = ?'); params.push(query.sessionType); }
    if (query.agentId)     { where.push('agent_id = ?');     params.push(query.agentId); }
    if (query.teamId)      { where.push('team_id = ?');      params.push(query.teamId); }
    if (query.workflowId)  { where.push('workflow_id = ?');  params.push(query.workflowId); }
    if (query.userId)      { where.push('user_id = ?');      params.push(query.userId); }
    let sql = `SELECT * FROM ${this.t.sessions}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit  !== undefined) { sql += ' LIMIT ?';  params.push(query.limit); }
    if (query.offset !== undefined) { sql += ' OFFSET ?'; params.push(query.offset); }
    const rows = await this.q(sql, params);
    return rows.map(r => this._serSession(r as SessionRow));
  }

  async deleteSession(sessionId: string, userId?: string): Promise<boolean> {
    await this.init();
    const params: unknown[] = [sessionId];
    let sql = `DELETE FROM ${this.t.sessions} WHERE session_id = ?`;
    if (userId !== undefined) { sql += ' AND user_id = ?'; params.push(userId); }
    const result = await this.pool().execute(sql, params);
    return ((result[0] as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sd = row.session_data ? JSON.parse(row.session_data) as Record<string, unknown> : {};
    sd['session_name'] = name;
    const ts = now();
    await this.q(
      `UPDATE ${this.t.sessions} SET session_data = ?, updated_at = ? WHERE session_id = ?`,
      [JSON.stringify(sd), ts, sessionId],
    );
    return { ...row, session_data: JSON.stringify(sd), updated_at: ts };
  }

  private _serSession(r: SessionRow): SessionRow {
    return { ...r,
      agent_data: this._strify(r.agent_data), team_data: this._strify(r.team_data),
      workflow_data: this._strify(r.workflow_data), session_data: this._strify(r.session_data),
      metadata: this._strify(r.metadata), runs: this._strify(r.runs) };
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
    await this.init();
    const ts = now();
    const memoryId = input.memoryId ?? uuid();
    const existing = (await this.q(`SELECT created_at FROM ${this.t.memories} WHERE memory_id = ?`, [memoryId]))[0] as { created_at: number } | undefined;
    const row: MemoryRow = {
      memory_id:  memoryId,
      user_id:    input.userId   ?? null,
      agent_id:   input.agentId  ?? null,
      team_id:    input.teamId   ?? null,
      memory:     input.memory,
      topics:     input.topics   ? JSON.stringify(input.topics) : null,
      input:      input.input    ?? null,
      feedback:   input.feedback ?? null,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    };
    await this.q(`
      INSERT INTO ${this.t.memories}
        (memory_id, user_id, agent_id, team_id, memory, topics, input, feedback, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        memory=VALUES(memory), topics=VALUES(topics), input=VALUES(input),
        feedback=VALUES(feedback), agent_id=VALUES(agent_id),
        team_id=VALUES(team_id), updated_at=VALUES(updated_at)
    `, [
      row.memory_id, row.user_id, row.agent_id, row.team_id, row.memory,
      row.topics, row.input, row.feedback, row.created_at, row.updated_at,
    ]);
    return row;
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    await this.init();
    const params: unknown[] = [memoryId];
    let sql = `SELECT * FROM ${this.t.memories} WHERE memory_id = ?`;
    if (userId !== undefined) { sql += ' AND user_id = ?'; params.push(userId); }
    const rows = await this.q(sql, params);
    if (!rows[0]) return null;
    const r = rows[0] as MemoryRow;
    return { ...r, topics: this._strify(r.topics) };
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    if (query.userId)  { where.push('user_id = ?');  params.push(query.userId); }
    if (query.agentId) { where.push('agent_id = ?'); params.push(query.agentId); }
    if (query.teamId)  { where.push('team_id = ?');  params.push(query.teamId); }
    if (query.search)  { where.push('memory LIKE ?'); params.push(`%${query.search}%`); }
    let sql = `SELECT * FROM ${this.t.memories}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit  !== undefined) { sql += ' LIMIT ?';  params.push(query.limit); }
    if (query.offset !== undefined) { sql += ' OFFSET ?'; params.push(query.offset); }
    const rows = await this.q(sql, params);
    return rows.map(r => {
      const row = r as MemoryRow;
      return { ...row, topics: this._strify(row.topics) };
    });
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    await this.init();
    const params: unknown[] = [memoryId];
    let sql = `DELETE FROM ${this.t.memories} WHERE memory_id = ?`;
    if (userId !== undefined) { sql += ' AND user_id = ?'; params.push(userId); }
    const result = await this.pool().execute(sql, params);
    return ((result[0] as { affectedRows?: number }).affectedRows ?? 0) > 0;
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
    const existing = (await this.q(`SELECT created_at FROM ${this.t.learnings} WHERE learning_id = ?`, [input.id]))[0] as { created_at: number } | undefined;
    await this.q(`
      INSERT INTO ${this.t.learnings}
        (learning_id, learning_type, namespace, user_id, agent_id, team_id,
         workflow_id, session_id, entity_id, entity_type, content, metadata,
         created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        content=VALUES(content), metadata=VALUES(metadata),
        updated_at=VALUES(updated_at)
    `, [
      input.id, input.learningType, input.namespace ?? null,
      input.userId ?? null, input.agentId ?? null, input.teamId ?? null,
      input.workflowId ?? null, input.sessionId ?? null,
      input.entityId ?? null, input.entityType ?? null,
      JSON.stringify(input.content),
      input.metadata ? JSON.stringify(input.metadata) : null,
      existing?.created_at ?? ts, ts,
    ]);
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    const rows = await this.getLearnings({ ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    if (query.learningType) { where.push('learning_type = ?'); params.push(query.learningType); }
    if (query.userId)       { where.push('user_id = ?');       params.push(query.userId); }
    if (query.agentId)      { where.push('agent_id = ?');      params.push(query.agentId); }
    if (query.teamId)       { where.push('team_id = ?');       params.push(query.teamId); }
    if (query.workflowId)   { where.push('workflow_id = ?');   params.push(query.workflowId); }
    if (query.sessionId)    { where.push('session_id = ?');    params.push(query.sessionId); }
    if (query.namespace)    { where.push('namespace = ?');     params.push(query.namespace); }
    if (query.entityId)     { where.push('entity_id = ?');     params.push(query.entityId); }
    if (query.entityType)   { where.push('entity_type = ?');   params.push(query.entityType); }
    let sql = `SELECT * FROM ${this.t.learnings}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit !== undefined) { sql += ' LIMIT ?'; params.push(query.limit); }
    const rows = await this.q(sql, params);
    return rows.map(r => {
      const row = r as LearningRow;
      return { ...row, content: this._strify(row.content) as string };
    });
  }

  async deleteLearning(id: string): Promise<boolean> {
    await this.init();
    const result = await this.pool().execute(`DELETE FROM ${this.t.learnings} WHERE learning_id = ?`, [id]);
    return ((result[0] as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    await this.init();
    const ts = now();
    const existing = (await this.q(`SELECT created_at, access_count FROM ${this.t.knowledge} WHERE id = ?`, [input.id]))[0] as Pick<KnowledgeRow, 'created_at' | 'access_count'> | undefined;
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
      ON DUPLICATE KEY UPDATE
        name=VALUES(name), description=VALUES(description),
        content=VALUES(content), type=VALUES(type), size=VALUES(size),
        linked_to=VALUES(linked_to), status=VALUES(status),
        status_message=VALUES(status_message), external_id=VALUES(external_id),
        metadata=VALUES(metadata), updated_at=VALUES(updated_at)
    `, [
      row.id, row.name, row.description, row.content, row.type, row.size,
      row.linked_to, row.access_count, row.status, row.status_message,
      row.external_id, row.metadata, row.created_at, row.updated_at,
    ]);
    return row;
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    await this.init();
    const rows = await this.q(`SELECT * FROM ${this.t.knowledge} WHERE id = ?`, [id]);
    if (!rows[0]) return null;
    const r = rows[0] as KnowledgeRow;
    return { ...r, content: this._strify(r.content) };
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    if (query.linkedTo) { where.push('linked_to = ?'); params.push(query.linkedTo); }
    if (query.status)   { where.push('status = ?');    params.push(query.status); }
    let sql = `SELECT * FROM ${this.t.knowledge}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    const countRows = await this.q(sql.replace('SELECT *', 'SELECT count(*) AS cnt'), params);
    const total = (countRows[0] as { cnt: number }).cnt;
    if (query.limit  !== undefined) { sql += ' LIMIT ?';  params.push(query.limit); }
    if (query.offset !== undefined) { sql += ' OFFSET ?'; params.push(query.offset); }
    const rows = await this.q(sql, params);
    return [rows as KnowledgeRow[], total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    await this.init();
    const result = await this.pool().execute(`DELETE FROM ${this.t.knowledge} WHERE id = ?`, [id]);
    return ((result[0] as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    try {
      await this.init();
      const ts = now();
      const existing = (await this.q(`SELECT created_at FROM ${this.t.traces} WHERE trace_id = ?`, [trace.trace_id]))[0] as { created_at: number } | undefined;
      await this.q(`
        INSERT INTO ${this.t.traces}
          (trace_id, run_id, session_id, user_id, agent_id, team_id, workflow_id,
           name, status, start_time, end_time, duration_ms, metadata, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE
          status=VALUES(status), end_time=VALUES(end_time),
          duration_ms=VALUES(duration_ms), updated_at=VALUES(updated_at)
      `, [
        trace.trace_id, trace.run_id ?? null, trace.session_id ?? null,
        trace.user_id ?? null, trace.agent_id ?? null, trace.team_id ?? null,
        trace.workflow_id ?? null, trace.name ?? null, trace.status ?? null,
        trace.start_time ?? null, trace.end_time ?? null, trace.duration_ms ?? null,
        trace.metadata ?? null,
        existing?.created_at ?? trace.created_at ?? ts, ts,
      ]);
    } catch { /* traces must not break agent flow */ }
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    await this.init();
    const rows = await this.q(`SELECT * FROM ${this.t.traces} WHERE trace_id = ?`, [traceId]);
    return (rows[0] as TraceRow) ?? null;
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    await this.init();
    const where: string[] = []; const params: unknown[] = [];
    if (opts.sessionId) { where.push('session_id = ?'); params.push(opts.sessionId); }
    if (opts.agentId)   { where.push('agent_id = ?');   params.push(opts.agentId); }
    if (opts.userId)    { where.push('user_id = ?');    params.push(opts.userId); }
    let sql = `SELECT * FROM ${this.t.traces}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const countRows = await this.q(sql.replace('SELECT *', 'SELECT count(*) AS cnt'), params);
    const total = (countRows[0] as { cnt: number }).cnt;
    if (opts.limit  !== undefined) { sql += ' LIMIT ?';  params.push(opts.limit); }
    if (opts.offset !== undefined) { sql += ' OFFSET ?'; params.push(opts.offset); }
    const rows = await this.q(sql, params);
    return [rows as TraceRow[], total];
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
      full.id, full.name, full.agent_id ?? null, full.cron ?? null, full.enabled,
      full.next_run_at ?? null, full.last_run_at ?? null,
      full.locked_by ?? null, full.locked_at ?? null,
      full.metadata ?? null, full.created_at, full.updated_at,
    ]);
    return full;
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    await this.init();
    const rows = await this.q(`SELECT * FROM ${this.t.schedules} WHERE id = ?`, [id]);
    if (!rows[0]) return null;
    const r = rows[0] as Record<string, unknown>;
    return { ...r, enabled: Boolean(r['enabled']) } as unknown as ScheduleRow;
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    await this.init();
    let sql = `SELECT * FROM ${this.t.schedules}`;
    const params: unknown[] = [];
    if (opts?.enabled !== undefined) { sql += ' WHERE enabled = ?'; params.push(opts.enabled); }
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit !== undefined) { sql += ' LIMIT ?'; params.push(opts.limit); }
    const rows = await this.q(sql, params);
    return rows.map(r => {
      const row = r as Record<string, unknown>;
      return { ...row, enabled: Boolean(row['enabled']) } as unknown as ScheduleRow;
    });
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    await this.init();
    const sets: string[] = ['updated_at = ?']; const params: unknown[] = [now()];
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'created_at' || k === 'id') continue;
      sets.push(`${k} = ?`);
      params.push(k === 'enabled' ? (v ? 1 : 0) : v);
    }
    params.push(id);
    await this.q(`UPDATE ${this.t.schedules} SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getSchedule(id);
  }

  async deleteSchedule(id: string): Promise<boolean> {
    await this.init();
    const result = await this.pool().execute(`DELETE FROM ${this.t.schedules} WHERE id = ?`, [id]);
    return ((result[0] as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  override toDict(): Record<string, unknown> {
    const { tables: _t, password: _p, ...cfg } = this.opts;
    void _t; void _p;
    return { type: this.type, ...cfg };
  }
}
