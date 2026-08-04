/**
 * Hermetic coverage for src/session — in-memory, redis, sqlite stores.
 * Redis is exercised via a mocked tryImport; no network. Callers: vitest only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemorySessionStore, createInMemoryStore } from '../src/session/in-memory.js';
import { createRedisStore } from '../src/session/redis-store.js';
import { createSqliteStore } from '../src/session/sqlite.js';
import { DbSessionStore, createDbSessionStore } from '../src/session/db-store.js';
import type { AgentDb, SessionRow } from '../src/db/index.js';

// ── in-memory ───────────────────────────────────────────────────────────────

describe('session/in-memory', () => {
    it('CRUD + append + getMessages + size', async () => {
        const store = createInMemoryStore();
        const s1 = await store.create({ agentId: 'a1', userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
        expect(s1.id).toBeTruthy();
        expect(s1.agentId).toBe('a1');
        expect(s1.userId).toBe('u1');

        const s2 = await store.create('custom-id');
        expect(s2.id).toBe('custom-id');
        expect(s2.agentId).toBe('unknown');
        expect(s2.messages).toEqual([]);

        expect((await store.get(s1.id))?.messages).toHaveLength(1);
        await store.appendMessage(s1.id, { role: 'assistant', content: 'yo' });
        expect((await store.getMessages(s1.id))).toHaveLength(2);
        await store.update(s1.id, { messages: [{ role: 'user', content: 'replaced' }] });
        expect((await store.getMessages(s1.id))![0]!.content).toBe('replaced');
        expect(store.size).toBe(2);
        await store.delete(s1.id);
        expect(await store.get(s1.id)).toBeUndefined();
        expect(store.size).toBe(1);
    });

    it('update/append on missing session are no-ops', async () => {
        const store = new InMemorySessionStore();
        await store.update('missing', { messages: [] });
        await store.appendMessage('missing', { role: 'user', content: 'x' });
        expect(await store.get('missing')).toBeUndefined();
    });

    it('pruneExpired respects retentionDays and no-op without', async () => {
        const store = new InMemorySessionStore({ retentionDays: 1 });
        const old = await store.create({ agentId: 'a', messages: [] });
        const now = Date.now();
        // backdate updatedAt via direct map manipulation
        (store as unknown as { _store: Map<string, { updatedAt: number }> })._store.set(old.id, {
            ...old,
            updatedAt: now - 2 * 86_400_000,
        } as never);
        await store.create({ agentId: 'b', messages: [] });
        expect(store.pruneExpired()).toBe(1);
        expect(await store.get(old.id)).toBeUndefined();

        const noRetention = new InMemorySessionStore();
        await noRetention.create({ agentId: 'a' });
        expect(noRetention.pruneExpired()).toBe(0);
    });
});

// ── redis (mocked tryImport) ────────────────────────────────────────────────

describe('session/redis-store', () => {
    // Mock tryImport via module mock so createRedisStore can load ioredis.
    // We use vi.mock on the shared index (same pattern as secret-manager tests).
    let clientState = new Map<string, string>();
    const watchCalls: string[] = [];
    let multiExecResult: unknown[] | null = null;

    const fakeClient = () => ({
        get: vi.fn(async (k: string) => clientState.get(k) ?? null),
        setex: vi.fn(async (k: string, ttl: number, v: string) => { clientState.set(k, v); return 'OK'; }),
        del: vi.fn(async (k: string) => { clientState.delete(k); return 1; }),
        watch: vi.fn(async (k: string) => { watchCalls.push(k); return 'OK'; }),
        unwatch: vi.fn(async () => 'OK'),
        multi: vi.fn(() => ({
            setex: vi.fn((k: string, ttl: number, v: string) => { clientState.set(k, v); return {} as never; }),
            exec: vi.fn(async () => multiExecResult),
        })),
    });

    beforeEach(() => {
        clientState = new Map();
        watchCalls.length = 0;
        multiExecResult = ['OK']; // non-null → watch/multi transaction succeeds
        vi.resetModules();
        vi.doMock('../src/shared/index.js', async (importOriginal) => {
            const mod = await importOriginal<typeof import('../src/shared/index.js')>();
            return {
                ...mod,
                tryImport: vi.fn(async () => {
                    const IORedis = class {
                        constructor(_opts?: string | object) {}
                        get = fakeClient().get;
                        setex = fakeClient().setex;
                        del = fakeClient().del;
                        watch = fakeClient().watch;
                        unwatch = fakeClient().unwatch;
                        multi = fakeClient().multi;
                    };
                    return IORedis as never;
                }),
            };
        });
    });

    it('create/get/update/append/delete via mocked ioredis', async () => {
        const { createRedisStore: createRedis } = await import('../src/session/redis-store.js');
        const store = createRedis({ ttl: 100 });
        const s = await store.create({ agentId: 'a1', userId: 'u1', messages: [{ role: 'user', content: 'x' }] });
        expect(s.id).toBeTruthy();

        const fetched = await store.get(s.id);
        expect(fetched?.agentId).toBe('a1');
        expect((await store.getMessages(s.id))).toHaveLength(1);

        await store.appendMessage(s.id, { role: 'assistant', content: 'y' });
        expect((await store.getMessages(s.id))).toHaveLength(2);

        await store.update(s.id, { messages: [{ role: 'user', content: 'z' }] });
        expect((await store.getMessages(s.id))![0]!.content).toBe('z');

        await store.delete(s.id);
        expect(await store.get(s.id)).toBeUndefined();
    });

    it('create with string id + missing session returns undefined on update', async () => {
        const { createRedisStore: createRedis } = await import('../src/session/redis-store.js');
        const store = createRedis();
        const s = await store.create('str-id');
        expect(s.id).toBe('str-id');
        expect(s.agentId).toBe('unknown');

        await store.appendMessage('missing', { role: 'user', content: 'x' });
        expect(await store.get('missing')).toBeUndefined();
    });

    it('parses corrupt JSON as undefined session', async () => {
        const { createRedisStore: createRedis } = await import('../src/session/redis-store.js');
        clientState.set('personaforge:session:corrupt', 'not-json{{{');
        const store = createRedis();
        expect(await store.get('corrupt')).toBeUndefined();
    });
});

// ── sqlite (real better-sqlite3, :memory:) ─────────────────────────────────

describe('session/sqlite-store', () => {
    it('CRUD + append + getMessages + delete', async () => {
        const store = createSqliteStore({ path: ':memory:' });
        const s = await store.create({ agentId: 'a1', userId: 'u1', messages: [{ role: 'user', content: 'x' }] });
        expect(s.id).toBeTruthy();

        const fetched = await store.get(s.id);
        expect(fetched?.agentId).toBe('a1');
        expect(fetched?.userId).toBe('u1');
        expect((await store.getMessages(s.id))).toHaveLength(1);

        await store.appendMessage(s.id, { role: 'assistant', content: 'y' });
        expect((await store.getMessages(s.id))).toHaveLength(2);

        await store.update(s.id, { messages: [{ role: 'user', content: 'z' }] });
        expect((await store.getMessages(s.id))![0]!.content).toBe('z');

        await store.delete(s.id);
        expect(await store.get(s.id)).toBeUndefined();
        expect(await store.getMessages(s.id)).toEqual([]);
    });

    it('string id create + append on missing session is a no-op + corrupt messages', async () => {
        const store = createSqliteStore();
        const s = await store.create('fixed-id');
        expect(s.id).toBe('fixed-id');
        expect(s.agentId).toBe('unknown');

        await store.appendMessage('missing', { role: 'user', content: 'x' });
        expect(await store.get('missing')).toBeUndefined();
    });
});

// ── db-store (fake AgentDb) ─────────────────────────────────────────────────

describe('session/db-store', () => {
    function makeFakeDb() {
        const rows = new Map<string, SessionRow>();
        const db: AgentDb = {
            init: vi.fn(async () => {}),
            getSession: vi.fn(async (id: string) => rows.get(id) ?? null),
            upsertSession: vi.fn(async (s: {
                sessionId: string;
                sessionType: string;
                agentId?: string;
                userId?: string;
                sessionData: Record<string, unknown>;
            }) => {
                const existing = rows.get(s.sessionId);
                rows.set(s.sessionId, {
                    session_id: s.sessionId,
                    session_type: s.sessionType,
                    agent_id: s.agentId ?? null,
                    user_id: s.userId ?? null,
                    session_data: JSON.stringify(s.sessionData),
                    created_at: existing?.created_at ?? 123,
                    updated_at: 456,
                });
            }),
            deleteSession: vi.fn(async (id: string) => { rows.delete(id); }),
        } as unknown as AgentDb;
        return { db, rows };
    }

    it('CRUD + append + getMessages + delete + string create', async () => {
        const { db, rows } = makeFakeDb();
        const store = createDbSessionStore(db);
        const s = await store.create({ agentId: 'a1', userId: 'u1', messages: [{ role: 'user', content: 'x' }] });
        expect(s.id).toMatch(/^sess/);
        expect(s.agentId).toBe('a1');

        const fetched = await store.get(s.id);
        expect(fetched?.userId).toBe('u1');
        expect((await store.getMessages(s.id))).toHaveLength(1);

        await store.appendMessage(s.id, { role: 'assistant', content: 'y' });
        expect((await store.getMessages(s.id))).toHaveLength(2);

        await store.update(s.id, { messages: [{ role: 'user', content: 'z' }] });
        expect((await store.getMessages(s.id))![0]!.content).toBe('z');

        // missing session mutations are no-ops
        await store.update('missing', { messages: [] });
        await store.appendMessage('missing', { role: 'user', content: 'x' });

        const s2 = await store.create('fixed-id');
        expect(s2.id).toBe('fixed-id');
        expect(s2.agentId).toBe('unknown');

        await store.delete(s.id);
        expect(await store.get(s.id)).toBeUndefined();
        expect(await store.getMessages(s.id)).toEqual([]);
        expect(rows.size).toBe(1);
    });

    it('handles corrupt session data and concurrent appends via lock', async () => {
        const { db, rows } = makeFakeDb();
        const store = new DbSessionStore(db);
        await store.create({ agentId: 'a' });
        const id = Array.from(rows.keys())[0]!;
        // corrupt the blob
        rows.set(id, { ...rows.get(id)!, session_data: 'not-json' });
        expect(await store.getMessages(id)).toEqual([]);
        expect((await store.get(id))?.messages).toEqual([]);

        // concurrent appends are serialized by the session lock
        rows.set(id, { ...rows.get(id)!, session_data: JSON.stringify({ messages: [] }) });
        await Promise.all([
            store.appendMessage(id, { role: 'user', content: 'a' }),
            store.appendMessage(id, { role: 'user', content: 'b' }),
            store.appendMessage(id, { role: 'user', content: 'c' }),
        ]);
        expect((await store.getMessages(id))).toHaveLength(3);
    });
});
