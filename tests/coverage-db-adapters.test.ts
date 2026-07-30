/**
 * Hermetic coverage for RedisAgentDb with an injected fake ioredis client.
 * Also asserts missing peer deps for mysql/postgres/mongo constructors.
 *
 * Callers: vitest only via tests coverage glob.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Module from 'node:module';
import { RedisAgentDb } from '../src/db/redis.js';
import { MysqlAgentDb } from '../src/db/mysql.js';
import { PostgresAgentDb } from '../src/db/postgres.js';
import { MongoAgentDb } from '../src/db/mongo.js';

type Hash = Record<string, string>;

class FakeRedis {
    private hashes = new Map<string, Hash>();
    private sets = new Map<string, Set<string>>();

    constructor(_url?: string) {}

    async hset(key: string, ...fieldValues: (string | number)[]): Promise<number> {
        const h = this.hashes.get(key) ?? {};
        for (let i = 0; i < fieldValues.length; i += 2) {
            h[String(fieldValues[i])] = String(fieldValues[i + 1] ?? '');
        }
        this.hashes.set(key, h);
        return fieldValues.length / 2;
    }

    async hgetall(key: string): Promise<Hash | null> {
        return this.hashes.get(key) ?? null;
    }

    async del(...keys: string[]): Promise<number> {
        let n = 0;
        for (const k of keys) {
            if (this.hashes.delete(k)) n++;
            this.sets.delete(k);
        }
        return n;
    }

    async smembers(key: string): Promise<string[]> {
        return [...(this.sets.get(key) ?? new Set())];
    }

    async sadd(key: string, ...members: string[]): Promise<number> {
        const s = this.sets.get(key) ?? new Set();
        let added = 0;
        for (const m of members) {
            if (!s.has(m)) {
                s.add(m);
                added++;
            }
        }
        this.sets.set(key, s);
        return added;
    }

    async srem(key: string, ...members: string[]): Promise<number> {
        const s = this.sets.get(key);
        if (!s) return 0;
        let n = 0;
        for (const m of members) {
            if (s.delete(m)) n++;
        }
        return n;
    }

    async quit(): Promise<string> {
        return 'OK';
    }
}

describe('RedisAgentDb with mocked ioredis', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Mod = Module as any;
    const originalLoad = Mod._load as (...args: unknown[]) => unknown;

    beforeEach(() => {
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === 'ioredis') return FakeRedis;
            return originalLoad.call(this, request, parent, isMain);
        };
    });

    afterEach(() => {
        Mod._load = originalLoad;
    });

    it('covers sessions/memories/learnings/knowledge/traces/schedules', async () => {
        const db = new RedisAgentDb({ url: 'redis://fake', prefix: 't' });
        expect(db.type).toBe('redis');
        await db.init();
        await db.init();

        const s = await db.upsertSession({
            sessionId: 's1',
            agentId: 'a1',
            userId: 'u1',
            sessionData: { messages: [] },
            metadata: { k: 1 },
        });
        expect(s.session_id).toBe('s1');
        expect(await db.getSession('s1', 'u1')).toBeTruthy();
        expect(await db.getSession('s1', 'other')).toBeNull();
        expect(await db.getSession('missing')).toBeNull();

        await db.upsertSession({
            sessionId: 's2',
            agentId: 'a2',
            userId: 'u2',
            teamId: 'tm',
            workflowId: 'wf',
        });
        expect(
            (await db.getSessions({ agentId: 'a1', userId: 'u1', sessionType: 'agent', limit: 5 })).length,
        ).toBe(1);
        expect((await db.renameSession('s1', 'Named', 'u1'))?.session_data).toContain('Named');
        expect(await db.renameSession('nope', 'x')).toBeNull();
        expect(await db.deleteSession('s2', 'wrong')).toBe(false);
        expect(await db.deleteSession('s2', 'u2')).toBe(true);

        const m = await db.upsertMemory({
            memory: 'hello cats',
            userId: 'u1',
            agentId: 'a1',
            topics: ['t'],
        });
        expect(await db.getMemory(m.memory_id, 'u1')).toBeTruthy();
        expect(await db.getMemory(m.memory_id, 'x')).toBeNull();
        expect((await db.getMemories({ userId: 'u1', search: 'cats', limit: 5 })).length).toBeGreaterThan(0);
        expect(await db.deleteMemory(m.memory_id, 'u1')).toBe(true);
        await db.upsertMemory({ memoryId: 'm2', memory: 'x', userId: 'u1' });
        await db.clearMemories('u1');
        await db.upsertMemory({ memory: 'y', userId: 'u2' });
        await db.clearMemories();

        await db.upsertLearning({
            id: 'l1',
            learningType: 'user_memory',
            content: { a: 1 },
            userId: 'u1',
            agentId: 'a1',
            namespace: 'ns',
        });
        expect(await db.getLearning({ learningType: 'user_memory', userId: 'u1' })).toBeTruthy();
        expect((await db.getLearnings({ learningType: 'user_memory', limit: 10 })).length).toBe(1);
        expect(await db.deleteLearning('l1')).toBe(true);

        await db.upsertKnowledge({
            id: 'k1',
            content: 'doc',
            linkedTo: 'default',
            status: 'ready',
            metadata: { a: 1 },
        });
        expect(await db.getKnowledge('k1')).toBeTruthy();
        const [items, total] = await db.getKnowledgeItems({ linkedTo: 'default', status: 'ready' });
        expect(total).toBeGreaterThanOrEqual(1);
        expect(items[0]?.id).toBe('k1');
        expect(await db.deleteKnowledge('k1')).toBe(true);

        await db.upsertTrace({
            trace_id: 't1',
            session_id: 's1',
            agent_id: 'a1',
            user_id: 'u1',
            status: 'ok',
        });
        expect(await db.getTrace('t1')).toBeTruthy();
        const [traces] = await db.getTraces({ sessionId: 's1', agentId: 'a1', userId: 'u1', limit: 5 });
        expect(traces[0]?.trace_id).toBe('t1');

        const sch = await db.createSchedule({
            id: 'sch1',
            name: 'job',
            enabled: true,
            cron: '* * * * *',
            agent_id: 'a1',
        });
        expect(sch.id).toBe('sch1');
        expect(await db.getSchedule('sch1')).toBeTruthy();
        expect((await db.getSchedules({ enabled: true, limit: 5 })).length).toBe(1);
        expect((await db.updateSchedule('sch1', { enabled: false }))?.enabled).toBe(false);
        expect(await db.updateSchedule('missing', {})).toBeNull();
        expect(await db.deleteSchedule('sch1')).toBe(true);

        expect(db.toDict()).toMatchObject({ type: 'redis' });
        await db.close();
    });
});

describe('SQL/NoSQL adapters with Module._load mocks', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Mod = Module as any;
    const originalLoad = Mod._load as (...args: unknown[]) => unknown;
    let mode: 'mysql' | 'pg' | 'mongo' | null = null;

    /** Minimal in-memory table keyed by primary id extracted from SQL params. */
    const sqlStore = new Map<string, Record<string, unknown>>();

    function makeMysqlPool() {
        return {
            async execute(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
                const s = sql.replace(/\s+/g, ' ').trim();
                if (/^CREATE TABLE/i.test(s) || /^CREATE INDEX/i.test(s)) return [[], {}];
                if (/^INSERT/i.test(s) && /agent_sessions/i.test(s)) {
                    const row = {
                        session_id: params[0],
                        session_type: params[1],
                        agent_id: params[2],
                        team_id: params[3],
                        workflow_id: params[4],
                        user_id: params[5],
                        agent_data: params[6],
                        team_data: params[7],
                        workflow_data: params[8],
                        session_data: params[9],
                        metadata: params[10],
                        runs: params[11],
                        summary: params[12],
                        created_at: params[13],
                        updated_at: params[14],
                    };
                    sqlStore.set(`sess:${params[0]}`, row);
                    return [[], { affectedRows: 1 }];
                }
                if (/SELECT created_at FROM/i.test(s)) {
                    const id = params[0];
                    const row = sqlStore.get(`sess:${id}`);
                    return [row ? [{ created_at: row['created_at'] }] : [], {}];
                }
                if (/SELECT \* FROM .*sessions WHERE session_id/i.test(s)) {
                    const row = sqlStore.get(`sess:${params[0]}`);
                    if (!row) return [[], {}];
                    if (params[1] !== undefined && row['user_id'] !== params[1]) return [[], {}];
                    return [[row], {}];
                }
                if (/SELECT \* FROM .*sessions/i.test(s)) {
                    return [[...sqlStore.values()].filter((r) => r['session_id']), {}];
                }
                if (/^DELETE FROM .*sessions/i.test(s)) {
                    const ok = sqlStore.delete(`sess:${params[0]}`);
                    return [{ affectedRows: ok ? 1 : 0 }, {}];
                }
                if (/^UPDATE .*sessions SET session_data/i.test(s)) {
                    const row = sqlStore.get(`sess:${params[2]}`);
                    if (row) {
                        row['session_data'] = params[0];
                        row['updated_at'] = params[1];
                    }
                    return [[], { affectedRows: 1 }];
                }
                // memories / learnings / knowledge / traces / schedules — accept writes
                if (/^INSERT|^UPDATE|^DELETE|^SELECT|^CREATE/i.test(s)) {
                    if (/SELECT/i.test(s) && !/created_at/i.test(s)) return [[], {}];
                    return [[], { affectedRows: 1 }];
                }
                return [[], {}];
            },
            async end() {},
        };
    }

    function makePgPool() {
        const versions: number[] = [];
        return {
            async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
                const s = sql.replace(/\s+/g, ' ').trim();
                if (/schema_version/i.test(s) && /CREATE TABLE/i.test(s)) return { rows: [] };
                if (/SELECT version FROM schema_version/i.test(s)) {
                    return { rows: versions.map((version) => ({ version })) };
                }
                if (/INSERT INTO schema_version/i.test(s)) {
                    versions.push(Number(params[0]));
                    return { rows: [] };
                }
                if (/^CREATE |^ALTER /i.test(s)) return { rows: [] };
                if (/SELECT created_at FROM/i.test(s)) {
                    const row = sqlStore.get(`pgsess:${params[0]}`);
                    return { rows: row ? [{ created_at: row['created_at'] }] : [] };
                }
                if (/INSERT INTO .*sessions/i.test(s)) {
                    const row = {
                        session_id: params[0],
                        session_type: params[1],
                        agent_id: params[2],
                        team_id: params[3],
                        workflow_id: params[4],
                        user_id: params[5],
                        agent_data: params[6],
                        team_data: params[7],
                        workflow_data: params[8],
                        session_data: params[9],
                        metadata: params[10],
                        runs: params[11],
                        summary: params[12],
                        created_at: params[13],
                        updated_at: params[14],
                    };
                    sqlStore.set(`pgsess:${params[0]}`, row);
                    return { rows: [] };
                }
                if (/SELECT \* FROM .*sessions WHERE session_id/i.test(s)) {
                    const row = sqlStore.get(`pgsess:${params[0]}`);
                    if (!row) return { rows: [] };
                    if (params[1] !== undefined && row['user_id'] !== params[1]) return { rows: [] };
                    return { rows: [row] };
                }
                if (/SELECT \* FROM .*sessions/i.test(s)) {
                    return { rows: [...sqlStore.values()].filter((r) => String(r['session_id'] ?? '').length) };
                }
                if (/DELETE FROM .*sessions/i.test(s)) {
                    const row = sqlStore.get(`pgsess:${params[0]}`);
                    sqlStore.delete(`pgsess:${params[0]}`);
                    return { rows: row ? [{ session_id: params[0] }] : [] };
                }
                return { rows: [] };
            },
            async end() {},
        };
    }

    class FakeMongoCollection {
        private docs = new Map<string, Record<string, unknown>>();
        constructor(private readonly keyField: string) {}
        async createIndex() {
            return 'ok';
        }
        async findOne(filter: Record<string, unknown>) {
            for (const d of this.docs.values()) {
                if (Object.entries(filter).every(([k, v]) => d[k] === v)) return { ...d };
            }
            return null;
        }
        find(filter: Record<string, unknown>) {
            const matched = [...this.docs.values()].filter((d) =>
                Object.entries(filter).every(([k, v]) => {
                    if (v && typeof v === 'object' && '$regex' in (v as object)) {
                        const re = new RegExp(String((v as { $regex: string }).$regex), 'i');
                        return re.test(String(d[k] ?? ''));
                    }
                    return d[k] === v;
                }),
            );
            const api = {
                sort: () => api,
                limit: () => api,
                skip: () => api,
                toArray: async () => matched.map((d) => ({ ...d })),
            };
            return api;
        }
        async updateOne(filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
            const existing = await this.findOne(filter);
            const id = String(
                filter[this.keyField] ?? update.$set[this.keyField] ?? crypto.randomUUID(),
            );
            const next = { ...(existing ?? {}), ...update.$set };
            this.docs.set(id, next);
            return { acknowledged: true };
        }
        async deleteOne(filter: Record<string, unknown>) {
            for (const [id, d] of this.docs) {
                if (Object.entries(filter).every(([k, v]) => d[k] === v)) {
                    this.docs.delete(id);
                    return { deletedCount: 1 };
                }
            }
            return { deletedCount: 0 };
        }
        async deleteMany() {
            this.docs.clear();
            return { deletedCount: 0 };
        }
        async insertOne(doc: Record<string, unknown>) {
            const id = String(doc[this.keyField] ?? crypto.randomUUID());
            this.docs.set(id, doc);
            return { acknowledged: true };
        }
        async countDocuments(filter: Record<string, unknown> = {}) {
            return [...this.docs.values()].filter((d) =>
                Object.entries(filter).every(([k, v]) => d[k] === v),
            ).length;
        }
    }

    class FakeMongoClient {
        private cols = new Map<string, FakeMongoCollection>();
        constructor(_url: string) {}
        async connect() {}
        async close() {}
        db() {
            return {
                collection: (name: string) => {
                    if (!this.cols.has(name)) {
                        const key =
                            name.includes('session')
                                ? 'session_id'
                                : name.includes('memor')
                                  ? 'memory_id'
                                  : name.includes('learn')
                                    ? 'learning_id'
                                    : name.includes('trace')
                                      ? 'trace_id'
                                      : name.includes('schedule')
                                        ? 'id'
                                        : 'id';
                        this.cols.set(name, new FakeMongoCollection(key));
                    }
                    return this.cols.get(name)!;
                },
            };
        }
    }

    beforeEach(() => {
        sqlStore.clear();
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (mode === 'mysql' && request === 'mysql2/promise') {
                return { createPool: () => makeMysqlPool() };
            }
            if (mode === 'pg' && request === 'pg') {
                return { Pool: class {
                    constructor() {
                        return makePgPool();
                    }
                } };
            }
            if (mode === 'mongo' && request === 'mongodb') {
                return { MongoClient: FakeMongoClient };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
    });

    afterEach(() => {
        mode = null;
        Mod._load = originalLoad;
    });

    it('MysqlAgentDb session CRUD via mocked mysql2', async () => {
        mode = 'mysql';
        const db = new MysqlAgentDb({ host: 'localhost', database: 't' });
        await db.init();
        const row = await db.upsertSession({
            sessionId: 's1',
            agentId: 'a1',
            userId: 'u1',
            sessionData: { messages: [] },
        });
        expect(row.session_id).toBe('s1');
        expect(await db.getSession('s1', 'u1')).toBeTruthy();
        expect((await db.getSessions({ agentId: 'a1' })).length).toBeGreaterThan(0);
        expect((await db.renameSession('s1', 'N', 'u1'))?.session_data).toContain('N');
        expect(await db.deleteSession('s1', 'u1')).toBe(true);
        await db.close();
    });

    it('PostgresAgentDb session CRUD via mocked pg', async () => {
        mode = 'pg';
        const db = new PostgresAgentDb({ connectionString: 'postgres://x' });
        await db.init();
        const row = await db.upsertSession({
            sessionId: 's1',
            agentId: 'a1',
            userId: 'u1',
            sessionData: { messages: [] },
        });
        expect(row.session_id).toBe('s1');
        expect(await db.getSession('s1', 'u1')).toBeTruthy();
        expect((await db.getSessions({ userId: 'u1', limit: 5 })).length).toBeGreaterThan(0);
        expect(await db.deleteSession('s1', 'u1')).toBe(true);
        await db.close();
    });

    it('MongoAgentDb session/memory CRUD via mocked mongodb', async () => {
        mode = 'mongo';
        const db = new MongoAgentDb({ url: 'mongodb://fake', database: 't' });
        await db.init();
        const s = await db.upsertSession({
            sessionId: 's1',
            agentId: 'a1',
            userId: 'u1',
            sessionData: { messages: [] },
        });
        expect(s.session_id).toBe('s1');
        expect(await db.getSession('s1', 'u1')).toBeTruthy();
        expect((await db.getSessions({ agentId: 'a1' })).length).toBe(1);
        expect((await db.renameSession('s1', 'Named', 'u1'))?.session_data).toContain('Named');

        const m = await db.upsertMemory({ memory: 'cats', userId: 'u1', agentId: 'a1' });
        expect(await db.getMemory(m.memory_id, 'u1')).toBeTruthy();
        expect((await db.getMemories({ userId: 'u1', search: 'cat' })).length).toBeGreaterThan(0);
        expect(await db.deleteMemory(m.memory_id, 'u1')).toBe(true);

        await db.upsertLearning({ id: 'l1', learningType: 'x', content: { a: 1 }, userId: 'u1' });
        expect(await db.getLearning({ learningType: 'x', userId: 'u1' })).toBeTruthy();
        expect(await db.deleteLearning('l1')).toBe(true);

        await db.upsertKnowledge({ id: 'k1', content: 'c', linkedTo: 'd', status: 'ready' });
        expect(await db.getKnowledge('k1')).toBeTruthy();
        expect(await db.deleteKnowledge('k1')).toBe(true);

        await db.upsertTrace({ trace_id: 't1', session_id: 's1', agent_id: 'a1', user_id: 'u1' });
        expect(await db.getTrace('t1')).toBeTruthy();

        const sch = await db.createSchedule({ id: 'sch1', name: 'n', enabled: true });
        expect(await db.getSchedule('sch1')).toBeTruthy();
        expect((await db.updateSchedule('sch1', { enabled: false }))?.enabled).toBe(false);
        expect(await db.deleteSchedule('sch1')).toBe(true);

        expect(await db.deleteSession('s1', 'u1')).toBe(true);
        await db.close();
    });
});

describe('SqliteAgentDb (:memory:)', () => {
    it('covers full CRUD hermetically', async () => {
        const { SqliteAgentDb } = await import('../src/db/sqlite.js');
        const db = new SqliteAgentDb({ path: ':memory:' });
        expect(db.type).toBe('sqlite');
        await db.init();
        await db.init();

        await db.upsertSession({
            sessionId: 's1',
            agentId: 'a1',
            userId: 'u1',
            teamId: 'tm',
            workflowId: 'wf',
            sessionData: { messages: [] },
            agentData: { x: 1 },
            metadata: { k: 1 },
            runs: [{ id: 1 }],
            summary: 'sum',
        });
        expect(await db.getSession('s1', 'u1')).toBeTruthy();
        expect(await db.getSession('s1', 'other')).toBeNull();
        expect((await db.getSessions({ agentId: 'a1', teamId: 'tm', workflowId: 'wf', limit: 5 })).length).toBe(1);
        expect((await db.renameSession('s1', 'Named', 'u1'))?.session_data).toContain('Named');
        expect(await db.renameSession('missing', 'x')).toBeNull();

        const m = await db.upsertMemory({
            memory: 'cats like fish',
            userId: 'u1',
            agentId: 'a1',
            topics: ['pets'],
            input: 'q',
            feedback: 'ok',
        });
        expect(await db.getMemory(m.memory_id, 'u1')).toBeTruthy();
        expect((await db.getMemories({ userId: 'u1', search: 'cats', topics: ['pets'], limit: 5 })).length).toBeGreaterThan(0);
        expect(await db.deleteMemory(m.memory_id, 'wrong')).toBe(false);
        expect(await db.deleteMemory(m.memory_id, 'u1')).toBe(true);
        await db.clearMemories('u1');
        await db.upsertMemory({ memory: 'x', userId: 'u2' });
        await db.clearMemories();

        await db.upsertLearning({
            id: 'l1',
            learningType: 'user_memory',
            content: { n: 1 },
            namespace: 'ns',
            userId: 'u1',
            agentId: 'a1',
            entityId: 'e1',
            entityType: 'person',
        });
        expect(await db.getLearning({ learningType: 'user_memory', userId: 'u1' })).toBeTruthy();
        expect((await db.getLearnings({ learningType: 'user_memory', namespace: 'ns', limit: 5 })).length).toBe(1);
        expect(await db.deleteLearning('l1')).toBe(true);

        await db.upsertKnowledge({
            id: 'k1',
            name: 'doc',
            content: { t: 1 },
            linkedTo: 'default',
            status: 'ready',
            metadata: { a: 1 },
        });
        expect(await db.getKnowledge('k1')).toBeTruthy();
        const [items, total] = await db.getKnowledgeItems({ linkedTo: 'default', status: 'ready', limit: 5 });
        expect(total).toBeGreaterThanOrEqual(1);
        expect(items[0]?.id).toBe('k1');
        expect(await db.deleteKnowledge('k1')).toBe(true);

        await db.upsertTrace({
            trace_id: 't1',
            session_id: 's1',
            agent_id: 'a1',
            user_id: 'u1',
            status: 'ok',
            metadata: null,
        });
        expect(await db.getTrace('t1')).toBeTruthy();
        expect((await db.getTraces({ sessionId: 's1', agentId: 'a1', userId: 'u1', limit: 5 }))[1]).toBeGreaterThanOrEqual(1);

        const sch = await db.createSchedule({
            id: 'sch1',
            name: 'job',
            cron: '* * * * *',
            enabled: true,
            agent_id: 'a1',
            last_run_at: null,
            next_run_at: null,
        });
        expect(sch.id).toBe('sch1');
        expect(await db.getSchedule('sch1')).toBeTruthy();
        expect((await db.getSchedules({ enabled: true, limit: 5 })).length).toBe(1);
        expect((await db.updateSchedule('sch1', { enabled: false }))?.enabled).toBe(false);
        expect(await db.updateSchedule('missing', {})).toBeNull();
        expect(await db.deleteSchedule('sch1')).toBe(true);
        expect(await db.deleteSession('s1', 'u1')).toBe(true);
        expect((await db.health()).ok).toBe(true);
        expect(db.toDict()).toMatchObject({ type: 'sqlite' });
        await db.close();
    });
});

describe('createAgentDb factory', () => {
    it('memory/json/sqlite URL and unknown rejection', async () => {
        const { createAgentDb } = await import('../src/db/factory.js');
        const mem = await createAgentDb('memory');
        expect(mem.type).toBe('in-memory');
        await mem.close();

        const mem2 = await createAgentDb({ type: 'in-memory' });
        expect(mem2.type).toBe('in-memory');
        await mem2.close();

        const sqlite = await createAgentDb('sqlite://:memory:');
        expect(sqlite.type).toBe('sqlite');
        await sqlite.close();

        const json = await createAgentDb({ type: 'json', dir: '/tmp/pf-factory-json-cov' });
        expect(json.type).toBe('json');
        await json.init();
        await json.close();

        await expect(createAgentDb('ftp://x')).rejects.toThrow(/Cannot parse/);
        await expect(createAgentDb({ type: 'oracle' as 'sqlite' })).rejects.toThrow(/Unknown database type/);
    });

    it('optional backend constructors with Module._load mocks', async () => {
        const { createAgentDb } = await import('../src/db/factory.js');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Mod = Module as any;
        const originalLoad = Mod._load as (...args: unknown[]) => unknown;
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === 'ioredis') {
                return class {
                    async quit() {
                        return 'OK';
                    }
                };
            }
            if (request === 'mongodb') {
                return {
                    MongoClient: class {
                        async connect() {}
                        async close() {}
                        db() {
                            return { collection: () => ({ createIndex: async () => 'i' }) };
                        }
                    },
                };
            }
            if (request === 'mysql2/promise') {
                return { createPool: () => ({ execute: async () => [[], []], end: async () => {} }) };
            }
            if (request === 'pg') {
                return {
                    Pool: class {
                        async query() {
                            return { rows: [] };
                        }
                        async end() {}
                    },
                };
            }
            if (request === '@libsql/client') {
                return { createClient: () => ({ execute: async () => ({ rows: [], rowsAffected: 0 }), close() {} }) };
            }
            if (request === '@aws-sdk/client-dynamodb') {
                return {
                    DynamoDBClient: class {
                        destroy() {}
                    },
                    CreateTableCommand: class {
                        constructor(public input: unknown) {}
                    },
                };
            }
            if (request === '@aws-sdk/lib-dynamodb') {
                return {
                    DynamoDBDocumentClient: { from: () => ({ send: async () => ({}) }) },
                    PutCommand: class {
                        constructor(public input: unknown) {}
                    },
                    GetCommand: class {
                        constructor(public input: unknown) {}
                    },
                    DeleteCommand: class {
                        constructor(public input: unknown) {}
                    },
                    QueryCommand: class {
                        constructor(public input: unknown) {}
                    },
                    ScanCommand: class {
                        constructor(public input: unknown) {}
                    },
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            expect((await createAgentDb('redis://localhost:6379')).type).toBe('redis');
            expect((await createAgentDb({ type: 'mongo', uri: 'mongodb://x', database: 'd' })).type).toBe('mongo');
            expect((await createAgentDb('mysql://u:p@h/db')).type).toBe('mysql');
            expect((await createAgentDb('postgres://u:p@h/db')).type).toBe('postgres');
            expect((await createAgentDb('libsql://x')).type).toBe('turso');
            expect((await createAgentDb('file:agent.db')).type).toBe('turso');
            expect((await createAgentDb({ type: 'dynamodb', tableName: 'T', region: 'us-west-2' })).type).toBe(
                'dynamodb',
            );
            expect((await createAgentDb('dynamodb://http://localhost:8000')).type).toBe('dynamodb');
            expect((await createAgentDb('json://./agent-db')).type).toBe('json');
        } finally {
            Mod._load = originalLoad;
        }
    });
});

describe('DynamoDbAgentDb + TursoAgentDb mocked peers', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Mod = Module as any;
    const originalLoad = Mod._load as (...args: unknown[]) => unknown;

    afterEach(() => {
        Mod._load = originalLoad;
    });

    it('DynamoDbAgentDb full CRUD via AWS SDK mocks', async () => {
        const items = new Map<string, Record<string, unknown>>();
        class Tagged {
            constructor(
                public readonly _tag: string,
                public readonly input: Record<string, unknown>,
            ) {}
        }
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === '@aws-sdk/client-dynamodb') {
                return {
                    DynamoDBClient: class {
                        destroy() {}
                    },
                    CreateTableCommand: class extends Tagged {
                        constructor(input: Record<string, unknown>) {
                            super('CreateTable', input);
                        }
                    },
                };
            }
            if (request === '@aws-sdk/lib-dynamodb') {
                return {
                    DynamoDBDocumentClient: {
                        from: () => ({
                            send: async (cmd: Tagged) => {
                                if (cmd._tag === 'CreateTable') return {};
                                if (cmd._tag === 'Put') {
                                    const item = cmd.input['Item'] as Record<string, unknown>;
                                    items.set(String(item['pk']), item);
                                    return {};
                                }
                                if (cmd._tag === 'Get') {
                                    const key = cmd.input['Key'] as { pk: string };
                                    return { Item: items.get(key.pk) };
                                }
                                if (cmd._tag === 'Delete') {
                                    const key = cmd.input['Key'] as { pk: string };
                                    items.delete(key.pk);
                                    return {};
                                }
                                if (cmd._tag === 'Scan' || cmd._tag === 'Query') {
                                    const all = [...items.values()];
                                    const entity = (cmd.input['ExpressionAttributeValues'] as Record<string, string> | undefined)?.[
                                        ':entity'
                                    ];
                                    const filtered = entity ? all.filter((i) => i['_entity'] === entity) : all;
                                    return { Items: filtered, Count: filtered.length };
                                }
                                return {};
                            },
                        }),
                    },
                    PutCommand: class extends Tagged {
                        constructor(input: Record<string, unknown>) {
                            super('Put', input);
                        }
                    },
                    GetCommand: class extends Tagged {
                        constructor(input: Record<string, unknown>) {
                            super('Get', input);
                        }
                    },
                    DeleteCommand: class extends Tagged {
                        constructor(input: Record<string, unknown>) {
                            super('Delete', input);
                        }
                    },
                    QueryCommand: class extends Tagged {
                        constructor(input: Record<string, unknown>) {
                            super('Query', input);
                        }
                    },
                    ScanCommand: class extends Tagged {
                        constructor(input: Record<string, unknown>) {
                            super('Scan', input);
                        }
                    },
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const { DynamoDbAgentDb } = await import('../src/db/dynamodb.js');
        const db = new DynamoDbAgentDb({ tableName: 'T', region: 'us-east-1', endpoint: 'http://localhost:8000' });
        expect(db.type).toBe('dynamodb');
        await db.init();

        await db.upsertSession({
            sessionId: 's1',
            userId: 'u1',
            agentId: 'a1',
            sessionData: { messages: [] },
            metadata: { k: 1 },
        });
        expect(await db.getSession('s1', 'u1')).toBeTruthy();
        expect(await db.getSession('s1', 'other')).toBeNull();
        expect((await db.getSessions({ userId: 'u1', limit: 5 })).length).toBeGreaterThanOrEqual(1);
        expect((await db.renameSession('s1', 'N', 'u1'))?.session_data).toContain('N');

        const m = await db.upsertMemory({ memory: 'hello cats', userId: 'u1', agentId: 'a1', topics: ['t'] });
        expect(await db.getMemory(m.memory_id, 'u1')).toBeTruthy();
        expect((await db.getMemories({ userId: 'u1', search: 'cats' })).length).toBeGreaterThan(0);
        expect(await db.deleteMemory(m.memory_id, 'u1')).toBe(true);
        await db.clearMemories();

        await db.upsertLearning({ id: 'l1', learningType: 'user_memory', content: { a: 1 }, userId: 'u1' });
        expect(await db.getLearning({ learningType: 'user_memory', userId: 'u1' })).toBeTruthy();
        expect(await db.deleteLearning('l1')).toBe(true);

        await db.upsertKnowledge({ id: 'k1', content: 'c', linkedTo: 'd', status: 'ready' });
        expect(await db.getKnowledge('k1')).toBeTruthy();
        expect((await db.getKnowledgeItems({ linkedTo: 'd' }))[1]).toBeGreaterThanOrEqual(1);
        expect(await db.deleteKnowledge('k1')).toBe(true);

        await db.upsertTrace({ trace_id: 't1', session_id: 's1', agent_id: 'a1', user_id: 'u1', status: 'ok' });
        expect(await db.getTrace('t1')).toBeTruthy();
        expect((await db.getTraces({ sessionId: 's1' }))[0].length).toBeGreaterThanOrEqual(1);

        const sch = await db.createSchedule({ id: 'sch1', name: 'n', enabled: true, cron: '* * * * *', agent_id: 'a1' });
        expect(await db.getSchedule('sch1')).toBeTruthy();
        expect((await db.getSchedules({ enabled: true })).length).toBeGreaterThanOrEqual(1);
        expect((await db.updateSchedule('sch1', { enabled: false }))?.enabled).toBe(false);
        expect(await db.deleteSchedule('sch1')).toBe(true);
        expect(await db.deleteSession('s1', 'u1')).toBe(true);
        await db.close();
    });

    it('TursoAgentDb CRUD smoke via @libsql/client mock', async () => {
        const store = new Map<string, Map<string, Record<string, unknown>>>();
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === '@libsql/client') {
                return {
                    createClient: () => ({
                        execute: async (arg: string | { sql: string; args: unknown[] }) => {
                            const sql = typeof arg === 'string' ? arg : arg.sql;
                            const params = typeof arg === 'string' ? [] : arg.args;
                            const s = sql.replace(/\s+/g, ' ');
                            if (/CREATE TABLE|CREATE INDEX/i.test(s)) return { rows: [], rowsAffected: 0 };
                            const m = s.match(/(?:FROM|INTO|UPDATE|TABLE)\s+(\w+)/i);
                            const table = m?.[1] ?? 'x';
                            if (!store.has(table)) store.set(table, new Map());
                            const t = store.get(table)!;
                            if (/INSERT/i.test(s)) {
                                const id = String(params[0]);
                                const row: Record<string, unknown> = {
                                    session_id: params[0],
                                    memory_id: params[0],
                                    learning_id: params[0],
                                    id: params[0],
                                    trace_id: params[0],
                                    user_id: params[5] ?? params[1],
                                    agent_id: params[2] ?? params[4],
                                    memory: params[4],
                                    session_data: params[9],
                                    created_at: params[params.length - 2] ?? 1,
                                    updated_at: params[params.length - 1] ?? 1,
                                    enabled: 1,
                                    name: params[1],
                                    content: typeof params[10] === 'string' ? params[10] : JSON.stringify(params[10] ?? {}),
                                    learning_type: params[1],
                                    linked_to: params[6],
                                    status: params[8],
                                };
                                t.set(id, row);
                                return { rows: [], rowsAffected: 1 };
                            }
                            if (/SELECT created_at/i.test(s)) {
                                const row = t.get(String(params[0]));
                                return { rows: row ? [{ created_at: row['created_at'] }] : [], rowsAffected: 0 };
                            }
                            if (/DELETE/i.test(s)) {
                                return { rows: [], rowsAffected: t.delete(String(params[0])) ? 1 : 0 };
                            }
                            if (/UPDATE/i.test(s)) {
                                const id = String(params[params.length - 1]);
                                const row = t.get(id);
                                if (row && s.includes('session_data')) t.set(id, { ...row, session_data: params[0] });
                                return { rows: [], rowsAffected: row ? 1 : 0 };
                            }
                            if (/SELECT/i.test(s)) {
                                if (params[0] !== undefined && !/LIMIT/i.test(s)) {
                                    const row = t.get(String(params[0]));
                                    return { rows: row ? [row] : [], rowsAffected: 0 };
                                }
                                return { rows: [...t.values()], rowsAffected: 0 };
                            }
                            return { rows: [], rowsAffected: 0 };
                        },
                        close() {},
                    }),
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const { TursoAgentDb } = await import('../src/db/turso.js');
        const db = new TursoAgentDb({ url: 'file:test.db', authToken: 'tok' });
        expect(db.type).toBe('turso');
        await db.init();
        await db.upsertSession({ sessionId: 's1', userId: 'u1', agentId: 'a1', sessionData: {} });
        expect(await db.getSession('s1')).toBeTruthy();
        await db.renameSession('s1', 'N');
        await db.getSessions({ limit: 5 });
        const mem = await db.upsertMemory({ memory: 'x', userId: 'u1' });
        await db.getMemories({ userId: 'u1' });
        await db.deleteMemory(mem.memory_id);
        await db.clearMemories();
        await db.upsertLearning({ id: 'l1', learningType: 'user_memory', content: {} });
        await db.getLearnings({ learningType: 'user_memory' });
        await db.deleteLearning('l1');
        await db.upsertKnowledge({ id: 'k1', name: 'n', linkedTo: 'd', status: 'ready' });
        await db.getKnowledgeItems({ linkedTo: 'd' });
        await db.deleteKnowledge('k1');
        await db.upsertTrace({
            trace_id: 't1',
            session_id: 's1',
            agent_id: 'a1',
            user_id: 'u1',
            status: 'ok',
            metadata: null,
        });
        await db.getTraces({});
        await db.createSchedule({
            id: 'sch1',
            name: 'n',
            cron: '* * * * *',
            enabled: true,
            agent_id: 'a1',
            last_run_at: null,
            next_run_at: null,
        });
        await db.getSchedules({});
        await db.updateSchedule('sch1', { enabled: false });
        await db.deleteSchedule('sch1');
        await db.deleteSession('s1');
        await db.close();
    });
});

describe('db base validators', () => {
    it('validateTableName(s)', async () => {
        const { validateTableName, validateTableNames } = await import('../src/db/base.js');
        const { DEFAULT_TABLE_NAMES } = await import('../src/db/types.js');
        expect(validateTableName('agent_sessions')).toBe('agent_sessions');
        expect(() => validateTableName('bad-name!')).toThrow(/Invalid table name/);
        expect(validateTableNames({ ...DEFAULT_TABLE_NAMES })).toMatchObject(DEFAULT_TABLE_NAMES);
    });
});
