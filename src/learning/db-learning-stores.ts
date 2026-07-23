/**
 * @personaforge/learning — DbLearningStores.
 *
 * All five learning store interfaces implemented on top of AgentDb's unified
 * `agent_learnings` table. One backend — any AgentDb variant — covers every
 * learning domain.
 *
 * Mapping:
 *   UserMemoryStore         → learning_type = 'user_memory'
 *   SessionContextStore     → learning_type = 'session_context'
 *   LearnedKnowledgeStore   → learning_type = 'learned_knowledge'
 *   EntityMemoryStore       → learning_type = 'entity_memory'
 *   DecisionLogStore        → learning_type = 'decision_log'
 *
 * Usage:
 * ```ts
 * import { SqliteAgentDb } from '../db/index.js';
 * import { DbUserMemoryStore, DbSessionContextStore, ... } from './index.js';
 *
 * const db = new SqliteAgentDb({ path: './agent.db' });
 * const machine = new LearningMachine({
 *   userMemory:     new DbUserMemoryStore(db),
 *   sessionContext: new DbSessionContextStore(db),
 *   learnedKnowledge: new DbLearnedKnowledgeStore(db),
 *   entityMemory:   new DbEntityMemoryStore(db),
 *   decisionLog:    new DbDecisionLogStore(db),
 * });
 * ```
 */

import type { AgentDb } from '../db/index.js';
import type {
  UserMemory, UserMemoryEntry,
  SessionContext,
  LearnedKnowledge,
  EntityMemory, EntityFact, EntityEvent, EntityRelationship,
  DecisionLog,
  UserMemoryStore,
  SessionContextStore,
  LearnedKnowledgeStore,
  EntityMemoryStore,
  DecisionLogStore,
} from './types.js';

function genId(): string {
  return crypto.randomUUID();
}
function nowIso(): string { return new Date().toISOString(); }

// ── helpers ────────────────────────────────────────────────────────────────────

/** Upsert a single learning record keyed by a deterministic ID. */
async function upsertLearning(
  db: AgentDb,
  learningType: string,
  id: string,
  content: Record<string, unknown>,
  opts: { userId?: string; agentId?: string; sessionId?: string; namespace?: string; entityId?: string; entityType?: string },
): Promise<void> {
  await db.upsertLearning({ id, learningType, content, ...opts });
}

/** Find all learnings matching a query and parse their content. */
async function findLearnings<T>(
  db: AgentDb,
  query: Parameters<AgentDb['getLearnings']>[0],
): Promise<{ id: string; content: T; updatedAt: number }[]> {
  const rows = await db.getLearnings(query);
  return rows.map(r => ({
    id:        r.learning_id,
    content:   JSON.parse(r.content) as T,
    updatedAt: r.updated_at,
  }));
}

// ── UserMemoryStore ────────────────────────────────────────────────────────────

export class DbUserMemoryStore implements UserMemoryStore {
  constructor(private readonly db: AgentDb) {}

  /** Master record key: user-level row that holds the memory list. */
  private _key(userId: string, agentId?: string): string {
    return `user_memory:${userId}:${agentId ?? '__global__'}`;
  }

  async get(userId: string, agentId?: string): Promise<UserMemory | null> {
    await this.db.init();
    const row = await this.db.getLearning({ learningType: 'user_memory', userId, agentId });
    if (!row) return null;
    return JSON.parse(row.content) as UserMemory;
  }

  async set(memory: UserMemory): Promise<UserMemory> {
    await this.db.init();
    const id = this._key(memory.userId, memory.agentId);
    await upsertLearning(this.db, 'user_memory', id, memory as unknown as Record<string, unknown>, {
      userId: memory.userId, agentId: memory.agentId,
    });
    return memory;
  }

  async addMemory(userId: string, content: string, agentId?: string, extra?: Record<string, unknown>): Promise<string> {
    const existing = await this.get(userId, agentId);
    const memId  = genId();
    const entry: UserMemoryEntry = { id: memId, content, createdAt: nowIso(), ...extra };
    const updated: UserMemory = existing
      ? { ...existing, memories: [...existing.memories, entry], updatedAt: nowIso() }
      : { userId, agentId, memories: [entry], createdAt: nowIso(), updatedAt: nowIso() };
    await this.set(updated);
    return memId;
  }

  async updateMemory(userId: string, memoryId: string, content: string, agentId?: string): Promise<boolean> {
    const existing = await this.get(userId, agentId);
    if (!existing) return false;
    const idx = existing.memories.findIndex(m => m.id === memoryId);
    if (idx === -1) return false;
    const updatedMems = [...existing.memories];
    updatedMems[idx] = { ...updatedMems[idx]!, content };
    await this.set({ ...existing, memories: updatedMems, updatedAt: nowIso() });
    return true;
  }

  async deleteMemory(userId: string, memoryId: string, agentId?: string): Promise<boolean> {
    const existing = await this.get(userId, agentId);
    if (!existing) return false;
    const before = existing.memories.length;
    const filtered = existing.memories.filter(m => m.id !== memoryId);
    if (filtered.length === before) return false;
    await this.set({ ...existing, memories: filtered, updatedAt: nowIso() });
    return true;
  }

  async clearMemories(userId: string, agentId?: string): Promise<void> {
    const existing = await this.get(userId, agentId);
    if (!existing) return;
    await this.set({ ...existing, memories: [], updatedAt: nowIso() });
  }
}

// ── SessionContextStore ────────────────────────────────────────────────────────

export class DbSessionContextStore implements SessionContextStore {
  constructor(private readonly db: AgentDb) {}

  async get(sessionId: string, agentId?: string): Promise<SessionContext | null> {
    await this.db.init();
    const row = await this.db.getLearning({ learningType: 'session_context', sessionId, agentId });
    if (!row) return null;
    return JSON.parse(row.content) as SessionContext;
  }

  async set(context: SessionContext): Promise<SessionContext> {
    await this.db.init();
    const id = `session_context:${context.sessionId}:${context.agentId ?? '__global__'}`;
    await upsertLearning(
      this.db, 'session_context', id, context as unknown as Record<string, unknown>,
      { userId: context.userId, agentId: context.agentId, sessionId: context.sessionId },
    );
    return context;
  }

  async clear(sessionId: string, agentId?: string): Promise<boolean> {
    await this.db.init();
    const id = `session_context:${sessionId}:${agentId ?? '__global__'}`;
    return this.db.deleteLearning(id);
  }
}

// ── LearnedKnowledgeStore ──────────────────────────────────────────────────────

export class DbLearnedKnowledgeStore implements LearnedKnowledgeStore {
  constructor(private readonly db: AgentDb) {}

  async search(query: string, namespace?: string, limit = 20): Promise<LearnedKnowledge[]> {
    await this.db.init();
    const rows = await this.db.getLearnings({ learningType: 'learned_knowledge', namespace, limit });
    const all = rows.map(r => JSON.parse(r.content) as LearnedKnowledge);
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter(k =>
      k.title.toLowerCase().includes(q) ||
      k.learning.toLowerCase().includes(q) ||
      (k.context ?? '').toLowerCase().includes(q) ||
      (k.tags ?? []).some(t => t.toLowerCase().includes(q)),
    );
  }

  async save(knowledge: LearnedKnowledge): Promise<LearnedKnowledge> {
    await this.db.init();
    const id = `learned_knowledge:${knowledge.namespace ?? '__global__'}:${knowledge.title}`;
    await upsertLearning(
      this.db, 'learned_knowledge', id, knowledge as unknown as Record<string, unknown>,
      { namespace: knowledge.namespace, agentId: knowledge.agentId },
    );
    return knowledge;
  }

  async delete(title: string, namespace?: string): Promise<boolean> {
    await this.db.init();
    const id = `learned_knowledge:${namespace ?? '__global__'}:${title}`;
    return this.db.deleteLearning(id);
  }
}

// ── EntityMemoryStore ──────────────────────────────────────────────────────────

export class DbEntityMemoryStore implements EntityMemoryStore {
  constructor(private readonly db: AgentDb) {}

  private _id(entityId: string, namespace?: string): string {
    return `entity_memory:${namespace ?? '__global__'}:${entityId}`;
  }

  async get(entityId: string, namespace?: string): Promise<EntityMemory | null> {
    await this.db.init();
    const row = await this.db.getLearning({ learningType: 'entity_memory', entityId, namespace });
    if (!row) return null;
    return JSON.parse(row.content) as EntityMemory;
  }

  async search(query: string, namespace?: string, limit = 20): Promise<EntityMemory[]> {
    await this.db.init();
    const rows = await this.db.getLearnings({ learningType: 'entity_memory', namespace, limit });
    const all = rows.map(r => JSON.parse(r.content) as EntityMemory);
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter(e =>
      (e.name ?? '').toLowerCase().includes(q) ||
      (e.description ?? '').toLowerCase().includes(q) ||
      e.entityId.toLowerCase().includes(q) ||
      e.facts.some(f => f.content.toLowerCase().includes(q)),
    );
  }

  async set(entity: EntityMemory): Promise<EntityMemory> {
    await this.db.init();
    const id = this._id(entity.entityId, entity.namespace);
    await upsertLearning(
      this.db, 'entity_memory', id, entity as unknown as Record<string, unknown>,
      { namespace: entity.namespace, agentId: entity.agentId, entityId: entity.entityId, entityType: entity.entityType },
    );
    return entity;
  }

  async addFact(entityId: string, content: string, namespace?: string, extra?: Record<string, unknown>): Promise<string> {
    const entity = await this.get(entityId, namespace) ?? this._empty(entityId, 'unknown', namespace);
    const factId = genId();
    const fact: EntityFact = { id: factId, content, ...extra };
    await this.set({ ...entity, facts: [...entity.facts, fact], updatedAt: nowIso() });
    return factId;
  }

  async updateFact(entityId: string, factId: string, content: string): Promise<boolean> {
    const entity = await this.get(entityId);
    if (!entity) return false;
    const idx = entity.facts.findIndex(f => f.id === factId);
    if (idx === -1) return false;
    const facts = [...entity.facts];
    facts[idx] = { ...facts[idx]!, content };
    await this.set({ ...entity, facts, updatedAt: nowIso() });
    return true;
  }

  async deleteFact(entityId: string, factId: string): Promise<boolean> {
    const entity = await this.get(entityId);
    if (!entity) return false;
    const before = entity.facts.length;
    const facts = entity.facts.filter(f => f.id !== factId);
    if (facts.length === before) return false;
    await this.set({ ...entity, facts, updatedAt: nowIso() });
    return true;
  }

  async addEvent(entityId: string, content: string, date?: string, namespace?: string): Promise<string> {
    const entity = await this.get(entityId, namespace) ?? this._empty(entityId, 'unknown', namespace);
    const evId = genId();
    const ev: EntityEvent = { id: evId, content, ...(date !== undefined && { date }) };
    await this.set({ ...entity, events: [...entity.events, ev], updatedAt: nowIso() });
    return evId;
  }

  async addRelationship(
    entityId: string, relatedEntityId: string, relation: string,
    direction: 'outgoing' | 'incoming' = 'outgoing', namespace?: string,
  ): Promise<string> {
    const entity = await this.get(entityId, namespace) ?? this._empty(entityId, 'unknown', namespace);
    const relId = genId();
    const rel: EntityRelationship = { id: relId, entityId: relatedEntityId, relation, direction };
    await this.set({ ...entity, relationships: [...entity.relationships, rel], updatedAt: nowIso() });
    return relId;
  }

  async delete(entityId: string, namespace?: string): Promise<boolean> {
    await this.db.init();
    const id = this._id(entityId, namespace);
    return this.db.deleteLearning(id);
  }

  private _empty(entityId: string, entityType: string, namespace?: string): EntityMemory {
    return {
      entityId, entityType, namespace,
      facts: [], events: [], relationships: [],
      createdAt: nowIso(), updatedAt: nowIso(),
    };
  }
}

// ── DecisionLogStore ───────────────────────────────────────────────────────────

export class DbDecisionLogStore implements DecisionLogStore {
  constructor(private readonly db: AgentDb) {}

  async add(log: Omit<DecisionLog, 'id' | 'createdAt'>): Promise<DecisionLog> {
    await this.db.init();
    const id = genId();
    const full: DecisionLog = { ...log, id, createdAt: nowIso() };
    await upsertLearning(
      this.db, 'decision_log', id, full as unknown as Record<string, unknown>,
      { agentId: log.agentId, sessionId: log.sessionId },
    );
    return full;
  }

  async get(id: string): Promise<DecisionLog | null> {
    await this.db.init();
    const allRows = await this.db.getLearnings({ learningType: 'decision_log', limit: 10_000 });
    const found = allRows.find(r => r.learning_id === id);
    if (!found) return null;
    return JSON.parse(found.content) as DecisionLog;
  }

  async list(agentId?: string, sessionId?: string, limit = 50): Promise<DecisionLog[]> {
    await this.db.init();
    const items = await findLearnings<DecisionLog>(this.db, {
      learningType: 'decision_log',
      ...(agentId   !== undefined && { agentId }),
      ...(sessionId !== undefined && { sessionId }),
      limit,
    });
    return items.map(i => i.content).sort((a, b) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    );
  }

  async search(query: string, agentId?: string, limit = 20): Promise<DecisionLog[]> {
    const all = await this.list(agentId, undefined, 500);
    const q = query.toLowerCase();
    return all
      .filter(d =>
        d.decision.toLowerCase().includes(q) ||
        (d.reasoning ?? '').toLowerCase().includes(q) ||
        (d.context ?? '').toLowerCase().includes(q),
      )
      .slice(0, limit);
  }

  async update(
    id: string,
    updates: Partial<Pick<DecisionLog, 'outcome' | 'outcomeQuality'>>,
  ): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    const updated = { ...existing, ...updates };
    await upsertLearning(
      this.db, 'decision_log', id, updated as unknown as Record<string, unknown>,
      { agentId: existing.agentId, sessionId: existing.sessionId },
    );
    return true;
  }

  async delete(id: string): Promise<boolean> {
    await this.db.init();
    return this.db.deleteLearning(id);
  }

  async prune(agentId?: string, maxAgeDays = 30): Promise<number> {
    await this.db.init();
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const all = await this.list(agentId, undefined, 10_000);
    let deleted = 0;
    for (const d of all) {
      if (d.id && d.createdAt && new Date(d.createdAt).getTime() < cutoff) {
        await this.db.deleteLearning(d.id);
        deleted++;
      }
    }
    return deleted;
  }
}
