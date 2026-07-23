/**
 * @personaforge/db/redis — RedisAgentDb.
 *
 * Uses ioredis. Data is stored as Redis hashes keyed by record id.
 * Sets and sorted sets track membership for list/query operations.
 * Peer dep: `ioredis` (optional — install only if you want Redis).
 *
 * Note: Redis does not support full SQL-style filtering. Queries scan a
 * sorted set by primary key and filter in memory. For large datasets,
 * prefer SqliteAgentDb or PostgresAgentDb.
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
  '[personaforge/db] RedisAgentDb requires ioredis.\n' +
  '  Install: npm install ioredis';

type RedisClient = {
  hset(key: string, ...fieldValues: (string | number)[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  del(...keys: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  quit(): Promise<string>;
};
type RedisCtor = new (url?: string) => RedisClient;



export interface RedisAgentDbOptions {
  /** Redis connection URL, e.g. `redis://localhost:6379`. */
  url?: string;
  /** Key prefix. Defaults to `adb`. */
  prefix?: string;
  /** Override collection (key-prefix) names. */
  tables?: AgentDbTableNames;
}

export class RedisAgentDb extends AgentDb {
  readonly type = 'redis';

  private readonly opts: Required<RedisAgentDbOptions>;
  private readonly t: Required<AgentDbTableNames>;
  private _client: RedisClient | null = null;
  private _ready = false;

  constructor(opts: RedisAgentDbOptions = {}) {
    super();
    this.opts = { url: opts.url ?? 'redis://localhost:6379', prefix: opts.prefix ?? 'adb', tables: opts.tables ?? {} };
    this.t = validateTableNames({ ...DEFAULT_TABLE_NAMES, ...(opts.tables ?? {}) });
  }

  private client(): RedisClient {
    if (this._client) return this._client;
    let Ctor: RedisCtor;
    try { Ctor = require('ioredis') as RedisCtor; }
    catch { throw new Error(MISSING); }
    this._client = new Ctor(this.opts.url);
    return this._client;
  }

  async init(): Promise<void> {
    if (this._ready) return;
    this.client(); // triggers connection
    this._ready = true;
  }

  async close(): Promise<void> {
    await this._client?.quit();
    this._client = null; this._ready = false;
  }

  // ── Key helpers ────────────────────────────────────────────────────────────

  private key(table: string, id: string): string {
    return `${this.opts.prefix}:${table}:${id}`;
  }
  private setKey(table: string): string {
    return `${this.opts.prefix}:${table}:__ids`;
  }

  private async _set<T extends object>(table: string, id: string, data: T): Promise<T> {
    await this.init();
    const flat: (string | number)[] = [];
    for (const [k, v] of Object.entries(data)) {
      flat.push(k, v == null ? '' : String(v));
    }
    await this.client().hset(this.key(table, id), ...flat);
    await this.client().sadd(this.setKey(table), id);
    return data;
  }

  private async _get(table: string, id: string): Promise<Record<string, string> | null> {
    await this.init();
    const h = await this.client().hgetall(this.key(table, id));
    if (!h || Object.keys(h).length === 0) return null;
    return h;
  }

  private async _del(table: string, id: string): Promise<boolean> {
    await this.init();
    const n = await this.client().del(this.key(table, id));
    await this.client().srem(this.setKey(table), id);
    return n > 0;
  }

  private async _allIds(table: string): Promise<string[]> {
    return this.client().smembers(this.setKey(table));
  }

  private async _all<T>(table: string): Promise<T[]> {
    const ids = await this._allIds(table);
    const results = await Promise.all(ids.map(id => this._get(table, id)));
    return results.filter(Boolean) as T[];
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    const ts = now();
    const existing = await this._get(this.t.sessions, input.sessionId) as { created_at?: string } | null;
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
      created_at:    existing?.created_at ? Number(existing.created_at) : ts,
      updated_at:    ts,
    };
    return this._set(this.t.sessions, input.sessionId, row);
  }

  async getSession(sessionId: string, userId?: string): Promise<SessionRow | null> {
    const h = await this._get(this.t.sessions, sessionId);
    if (!h) return null;
    const row = this._parse<SessionRow>(h);
    if (userId !== undefined && row.user_id !== userId) return null;
    return row;
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    let rows = await this._all<SessionRow>(this.t.sessions);
    rows = rows.map(r => this._parse<SessionRow>(r as unknown as Record<string, string>));
    if (query.sessionType) rows = rows.filter(r => r.session_type === query.sessionType);
    if (query.agentId)     rows = rows.filter(r => r.agent_id     === query.agentId);
    if (query.teamId)      rows = rows.filter(r => r.team_id      === query.teamId);
    if (query.workflowId)  rows = rows.filter(r => r.workflow_id  === query.workflowId);
    if (query.userId)      rows = rows.filter(r => r.user_id      === query.userId);
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const offset = query.offset ?? 0;
    return rows.slice(offset, offset + (query.limit ?? rows.length));
  }

  async deleteSession(sessionId: string, userId?: string): Promise<boolean> {
    if (userId !== undefined) {
      const row = await this.getSession(sessionId, userId);
      if (!row) return false;
    }
    return this._del(this.t.sessions, sessionId);
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sd = row.session_data ? JSON.parse(row.session_data) as Record<string, unknown> : {};
    sd['session_name'] = name;
    const updated = { ...row, session_data: JSON.stringify(sd), updated_at: now() };
    return this._set(this.t.sessions, sessionId, updated);
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
    const ts = now();
    const memoryId = input.memoryId ?? uuid();
    const existing = await this._get(this.t.memories, memoryId) as { created_at?: string } | null;
    const row: MemoryRow = {
      memory_id:  memoryId,
      user_id:    input.userId   ?? null,
      agent_id:   input.agentId  ?? null,
      team_id:    input.teamId   ?? null,
      memory:     input.memory,
      topics:     input.topics   ? JSON.stringify(input.topics) : null,
      input:      input.input    ?? null,
      feedback:   input.feedback ?? null,
      created_at: existing?.created_at ? Number(existing.created_at) : ts,
      updated_at: ts,
    };
    return this._set(this.t.memories, memoryId, row);
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    const h = await this._get(this.t.memories, memoryId);
    if (!h) return null;
    const row = this._parse<MemoryRow>(h);
    if (userId !== undefined && row.user_id !== userId) return null;
    return row;
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    let rows = (await this._all<Record<string, string>>(this.t.memories)).map(h => this._parse<MemoryRow>(h));
    if (query.userId)  rows = rows.filter(r => r.user_id  === query.userId);
    if (query.agentId) rows = rows.filter(r => r.agent_id === query.agentId);
    if (query.teamId)  rows = rows.filter(r => r.team_id  === query.teamId);
    if (query.search)  rows = rows.filter(r => r.memory.toLowerCase().includes(query.search!.toLowerCase()));
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const offset = query.offset ?? 0;
    return rows.slice(offset, offset + (query.limit ?? rows.length));
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    if (userId !== undefined) {
      const row = await this.getMemory(memoryId, userId);
      if (!row) return false;
    }
    return this._del(this.t.memories, memoryId);
  }

  async clearMemories(userId?: string): Promise<void> {
    if (userId === undefined) {
      const ids = await this._allIds(this.t.memories);
      await Promise.all(ids.map(id => this._del(this.t.memories, id)));
    } else {
      const rows = await this.getMemories({ userId });
      await Promise.all(rows.map(r => this._del(this.t.memories, r.memory_id)));
    }
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async upsertLearning(input: UpsertLearningInput): Promise<void> {
    const ts = now();
    const existing = await this._get(this.t.learnings, input.id) as { created_at?: string } | null;
    await this._set(this.t.learnings, input.id, {
      learning_id:   input.id,
      learning_type: input.learningType,
      namespace:     input.namespace   ?? null,
      user_id:       input.userId      ?? null,
      agent_id:      input.agentId     ?? null,
      team_id:       input.teamId      ?? null,
      workflow_id:   input.workflowId  ?? null,
      session_id:    input.sessionId   ?? null,
      entity_id:     input.entityId    ?? null,
      entity_type:   input.entityType  ?? null,
      content:       JSON.stringify(input.content),
      metadata:      input.metadata ? JSON.stringify(input.metadata) : null,
      created_at:    existing?.created_at ? Number(existing.created_at) : ts,
      updated_at:    ts,
    } satisfies LearningRow);
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    const rows = await this.getLearnings({ ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    let rows = (await this._all<Record<string, string>>(this.t.learnings)).map(h => this._parse<LearningRow>(h));
    if (query.learningType) rows = rows.filter(r => r.learning_type === query.learningType);
    if (query.userId)       rows = rows.filter(r => r.user_id       === query.userId);
    if (query.agentId)      rows = rows.filter(r => r.agent_id      === query.agentId);
    if (query.teamId)       rows = rows.filter(r => r.team_id       === query.teamId);
    if (query.workflowId)   rows = rows.filter(r => r.workflow_id   === query.workflowId);
    if (query.sessionId)    rows = rows.filter(r => r.session_id    === query.sessionId);
    if (query.namespace)    rows = rows.filter(r => r.namespace      === query.namespace);
    if (query.entityId)     rows = rows.filter(r => r.entity_id     === query.entityId);
    if (query.entityType)   rows = rows.filter(r => r.entity_type   === query.entityType);
    rows.sort((a, b) => b.updated_at - a.updated_at);
    if (query.limit !== undefined) rows = rows.slice(0, query.limit);
    return rows;
  }

  async deleteLearning(id: string): Promise<boolean> {
    return this._del(this.t.learnings, id);
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    const ts = now();
    const existing = await this._get(this.t.knowledge, input.id) as { created_at?: string; access_count?: string } | null;
    const row: KnowledgeRow = {
      id: input.id, name: input.name ?? null, description: input.description ?? null,
      content: input.content ? (typeof input.content === 'string' ? input.content : JSON.stringify(input.content)) : null,
      type: input.type ?? null, size: input.size ?? null, linked_to: input.linkedTo ?? null,
      access_count: existing?.access_count ? Number(existing.access_count) : 0,
      status: input.status ?? null, status_message: input.statusMessage ?? null,
      external_id: input.externalId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: existing?.created_at ? Number(existing.created_at) : ts, updated_at: ts,
    };
    return this._set(this.t.knowledge, input.id, row);
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    const h = await this._get(this.t.knowledge, id);
    return h ? this._parse<KnowledgeRow>(h) : null;
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    let rows = (await this._all<Record<string, string>>(this.t.knowledge)).map(h => this._parse<KnowledgeRow>(h));
    if (query.linkedTo) rows = rows.filter(r => r.linked_to === query.linkedTo);
    if (query.status)   rows = rows.filter(r => r.status    === query.status);
    const total  = rows.length;
    const offset = query.offset ?? 0;
    return [rows.slice(offset, offset + (query.limit ?? rows.length)), total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    return this._del(this.t.knowledge, id);
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    try {
      const ts = now();
      const existing = await this._get(this.t.traces, trace.trace_id) as { created_at?: string } | null;
      await this._set(this.t.traces, trace.trace_id, {
        ...trace,
        created_at: existing?.created_at ? Number(existing.created_at) : (trace.created_at ?? ts),
        updated_at: ts,
      });
    } catch { /* traces must not break agent flow */ }
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    const h = await this._get(this.t.traces, traceId);
    return h ? this._parse<TraceRow>(h) : null;
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    let rows = (await this._all<Record<string, string>>(this.t.traces)).map(h => this._parse<TraceRow>(h));
    if (opts.sessionId) rows = rows.filter(r => r.session_id === opts.sessionId);
    if (opts.agentId)   rows = rows.filter(r => r.agent_id   === opts.agentId);
    if (opts.userId)    rows = rows.filter(r => r.user_id    === opts.userId);
    const total  = rows.length;
    const offset = opts.offset ?? 0;
    return [rows.slice(offset, offset + (opts.limit ?? rows.length)), total];
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  async createSchedule(row: Omit<ScheduleRow, 'created_at' | 'updated_at'>): Promise<ScheduleRow> {
    const ts = now();
    const full: ScheduleRow = { ...row, created_at: ts, updated_at: ts };
    return this._set(this.t.schedules, row.id, full);
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    const h = await this._get(this.t.schedules, id);
    if (!h) return null;
    const row = this._parse<ScheduleRow>(h);
    return { ...row, enabled: String(row.enabled) === 'true' || row.enabled === true };
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    let rows = (await this._all<Record<string, string>>(this.t.schedules))
      .map(h => { const r = this._parse<ScheduleRow>(h); return { ...r, enabled: String(r.enabled) === 'true' || r.enabled === true }; });
    if (opts?.enabled !== undefined) rows = rows.filter(r => r.enabled === opts.enabled);
    if (opts?.limit !== undefined)   rows = rows.slice(0, opts.limit);
    return rows;
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    const row = await this.getSchedule(id);
    if (!row) return null;
    return this._set(this.t.schedules, id, { ...row, ...updates, updated_at: now() });
  }

  async deleteSchedule(id: string): Promise<boolean> {
    return this._del(this.t.schedules, id);
  }

  // ── Parse helper — Redis stores everything as string ──────────────────────

  private _parse<T extends object>(h: Record<string, string>): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(h)) {
      if (v === '') { out[k] = null; continue; }
      // coerce numeric-looking fields
      if (['created_at','updated_at','size','access_count','duration_ms','next_run_at','last_run_at','locked_at'].includes(k)) {
        out[k] = v === '' || v == null ? null : Number(v);
      } else {
        out[k] = v;
      }
    }
    return out as T;
  }

  override toDict(): Record<string, unknown> {
    return { type: this.type, url: this.opts.url, prefix: this.opts.prefix };
  }
}
