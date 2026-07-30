/**
 * Hermetic coverage for InMemoryAgentDb + JsonFileAgentDb (+ DbMemoryStore / DbSessionStore).
 *
 * Callers: vitest CI only. Temp-dir JSON files for JsonFileAgentDb.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { InMemoryAgentDb } from '../src/db/in-memory.js';
import { JsonFileAgentDb } from '../src/db/json.js';
import { DbMemoryStore, createDbMemoryStore } from '../src/memory/db-store.js';
import { DbSessionStore } from '../src/session/db-store.js';
import { MemoryType } from '../src/memory/types.js';
import {
    PineconeVectorStore,
    QdrantVectorStore,
    PgVectorStore,
} from '../src/memory/vector-adapters.js';
import { VectorMemoryStore } from '../src/memory/vector-store.js';
import type { EmbeddingProvider, VectorStoreAdapter } from '../src/memory/types.js';

async function exerciseAgentDb(db: InMemoryAgentDb | JsonFileAgentDb) {
    await db.init();

    const s = await db.upsertSession({
        sessionId: 's1',
        agentId: 'a1',
        userId: 'u1',
        sessionType: 'agent',
        agentData: { x: 1 },
        teamData: { t: 1 },
        workflowData: { w: 1 },
        sessionData: { messages: [] },
        metadata: { k: 'v' },
        runs: [{ id: 1 }],
        summary: 'sum',
    });
    expect(s.session_id).toBe('s1');
    expect(await db.getSession('s1', 'u1')).toBeTruthy();
    expect(await db.getSession('s1', 'other')).toBeNull();
    expect(await db.getSession('missing')).toBeNull();

    await db.upsertSession({ sessionId: 's2', agentId: 'a2', teamId: 'tm', workflowId: 'wf', userId: 'u2' });
    const sessions = await db.getSessions({
        sessionType: 'agent',
        agentId: 'a1',
        userId: 'u1',
        limit: 10,
        offset: 0,
    });
    expect(sessions.some((r) => r.session_id === 's1')).toBe(true);

    const renamed = await db.renameSession('s1', 'Renamed', 'u1');
    expect(renamed?.session_data).toContain('Renamed');
    expect(await db.renameSession('nope', 'x')).toBeNull();

    expect(await db.deleteSession('s2', 'wrong')).toBe(false);
    expect(await db.deleteSession('s2', 'u2')).toBe(true);
    expect(await db.deleteSession('missing')).toBe(false);

    const m = await db.upsertMemory({
        memory: 'cats like fish',
        userId: 'u1',
        agentId: 'a1',
        topics: ['pets'],
        input: 'q',
        feedback: 'good',
    });
    expect(m.memory_id).toBeTruthy();
    expect(await db.getMemory(m.memory_id, 'u1')).toBeTruthy();
    expect(await db.getMemory(m.memory_id, 'x')).toBeNull();
    expect(await db.getMemory('nope')).toBeNull();

    await db.upsertMemory({
        memoryId: 'm2',
        memory: 'dogs bark',
        userId: 'u1',
        agentId: 'a1',
        teamId: 'tm',
        topics: ['pets'],
    });
    const mems = await db.getMemories({
        userId: 'u1',
        agentId: 'a1',
        search: 'cats',
        topics: ['pets'],
        limit: 5,
        offset: 0,
    });
    expect(mems.length).toBeGreaterThan(0);

    expect(await db.deleteMemory('m2', 'wrong')).toBe(false);
    expect(await db.deleteMemory('m2', 'u1')).toBe(true);
    await db.clearMemories('u1');
    await db.upsertMemory({ memory: 'keep', userId: 'u2' });
    await db.clearMemories();

    await db.upsertLearning({
        id: 'l1',
        learningType: 'user_memory',
        content: { note: 'n' },
        namespace: 'ns',
        userId: 'u1',
        agentId: 'a1',
        teamId: 'tm',
        workflowId: 'wf',
        sessionId: 's1',
        entityId: 'e1',
        entityType: 'person',
        metadata: { m: 1 },
    });
    expect(await db.getLearning({ learningType: 'user_memory', userId: 'u1' })).toBeTruthy();
    const learns = await db.getLearnings({
        learningType: 'user_memory',
        userId: 'u1',
        agentId: 'a1',
        teamId: 'tm',
        workflowId: 'wf',
        sessionId: 's1',
        namespace: 'ns',
        entityId: 'e1',
        entityType: 'person',
        limit: 10,
    });
    expect(learns).toHaveLength(1);
    expect(await db.deleteLearning('l1')).toBe(true);
    expect(await db.deleteLearning('l1')).toBe(false);

    const k = await db.upsertKnowledge({
        id: 'k1',
        name: 'doc',
        description: 'd',
        content: { text: 'hello' },
        type: 'json',
        size: 10,
        linkedTo: 'default',
        status: 'ready',
        statusMessage: 'ok',
        externalId: 'ext',
        metadata: { a: 1 },
    });
    expect(k.id).toBe('k1');
    expect(await db.getKnowledge('k1')).toBeTruthy();
    expect(await db.getKnowledge('nope')).toBeNull();
    const [items, total] = await db.getKnowledgeItems({
        linkedTo: 'default',
        status: 'ready',
        limit: 5,
        offset: 0,
    });
    expect(total).toBeGreaterThanOrEqual(1);
    expect(items[0]?.id).toBe('k1');
    expect(await db.deleteKnowledge('k1')).toBe(true);
    expect(await db.deleteKnowledge('k1')).toBe(false);

    await db.upsertTrace({
        trace_id: 't1',
        session_id: 's1',
        agent_id: 'a1',
        user_id: 'u1',
        status: 'ok',
        metadata: null,
    });
    expect(await db.getTrace('t1')).toBeTruthy();
    expect(await db.getTrace('nope')).toBeNull();
    const [traces, tTotal] = await db.getTraces({
        sessionId: 's1',
        agentId: 'a1',
        userId: 'u1',
        limit: 10,
        offset: 0,
    });
    expect(tTotal).toBeGreaterThanOrEqual(1);
    expect(traces[0]?.trace_id).toBe('t1');

    const sch = await db.createSchedule({
        id: 'sch1',
        name: 'daily',
        cron: '0 * * * *',
        enabled: true,
        agent_id: 'a1',
        last_run_at: null,
        next_run_at: null,
    });
    expect(sch.id).toBe('sch1');
    expect(await db.getSchedule('sch1')).toBeTruthy();
    expect(await db.getSchedule('nope')).toBeNull();
    expect((await db.getSchedules({ enabled: true, limit: 5 })).length).toBeGreaterThanOrEqual(1);
    expect((await db.updateSchedule('sch1', { enabled: false }))?.enabled).toBe(false);
    expect(await db.updateSchedule('nope', { enabled: true })).toBeNull();
    expect(await db.deleteSchedule('sch1')).toBe(true);
    expect(await db.deleteSchedule('sch1')).toBe(false);

    await db.close();
}

describe('InMemoryAgentDb', () => {
    it('covers all public CRUD paths', async () => {
        const db = new InMemoryAgentDb();
        expect(db.type).toBe('in-memory');
        await exerciseAgentDb(db);
        expect(db.toDict()).toMatchObject({ type: 'in-memory' });
    });
});

describe('JsonFileAgentDb', () => {
    let dir: string;
    afterEach(() => {
        if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('persists and reloads from disk', async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-jsondb-'));
        const db = new JsonFileAgentDb({ dir });
        expect(db.type).toBe('json');
        await exerciseAgentDb(db);

        const db2 = new JsonFileAgentDb({ dir });
        await db2.init();
        await db2.init();
        expect(db2.toDict()).toMatchObject({ type: 'json', dir });
        await db2.close();
    });

    it('handles corrupt JSON files gracefully', async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-jsondb-bad-'));
        fs.writeFileSync(path.join(dir, 'agent_sessions.json'), '{not-json', 'utf-8');
        const db = new JsonFileAgentDb({ dir });
        await db.init();
        expect(await db.getSessions({})).toEqual([]);
        await db.close();
    });
});

describe('DbMemoryStore', () => {
    it('CRUD + retrieve filters via InMemoryAgentDb', async () => {
        const db = new InMemoryAgentDb();
        const store = createDbMemoryStore(db, { agentId: 'a1', userId: 'u1', defaultQueryLimit: 5 });

        const e = await store.store({
            type: MemoryType.LONG_TERM,
            content: 'the cat sat on the mat',
            metadata: { tags: ['animal'], agentId: 'a1' },
            embedding: [0.1, 0.2],
            expiresAt: new Date(Date.now() + 60_000),
        });
        expect(e.id).toBeTruthy();
        expect(await store.get(e.id)).toMatchObject({ content: 'the cat sat on the mat' });

        await store.store({
            type: MemoryType.SHORT_TERM,
            content: 'dogs bark loudly',
            metadata: { tags: ['animal'] },
        });

        const hits = await store.retrieve({
            query: 'cat mat',
            type: MemoryType.LONG_TERM,
            filter: { tags: ['animal'], after: new Date(0), before: new Date(Date.now() + 1e9) },
            threshold: 0.1,
        });
        // retrieve may be embedding/keyword based; assert it returns an array and getRecent works
        expect(Array.isArray(hits)).toBe(true);
        const recent = await store.getRecent(10, MemoryType.LONG_TERM);
        expect(recent.length).toBeGreaterThan(0);

        const updated = await store.update(e.id, { content: 'updated cat' });
        expect(updated.content).toBe('updated cat');
        await expect(store.update('missing', { content: 'x' })).rejects.toThrow(/not found/i);

        expect((await store.getRecent(10, MemoryType.LONG_TERM)).length).toBeGreaterThan(0);
        expect((await store.snapshot()).length).toBeGreaterThan(0);

        await store.clear(MemoryType.SHORT_TERM);
        await store.clear();
        expect(await store.delete(e.id)).toBe(false);
    });
});

describe('DbSessionStore', () => {
    it('create/get/update/append/delete via InMemoryAgentDb', async () => {
        const db = new InMemoryAgentDb();
        const store = new DbSessionStore(db);

        const s = await store.create({
            agentId: 'a1',
            userId: 'u1',
            messages: [{ role: 'user', content: 'hi' }],
        });
        expect((await store.get(s.id))?.messages[0]?.content).toBe('hi');
        expect(await store.get('missing')).toBeUndefined();

        await store.appendMessage(s.id, { role: 'assistant', content: 'hello' });
        await store.update(s.id, { messages: [{ role: 'user', content: 'reset' }] });
        const msgs = await store.getMessages(s.id);
        expect(msgs[0]?.content).toBe('reset');

        const named = await store.create('fixed-id');
        expect(named.id).toBe('fixed-id');

        await store.delete(s.id);
        expect(await store.get(s.id)).toBeUndefined();
    });
});

describe('Vector adapters + VectorMemoryStore', () => {
    it('PineconeVectorStore exercises upsert/search/delete/clear', async () => {
        const calls: string[] = [];
        const index = {
            upsert: async () => {
                calls.push('upsert');
            },
            query: async () => ({ matches: [{ id: 'v1', score: 0.9, metadata: { content: 'x' } }] }),
            deleteMany: async () => {
                calls.push('delete');
            },
            deleteAll: async () => {
                calls.push('clear');
            },
            namespace: () => index,
        };
        const store = new PineconeVectorStore({ index: index as never, namespace: 'ns', batchSize: 1 });
        await store.upsert([
            { id: 'v1', vector: [1, 0], metadata: { content: 'a' } },
            { id: 'v2', vector: [0, 1], metadata: { content: 'b' } },
        ]);
        expect(calls.filter((c) => c === 'upsert').length).toBe(2);
        const hits = await store.search([1, 0], 5, { type: 'long' });
        expect(hits[0]?.id).toBe('v1');
        await store.delete([]);
        await store.delete(['v1', 'v2']);
        await store.clear();
        expect(calls).toContain('clear');
    });

    it('QdrantVectorStore with mocked fetch', async () => {
        const original = globalThis.fetch;
        globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
            const u = String(url);
            if (u.includes('/collections/c') && !init?.method) {
                return new Response('', { status: 404 });
            }
            if (init?.method === 'PUT' && u.endsWith('/collections/c')) {
                return new Response('{}', { status: 200 });
            }
            if (u.includes('/points') && init?.method === 'PUT') {
                return new Response('{}', { status: 200 });
            }
            if (u.includes('/search')) {
                return new Response(
                    JSON.stringify({
                        result: [{ id: '1', score: 0.8, payload: { content: 'hi' } }],
                    }),
                    { status: 200 },
                );
            }
            if (u.includes('/delete')) return new Response('{}', { status: 200 });
            if (init?.method === 'DELETE') return new Response('{}', { status: 200 });
            return new Response('{}', { status: 200 });
        }) as typeof fetch;

        const store = new QdrantVectorStore({
            url: 'http://qdrant.local/',
            collection: 'c',
            dimension: 2,
            apiKey: 'k',
            batchSize: 1,
            scoreThreshold: 0.1,
        });
        await store.upsert([{ id: '1', vector: [1, 0], metadata: { content: 'hi' } }]);
        const hits = await store.search([1, 0], 3, { content: 'hi' });
        expect(hits[0]?.score).toBe(0.8);
        await store.delete([]);
        await store.delete(['1']);
        await store.clear();
        globalThis.fetch = original;
    });

    it('PgVectorStore with mocked pool', async () => {
        const queries: string[] = [];
        const pool = {
            query: async (sql: string, params?: unknown[]) => {
                queries.push(sql);
                if (sql.includes('SELECT')) {
                    return {
                        rows: [{ id: '1', metadata: { content: 'x' }, score: '0.95' }],
                    };
                }
                void params;
                return { rows: [] };
            },
        };
        const store = new PgVectorStore({ pool, table: 'vecs', dimension: 2, ivfflatLists: 10 });
        await store.upsert([{ id: '1', vector: [0.1, 0.2], metadata: { content: 'x' } }]);
        await expect(store.upsert([{ id: 'bad', vector: [1], metadata: {} }])).rejects.toThrow(
            /dimension mismatch/,
        );
        const hits = await store.search([0.1, 0.2], 5, { content: 'x' });
        expect(hits[0]?.id).toBe('1');
        await store.delete([]);
        await store.delete(['1']);
        await store.clear();
        expect(queries.some((q) => q.includes('CREATE EXTENSION'))).toBe(true);
    });

    it('VectorMemoryStore full lifecycle with in-memory adapter', async () => {
        const vectors = new Map<string, { vector: number[]; metadata: Record<string, unknown> }>();
        const adapter: VectorStoreAdapter = {
            upsert: async (entries) => {
                for (const e of entries) vectors.set(e.id, { vector: e.vector, metadata: e.metadata });
            },
            search: async () =>
                [...vectors.entries()].map(([id, v]) => ({ id, score: 0.9, metadata: v.metadata })),
            delete: async (ids) => {
                for (const id of ids) vectors.delete(id);
            },
            clear: async () => {
                vectors.clear();
            },
            get: async (id) => {
                const v = vectors.get(id);
                return v ? { id, vector: v.vector, metadata: v.metadata } : null;
            },
        };
        const embed: EmbeddingProvider = {
            embed: async (text) => [text.length, 1],
            embedBatch: async (texts) => texts.map((t) => [t.length, 1]),
            getDimension: () => 2,
        };
        const store = new VectorMemoryStore({
            vectorStore: adapter,
            embeddingProvider: embed,
            defaultQueryLimit: 5,
            similarityThreshold: 0.5,
        });

        const e = await store.store({
            type: MemoryType.SEMANTIC,
            content: 'alpha',
            metadata: { tags: ['t'], source: 'test', agentId: 'a1', sessionId: 's1' },
        });
        expect(await store.get(e.id)).toBeTruthy();
        expect(
            (
                await store.retrieve({
                    query: 'alpha',
                    type: MemoryType.SEMANTIC,
                    filter: { tags: ['t'], source: 'test', agentId: 'a1', sessionId: 's1' },
                })
            ).length,
        ).toBeGreaterThan(0);
        await store.update(e.id, { content: 'beta' });
        expect((await store.getRecent(5, MemoryType.SEMANTIC))[0]?.content).toBe('beta');
        expect((await store.snapshot()).length).toBe(1);
        await store.clear(MemoryType.SEMANTIC);
        await store.store({ type: MemoryType.SHORT_TERM, content: 'tmp', metadata: {} });
        await store.clear();
        expect(await store.delete('x')).toBe(true);
        await expect(store.update('missing', { content: 'n' })).rejects.toThrow(/not found/);
    });
});
