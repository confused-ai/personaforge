/**
 * @personaforge/db/json — JsonFileAgentDb.
 *
 * Zero peer-dependency file-based backend. Stores each table as a separate
 * JSON file in a directory. Great for local development and debugging.
 * Reads all data into memory on first use; flushes to disk after every write.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentDb, validateTableNames } from './base.js';
import { DEFAULT_TABLE_NAMES } from './types.js';
import { uuid, now } from './utils.js';
import type {
  SessionRow, MemoryRow, LearningRow, KnowledgeRow, TraceRow, ScheduleRow,
  SessionQuery, MemoryQuery, LearningQuery, KnowledgeQuery,
  UpsertSessionInput, UpsertMemoryInput, UpsertLearningInput, UpsertKnowledgeInput,
  AgentDbTableNames,
} from './types.js';



export interface JsonFileAgentDbOptions {
  /** Directory to store JSON files. Defaults to `./agent-db`. */
  dir?: string;
  /** Override table (file) names. */
  tables?: AgentDbTableNames;
}

export class JsonFileAgentDb extends AgentDb {
  readonly type = 'json';

  private readonly dir: string;
  private readonly t: Required<AgentDbTableNames>;
  private _ready = false;

  // In-memory tables
  private sessions:  Map<string, SessionRow>  = new Map();
  private memories:  Map<string, MemoryRow>   = new Map();
  private learnings: Map<string, LearningRow> = new Map();
  private knowledge: Map<string, KnowledgeRow>= new Map();
  private traces:    Map<string, TraceRow>    = new Map();
  private schedules: Map<string, ScheduleRow> = new Map();

  constructor(opts: JsonFileAgentDbOptions = {}) {
    super();
    this.dir = opts.dir ?? './agent-db';
    this.t = validateTableNames({ ...DEFAULT_TABLE_NAMES, ...(opts.tables ?? {}) });
  }

  async init(): Promise<void> {
    if (this._ready) return;
    fs.mkdirSync(this.dir, { recursive: true });
    this.sessions  = this._load<SessionRow>(this.t.sessions);
    this.memories  = this._load<MemoryRow>(this.t.memories);
    this.learnings = this._load<LearningRow>(this.t.learnings);
    this.knowledge = this._load<KnowledgeRow>(this.t.knowledge);
    this.traces    = this._load<TraceRow>(this.t.traces);
    this.schedules = this._load<ScheduleRow>(this.t.schedules);
    this._ready = true;
  }

  async close(): Promise<void> {
    this._flush(); // ensure any pending writes are persisted
    this._ready = false;
  }

  private _filePath(table: string): string {
    return path.join(this.dir, `${table}.json`);
  }

  private _load<T>(table: string): Map<string, T> {
    const fp = this._filePath(table);
    if (!fs.existsSync(fp)) return new Map();
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, T>;
      return new Map(Object.entries(data));
    } catch {
      return new Map();
    }
  }

  private _save<T>(table: string, map: Map<string, T>): void {
    const fp = this._filePath(table);
    fs.writeFileSync(fp, JSON.stringify(Object.fromEntries(map), null, 2), 'utf-8');
  }

  private _flush(): void {
    this._save(this.t.sessions,  this.sessions);
    this._save(this.t.memories,  this.memories);
    this._save(this.t.learnings, this.learnings);
    this._save(this.t.knowledge, this.knowledge);
    this._save(this.t.traces,    this.traces);
    this._save(this.t.schedules, this.schedules);
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    await this.init();
    const ts = now();
    const existing = this.sessions.get(input.sessionId);
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
    this.sessions.set(input.sessionId, row);
    this._save(this.t.sessions, this.sessions);
    return row;
  }

  async getSession(sessionId: string, userId?: string): Promise<SessionRow | null> {
    await this.init();
    const row = this.sessions.get(sessionId);
    if (!row) return null;
    if (userId !== undefined && row.user_id !== userId) return null;
    return row;
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    await this.init();
    let rows = [...this.sessions.values()];
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
    await this.init();
    const row = this.sessions.get(sessionId);
    if (!row) return false;
    if (userId !== undefined && row.user_id !== userId) return false;
    this.sessions.delete(sessionId);
    this._save(this.t.sessions, this.sessions);
    return true;
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sd = row.session_data ? JSON.parse(row.session_data) as Record<string, unknown> : {};
    sd['session_name'] = name;
    const updated = { ...row, session_data: JSON.stringify(sd), updated_at: now() };
    this.sessions.set(sessionId, updated);
    this._save(this.t.sessions, this.sessions);
    return updated;
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
    await this.init();
    const ts = now();
    const memoryId = input.memoryId ?? uuid();
    const existing = this.memories.get(memoryId);
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
    this.memories.set(memoryId, row);
    this._save(this.t.memories, this.memories);
    return row;
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    await this.init();
    const row = this.memories.get(memoryId);
    if (!row) return null;
    if (userId !== undefined && row.user_id !== userId) return null;
    return row;
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    await this.init();
    let rows = [...this.memories.values()];
    if (query.userId)  rows = rows.filter(r => r.user_id  === query.userId);
    if (query.agentId) rows = rows.filter(r => r.agent_id === query.agentId);
    if (query.teamId)  rows = rows.filter(r => r.team_id  === query.teamId);
    if (query.search)  rows = rows.filter(r => r.memory.toLowerCase().includes(query.search!.toLowerCase()));
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const offset = query.offset ?? 0;
    return rows.slice(offset, offset + (query.limit ?? rows.length));
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    await this.init();
    const row = this.memories.get(memoryId);
    if (!row) return false;
    if (userId !== undefined && row.user_id !== userId) return false;
    this.memories.delete(memoryId);
    this._save(this.t.memories, this.memories);
    return true;
  }

  async clearMemories(userId?: string): Promise<void> {
    await this.init();
    if (userId === undefined) {
      this.memories.clear();
    } else {
      for (const [id, r] of this.memories) if (r.user_id === userId) this.memories.delete(id);
    }
    this._save(this.t.memories, this.memories);
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async upsertLearning(input: UpsertLearningInput): Promise<void> {
    await this.init();
    const ts = now();
    const existing = this.learnings.get(input.id);
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
    this.learnings.set(input.id, row);
    this._save(this.t.learnings, this.learnings);
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    const rows = await this.getLearnings({ ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    await this.init();
    let rows = [...this.learnings.values()];
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
    await this.init();
    const existed = this.learnings.has(id);
    if (existed) { this.learnings.delete(id); this._save(this.t.learnings, this.learnings); }
    return existed;
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    await this.init();
    const ts = now();
    const existing = this.knowledge.get(input.id);
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
    this.knowledge.set(input.id, row);
    this._save(this.t.knowledge, this.knowledge);
    return row;
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    await this.init();
    return this.knowledge.get(id) ?? null;
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    await this.init();
    let rows = [...this.knowledge.values()];
    if (query.linkedTo) rows = rows.filter(r => r.linked_to === query.linkedTo);
    if (query.status)   rows = rows.filter(r => r.status    === query.status);
    const total  = rows.length;
    const offset = query.offset ?? 0;
    return [rows.slice(offset, offset + (query.limit ?? rows.length)), total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    await this.init();
    const existed = this.knowledge.has(id);
    if (existed) { this.knowledge.delete(id); this._save(this.t.knowledge, this.knowledge); }
    return existed;
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    try {
      await this.init();
      const ts = now();
      const existing = this.traces.get(trace.trace_id);
      this.traces.set(trace.trace_id, {
        ...trace,
        created_at: existing?.created_at ?? trace.created_at ?? ts,
        updated_at: ts,
      } as TraceRow);
      this._save(this.t.traces, this.traces);
    } catch { /* traces must not break agent flow */ }
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    await this.init();
    return this.traces.get(traceId) ?? null;
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    await this.init();
    let rows = [...this.traces.values()];
    if (opts.sessionId) rows = rows.filter(r => r.session_id === opts.sessionId);
    if (opts.agentId)   rows = rows.filter(r => r.agent_id   === opts.agentId);
    if (opts.userId)    rows = rows.filter(r => r.user_id    === opts.userId);
    rows.sort((a, b) => b.created_at - a.created_at);
    const total  = rows.length;
    const offset = opts.offset ?? 0;
    return [rows.slice(offset, offset + (opts.limit ?? rows.length)), total];
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  async createSchedule(row: Omit<ScheduleRow, 'created_at' | 'updated_at'>): Promise<ScheduleRow> {
    await this.init();
    const ts = now();
    const full: ScheduleRow = { ...row, created_at: ts, updated_at: ts };
    this.schedules.set(row.id, full);
    this._save(this.t.schedules, this.schedules);
    return full;
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    await this.init();
    return this.schedules.get(id) ?? null;
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    await this.init();
    let rows = [...this.schedules.values()];
    if (opts?.enabled !== undefined) rows = rows.filter(r => r.enabled === opts.enabled);
    if (opts?.limit !== undefined)   rows = rows.slice(0, opts.limit);
    return rows;
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    await this.init();
    const row = this.schedules.get(id);
    if (!row) return null;
    const updated = { ...row, ...updates, updated_at: now() };
    this.schedules.set(id, updated);
    this._save(this.t.schedules, this.schedules);
    return updated;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    await this.init();
    const existed = this.schedules.has(id);
    if (existed) { this.schedules.delete(id); this._save(this.t.schedules, this.schedules); }
    return existed;
  }

  override toDict(): Record<string, unknown> {
    return { type: this.type, dir: this.dir };
  }
}
