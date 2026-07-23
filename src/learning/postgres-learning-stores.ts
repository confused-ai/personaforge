/**
 * PostgreSQL-backed learning stores for all extended learning store types.
 *
 * SRP  — each class owns exactly one concern.
 * DIP  — each class implements the corresponding store interface.
 * Lazy — `pg` Pool is loaded inside each factory; zero cost if unused.
 */

import type {
    UserMemory, UserMemoryEntry, UserMemoryStore,
    SessionContext, SessionContextStore,
    LearnedKnowledge, LearnedKnowledgeStore,
    EntityMemory, EntityFact, EntityEvent, EntityRelationship, EntityMemoryStore,
    DecisionLog, DecisionLogStore,
} from './types.js';

// ── Minimal pg typing (avoids hard compile dep) ───────────────────────────────

const MISSING_SDK =
    '[personaforge] Postgres learning stores require the `pg` package.\n' +
    '  Install: npm install pg';

interface PgPool {
    query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
    end(): Promise<void>;
}
interface PgPoolConfig { connectionString?: string; host?: string; port?: number; database?: string; user?: string; password?: string; ssl?: unknown; }
type PgPoolCtor = new (config: PgPoolConfig) => PgPool;

function loadPg(): PgPoolCtor {
    try {
        const pg = require('pg') as { Pool: PgPoolCtor };
        return pg.Pool;
    } catch {
        throw new Error(MISSING_SDK);
    }
}

function uuid(): string {
    return crypto.randomUUID();
}

// ── PostgresUserMemoryStore ───────────────────────────────────────────────────

export class PostgresUserMemoryStore implements UserMemoryStore {
    private readonly _pool: PgPool;
    private _initPromise: Promise<void> | undefined;

    constructor(config: PgPoolConfig | string) {
        const Pool = loadPg();
        this._pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
    }

    private _init(): Promise<void> {
        return (this._initPromise ??= this._createTables());
    }

    private async _createTables(): Promise<void> {
        await this._pool.query(`
            CREATE TABLE IF NOT EXISTS user_memories (
                user_id    TEXT NOT NULL,
                agent_id   TEXT NOT NULL DEFAULT '',
                memories   JSONB NOT NULL DEFAULT '[]',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (user_id, agent_id)
            );
        `);
    }

    async get(userId: string, agentId = ''): Promise<UserMemory | null> {
        await this._init();
        const { rows } = await this._pool.query(
            'SELECT * FROM user_memories WHERE user_id = $1 AND agent_id = $2',
            [userId, agentId]
        );
        if (!rows[0]) return null;
        const r = rows[0] as Record<string, unknown>;
        return {
            userId: r.user_id as string,
            agentId: (r.agent_id as string) || undefined,
            memories: r.memories as UserMemoryEntry[],
            createdAt: (r.created_at as Date).toISOString(),
            updatedAt: (r.updated_at as Date).toISOString(),
        };
    }

    async set(memory: UserMemory): Promise<UserMemory> {
        await this._init();
        const agentId = memory.agentId ?? '';
        await this._pool.query(
            `INSERT INTO user_memories (user_id, agent_id, memories, created_at, updated_at)
             VALUES ($1, $2, $3::jsonb, NOW(), NOW())
             ON CONFLICT (user_id, agent_id) DO UPDATE
             SET memories = $3::jsonb, updated_at = NOW()`,
            [memory.userId, agentId, JSON.stringify(memory.memories)]
        );
        return memory;
    }

    async addMemory(userId: string, content: string, agentId = '', extra?: Record<string, unknown>): Promise<string> {
        const existing = await this.get(userId, agentId);
        const id = uuid();
        const entry: UserMemoryEntry = { id, content, createdAt: new Date().toISOString(), ...extra };
        await this.set({
            userId, agentId: agentId || undefined,
            memories: [...(existing?.memories ?? []), entry],
        });
        return id;
    }

    async updateMemory(userId: string, memoryId: string, content: string, agentId = ''): Promise<boolean> {
        const existing = await this.get(userId, agentId);
        if (!existing) return false;
        const updated = existing.memories.map((m) => m.id === memoryId ? { ...m, content } : m);
        await this.set({ ...existing, memories: updated });
        return true;
    }

    async deleteMemory(userId: string, memoryId: string, agentId = ''): Promise<boolean> {
        const existing = await this.get(userId, agentId);
        if (!existing) return false;
        const before = existing.memories.length;
        const updated = existing.memories.filter((m) => m.id !== memoryId);
        await this.set({ ...existing, memories: updated });
        return updated.length < before;
    }

    async clearMemories(userId: string, agentId = ''): Promise<void> {
        await this._init();
        await this._pool.query('DELETE FROM user_memories WHERE user_id = $1 AND agent_id = $2', [userId, agentId]);
    }

    /** Gracefully end the connection pool. Call during shutdown. */
    async close(): Promise<void> {
        await this._pool.end();
    }
}

// ── PostgresSessionContextStore ───────────────────────────────────────────────

export class PostgresSessionContextStore implements SessionContextStore {
    private readonly _pool: PgPool;
    private _initPromise: Promise<void> | undefined;

    constructor(config: PgPoolConfig | string) {
        const Pool = loadPg();
        this._pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
    }

    private _init(): Promise<void> {
        return (this._initPromise ??= this._createTables());
    }

    private async _createTables(): Promise<void> {
        await this._pool.query(`
            CREATE TABLE IF NOT EXISTS session_contexts (
                session_id TEXT NOT NULL,
                agent_id   TEXT NOT NULL DEFAULT '',
                user_id    TEXT,
                summary    TEXT,
                goal       TEXT,
                plan       JSONB,
                progress   JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (session_id, agent_id)
            );
        `);
    }

    async get(sessionId: string, agentId = ''): Promise<SessionContext | null> {
        await this._init();
        const { rows } = await this._pool.query(
            'SELECT * FROM session_contexts WHERE session_id = $1 AND agent_id = $2',
            [sessionId, agentId]
        );
        if (!rows[0]) return null;
        const r = rows[0] as Record<string, unknown>;
        return {
            sessionId: r.session_id as string,
            agentId: (r.agent_id as string) || undefined,
            userId: r.user_id as string | undefined,
            summary: r.summary as string | undefined,
            goal: r.goal as string | undefined,
            plan: r.plan as string[] | undefined,
            progress: r.progress as string[] | undefined,
            createdAt: (r.created_at as Date).toISOString(),
            updatedAt: (r.updated_at as Date).toISOString(),
        };
    }

    async set(context: SessionContext): Promise<SessionContext> {
        await this._init();
        const agentId = context.agentId ?? '';
        await this._pool.query(
            `INSERT INTO session_contexts (session_id, agent_id, user_id, summary, goal, plan, progress, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW(), NOW())
             ON CONFLICT (session_id, agent_id) DO UPDATE SET
               user_id = $3, summary = $4, goal = $5, plan = $6::jsonb, progress = $7::jsonb, updated_at = NOW()`,
            [
                context.sessionId, agentId, context.userId ?? null,
                context.summary ?? null, context.goal ?? null,
                context.plan ? JSON.stringify(context.plan) : null,
                context.progress ? JSON.stringify(context.progress) : null,
            ]
        );
        return context;
    }

    async clear(sessionId: string, agentId = ''): Promise<boolean> {
        await this._init();
        const { rowCount } = await this._pool.query(
            'DELETE FROM session_contexts WHERE session_id = $1 AND agent_id = $2',
            [sessionId, agentId]
        );
        return (rowCount ?? 0) > 0;
    }

    /** Gracefully end the connection pool. Call during shutdown. */
    async close(): Promise<void> {
        await this._pool.end();
    }
}

// ── PostgresLearnedKnowledgeStore ─────────────────────────────────────────────

export class PostgresLearnedKnowledgeStore implements LearnedKnowledgeStore {
    private readonly _pool: PgPool;
    private _initPromise: Promise<void> | undefined;

    constructor(config: PgPoolConfig | string) {
        const Pool = loadPg();
        this._pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
    }

    private _init(): Promise<void> {
        return (this._initPromise ??= this._createTables());
    }

    private async _createTables(): Promise<void> {
        await this._pool.query(`
            CREATE TABLE IF NOT EXISTS learned_knowledge (
                id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
                title      TEXT NOT NULL,
                learning   TEXT NOT NULL,
                context    TEXT,
                tags       JSONB,
                namespace  TEXT NOT NULL DEFAULT 'global',
                agent_id   TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_lk_ns ON learned_knowledge(namespace);
        `);
    }

    async search(query: string, namespace?: string, limit = 10): Promise<LearnedKnowledge[]> {
        await this._init();
        const q = `%${query}%`;
        const params: unknown[] = [q, q, q];
        let sql = `SELECT * FROM learned_knowledge
                   WHERE (title ILIKE $1 OR learning ILIKE $2 OR context ILIKE $3)`;
        if (namespace) { sql += ` AND namespace = $${String(params.length + 1)}`; params.push(namespace); }
        sql += ` ORDER BY updated_at DESC LIMIT $${String(params.length + 1)}`;
        params.push(limit);
        const { rows } = await this._pool.query(sql, params);
        return rows.map((r) => {
            const row = r as Record<string, unknown>;
            return {
                title: row.title as string, learning: row.learning as string,
                context: row.context as string | undefined,
                tags: row.tags as string[] | undefined,
                namespace: row.namespace as string,
                agentId: row.agent_id as string | undefined,
                createdAt: (row.created_at as Date).toISOString(),
                updatedAt: (row.updated_at as Date).toISOString(),
            };
        });
    }

    async save(knowledge: LearnedKnowledge): Promise<LearnedKnowledge> {
        await this._init();
        await this._pool.query(
            `INSERT INTO learned_knowledge (title, learning, context, tags, namespace, agent_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [
                knowledge.title, knowledge.learning, knowledge.context ?? null,
                knowledge.tags ? JSON.stringify(knowledge.tags) : null,
                knowledge.namespace ?? 'global', knowledge.agentId ?? null,
            ]
        );
        return knowledge;
    }

    async delete(title: string, namespace = 'global'): Promise<boolean> {
        await this._init();
        const { rowCount } = await this._pool.query(
            'DELETE FROM learned_knowledge WHERE title = $1 AND namespace = $2',
            [title, namespace]
        );
        return (rowCount ?? 0) > 0;
    }

    /** Gracefully end the connection pool. Call during shutdown. */
    async close(): Promise<void> {
        await this._pool.end();
    }
}

// ── PostgresEntityMemoryStore ─────────────────────────────────────────────────

export class PostgresEntityMemoryStore implements EntityMemoryStore {
    private readonly _pool: PgPool;
    private _initPromise: Promise<void> | undefined;

    constructor(config: PgPoolConfig | string) {
        const Pool = loadPg();
        this._pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
    }

    private _init(): Promise<void> {
        return (this._initPromise ??= this._createTables());
    }

    private async _createTables(): Promise<void> {
        await this._pool.query(`
            CREATE TABLE IF NOT EXISTS entity_memories (
                entity_id     TEXT NOT NULL,
                entity_type   TEXT NOT NULL,
                name          TEXT,
                description   TEXT,
                properties    JSONB,
                facts         JSONB NOT NULL DEFAULT '[]',
                events        JSONB NOT NULL DEFAULT '[]',
                relationships JSONB NOT NULL DEFAULT '[]',
                namespace     TEXT NOT NULL DEFAULT 'global',
                agent_id      TEXT,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (entity_id, namespace)
            );
        `);
    }

    private _rowToEntity(r: Record<string, unknown>): EntityMemory {
        return {
            entityId: r.entity_id as string,
            entityType: r.entity_type as string,
            name: r.name as string | undefined,
            description: r.description as string | undefined,
            properties: r.properties as Record<string, string> | undefined,
            facts: r.facts as EntityFact[],
            events: r.events as EntityEvent[],
            relationships: r.relationships as EntityRelationship[],
            namespace: r.namespace as string,
            agentId: r.agent_id as string | undefined,
            createdAt: (r.created_at as Date).toISOString(),
            updatedAt: (r.updated_at as Date).toISOString(),
        };
    }

    async get(entityId: string, namespace = 'global'): Promise<EntityMemory | null> {
        await this._init();
        const { rows } = await this._pool.query(
            'SELECT * FROM entity_memories WHERE entity_id = $1 AND namespace = $2',
            [entityId, namespace]
        );
        return rows[0] ? this._rowToEntity(rows[0] as Record<string, unknown>) : null;
    }

    async search(query: string, namespace?: string, limit = 10): Promise<EntityMemory[]> {
        await this._init();
        const q = `%${query}%`;
        const params: unknown[] = [q, q, q];
        let sql = `SELECT * FROM entity_memories
                   WHERE (entity_id ILIKE $1 OR name ILIKE $2 OR description ILIKE $3)`;
        if (namespace) { sql += ` AND namespace = $${String(params.length + 1)}`; params.push(namespace); }
        sql += ` ORDER BY updated_at DESC LIMIT $${String(params.length + 1)}`;
        params.push(limit);
        const { rows } = await this._pool.query(sql, params);
        return rows.map((r) => this._rowToEntity(r as Record<string, unknown>));
    }

    async set(entity: EntityMemory): Promise<EntityMemory> {
        await this._init();
        const namespace = entity.namespace ?? 'global';
        await this._pool.query(
            `INSERT INTO entity_memories
             (entity_id, entity_type, name, description, properties, facts, events, relationships, namespace, agent_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, NOW(), NOW())
             ON CONFLICT (entity_id, namespace) DO UPDATE SET
               entity_type = $2, name = $3, description = $4, properties = $5::jsonb,
               facts = $6::jsonb, events = $7::jsonb, relationships = $8::jsonb,
               agent_id = $10, updated_at = NOW()`,
            [
                entity.entityId, entity.entityType,
                entity.name ?? null, entity.description ?? null,
                entity.properties ? JSON.stringify(entity.properties) : null,
                JSON.stringify(entity.facts), JSON.stringify(entity.events),
                JSON.stringify(entity.relationships), namespace, entity.agentId ?? null,
            ]
        );
        return entity;
    }

    async addFact(entityId: string, content: string, namespace = 'global', extra?: Record<string, unknown>): Promise<string> {
        const entity = await this.get(entityId, namespace);
        const base = entity ?? { entityId, entityType: 'unknown', facts: [], events: [], relationships: [], namespace };
        const id = uuid();
        await this.set({ ...base, facts: [...base.facts, { id, content, ...extra }] });
        return id;
    }

    async updateFact(entityId: string, factId: string, content: string, namespace = 'global'): Promise<boolean> {
        const entity = await this.get(entityId, namespace);
        if (!entity) return false;
        await this.set({ ...entity, facts: entity.facts.map((f) => f.id === factId ? { ...f, content } : f) });
        return true;
    }

    async deleteFact(entityId: string, factId: string, namespace = 'global'): Promise<boolean> {
        const entity = await this.get(entityId, namespace);
        if (!entity) return false;
        const before = entity.facts.length;
        await this.set({ ...entity, facts: entity.facts.filter((f) => f.id !== factId) });
        return entity.facts.length < before;
    }

    async addEvent(entityId: string, content: string, date?: string, namespace = 'global'): Promise<string> {
        const entity = await this.get(entityId, namespace);
        const base = entity ?? { entityId, entityType: 'unknown', facts: [], events: [], relationships: [], namespace };
        const id = uuid();
        await this.set({ ...base, events: [...base.events, { id, content, date }] });
        return id;
    }

    async addRelationship(entityId: string, relatedEntityId: string, relation: string, direction: 'outgoing' | 'incoming' = 'outgoing', namespace = 'global'): Promise<string> {
        const entity = await this.get(entityId, namespace);
        const base = entity ?? { entityId, entityType: 'unknown', facts: [], events: [], relationships: [], namespace };
        const id = uuid();
        await this.set({ ...base, relationships: [...base.relationships, { id, entityId: relatedEntityId, relation, direction }] });
        return id;
    }

    async delete(entityId: string, namespace = 'global'): Promise<boolean> {
        await this._init();
        const { rowCount } = await this._pool.query(
            'DELETE FROM entity_memories WHERE entity_id = $1 AND namespace = $2',
            [entityId, namespace]
        );
        return (rowCount ?? 0) > 0;
    }

    /** Gracefully end the connection pool. Call during shutdown. */
    async close(): Promise<void> {
        await this._pool.end();
    }
}

// ── PostgresDecisionLogStore ──────────────────────────────────────────────────

export class PostgresDecisionLogStore implements DecisionLogStore {
    private readonly _pool: PgPool;
    private _initPromise: Promise<void> | undefined;

    constructor(config: PgPoolConfig | string) {
        const Pool = loadPg();
        this._pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
    }

    private _init(): Promise<void> {
        return (this._initPromise ??= this._createTables());
    }

    private async _createTables(): Promise<void> {
        await this._pool.query(`
            CREATE TABLE IF NOT EXISTS decision_logs (
                id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
                decision        TEXT NOT NULL,
                reasoning       TEXT,
                decision_type   TEXT,
                context         TEXT,
                alternatives    JSONB,
                confidence      FLOAT,
                outcome         TEXT,
                outcome_quality TEXT,
                tags            JSONB,
                session_id      TEXT,
                agent_id        TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_dl_agent   ON decision_logs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_dl_session ON decision_logs(session_id);
            CREATE INDEX IF NOT EXISTS idx_dl_created ON decision_logs(created_at);
        `);
    }

    private _rowToLog(r: Record<string, unknown>): DecisionLog {
        return {
            id: r.id as string, decision: r.decision as string,
            reasoning: r.reasoning as string | undefined,
            decisionType: r.decision_type as string | undefined,
            context: r.context as string | undefined,
            alternatives: r.alternatives as string[] | undefined,
            confidence: r.confidence as number | undefined,
            outcome: r.outcome as string | undefined,
            outcomeQuality: r.outcome_quality as DecisionLog['outcomeQuality'],
            tags: r.tags as string[] | undefined,
            sessionId: r.session_id as string | undefined,
            agentId: r.agent_id as string | undefined,
            createdAt: (r.created_at as Date).toISOString(),
        };
    }

    async add(log: Omit<DecisionLog, 'id' | 'createdAt'>): Promise<DecisionLog> {
        await this._init();
        const { rows } = await this._pool.query(
            `INSERT INTO decision_logs (decision, reasoning, decision_type, context, alternatives, confidence, outcome, outcome_quality, tags, session_id, agent_id)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $11) RETURNING *`,
            [
                log.decision, log.reasoning ?? null, log.decisionType ?? null,
                log.context ?? null,
                log.alternatives ? JSON.stringify(log.alternatives) : null,
                log.confidence ?? null, log.outcome ?? null, log.outcomeQuality ?? null,
                log.tags ? JSON.stringify(log.tags) : null,
                log.sessionId ?? null, log.agentId ?? null,
            ]
        );
        return this._rowToLog(rows[0] as Record<string, unknown>);
    }

    async get(id: string): Promise<DecisionLog | null> {
        await this._init();
        const { rows } = await this._pool.query('SELECT * FROM decision_logs WHERE id = $1', [id]);
        return rows[0] ? this._rowToLog(rows[0] as Record<string, unknown>) : null;
    }

    async list(agentId?: string, sessionId?: string, limit = 100): Promise<DecisionLog[]> {
        await this._init();
        const where: string[] = [];
        const params: unknown[] = [];
        if (agentId) { where.push(`agent_id = $${String(params.length + 1)}`); params.push(agentId); }
        if (sessionId) { where.push(`session_id = $${String(params.length + 1)}`); params.push(sessionId); }
        const sql = `SELECT * FROM decision_logs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${String(params.length + 1)}`;
        params.push(limit);
        const { rows } = await this._pool.query(sql, params);
        return rows.map((r) => this._rowToLog(r as Record<string, unknown>));
    }

    async search(query: string, agentId?: string, limit = 20): Promise<DecisionLog[]> {
        await this._init();
        const q = `%${query}%`;
        const params: unknown[] = [q, q, q];
        let sql = `SELECT * FROM decision_logs WHERE (decision ILIKE $1 OR reasoning ILIKE $2 OR context ILIKE $3)`;
        if (agentId) { sql += ` AND agent_id = $${String(params.length + 1)}`; params.push(agentId); }
        sql += ` ORDER BY created_at DESC LIMIT $${String(params.length + 1)}`;
        params.push(limit);
        const { rows } = await this._pool.query(sql, params);
        return rows.map((r) => this._rowToLog(r as Record<string, unknown>));
    }

    async update(id: string, updates: Partial<Pick<DecisionLog, 'outcome' | 'outcomeQuality'>>): Promise<boolean> {
        await this._init();
        const parts: string[] = [];
        const params: unknown[] = [];
        if (updates.outcome !== undefined) { parts.push(`outcome = $${String(params.length + 1)}`); params.push(updates.outcome); }
        if (updates.outcomeQuality !== undefined) { parts.push(`outcome_quality = $${String(params.length + 1)}`); params.push(updates.outcomeQuality); }
        if (!parts.length) return false;
        params.push(id);
        const { rowCount } = await this._pool.query(
            `UPDATE decision_logs SET ${parts.join(', ')} WHERE id = $${String(params.length)}`, params
        );
        return (rowCount ?? 0) > 0;
    }

    async delete(id: string): Promise<boolean> {
        await this._init();
        const { rowCount } = await this._pool.query('DELETE FROM decision_logs WHERE id = $1', [id]);
        return (rowCount ?? 0) > 0;
    }

    async prune(agentId?: string, maxAgeDays = 30): Promise<number> {
        await this._init();
        const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000);
        const params: unknown[] = [cutoff];
        let sql = 'DELETE FROM decision_logs WHERE created_at < $1';
        if (agentId) { sql += ` AND agent_id = $${String(params.length + 1)}`; params.push(agentId); }
        const { rowCount } = await this._pool.query(sql, params);
        return rowCount ?? 0;
    }

    /** Gracefully end the connection pool. Call during shutdown. */
    async close(): Promise<void> {
        await this._pool.end();
    }
}

/** Connection config for Postgres learning stores. */
export type PgLearningStoreConfig = PgPoolConfig | string;
