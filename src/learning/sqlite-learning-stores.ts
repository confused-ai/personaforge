/**
 * SQLite-backed learning stores for all extended learning store types.
 *
 * SRP  — each class owns exactly one concern (one store type).
 * DIP  — each class implements the corresponding store interface.
 * Lazy — better-sqlite3 is loaded inside each factory; zero cost if unused.
 */

import type {
    UserMemory, UserMemoryEntry, UserMemoryStore,
    SessionContext, SessionContextStore,
    LearnedKnowledge, LearnedKnowledgeStore,
    EntityMemory, EntityFact, EntityEvent, EntityRelationship, EntityMemoryStore,
    DecisionLog, DecisionLogStore,
} from './types.js';

// ── Shared SQLite bootstrap ────────────────────────────────────────────────────

const MISSING_SDK =
    '[personaforge] SQLite learning stores require better-sqlite3.\n' +
    '  Install: npm install better-sqlite3';

interface Stmt<T = unknown> { get(...a: unknown[]): T | undefined; run(...a: unknown[]): unknown; all(...a: unknown[]): T[]; }
interface Db { exec(sql: string): void; prepare<T = unknown>(sql: string): Stmt<T>; }
type DbCtor = new (path: string) => Db;

function loadSqlite(): DbCtor {
    try { return require('better-sqlite3') as DbCtor; }
    catch { throw new Error(MISSING_SDK); }
}

function uuid(): string {
    return crypto.randomUUID();
}

// ── SqliteUserMemoryStore ─────────────────────────────────────────────────────

interface UserMemoryRow {
    user_id: string;
    agent_id: string | null;
    memories: string; // JSON array
    created_at: string;
    updated_at: string;
}

export class SqliteUserMemoryStore implements UserMemoryStore {
    private readonly _db: Db;

    constructor(path = ':memory:') {
        const Db = loadSqlite();
        this._db = new Db(path);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS user_memories (
                user_id    TEXT NOT NULL,
                agent_id   TEXT NOT NULL DEFAULT '',
                memories   TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, agent_id)
            );
        `);
    }

    async get(userId: string, agentId = ''): Promise<UserMemory | null> {
        const row = this._db.prepare<UserMemoryRow>(
            'SELECT * FROM user_memories WHERE user_id = ? AND agent_id = ?'
        ).get(userId, agentId);
        if (!row) return null;
        return {
            userId: row.user_id,
            agentId: row.agent_id ?? undefined,
            memories: JSON.parse(row.memories) as UserMemoryEntry[],
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async set(memory: UserMemory): Promise<UserMemory> {
        const now = new Date().toISOString();
        const agentId = memory.agentId ?? '';
        this._db.prepare(
            `INSERT INTO user_memories (user_id, agent_id, memories, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id, agent_id) DO UPDATE SET memories = excluded.memories, updated_at = excluded.updated_at`
        ).run(memory.userId, agentId, JSON.stringify(memory.memories), memory.createdAt ?? now, now);
        return { ...memory, updatedAt: now };
    }

    async addMemory(userId: string, content: string, agentId = '', extra?: Record<string, unknown>): Promise<string> {
        const existing = await this.get(userId, agentId);
        const id = uuid();
        const entry: UserMemoryEntry = { id, content, createdAt: new Date().toISOString(), ...extra };
        const memories = [...(existing?.memories ?? []), entry];
        await this.set({
            userId, agentId: agentId || undefined,
            memories,
            createdAt: existing?.createdAt,
            updatedAt: new Date().toISOString(),
        });
        return id;
    }

    async updateMemory(userId: string, memoryId: string, content: string, agentId = ''): Promise<boolean> {
        const existing = await this.get(userId, agentId);
        if (!existing) return false;
        const idx = existing.memories.findIndex((m) => m.id === memoryId);
        if (idx === -1) return false;
        const updated = existing.memories.map((m) => m.id === memoryId ? { ...m, content } : m);
        await this.set({ ...existing, memories: updated });
        return true;
    }

    async deleteMemory(userId: string, memoryId: string, agentId = ''): Promise<boolean> {
        const existing = await this.get(userId, agentId);
        if (!existing) return false;
        const before = existing.memories.length;
        const updated = existing.memories.filter((m) => m.id !== memoryId);
        if (updated.length === before) return false;
        await this.set({ ...existing, memories: updated });
        return true;
    }

    async clearMemories(userId: string, agentId = ''): Promise<void> {
        this._db.prepare('DELETE FROM user_memories WHERE user_id = ? AND agent_id = ?').run(userId, agentId);
    }
}

// ── SqliteSessionContextStore ─────────────────────────────────────────────────

interface SessionContextRow {
    session_id: string;
    agent_id: string | null;
    summary: string | null;
    goal: string | null;
    plan: string | null;
    progress: string | null;
    user_id: string | null;
    created_at: string;
    updated_at: string;
}

export class SqliteSessionContextStore implements SessionContextStore {
    private readonly _db: Db;

    constructor(path = ':memory:') {
        const Db = loadSqlite();
        this._db = new Db(path);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS session_contexts (
                session_id TEXT NOT NULL,
                agent_id   TEXT NOT NULL DEFAULT '',
                user_id    TEXT,
                summary    TEXT,
                goal       TEXT,
                plan       TEXT,
                progress   TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (session_id, agent_id)
            );
        `);
    }

    async get(sessionId: string, agentId = ''): Promise<SessionContext | null> {
        const row = this._db.prepare<SessionContextRow>(
            'SELECT * FROM session_contexts WHERE session_id = ? AND agent_id = ?'
        ).get(sessionId, agentId);
        if (!row) return null;
        return {
            sessionId: row.session_id,
            agentId: row.agent_id ?? undefined,
            userId: row.user_id ?? undefined,
            summary: row.summary ?? undefined,
            goal: row.goal ?? undefined,
            plan: row.plan ? (JSON.parse(row.plan) as string[]) : undefined,
            progress: row.progress ? (JSON.parse(row.progress) as string[]) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async set(context: SessionContext): Promise<SessionContext> {
        const now = new Date().toISOString();
        const agentId = context.agentId ?? '';
        this._db.prepare(
            `INSERT INTO session_contexts (session_id, agent_id, user_id, summary, goal, plan, progress, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id, agent_id) DO UPDATE SET
               user_id = excluded.user_id, summary = excluded.summary, goal = excluded.goal,
               plan = excluded.plan, progress = excluded.progress, updated_at = excluded.updated_at`
        ).run(
            context.sessionId, agentId,
            context.userId ?? null, context.summary ?? null,
            context.goal ?? null,
            context.plan ? JSON.stringify(context.plan) : null,
            context.progress ? JSON.stringify(context.progress) : null,
            context.createdAt ?? now, now
        );
        return { ...context, updatedAt: now };
    }

    async clear(sessionId: string, agentId = ''): Promise<boolean> {
        const r = this._db.prepare(
            'DELETE FROM session_contexts WHERE session_id = ? AND agent_id = ?'
        ).run(sessionId, agentId) as { changes: number };
        return r.changes > 0;
    }
}

// ── SqliteLearnedKnowledgeStore ───────────────────────────────────────────────

interface KnowledgeRow {
    id: string;
    title: string;
    learning: string;
    context: string | null;
    tags: string | null;
    namespace: string;
    agent_id: string | null;
    created_at: string;
    updated_at: string;
}

export class SqliteLearnedKnowledgeStore implements LearnedKnowledgeStore {
    private readonly _db: Db;

    constructor(path = ':memory:') {
        const Db = loadSqlite();
        this._db = new Db(path);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS learned_knowledge (
                id         TEXT PRIMARY KEY,
                title      TEXT NOT NULL,
                learning   TEXT NOT NULL,
                context    TEXT,
                tags       TEXT,
                namespace  TEXT NOT NULL DEFAULT 'global',
                agent_id   TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_lk_ns ON learned_knowledge(namespace);
        `);
    }

    async search(query: string, namespace?: string, limit = 10): Promise<LearnedKnowledge[]> {
        const q = `%${query}%`;
        let rows: KnowledgeRow[];
        if (namespace) {
            rows = this._db.prepare<KnowledgeRow>(
                `SELECT * FROM learned_knowledge WHERE namespace = ?
                 AND (title LIKE ? OR learning LIKE ? OR context LIKE ?)
                 ORDER BY updated_at DESC LIMIT ?`
            ).all(namespace, q, q, q, limit);
        } else {
            rows = this._db.prepare<KnowledgeRow>(
                `SELECT * FROM learned_knowledge
                 WHERE title LIKE ? OR learning LIKE ? OR context LIKE ?
                 ORDER BY updated_at DESC LIMIT ?`
            ).all(q, q, q, limit);
        }
        return rows.map((r) => ({
            title: r.title, learning: r.learning,
            context: r.context ?? undefined,
            tags: r.tags ? (JSON.parse(r.tags) as string[]) : undefined,
            namespace: r.namespace,
            agentId: r.agent_id ?? undefined,
            createdAt: r.created_at, updatedAt: r.updated_at,
        }));
    }

    async save(knowledge: LearnedKnowledge): Promise<LearnedKnowledge> {
        const now = new Date().toISOString();
        const id = uuid();
        this._db.prepare(
            `INSERT INTO learned_knowledge (id, title, learning, context, tags, namespace, agent_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET learning = excluded.learning, context = excluded.context,
               tags = excluded.tags, updated_at = excluded.updated_at`
        ).run(
            id, knowledge.title, knowledge.learning,
            knowledge.context ?? null,
            knowledge.tags ? JSON.stringify(knowledge.tags) : null,
            knowledge.namespace ?? 'global',
            knowledge.agentId ?? null,
            knowledge.createdAt ?? now, now
        );
        return { ...knowledge, createdAt: knowledge.createdAt ?? now, updatedAt: now };
    }

    async delete(title: string, namespace = 'global'): Promise<boolean> {
        const r = this._db.prepare(
            'DELETE FROM learned_knowledge WHERE title = ? AND namespace = ?'
        ).run(title, namespace) as { changes: number };
        return r.changes > 0;
    }
}

// ── SqliteEntityMemoryStore ───────────────────────────────────────────────────

interface EntityRow {
    entity_id: string;
    entity_type: string;
    name: string | null;
    description: string | null;
    properties: string | null;
    facts: string;
    events: string;
    relationships: string;
    namespace: string;
    agent_id: string | null;
    created_at: string;
    updated_at: string;
}

export class SqliteEntityMemoryStore implements EntityMemoryStore {
    private readonly _db: Db;

    constructor(path = ':memory:') {
        const Db = loadSqlite();
        this._db = new Db(path);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS entity_memories (
                entity_id   TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                name        TEXT,
                description TEXT,
                properties  TEXT,
                facts       TEXT NOT NULL DEFAULT '[]',
                events      TEXT NOT NULL DEFAULT '[]',
                relationships TEXT NOT NULL DEFAULT '[]',
                namespace   TEXT NOT NULL DEFAULT 'global',
                agent_id    TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                PRIMARY KEY (entity_id, namespace)
            );
        `);
    }

    private _rowToEntity(row: EntityRow): EntityMemory {
        return {
            entityId: row.entity_id,
            entityType: row.entity_type,
            name: row.name ?? undefined,
            description: row.description ?? undefined,
            properties: row.properties ? (JSON.parse(row.properties) as Record<string, string>) : undefined,
            facts: JSON.parse(row.facts) as EntityFact[],
            events: JSON.parse(row.events) as EntityEvent[],
            relationships: JSON.parse(row.relationships) as EntityRelationship[],
            namespace: row.namespace,
            agentId: row.agent_id ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private _saveRow(entity: EntityMemory): void {
        const now = new Date().toISOString();
        this._db.prepare(
            `INSERT INTO entity_memories
             (entity_id, entity_type, name, description, properties, facts, events, relationships, namespace, agent_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(entity_id, namespace) DO UPDATE SET
               entity_type = excluded.entity_type, name = excluded.name, description = excluded.description,
               properties = excluded.properties, facts = excluded.facts, events = excluded.events,
               relationships = excluded.relationships, agent_id = excluded.agent_id, updated_at = excluded.updated_at`
        ).run(
            entity.entityId, entity.entityType,
            entity.name ?? null, entity.description ?? null,
            entity.properties ? JSON.stringify(entity.properties) : null,
            JSON.stringify(entity.facts), JSON.stringify(entity.events), JSON.stringify(entity.relationships),
            entity.namespace ?? 'global', entity.agentId ?? null,
            entity.createdAt ?? now, now
        );
    }

    async get(entityId: string, namespace = 'global'): Promise<EntityMemory | null> {
        const row = this._db.prepare<EntityRow>(
            'SELECT * FROM entity_memories WHERE entity_id = ? AND namespace = ?'
        ).get(entityId, namespace);
        return row ? this._rowToEntity(row) : null;
    }

    async search(query: string, namespace?: string, limit = 10): Promise<EntityMemory[]> {
        const q = `%${query}%`;
        let rows: EntityRow[];
        if (namespace) {
            rows = this._db.prepare<EntityRow>(
                `SELECT * FROM entity_memories WHERE namespace = ?
                 AND (entity_id LIKE ? OR name LIKE ? OR description LIKE ?)
                 ORDER BY updated_at DESC LIMIT ?`
            ).all(namespace, q, q, q, limit);
        } else {
            rows = this._db.prepare<EntityRow>(
                `SELECT * FROM entity_memories
                 WHERE entity_id LIKE ? OR name LIKE ? OR description LIKE ?
                 ORDER BY updated_at DESC LIMIT ?`
            ).all(q, q, q, limit);
        }
        return rows.map((r) => this._rowToEntity(r));
    }

    async set(entity: EntityMemory): Promise<EntityMemory> {
        this._saveRow(entity);
        return entity;
    }

    async addFact(entityId: string, content: string, namespace = 'global', extra?: Record<string, unknown>): Promise<string> {
        const entity = await this.get(entityId, namespace);
        const base = entity ?? { entityId, entityType: 'unknown', facts: [], events: [], relationships: [], namespace };
        const id = uuid();
        const fact: EntityFact = { id, content, ...extra };
        await this.set({ ...base, facts: [...base.facts, fact] });
        return id;
    }

    async updateFact(entityId: string, factId: string, content: string, namespace = 'global'): Promise<boolean> {
        const entity = await this.get(entityId, namespace);
        if (!entity) return false;
        const updated = entity.facts.map((f) => f.id === factId ? { ...f, content } : f);
        if (updated.length === entity.facts.length && !updated.find((f) => f.id === factId)) return false;
        await this.set({ ...entity, facts: updated });
        return true;
    }

    async deleteFact(entityId: string, factId: string, namespace = 'global'): Promise<boolean> {
        const entity = await this.get(entityId, namespace);
        if (!entity) return false;
        const updated = entity.facts.filter((f) => f.id !== factId);
        await this.set({ ...entity, facts: updated });
        return updated.length < entity.facts.length;
    }

    async addEvent(entityId: string, content: string, date?: string, namespace = 'global'): Promise<string> {
        const entity = await this.get(entityId, namespace);
        const base = entity ?? { entityId, entityType: 'unknown', facts: [], events: [], relationships: [], namespace };
        const id = uuid();
        const event: EntityEvent = { id, content, date };
        await this.set({ ...base, events: [...base.events, event] });
        return id;
    }

    async addRelationship(entityId: string, relatedEntityId: string, relation: string, direction: 'outgoing' | 'incoming' = 'outgoing', namespace = 'global'): Promise<string> {
        const entity = await this.get(entityId, namespace);
        const base = entity ?? { entityId, entityType: 'unknown', facts: [], events: [], relationships: [], namespace };
        const id = uuid();
        const rel: EntityRelationship = { id, entityId: relatedEntityId, relation, direction };
        await this.set({ ...base, relationships: [...base.relationships, rel] });
        return id;
    }

    async delete(entityId: string, namespace = 'global'): Promise<boolean> {
        const r = this._db.prepare(
            'DELETE FROM entity_memories WHERE entity_id = ? AND namespace = ?'
        ).run(entityId, namespace) as { changes: number };
        return r.changes > 0;
    }
}

// ── SqliteDecisionLogStore ────────────────────────────────────────────────────

interface DecisionLogRow {
    id: string;
    decision: string;
    reasoning: string | null;
    decision_type: string | null;
    context: string | null;
    alternatives: string | null;
    confidence: number | null;
    outcome: string | null;
    outcome_quality: string | null;
    tags: string | null;
    session_id: string | null;
    agent_id: string | null;
    created_at: string;
}

export class SqliteDecisionLogStore implements DecisionLogStore {
    private readonly _db: Db;

    constructor(path = ':memory:') {
        const Db = loadSqlite();
        this._db = new Db(path);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS decision_logs (
                id             TEXT PRIMARY KEY,
                decision       TEXT NOT NULL,
                reasoning      TEXT,
                decision_type  TEXT,
                context        TEXT,
                alternatives   TEXT,
                confidence     REAL,
                outcome        TEXT,
                outcome_quality TEXT,
                tags           TEXT,
                session_id     TEXT,
                agent_id       TEXT,
                created_at     TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_dl_agent ON decision_logs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_dl_session ON decision_logs(session_id);
            CREATE INDEX IF NOT EXISTS idx_dl_created ON decision_logs(created_at);
        `);
    }

    private _rowToLog(r: DecisionLogRow): DecisionLog {
        return {
            id: r.id, decision: r.decision,
            reasoning: r.reasoning ?? undefined,
            decisionType: r.decision_type ?? undefined,
            context: r.context ?? undefined,
            alternatives: r.alternatives ? (JSON.parse(r.alternatives) as string[]) : undefined,
            confidence: r.confidence ?? undefined,
            outcome: r.outcome ?? undefined,
            outcomeQuality: r.outcome_quality as DecisionLog['outcomeQuality'] ?? undefined,
            tags: r.tags ? (JSON.parse(r.tags) as string[]) : undefined,
            sessionId: r.session_id ?? undefined,
            agentId: r.agent_id ?? undefined,
            createdAt: r.created_at,
        };
    }

    async add(log: Omit<DecisionLog, 'id' | 'createdAt'>): Promise<DecisionLog> {
        const id = uuid();
        const now = new Date().toISOString();
        this._db.prepare(
            `INSERT INTO decision_logs
             (id, decision, reasoning, decision_type, context, alternatives, confidence, outcome, outcome_quality, tags, session_id, agent_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id, log.decision, log.reasoning ?? null, log.decisionType ?? null,
            log.context ?? null,
            log.alternatives ? JSON.stringify(log.alternatives) : null,
            log.confidence ?? null, log.outcome ?? null, log.outcomeQuality ?? null,
            log.tags ? JSON.stringify(log.tags) : null,
            log.sessionId ?? null, log.agentId ?? null, now
        );
        return { ...log, id, createdAt: now };
    }

    async get(id: string): Promise<DecisionLog | null> {
        const row = this._db.prepare<DecisionLogRow>('SELECT * FROM decision_logs WHERE id = ?').get(id);
        return row ? this._rowToLog(row) : null;
    }

    async list(agentId?: string, sessionId?: string, limit = 100): Promise<DecisionLog[]> {
        let sql = 'SELECT * FROM decision_logs';
        const params: unknown[] = [];
        const where: string[] = [];
        if (agentId) { where.push('agent_id = ?'); params.push(agentId); }
        if (sessionId) { where.push('session_id = ?'); params.push(sessionId); }
        if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);
        const rows = this._db.prepare<DecisionLogRow>(sql).all(...params);
        return rows.map((r) => this._rowToLog(r));
    }

    async search(query: string, agentId?: string, limit = 20): Promise<DecisionLog[]> {
        const q = `%${query}%`;
        const rows = agentId
            ? this._db.prepare<DecisionLogRow>(
                `SELECT * FROM decision_logs WHERE agent_id = ?
                 AND (decision LIKE ? OR reasoning LIKE ? OR context LIKE ?)
                 ORDER BY created_at DESC LIMIT ?`
              ).all(agentId, q, q, q, limit)
            : this._db.prepare<DecisionLogRow>(
                `SELECT * FROM decision_logs
                 WHERE decision LIKE ? OR reasoning LIKE ? OR context LIKE ?
                 ORDER BY created_at DESC LIMIT ?`
              ).all(q, q, q, limit);
        return rows.map((r) => this._rowToLog(r));
    }

    async update(id: string, updates: Partial<Pick<DecisionLog, 'outcome' | 'outcomeQuality'>>): Promise<boolean> {
        const parts: string[] = [];
        const params: unknown[] = [];
        if (updates.outcome !== undefined) { parts.push('outcome = ?'); params.push(updates.outcome); }
        if (updates.outcomeQuality !== undefined) { parts.push('outcome_quality = ?'); params.push(updates.outcomeQuality); }
        if (!parts.length) return false;
        params.push(id);
        const r = this._db.prepare(`UPDATE decision_logs SET ${parts.join(', ')} WHERE id = ?`).run(...params) as { changes: number };
        return r.changes > 0;
    }

    async delete(id: string): Promise<boolean> {
        const r = this._db.prepare('DELETE FROM decision_logs WHERE id = ?').run(id) as { changes: number };
        return r.changes > 0;
    }

    async prune(agentId?: string, maxAgeDays = 30): Promise<number> {
        const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
        const r = agentId
            ? this._db.prepare('DELETE FROM decision_logs WHERE agent_id = ? AND created_at < ?').run(agentId, cutoff) as { changes: number }
            : this._db.prepare('DELETE FROM decision_logs WHERE created_at < ?').run(cutoff) as { changes: number };
        return r.changes;
    }
}
