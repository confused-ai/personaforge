/**
 * @personaforge/db/in-memory — InMemoryAgentDb.
 *
 * Zero-dependency in-memory backend. Good for tests and quick prototypes.
 * All data is lost when the process exits.
 */

import { AgentDb } from './base.js';
import { DEFAULT_TABLE_NAMES } from './types.js';
import { uuid, now } from './utils.js';
import type {
  SessionRow, MemoryRow, LearningRow, KnowledgeRow, TraceRow, ScheduleRow,
  SessionQuery, MemoryQuery, LearningQuery, KnowledgeQuery,
  UpsertSessionInput, UpsertMemoryInput, UpsertLearningInput, UpsertKnowledgeInput,
  AgentDbTableNames,
} from './types.js';



export class InMemoryAgentDb extends AgentDb {
  readonly type = 'in-memory';


  constructor(_opts?: { tables?: AgentDbTableNames }) {
    super();
  }

  // Each map key = primary key of that table
  private sessions  = new Map<string, SessionRow>();
  private memories  = new Map<string, MemoryRow>();
  private learnings = new Map<string, LearningRow>();
  private knowledge = new Map<string, KnowledgeRow>();
  private traces    = new Map<string, TraceRow>();
  private schedules = new Map<string, ScheduleRow>();

  async init(): Promise<void> { /* no-op */ }
  async close(): Promise<void> { /* no-op */ }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    const ts = now();
    const existing = this.sessions.get(input.sessionId);
    const row: SessionRow = {
      session_id:    input.sessionId,
      session_type:  input.sessionType ?? 'agent',
      agent_id:      input.agentId ?? null,
      team_id:       input.teamId ?? null,
      workflow_id:   input.workflowId ?? null,
      user_id:       input.userId ?? null,
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
    this.sessions.set(row.session_id, row);
    return row;
  }

  async getSession(sessionId: string, userId?: string): Promise<SessionRow | null> {
    const row = this.sessions.get(sessionId) ?? null;
    if (!row) return null;
    if (userId !== undefined && row.user_id !== userId) return null;
    return row;
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    let rows = [...this.sessions.values()];
    if (query.sessionType) rows = rows.filter(r => r.session_type === query.sessionType);
    if (query.agentId)     rows = rows.filter(r => r.agent_id === query.agentId);
    if (query.teamId)      rows = rows.filter(r => r.team_id === query.teamId);
    if (query.workflowId)  rows = rows.filter(r => r.workflow_id === query.workflowId);
    if (query.userId)      rows = rows.filter(r => r.user_id === query.userId);
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const offset = query.offset ?? 0;
    const limit  = query.limit  ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async deleteSession(sessionId: string, userId?: string): Promise<boolean> {
    const row = this.sessions.get(sessionId);
    if (!row) return false;
    if (userId !== undefined && row.user_id !== userId) return false;
    this.sessions.delete(sessionId);
    return true;
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sessionData = row.session_data ? JSON.parse(row.session_data) as Record<string, unknown> : {};
    sessionData['session_name'] = name;
    const updated: SessionRow = { ...row, session_data: JSON.stringify(sessionData), updated_at: now() };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
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
    return row;
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    const row = this.memories.get(memoryId) ?? null;
    if (!row) return null;
    if (userId !== undefined && row.user_id !== userId) return null;
    return row;
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    let rows = [...this.memories.values()];
    if (query.userId)   rows = rows.filter(r => r.user_id  === query.userId);
    if (query.agentId)  rows = rows.filter(r => r.agent_id === query.agentId);
    if (query.teamId)   rows = rows.filter(r => r.team_id  === query.teamId);
    if (query.search)   rows = rows.filter(r => r.memory.toLowerCase().includes(query.search!.toLowerCase()));
    if (query.topics?.length) {
      rows = rows.filter(r => {
        if (!r.topics) return false;
        const rowTopics: string[] = JSON.parse(r.topics) as string[];
        return query.topics!.some(t => rowTopics.includes(t));
      });
    }
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const offset = query.offset ?? 0;
    const limit  = query.limit  ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    const row = this.memories.get(memoryId);
    if (!row) return false;
    if (userId !== undefined && row.user_id !== userId) return false;
    this.memories.delete(memoryId);
    return true;
  }

  async clearMemories(userId?: string): Promise<void> {
    if (userId === undefined) {
      this.memories.clear();
    } else {
      for (const [id, row] of this.memories) {
        if (row.user_id === userId) this.memories.delete(id);
      }
    }
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async upsertLearning(input: UpsertLearningInput): Promise<void> {
    const ts = now();
    const existing = this.learnings.get(input.id);
    const row: LearningRow = {
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
      created_at:    existing?.created_at ?? ts,
      updated_at:    ts,
    };
    this.learnings.set(input.id, row);
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    return this._filterLearnings(query)[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    return this._filterLearnings(query);
  }

  private _filterLearnings(query: LearningQuery): LearningRow[] {
    let rows = [...this.learnings.values()];
    if (query.learningType) rows = rows.filter(r => r.learning_type === query.learningType);
    if (query.userId)       rows = rows.filter(r => r.user_id      === query.userId);
    if (query.agentId)      rows = rows.filter(r => r.agent_id     === query.agentId);
    if (query.teamId)       rows = rows.filter(r => r.team_id      === query.teamId);
    if (query.workflowId)   rows = rows.filter(r => r.workflow_id  === query.workflowId);
    if (query.sessionId)    rows = rows.filter(r => r.session_id   === query.sessionId);
    if (query.namespace)    rows = rows.filter(r => r.namespace    === query.namespace);
    if (query.entityId)     rows = rows.filter(r => r.entity_id    === query.entityId);
    if (query.entityType)   rows = rows.filter(r => r.entity_type  === query.entityType);
    rows.sort((a, b) => b.updated_at - a.updated_at);
    if (query.limit !== undefined) rows = rows.slice(0, query.limit);
    return rows;
  }

  async deleteLearning(id: string): Promise<boolean> {
    return this.learnings.delete(id);
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    const ts = now();
    const existing = this.knowledge.get(input.id);
    const row: KnowledgeRow = {
      id:             input.id,
      name:           input.name           ?? null,
      description:    input.description    ?? null,
      content:        input.content ? (typeof input.content === 'string' ? input.content : JSON.stringify(input.content)) : null,
      type:           input.type           ?? null,
      size:           input.size           ?? null,
      linked_to:      input.linkedTo       ?? null,
      access_count:   existing?.access_count ?? 0,
      status:         input.status         ?? null,
      status_message: input.statusMessage  ?? null,
      external_id:    input.externalId     ?? null,
      metadata:       input.metadata ? JSON.stringify(input.metadata) : null,
      created_at:     existing?.created_at ?? ts,
      updated_at:     ts,
    };
    this.knowledge.set(input.id, row);
    return row;
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    return this.knowledge.get(id) ?? null;
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    let rows = [...this.knowledge.values()];
    if (query.linkedTo) rows = rows.filter(r => r.linked_to === query.linkedTo);
    if (query.status)   rows = rows.filter(r => r.status    === query.status);
    const total  = rows.length;
    const offset = query.offset ?? 0;
    const limit  = query.limit  ?? rows.length;
    return [rows.slice(offset, offset + limit), total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    return this.knowledge.delete(id);
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    const ts = now();
    const existing = this.traces.get(trace.trace_id);
    this.traces.set(trace.trace_id, {
      ...trace,
      created_at: existing?.created_at ?? trace.created_at ?? ts,
      updated_at: ts,
    });
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    return this.traces.get(traceId) ?? null;
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    let rows = [...this.traces.values()];
    if (opts.sessionId) rows = rows.filter(r => r.session_id === opts.sessionId);
    if (opts.agentId)   rows = rows.filter(r => r.agent_id   === opts.agentId);
    if (opts.userId)    rows = rows.filter(r => r.user_id    === opts.userId);
    const total  = rows.length;
    const offset = opts.offset ?? 0;
    const limit  = opts.limit  ?? rows.length;
    return [rows.slice(offset, offset + limit), total];
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  async createSchedule(row: Omit<ScheduleRow, 'created_at' | 'updated_at'>): Promise<ScheduleRow> {
    const ts = now();
    const full: ScheduleRow = { ...row, created_at: ts, updated_at: ts };
    this.schedules.set(row.id, full);
    return full;
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    return this.schedules.get(id) ?? null;
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    let rows = [...this.schedules.values()];
    if (opts?.enabled !== undefined) rows = rows.filter(r => r.enabled === opts.enabled);
    if (opts?.limit !== undefined)   rows = rows.slice(0, opts.limit);
    return rows;
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    const row = this.schedules.get(id);
    if (!row) return null;
    const updated = { ...row, ...updates, updated_at: now() };
    this.schedules.set(id, updated);
    return updated;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    return this.schedules.delete(id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  override toDict(): Record<string, unknown> {
    return {
      type: this.type,
      sessions:  this.sessions.size,
      memories:  this.memories.size,
      learnings: this.learnings.size,
      knowledge: this.knowledge.size,
    };
  }
}

export { DEFAULT_TABLE_NAMES };
