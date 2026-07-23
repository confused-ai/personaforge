/**
 * @personaforge/db/mongo — MongoAgentDb.
 *
 * Uses the official `mongodb` driver. Each table maps to a MongoDB collection.
 * Peer dep: `mongodb` (optional — install only if you want MongoDB).
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
  '[personaforge/db] MongoAgentDb requires mongodb.\n' +
  '  Install: npm install mongodb';


type MongoCollection = { findOne(f: object, o?: object): Promise<any>; find(f: object, o?: object): { sort(s: object): { limit(n: number): { skip(n: number): { toArray(): Promise<any[]> }; toArray(): Promise<any[]> }; toArray(): Promise<any[]> } }; updateOne(f: object, u: object, o: object): Promise<any>; deleteOne(f: object): Promise<{ deletedCount: number }>; deleteMany(f: object): Promise<any>; insertOne(d: object): Promise<any>; countDocuments(f: object): Promise<number>; createIndex(spec: object, opts?: object): Promise<string> };
type MongoDb = { collection(name: string): MongoCollection };
type MongoClient = { db(name?: string): MongoDb; connect(): Promise<void>; close(): Promise<void> };
type MongoCtor = new (url: string) => MongoClient;



export interface MongoAgentDbOptions {
  /** MongoDB connection URL, e.g. `mongodb://localhost:27017`. */
  url?: string;
  /** Database name. Defaults to `agent_db`. */
  database?: string;
  /** Override individual collection names. */
  tables?: AgentDbTableNames;
}

export class MongoAgentDb extends AgentDb {
  readonly type = 'mongo';

  private readonly opts: Required<MongoAgentDbOptions>;
  private readonly t: Required<AgentDbTableNames>;
  private _client: MongoClient | null = null;
  private _db: MongoDb | null = null;
  private _ready = false;
  private _initPromise: Promise<void> | null = null;

  constructor(opts: MongoAgentDbOptions = {}) {
    super();
    this.opts = { url: opts.url ?? 'mongodb://localhost:27017', database: opts.database ?? 'agent_db', tables: opts.tables ?? {} };
    this.t = validateTableNames({ ...DEFAULT_TABLE_NAMES, ...(opts.tables ?? {}) });
  }

  private getClient(): MongoClient {
    if (this._client) return this._client;
    let Ctor: MongoCtor;
    try { Ctor = (require('mongodb') as { MongoClient: MongoCtor }).MongoClient; }
    catch { throw new Error(MISSING); }
    this._client = new Ctor(this.opts.url);
    return this._client;
  }

  async init(): Promise<void> {
    if (this._ready) return;
    if (!this._initPromise) this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    const client = this.getClient();
    await client.connect();
    this._db = client.db(this.opts.database);
    // Create indexes for efficient queries
    const db = this._db;
    await Promise.all([
      db.collection(this.t.sessions).createIndex({ session_id: 1 }, { unique: true }).catch(() => null),
      db.collection(this.t.sessions).createIndex({ user_id: 1 }).catch(() => null),
      db.collection(this.t.sessions).createIndex({ agent_id: 1 }).catch(() => null),
      db.collection(this.t.memories).createIndex({ memory_id: 1 }, { unique: true }).catch(() => null),
      db.collection(this.t.memories).createIndex({ user_id: 1 }).catch(() => null),
      db.collection(this.t.learnings).createIndex({ learning_id: 1 }, { unique: true }).catch(() => null),
      db.collection(this.t.learnings).createIndex({ learning_type: 1 }).catch(() => null),
      db.collection(this.t.learnings).createIndex({ user_id: 1 }).catch(() => null),
      db.collection(this.t.knowledge).createIndex({ id: 1 }, { unique: true }).catch(() => null),
      db.collection(this.t.traces).createIndex({ trace_id: 1 }, { unique: true }).catch(() => null),
      db.collection(this.t.traces).createIndex({ session_id: 1 }).catch(() => null),
      db.collection(this.t.schedules).createIndex({ id: 1 }, { unique: true }).catch(() => null),
    ]);
    this._ready = true;
  }

  async close(): Promise<void> {
    await this._client?.close();
    this._client = null; this._db = null; this._ready = false; this._initPromise = null;
  }

  private col(name: string): MongoCollection {
    if (!this._db) throw new Error('[personaforge/db] MongoAgentDb not initialised — call init() first');
    return this._db.collection(name);
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    await this.init();
    const ts = now();
    const existing = await this.col(this.t.sessions).findOne({ session_id: input.sessionId }, { projection: { _id: 0 } }) as SessionRow | null;
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
    await this.col(this.t.sessions).updateOne(
      { session_id: input.sessionId },
      { $set: row },
      { upsert: true },
    );
    return row;
  }

  async getSession(sessionId: string, userId?: string): Promise<SessionRow | null> {
    await this.init();
    const filter: Record<string, unknown> = { session_id: sessionId };
    if (userId !== undefined) filter['user_id'] = userId;
    const doc = await this.col(this.t.sessions).findOne(filter, { projection: { _id: 0 } }) as SessionRow | null;
    if (!doc) return null;
    const row = doc;
    return row;
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    await this.init();
    const filter: Record<string, unknown> = {};
    if (query.sessionType) filter['session_type'] = query.sessionType;
    if (query.agentId)     filter['agent_id']     = query.agentId;
    if (query.teamId)      filter['team_id']      = query.teamId;
    if (query.workflowId)  filter['workflow_id']  = query.workflowId;
    if (query.userId)      filter['user_id']      = query.userId;
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const docs = await this.col(this.t.sessions).find(filter, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(limit).skip(offset).toArray() as (SessionRow)[];
    return docs;
  }

  async deleteSession(sessionId: string, userId?: string): Promise<boolean> {
    await this.init();
    const filter: Record<string, unknown> = { session_id: sessionId };
    if (userId !== undefined) filter['user_id'] = userId;
    const { deletedCount } = await this.col(this.t.sessions).deleteOne(filter);
    return deletedCount > 0;
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sd = row.session_data ? JSON.parse(row.session_data) as Record<string, unknown> : {};
    sd['session_name'] = name;
    const updated = { ...row, session_data: JSON.stringify(sd), updated_at: now() };
    await this.col(this.t.sessions).updateOne({ session_id: sessionId }, { $set: { session_data: updated.session_data, updated_at: updated.updated_at } }, {});
    return updated;
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
    await this.init();
    const ts = now();
    const memoryId = input.memoryId ?? uuid();
    const existing = await this.col(this.t.memories).findOne({ memory_id: memoryId }, { projection: { _id: 0 } }) as MemoryRow | null;
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
    await this.col(this.t.memories).updateOne({ memory_id: memoryId }, { $set: row }, { upsert: true });
    return row;
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    await this.init();
    const filter: Record<string, unknown> = { memory_id: memoryId };
    if (userId !== undefined) filter['user_id'] = userId;
    const doc = await this.col(this.t.memories).findOne(filter, { projection: { _id: 0 } }) as MemoryRow | null;
    if (!doc) return null;
    const row = doc as typeof doc;
    return row;
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    await this.init();
    const filter: Record<string, unknown> = {};
    if (query.userId)  filter['user_id']  = query.userId;
    if (query.agentId) filter['agent_id'] = query.agentId;
    if (query.teamId)  filter['team_id']  = query.teamId;
    if (query.search)  filter['memory']   = { $regex: query.search, $options: 'i' };
    const limit = query.limit ?? 100;
    const docs = await this.col(this.t.memories).find(filter, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(limit).toArray() as (MemoryRow)[];
    return docs;
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    await this.init();
    const filter: Record<string, unknown> = { memory_id: memoryId };
    if (userId !== undefined) filter['user_id'] = userId;
    const { deletedCount } = await this.col(this.t.memories).deleteOne(filter);
    return deletedCount > 0;
  }

  async clearMemories(userId?: string): Promise<void> {
    await this.init();
    const filter: Record<string, unknown> = userId !== undefined ? { user_id: userId } : {};
    await this.col(this.t.memories).deleteMany(filter);
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async upsertLearning(input: UpsertLearningInput): Promise<void> {
    await this.init();
    const ts = now();
    const existing = await this.col(this.t.learnings).findOne({ learning_id: input.id }, { projection: { _id: 0 } }) as LearningRow | null;
    const row: LearningRow = {
      learning_id: input.id, learning_type: input.learningType,
      namespace: input.namespace ?? null, user_id: input.userId ?? null,
      agent_id: input.agentId ?? null, team_id: input.teamId ?? null,
      workflow_id: input.workflowId ?? null, session_id: input.sessionId ?? null,
      entity_id: input.entityId ?? null, entity_type: input.entityType ?? null,
      content: JSON.stringify(input.content),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: existing?.created_at ?? ts, updated_at: ts,
    };
    await this.col(this.t.learnings).updateOne({ learning_id: input.id }, { $set: row }, { upsert: true });
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    const rows = await this.getLearnings({ ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    await this.init();
    const filter: Record<string, unknown> = {};
    if (query.learningType) filter['learning_type'] = query.learningType;
    if (query.userId)       filter['user_id']       = query.userId;
    if (query.agentId)      filter['agent_id']      = query.agentId;
    if (query.teamId)       filter['team_id']       = query.teamId;
    if (query.workflowId)   filter['workflow_id']   = query.workflowId;
    if (query.sessionId)    filter['session_id']    = query.sessionId;
    if (query.namespace)    filter['namespace']     = query.namespace;
    if (query.entityId)     filter['entity_id']     = query.entityId;
    if (query.entityType)   filter['entity_type']   = query.entityType;
    const limit = query.limit ?? 500;
    const docs = await this.col(this.t.learnings).find(filter, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(limit).toArray() as (LearningRow)[];
    return docs;
  }

  async deleteLearning(id: string): Promise<boolean> {
    await this.init();
    const { deletedCount } = await this.col(this.t.learnings).deleteOne({ learning_id: id });
    return deletedCount > 0;
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    await this.init();
    const ts = now();
    const existing = await this.col(this.t.knowledge).findOne({ id: input.id }, { projection: { _id: 0 } }) as KnowledgeRow | null;
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
    await this.col(this.t.knowledge).updateOne({ id: input.id }, { $set: row }, { upsert: true });
    return row;
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    await this.init();
    const doc = await this.col(this.t.knowledge).findOne({ id }, { projection: { _id: 0 } }) as KnowledgeRow | null;
    if (!doc) return null;
    const row = doc as typeof doc;
    return row;
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    await this.init();
    const filter: Record<string, unknown> = {};
    if (query.linkedTo) filter['linked_to'] = query.linkedTo;
    if (query.status)   filter['status']    = query.status;
    const total = await this.col(this.t.knowledge).countDocuments(filter);
    const limit = query.limit ?? 100;
    const docs = await this.col(this.t.knowledge).find(filter, { projection: { _id: 0 } }).sort({ updated_at: -1 }).limit(limit).toArray() as (KnowledgeRow)[];
    return [docs, total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    await this.init();
    const { deletedCount } = await this.col(this.t.knowledge).deleteOne({ id });
    return deletedCount > 0;
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    try {
      await this.init();
      const ts = now();
      const existing = await this.col(this.t.traces).findOne({ trace_id: trace.trace_id }, { projection: { _id: 0 } }) as TraceRow | null;
      await this.col(this.t.traces).updateOne(
        { trace_id: trace.trace_id },
        { $set: { ...trace, created_at: existing?.created_at ?? trace.created_at ?? ts, updated_at: ts } },
        { upsert: true },
      );
    } catch { /* traces must not break agent flow */ }
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    await this.init();
    const doc = await this.col(this.t.traces).findOne({ trace_id: traceId }, { projection: { _id: 0 } }) as TraceRow | null;
    if (!doc) return null;
    const row = doc as typeof doc;
    return row;
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    await this.init();
    const filter: Record<string, unknown> = {};
    if (opts.sessionId) filter['session_id'] = opts.sessionId;
    if (opts.agentId)   filter['agent_id']   = opts.agentId;
    if (opts.userId)    filter['user_id']     = opts.userId;
    const total = await this.col(this.t.traces).countDocuments(filter);
    const limit = opts.limit ?? 20;
    const docs = await this.col(this.t.traces).find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(limit).toArray() as (TraceRow)[];
    return [docs, total];
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  async createSchedule(row: Omit<ScheduleRow, 'created_at' | 'updated_at'>): Promise<ScheduleRow> {
    await this.init();
    const ts = now();
    const full: ScheduleRow = { ...row, created_at: ts, updated_at: ts };
    await this.col(this.t.schedules).insertOne(full);
    return full;
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    await this.init();
    const doc = await this.col(this.t.schedules).findOne({ id }, { projection: { _id: 0 } }) as ScheduleRow | null;
    if (!doc) return null;
    const row = doc as typeof doc;
    return row;
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    await this.init();
    const filter: Record<string, unknown> = {};
    if (opts?.enabled !== undefined) filter['enabled'] = opts.enabled;
    const limit = opts?.limit ?? 100;
    const docs = await this.col(this.t.schedules).find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(limit).toArray() as (ScheduleRow)[];
    return docs;
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    await this.init();
    await this.col(this.t.schedules).updateOne({ id }, { $set: { ...updates, updated_at: now() } }, {});
    return this.getSchedule(id);
  }

  async deleteSchedule(id: string): Promise<boolean> {
    await this.init();
    const { deletedCount } = await this.col(this.t.schedules).deleteOne({ id });
    return deletedCount > 0;
  }

  override toDict(): Record<string, unknown> {
    return { type: this.type, url: this.opts.url, database: this.opts.database };
  }
}
