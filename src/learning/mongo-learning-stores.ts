/**
 * MongoDB-backed learning stores for all extended learning store types.
 *
 * SRP  — each class owns exactly one concern.
 * DIP  — each class implements the corresponding store interface.
 * Lazy — mongodb driver is loaded inside each factory; zero cost if unused.
 */

import type {
    UserMemory, UserMemoryEntry, UserMemoryStore,
    SessionContext, SessionContextStore,
    LearnedKnowledge, LearnedKnowledgeStore,
    EntityMemory, EntityFact, EntityEvent, EntityRelationship, EntityMemoryStore,
    DecisionLog, DecisionLogStore,
} from './types.js';

// ── Minimal mongodb typing ────────────────────────────────────────────────────

const MISSING_SDK =
    '[personaforge] MongoDB learning stores require the `mongodb` package.\n' +
    '  Install: npm install mongodb';

interface MongoCollection<T = Record<string, unknown>> {
    findOne(filter: Record<string, unknown>): Promise<T | null>;
    find(filter: Record<string, unknown>, opts?: Record<string, unknown>): { toArray(): Promise<T[]> };
    insertOne(doc: T): Promise<{ insertedId: unknown }>;
    replaceOne(filter: Record<string, unknown>, doc: T, opts?: { upsert?: boolean }): Promise<{ modifiedCount: number; upsertedCount: number }>;
    updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }): Promise<{ modifiedCount: number }>;
    deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
    deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
    createIndex(spec: Record<string, unknown>, opts?: Record<string, unknown>): Promise<string>;
}
interface MongoDb {
    collection<T = Record<string, unknown>>(name: string): MongoCollection<T>;
}
interface MongoClient {
    connect(): Promise<this>;
    db(name?: string): MongoDb;
}
type MongoClientCtor = new (uri: string, opts?: Record<string, unknown>) => MongoClient;

function loadMongo(): MongoClientCtor {
    try {
        const m = require('mongodb') as { MongoClient: MongoClientCtor };
        return m.MongoClient;
    } catch {
        throw new Error(MISSING_SDK);
    }
}

function uuid(): string {
    return crypto.randomUUID();
}

export interface MongoLearningConfig {
    /** MongoDB connection URI */
    uri: string;
    /** Database name. Default: 'agent_learning' */
    database?: string;
}

// ── MongoUserMemoryStore ──────────────────────────────────────────────────────

export class MongoUserMemoryStore implements UserMemoryStore {
    private _client: MongoClient | null = null;
    private _db: MongoDb | null = null;
    private readonly _uri: string;
    private readonly _dbName: string;

    constructor(config: MongoLearningConfig | string) {
        if (typeof config === 'string') { this._uri = config; this._dbName = 'agent_learning'; }
        else { this._uri = config.uri; this._dbName = config.database ?? 'agent_learning'; }
        loadMongo(); // validate SDK available at construction
    }

    private async _col(): Promise<MongoCollection> {
        if (!this._client) {
            const Ctor = loadMongo();
            this._client = await new Ctor(this._uri).connect();
            this._db = this._client.db(this._dbName);
            const col = this._db.collection('user_memories');
            await col.createIndex({ userId: 1, agentId: 1 }, { unique: true });
        }
        return this._db!.collection('user_memories');
    }

    async get(userId: string, agentId = ''): Promise<UserMemory | null> {
        const col = await this._col();
        const doc = await col.findOne({ userId, agentId });
        if (!doc) return null;
        const d = doc as unknown as UserMemory & { agentId: string };
        return { ...d, agentId: d.agentId || undefined };
    }

    async set(memory: UserMemory): Promise<UserMemory> {
        const col = await this._col();
        const agentId = memory.agentId ?? '';
        const now = new Date().toISOString();
        await col.replaceOne(
            { userId: memory.userId, agentId },
            { ...memory, agentId, updatedAt: now },
            { upsert: true }
        );
        return { ...memory, updatedAt: now };
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
        const col = await this._col();
        await col.deleteOne({ userId, agentId });
    }
}

// ── MongoSessionContextStore ──────────────────────────────────────────────────

export class MongoSessionContextStore implements SessionContextStore {
    private _client: MongoClient | null = null;
    private _db: MongoDb | null = null;
    private readonly _uri: string;
    private readonly _dbName: string;

    constructor(config: MongoLearningConfig | string) {
        if (typeof config === 'string') { this._uri = config; this._dbName = 'agent_learning'; }
        else { this._uri = config.uri; this._dbName = config.database ?? 'agent_learning'; }
    }

    private async _col(): Promise<MongoCollection> {
        if (!this._client) {
            const Ctor = loadMongo();
            this._client = await new Ctor(this._uri).connect();
            this._db = this._client.db(this._dbName);
            const col = this._db.collection('session_contexts');
            await col.createIndex({ sessionId: 1, agentId: 1 }, { unique: true });
        }
        return this._db!.collection('session_contexts');
    }

    async get(sessionId: string, agentId = ''): Promise<SessionContext | null> {
        const col = await this._col();
        const doc = await col.findOne({ sessionId, agentId });
        if (!doc) return null;
        const d = doc as unknown as SessionContext & { agentId: string };
        return { ...d, agentId: d.agentId || undefined };
    }

    async set(context: SessionContext): Promise<SessionContext> {
        const col = await this._col();
        const agentId = context.agentId ?? '';
        const now = new Date().toISOString();
        await col.replaceOne(
            { sessionId: context.sessionId, agentId },
            { ...context, agentId, updatedAt: now },
            { upsert: true }
        );
        return { ...context, updatedAt: now };
    }

    async clear(sessionId: string, agentId = ''): Promise<boolean> {
        const col = await this._col();
        const { deletedCount } = await col.deleteOne({ sessionId, agentId });
        return deletedCount > 0;
    }
}

// ── MongoLearnedKnowledgeStore ────────────────────────────────────────────────

export class MongoLearnedKnowledgeStore implements LearnedKnowledgeStore {
    private _client: MongoClient | null = null;
    private _db: MongoDb | null = null;
    private readonly _uri: string;
    private readonly _dbName: string;

    constructor(config: MongoLearningConfig | string) {
        if (typeof config === 'string') { this._uri = config; this._dbName = 'agent_learning'; }
        else { this._uri = config.uri; this._dbName = config.database ?? 'agent_learning'; }
    }

    private async _col(): Promise<MongoCollection> {
        if (!this._client) {
            const Ctor = loadMongo();
            this._client = await new Ctor(this._uri).connect();
            this._db = this._client.db(this._dbName);
            const col = this._db.collection('learned_knowledge');
            await col.createIndex({ title: 1, namespace: 1 });
        }
        return this._db!.collection('learned_knowledge');
    }

    async search(query: string, namespace?: string, limit = 10): Promise<LearnedKnowledge[]> {
        const col = await this._col();
        const filter: Record<string, unknown> = {
            $or: [
                { title: { $regex: query, $options: 'i' } },
                { learning: { $regex: query, $options: 'i' } },
                { context: { $regex: query, $options: 'i' } },
            ],
        };
        if (namespace) filter['namespace'] = namespace;
        const docs = await col.find(filter, { sort: { updatedAt: -1 }, limit } as Record<string, unknown>).toArray();
        return docs.map((d) => {
            const doc = d as unknown as LearnedKnowledge;
            return doc;
        });
    }

    async save(knowledge: LearnedKnowledge): Promise<LearnedKnowledge> {
        const col = await this._col();
        const now = new Date().toISOString();
        const doc = { ...knowledge, namespace: knowledge.namespace ?? 'global', updatedAt: now };
        await col.updateOne(
            { title: knowledge.title, namespace: doc.namespace },
            { $set: doc, $setOnInsert: { createdAt: now } },
            { upsert: true }
        );
        return doc;
    }

    async delete(title: string, namespace = 'global'): Promise<boolean> {
        const col = await this._col();
        const { deletedCount } = await col.deleteOne({ title, namespace });
        return deletedCount > 0;
    }
}

// ── MongoEntityMemoryStore ────────────────────────────────────────────────────

export class MongoEntityMemoryStore implements EntityMemoryStore {
    private _client: MongoClient | null = null;
    private _db: MongoDb | null = null;
    private readonly _uri: string;
    private readonly _dbName: string;

    constructor(config: MongoLearningConfig | string) {
        if (typeof config === 'string') { this._uri = config; this._dbName = 'agent_learning'; }
        else { this._uri = config.uri; this._dbName = config.database ?? 'agent_learning'; }
    }

    private async _col(): Promise<MongoCollection> {
        if (!this._client) {
            const Ctor = loadMongo();
            this._client = await new Ctor(this._uri).connect();
            this._db = this._client.db(this._dbName);
            const col = this._db.collection('entity_memories');
            await col.createIndex({ entityId: 1, namespace: 1 }, { unique: true });
        }
        return this._db!.collection('entity_memories');
    }

    async get(entityId: string, namespace = 'global'): Promise<EntityMemory | null> {
        const col = await this._col();
        const doc = await col.findOne({ entityId, namespace });
        return doc ? (doc as unknown as EntityMemory) : null;
    }

    async search(query: string, namespace?: string, limit = 10): Promise<EntityMemory[]> {
        const col = await this._col();
        const filter: Record<string, unknown> = {
            $or: [
                { entityId: { $regex: query, $options: 'i' } },
                { name: { $regex: query, $options: 'i' } },
                { description: { $regex: query, $options: 'i' } },
            ],
        };
        if (namespace) filter['namespace'] = namespace;
        const docs = await col.find(filter, { sort: { updatedAt: -1 }, limit } as Record<string, unknown>).toArray();
        return docs.map((d) => d as unknown as EntityMemory);
    }

    async set(entity: EntityMemory): Promise<EntityMemory> {
        const col = await this._col();
        const namespace = entity.namespace ?? 'global';
        const now = new Date().toISOString();
        await col.replaceOne(
            { entityId: entity.entityId, namespace },
            { ...entity, namespace, updatedAt: now } as Record<string, unknown>,
            { upsert: true }
        );
        return entity;
    }

    private async _getOrCreate(entityId: string, namespace: string): Promise<EntityMemory> {
        return await this.get(entityId, namespace) ?? {
            entityId, entityType: 'unknown', namespace,
            facts: [], events: [], relationships: [],
        };
    }

    async addFact(entityId: string, content: string, namespace = 'global', extra?: Record<string, unknown>): Promise<string> {
        const entity = await this._getOrCreate(entityId, namespace);
        const id = uuid();
        await this.set({ ...entity, facts: [...entity.facts, { id, content, ...extra } as EntityFact] });
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
        const entity = await this._getOrCreate(entityId, namespace);
        const id = uuid();
        await this.set({ ...entity, events: [...entity.events, { id, content, date } as EntityEvent] });
        return id;
    }

    async addRelationship(entityId: string, relatedEntityId: string, relation: string, direction: 'outgoing' | 'incoming' = 'outgoing', namespace = 'global'): Promise<string> {
        const entity = await this._getOrCreate(entityId, namespace);
        const id = uuid();
        await this.set({ ...entity, relationships: [...entity.relationships, { id, entityId: relatedEntityId, relation, direction } as EntityRelationship] });
        return id;
    }

    async delete(entityId: string, namespace = 'global'): Promise<boolean> {
        const col = await this._col();
        const { deletedCount } = await col.deleteOne({ entityId, namespace });
        return deletedCount > 0;
    }
}

// ── MongoDecisionLogStore ─────────────────────────────────────────────────────

export class MongoDecisionLogStore implements DecisionLogStore {
    private _client: MongoClient | null = null;
    private _db: MongoDb | null = null;
    private readonly _uri: string;
    private readonly _dbName: string;

    constructor(config: MongoLearningConfig | string) {
        if (typeof config === 'string') { this._uri = config; this._dbName = 'agent_learning'; }
        else { this._uri = config.uri; this._dbName = config.database ?? 'agent_learning'; }
    }

    private async _col(): Promise<MongoCollection> {
        if (!this._client) {
            const Ctor = loadMongo();
            this._client = await new Ctor(this._uri).connect();
            this._db = this._client.db(this._dbName);
            const col = this._db.collection('decision_logs');
            await col.createIndex({ agentId: 1 });
            await col.createIndex({ sessionId: 1 });
            await col.createIndex({ createdAt: -1 });
        }
        return this._db!.collection('decision_logs');
    }

    async add(log: Omit<DecisionLog, 'id' | 'createdAt'>): Promise<DecisionLog> {
        const col = await this._col();
        const entry: DecisionLog = { ...log, id: uuid(), createdAt: new Date().toISOString() };
        await col.insertOne(entry as unknown as Record<string, unknown>);
        return entry;
    }

    async get(id: string): Promise<DecisionLog | null> {
        const col = await this._col();
        const doc = await col.findOne({ id });
        return doc ? (doc as unknown as DecisionLog) : null;
    }

    async list(agentId?: string, sessionId?: string, limit = 100): Promise<DecisionLog[]> {
        const col = await this._col();
        const filter: Record<string, unknown> = {};
        if (agentId) filter['agentId'] = agentId;
        if (sessionId) filter['sessionId'] = sessionId;
        const docs = await col.find(filter, { sort: { createdAt: -1 }, limit } as Record<string, unknown>).toArray();
        return docs.map((d) => d as unknown as DecisionLog);
    }

    async search(query: string, agentId?: string, limit = 20): Promise<DecisionLog[]> {
        const col = await this._col();
        const filter: Record<string, unknown> = {
            $or: [
                { decision: { $regex: query, $options: 'i' } },
                { reasoning: { $regex: query, $options: 'i' } },
                { context: { $regex: query, $options: 'i' } },
            ],
        };
        if (agentId) filter['agentId'] = agentId;
        const docs = await col.find(filter, { sort: { createdAt: -1 }, limit } as Record<string, unknown>).toArray();
        return docs.map((d) => d as unknown as DecisionLog);
    }

    async update(id: string, updates: Partial<Pick<DecisionLog, 'outcome' | 'outcomeQuality'>>): Promise<boolean> {
        const col = await this._col();
        const { modifiedCount } = await col.updateOne({ id }, { $set: updates });
        return modifiedCount > 0;
    }

    async delete(id: string): Promise<boolean> {
        const col = await this._col();
        const { deletedCount } = await col.deleteOne({ id });
        return deletedCount > 0;
    }

    async prune(agentId?: string, maxAgeDays = 30): Promise<number> {
        const col = await this._col();
        const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
        const filter: Record<string, unknown> = { createdAt: { $lt: cutoff } };
        if (agentId) filter['agentId'] = agentId;
        const { deletedCount } = await col.deleteMany(filter);
        return deletedCount;
    }
}
