/**
 * @personaforge/db/sqlite — SqliteAgentDb.
 *
 * Durable, zero-server backend using better-sqlite3.
 * All tables are created lazily on first use.
 * Peer dep: `better-sqlite3` (optional — install only if you want SQLite).
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
  '[personaforge/db] SqliteAgentDb requires better-sqlite3.\n' +
  '  Install: npm install better-sqlite3\n' +
  '           npm install -D @types/better-sqlite3';

// ─── minimal better-sqlite3 surface ──────────────────────────────────────────
interface Stmt { run(...a: unknown[]): { changes: number }; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] }
interface Db { exec(sql: string): void; prepare(sql: string): Stmt; close(): void }
type DbCtor = new (path: string, opts?: { verbose?: (msg: string) => void }) => Db;



export interface SqliteAgentDbOptions {
  /** Path to the SQLite file. Defaults to `./agent.db`. */
  path?: string;
  /** Override individual table names. */
  tables?: AgentDbTableNames;
}

export class SqliteAgentDb extends AgentDb {
  readonly type = 'sqlite';

  private readonly opts: Required<SqliteAgentDbOptions>;
  private readonly t: Required<AgentDbTableNames>;
  private _db: Db | null = null;
  private _ready = false;

  constructor(opts: SqliteAgentDbOptions = {}) {
    super();
    this.opts = { path: opts.path ?? './agent.db', tables: opts.tables ?? {} };
    this.t = validateTableNames({ ...DEFAULT_TABLE_NAMES, ...this.opts.tables });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  private _getDb(): Db {
    if (this._db) return this._db;
    let Ctor: DbCtor;
    try { Ctor = require('better-sqlite3') as DbCtor; }
    catch { throw new Error(MISSING); }
    this._db = new Ctor(this.opts.path);
    return this._db;
  }

  async init(): Promise<void> {
    if (this._ready) return;
    const db = this._getDb();
    this._initTables(db);
    this._ready = true;
  }

  private _initTables(db: Db): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.t.sessions} (
        session_id    TEXT PRIMARY KEY,
        session_type  TEXT NOT NULL DEFAULT 'agent',
        agent_id      TEXT,
        team_id       TEXT,
        workflow_id   TEXT,
        user_id       TEXT,
        agent_data    TEXT,
        team_data     TEXT,
        workflow_data TEXT,
        session_data  TEXT,
        metadata      TEXT,
        runs          TEXT,
        summary       TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.t.sessions}_user ON ${this.t.sessions}(user_id);
      CREATE INDEX IF NOT EXISTS idx_${this.t.sessions}_agent ON ${this.t.sessions}(agent_id);

      CREATE TABLE IF NOT EXISTS ${this.t.memories} (
        memory_id  TEXT PRIMARY KEY,
        user_id    TEXT,
        agent_id   TEXT,
        team_id    TEXT,
        memory     TEXT NOT NULL,
        topics     TEXT,
        input      TEXT,
        feedback   TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.t.memories}_user ON ${this.t.memories}(user_id);

      CREATE TABLE IF NOT EXISTS ${this.t.learnings} (
        learning_id   TEXT PRIMARY KEY,
        learning_type TEXT NOT NULL,
        namespace     TEXT,
        user_id       TEXT,
        agent_id      TEXT,
        team_id       TEXT,
        workflow_id   TEXT,
        session_id    TEXT,
        entity_id     TEXT,
        entity_type   TEXT,
        content       TEXT NOT NULL,
        metadata      TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.t.learnings}_type ON ${this.t.learnings}(learning_type);
      CREATE INDEX IF NOT EXISTS idx_${this.t.learnings}_user ON ${this.t.learnings}(user_id);

      CREATE TABLE IF NOT EXISTS ${this.t.knowledge} (
        id             TEXT PRIMARY KEY,
        name           TEXT,
        description    TEXT,
        content        TEXT,
        type           TEXT,
        size           INTEGER,
        linked_to      TEXT,
        access_count   INTEGER DEFAULT 0,
        status         TEXT,
        status_message TEXT,
        external_id    TEXT,
        metadata       TEXT,
        created_at     INTEGER,
        updated_at     INTEGER
      );

      CREATE TABLE IF NOT EXISTS ${this.t.traces} (
        trace_id    TEXT PRIMARY KEY,
        run_id      TEXT,
        session_id  TEXT,
        user_id     TEXT,
        agent_id    TEXT,
        team_id     TEXT,
        workflow_id TEXT,
        name        TEXT,
        status      TEXT,
        start_time  TEXT,
        end_time    TEXT,
        duration_ms REAL,
        metadata    TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.t.traces}_session ON ${this.t.traces}(session_id);
      CREATE INDEX IF NOT EXISTS idx_${this.t.traces}_agent   ON ${this.t.traces}(agent_id);

      CREATE TABLE IF NOT EXISTS ${this.t.schedules} (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        agent_id    TEXT,
        cron        TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        next_run_at INTEGER,
        last_run_at INTEGER,
        locked_by   TEXT,
        locked_at   INTEGER,
        metadata    TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `);
  }

  async close(): Promise<void> {
    this._db?.close();
    this._db = null;
    this._ready = false;
  }

  private db(): Db {
    if (!this._ready) {
      // Synchronous init: better-sqlite3 is sync so we can do this safely
      const db = this._getDb();
      this._initTables(db);
      this._ready = true;
    }
    return this._getDb();
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    await this.init();
    const db = this.db();
    const ts = now();
    const existing = db.prepare(`SELECT created_at FROM ${this.t.sessions} WHERE session_id = ?`).get(input.sessionId) as { created_at: number } | undefined;
    const row: SessionRow = {
      session_id:    input.sessionId,
      session_type:  input.sessionType ?? 'agent',
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
    db.prepare(`
      INSERT INTO ${this.t.sessions}
        (session_id, session_type, agent_id, team_id, workflow_id, user_id,
         agent_data, team_data, workflow_data, session_data, metadata, runs,
         summary, created_at, updated_at)
      VALUES
        (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET
        session_type=excluded.session_type, agent_id=excluded.agent_id,
        team_id=excluded.team_id, workflow_id=excluded.workflow_id,
        user_id=excluded.user_id, agent_data=excluded.agent_data,
        team_data=excluded.team_data, workflow_data=excluded.workflow_data,
        session_data=excluded.session_data, metadata=excluded.metadata,
        runs=excluded.runs, summary=excluded.summary,
        updated_at=excluded.updated_at
    `).run(
      row.session_id, row.session_type, row.agent_id, row.team_id, row.workflow_id,
      row.user_id, row.agent_data, row.team_data, row.workflow_data,
      row.session_data, row.metadata, row.runs, row.summary,
      row.created_at, row.updated_at,
    );
    return row;
  }

  async getSession(sessionId: string, userId?: string): Promise<SessionRow | null> {
    await this.init();
    let sql = `SELECT * FROM ${this.t.sessions} WHERE session_id = ?`;
    const params: unknown[] = [sessionId];
    if (userId !== undefined) { sql += ' AND user_id = ?'; params.push(userId); }
    return (this.db().prepare(sql).get(...params) as SessionRow) ?? null;
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
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
    return this.db().prepare(sql).all(...params) as SessionRow[];
  }

  async deleteSession(sessionId: string, userId?: string): Promise<boolean> {
    await this.init();
    let sql = `DELETE FROM ${this.t.sessions} WHERE session_id = ?`;
    const params: unknown[] = [sessionId];
    if (userId !== undefined) { sql += ' AND user_id = ?'; params.push(userId); }
    return this.db().prepare(sql).run(...params).changes > 0;
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sd = row.session_data ? JSON.parse(row.session_data) as Record<string, unknown> : {};
    sd['session_name'] = name;
    const ts = now();
    this.db().prepare(
      `UPDATE ${this.t.sessions} SET session_data = ?, updated_at = ? WHERE session_id = ?`
    ).run(JSON.stringify(sd), ts, sessionId);
    return { ...row, session_data: JSON.stringify(sd), updated_at: ts };
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
    await this.init();
    const db = this.db();
    const ts = now();
    const memoryId = input.memoryId ?? uuid();
    const existing = db.prepare(`SELECT created_at FROM ${this.t.memories} WHERE memory_id = ?`).get(memoryId) as { created_at: number } | undefined;
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
    db.prepare(`
      INSERT INTO ${this.t.memories}
        (memory_id, user_id, agent_id, team_id, memory, topics, input, feedback, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(memory_id) DO UPDATE SET
        memory=excluded.memory, topics=excluded.topics, input=excluded.input,
        feedback=excluded.feedback, agent_id=excluded.agent_id,
        team_id=excluded.team_id, updated_at=excluded.updated_at
    `).run(
      row.memory_id, row.user_id, row.agent_id, row.team_id, row.memory,
      row.topics, row.input, row.feedback, row.created_at, row.updated_at,
    );
    return row;
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    await this.init();
    let sql = `SELECT * FROM ${this.t.memories} WHERE memory_id = ?`;
    const params: unknown[] = [memoryId];
    if (userId !== undefined) { sql += ' AND user_id = ?'; params.push(userId); }
    return (this.db().prepare(sql).get(...params) as MemoryRow) ?? null;
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.userId)  { where.push('user_id = ?');  params.push(query.userId); }
    if (query.agentId) { where.push('agent_id = ?'); params.push(query.agentId); }
    if (query.teamId)  { where.push('team_id = ?');  params.push(query.teamId); }
    if (query.search)  { where.push('memory LIKE ?'); params.push(`%${query.search}%`); }
    let sql = `SELECT * FROM ${this.t.memories}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (query.limit  !== undefined) { sql += ' LIMIT ?';  params.push(query.limit); }
    if (query.offset !== undefined) { sql += ' OFFSET ?'; params.push(query.offset); }
    let rows = this.db().prepare(sql).all(...params) as MemoryRow[];
    if (query.topics?.length) {
      rows = rows.filter(r => {
        if (!r.topics) return false;
        const t: string[] = JSON.parse(r.topics) as string[];
        return query.topics!.some(qt => t.includes(qt));
      });
    }
    return rows;
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    await this.init();
    let sql = `DELETE FROM ${this.t.memories} WHERE memory_id = ?`;
    const params: unknown[] = [memoryId];
    if (userId !== undefined) { sql += ' AND user_id = ?'; params.push(userId); }
    return this.db().prepare(sql).run(...params).changes > 0;
  }

  async clearMemories(userId?: string): Promise<void> {
    await this.init();
    if (userId === undefined) {
      this.db().prepare(`DELETE FROM ${this.t.memories}`).run();
    } else {
      this.db().prepare(`DELETE FROM ${this.t.memories} WHERE user_id = ?`).run(userId);
    }
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async upsertLearning(input: UpsertLearningInput): Promise<void> {
    await this.init();
    const ts = now();
    const existing = this.db().prepare(`SELECT created_at FROM ${this.t.learnings} WHERE learning_id = ?`).get(input.id) as { created_at: number } | undefined;
    this.db().prepare(`
      INSERT INTO ${this.t.learnings}
        (learning_id, learning_type, namespace, user_id, agent_id, team_id,
         workflow_id, session_id, entity_id, entity_type, content, metadata,
         created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(learning_id) DO UPDATE SET
        content=excluded.content, metadata=excluded.metadata,
        updated_at=excluded.updated_at
    `).run(
      input.id, input.learningType, input.namespace ?? null,
      input.userId ?? null, input.agentId ?? null, input.teamId ?? null,
      input.workflowId ?? null, input.sessionId ?? null,
      input.entityId ?? null, input.entityType ?? null,
      JSON.stringify(input.content),
      input.metadata ? JSON.stringify(input.metadata) : null,
      existing?.created_at ?? ts, ts,
    );
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    const rows = await this.getLearnings({ ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
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
    return this.db().prepare(sql).all(...params) as LearningRow[];
  }

  async deleteLearning(id: string): Promise<boolean> {
    await this.init();
    return this.db().prepare(`DELETE FROM ${this.t.learnings} WHERE learning_id = ?`).run(id).changes > 0;
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    await this.init();
    const ts = now();
    const existing = this.db().prepare(`SELECT created_at, access_count FROM ${this.t.knowledge} WHERE id = ?`).get(input.id) as Pick<KnowledgeRow, 'created_at' | 'access_count'> | undefined;
    const row: KnowledgeRow = {
      id:             input.id,
      name:           input.name          ?? null,
      description:    input.description   ?? null,
      content:        input.content ? (typeof input.content === 'string' ? input.content : JSON.stringify(input.content)) : null,
      type:           input.type          ?? null,
      size:           input.size          ?? null,
      linked_to:      input.linkedTo      ?? null,
      access_count:   existing?.access_count ?? 0,
      status:         input.status        ?? null,
      status_message: input.statusMessage ?? null,
      external_id:    input.externalId    ?? null,
      metadata:       input.metadata ? JSON.stringify(input.metadata) : null,
      created_at:     existing?.created_at ?? ts,
      updated_at:     ts,
    };
    this.db().prepare(`
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
    `).run(
      row.id, row.name, row.description, row.content, row.type, row.size,
      row.linked_to, row.access_count, row.status, row.status_message,
      row.external_id, row.metadata, row.created_at, row.updated_at,
    );
    return row;
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    await this.init();
    return (this.db().prepare(`SELECT * FROM ${this.t.knowledge} WHERE id = ?`).get(id) as KnowledgeRow) ?? null;
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.linkedTo) { where.push('linked_to = ?'); params.push(query.linkedTo); }
    if (query.status)   { where.push('status = ?');    params.push(query.status); }
    let sql = `SELECT * FROM ${this.t.knowledge}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    const countSql = sql.replace('SELECT *', 'SELECT count(*)');
    const total = (this.db().prepare(countSql).get(...params) as { 'count(*)': number })['count(*)'];
    if (query.limit  !== undefined) { sql += ' LIMIT ?';  params.push(query.limit); }
    if (query.offset !== undefined) { sql += ' OFFSET ?'; params.push(query.offset); }
    return [this.db().prepare(sql).all(...params) as KnowledgeRow[], total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    await this.init();
    return this.db().prepare(`DELETE FROM ${this.t.knowledge} WHERE id = ?`).run(id).changes > 0;
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    try {
      await this.init();
      const ts = now();
      const existing = this.db().prepare(`SELECT created_at FROM ${this.t.traces} WHERE trace_id = ?`).get(trace.trace_id) as { created_at: number } | undefined;
      this.db().prepare(`
        INSERT INTO ${this.t.traces}
          (trace_id, run_id, session_id, user_id, agent_id, team_id, workflow_id,
           name, status, start_time, end_time, duration_ms, metadata, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(trace_id) DO UPDATE SET
          status=excluded.status, end_time=excluded.end_time,
          duration_ms=excluded.duration_ms, updated_at=excluded.updated_at
      `).run(
        trace.trace_id, trace.run_id ?? null, trace.session_id ?? null,
        trace.user_id ?? null, trace.agent_id ?? null, trace.team_id ?? null,
        trace.workflow_id ?? null, trace.name ?? null, trace.status ?? null,
        trace.start_time ?? null, trace.end_time ?? null, trace.duration_ms ?? null,
        trace.metadata ?? null,
        existing?.created_at ?? trace.created_at ?? ts, ts,
      );
    } catch { /* traces must not break agent flow */ }
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    await this.init();
    return (this.db().prepare(`SELECT * FROM ${this.t.traces} WHERE trace_id = ?`).get(traceId) as TraceRow) ?? null;
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    await this.init();
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.sessionId) { where.push('session_id = ?'); params.push(opts.sessionId); }
    if (opts.agentId)   { where.push('agent_id = ?');   params.push(opts.agentId); }
    if (opts.userId)    { where.push('user_id = ?');    params.push(opts.userId); }
    let sql = `SELECT * FROM ${this.t.traces}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const countSql = sql.replace('SELECT *', 'SELECT count(*)');
    const total = (this.db().prepare(countSql).get(...params) as { 'count(*)': number })['count(*)'];
    if (opts.limit  !== undefined) { sql += ' LIMIT ?';  params.push(opts.limit); }
    if (opts.offset !== undefined) { sql += ' OFFSET ?'; params.push(opts.offset); }
    return [this.db().prepare(sql).all(...params) as TraceRow[], total];
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  async createSchedule(row: Omit<ScheduleRow, 'created_at' | 'updated_at'>): Promise<ScheduleRow> {
    await this.init();
    const ts = now();
    const full: ScheduleRow = { ...row, created_at: ts, updated_at: ts };
    this.db().prepare(`
      INSERT INTO ${this.t.schedules}
        (id, name, agent_id, cron, enabled, next_run_at, last_run_at,
         locked_by, locked_at, metadata, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      full.id, full.name, full.agent_id ?? null, full.cron ?? null,
      full.enabled ? 1 : 0, full.next_run_at ?? null, full.last_run_at ?? null,
      full.locked_by ?? null, full.locked_at ?? null,
      full.metadata ?? null, full.created_at, full.updated_at,
    );
    return full;
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    await this.init();
    const row = this.db().prepare(`SELECT * FROM ${this.t.schedules} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { ...row, enabled: Boolean(row['enabled']) } as unknown as ScheduleRow;
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    await this.init();
    let sql = `SELECT * FROM ${this.t.schedules}`;
    const params: unknown[] = [];
    if (opts?.enabled !== undefined) { sql += ' WHERE enabled = ?'; params.push(opts.enabled ? 1 : 0); }
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit !== undefined) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return (this.db().prepare(sql).all(...params) as Record<string, unknown>[])
      .map(r => ({ ...r, enabled: Boolean(r['enabled']) } as unknown as ScheduleRow));
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    await this.init();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now()];
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'created_at' || k === 'id') continue;
      sets.push(`${k} = ?`);
      params.push(k === 'enabled' ? (v ? 1 : 0) : v);
    }
    params.push(id);
    this.db().prepare(`UPDATE ${this.t.schedules} SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getSchedule(id);
  }

  async deleteSchedule(id: string): Promise<boolean> {
    await this.init();
    return this.db().prepare(`DELETE FROM ${this.t.schedules} WHERE id = ?`).run(id).changes > 0;
  }

  override toDict(): Record<string, unknown> {
    return { type: this.type, path: this.opts.path };
  }
}
