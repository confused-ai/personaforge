/**
 * Hermetic coverage for db/factory, sqlite, dynamodb, turso with Module._load mocks.
 * tests include glob: tests/coverage-remaining-*.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Module from 'node:module';
import { createAgentDb } from '../src/db/factory.js';
import { SqliteAgentDb } from '../src/db/sqlite.js';
import { DynamoDbAgentDb } from '../src/db/dynamodb.js';
import { TursoAgentDb } from '../src/db/turso.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Mod = Module as any;
const originalLoad = Mod._load as (...args: unknown[]) => unknown;

describe('createAgentDb factory', () => {
    it('parses URL schemes and config objects', async () => {
        const mem = await createAgentDb('memory');
        expect(mem.type).toMatch(/memory/);
        await createAgentDb('in-memory');

        const sqlite = await createAgentDb('sqlite:///tmp/t.db');
        expect(sqlite.type).toBe('sqlite');

        expect((await createAgentDb({ type: 'postgres', uri: 'postgres://x' })).type).toBe('postgres');
        expect((await createAgentDb({ type: 'postgresql', uri: 'postgresql://x' })).type).toBe('postgres');
        expect((await createAgentDb('mongodb://h/db')).type).toBe('mongo');
        expect((await createAgentDb('redis://h')).type).toBe('redis');
        expect((await createAgentDb('json:///tmp/j')).type).toBe('json');
        expect((await createAgentDb('mysql://h/db')).type).toBe('mysql');
        expect((await createAgentDb({ type: 'mariadb', uri: 'mariadb://h' })).type).toBe('mysql');
        expect((await createAgentDb('dynamodb://localhost:8000')).type).toBe('dynamodb');
        expect((await createAgentDb('dynamodb://')).type).toBe('dynamodb');
        expect((await createAgentDb({ type: 'turso', uri: 'libsql://x', authToken: 't' })).type).toBe(
            'turso',
        );
        expect((await createAgentDb('file:agent.db')).type).toBe('turso');
        expect((await createAgentDb('libsql://x')).type).toBe('turso');

        await expect(createAgentDb('ftp://nope')).rejects.toThrow(/Cannot parse/);
        await expect(createAgentDb({ type: 'oracle' as any })).rejects.toThrow(/Unknown database type/);
    });
});

describe('SqliteAgentDb with fake better-sqlite3', () => {
    class FakeStmt {
        constructor(
            private db: FakeSqlite,
            private sql: string,
        ) {}
        run(...params: unknown[]) {
            const s = this.sql.replace(/\s+/g, ' ').trim();
            if (/^INSERT INTO/i.test(s)) {
                const m = /INSERT INTO (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                const colsMatch = /\(([^)]+)\)\s*VALUES/i.exec(s);
                const cols = (colsMatch?.[1] ?? '').split(',').map((c) => c.trim());
                const row: Record<string, unknown> = {};
                cols.forEach((c, i) => {
                    row[c] = params[i];
                });
                const pk =
                    (row['session_id'] as string) ??
                    (row['memory_id'] as string) ??
                    (row['learning_id'] as string) ??
                    (row['trace_id'] as string) ??
                    (row['id'] as string) ??
                    String(params[0]);
                const t = this.db.ensure(table);
                t.set(pk, { ...t.get(pk), ...row });
                return { changes: 1 };
            }
            if (/^UPDATE/i.test(s)) {
                const m = /UPDATE (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                const id = params[params.length - 1];
                const t = this.db.ensure(table);
                const row = t.get(String(id));
                if (row && /session_data/i.test(s)) {
                    row['session_data'] = params[0];
                    row['updated_at'] = params[1];
                } else if (row) {
                    // generic SET col=? ... WHERE id=?
                    const setPart = s.split(/SET/i)[1]?.split(/WHERE/i)[0] ?? '';
                    const cols = [...setPart.matchAll(/(\w+)\s*=\s*\?/g)].map((x) => x[1]!);
                    cols.forEach((c, i) => {
                        row[c] = params[i];
                    });
                }
                return { changes: row ? 1 : 0 };
            }
            if (/^DELETE FROM/i.test(s)) {
                const m = /DELETE FROM (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                const t = this.db.ensure(table);
                if (params.length === 0) {
                    const n = t.size;
                    t.clear();
                    return { changes: n };
                }
                const ok = t.delete(String(params[0]));
                return { changes: ok ? 1 : 0 };
            }
            return { changes: 0 };
        }
        get(...params: unknown[]) {
            const s = this.sql.replace(/\s+/g, ' ').trim();
            if (/SELECT count\(\*\)/i.test(s)) {
                const m = /FROM (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                let rows = [...this.db.ensure(table).values()];
                rows = this.filter(rows, s, params);
                return { 'count(*)': rows.length };
            }
            if (/SELECT created_at/i.test(s) || /SELECT created_at, access_count/i.test(s)) {
                const m = /FROM (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                const row = this.db.ensure(table).get(String(params[0]));
                return row ? { created_at: row['created_at'], access_count: row['access_count'] ?? 0 } : undefined;
            }
            if (/SELECT \*/i.test(s)) {
                const m = /FROM (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                let rows = [...this.db.ensure(table).values()];
                rows = this.filter(rows, s, params);
                return rows[0];
            }
            return undefined;
        }
        all(...params: unknown[]) {
            const s = this.sql.replace(/\s+/g, ' ').trim();
            const m = /FROM (\w+)/i.exec(s);
            const table = m?.[1] ?? 't';
            let rows = [...this.db.ensure(table).values()];
            rows = this.filter(rows, s, params);
            return rows;
        }
        private filter(rows: Record<string, unknown>[], s: string, params: unknown[]) {
            if (!/WHERE/i.test(s)) return rows;
            // simplistic: match equality clauses in order of params
            const where = s.split(/WHERE/i)[1]?.split(/ORDER BY|LIMIT|OFFSET/i)[0] ?? '';
            const clauses = where.split(/AND/i).map((c) => c.trim()).filter(Boolean);
            let pi = 0;
            for (const c of clauses) {
                const col = c.split('=')[0]?.trim().replace(/`/g, '');
                if (!col || col.includes('LIKE')) {
                    const likeVal = String(params[pi++] ?? '');
                    const needle = likeVal.replace(/%/g, '');
                    rows = rows.filter((r) => String(r['memory'] ?? '').includes(needle));
                    continue;
                }
                const val = params[pi++];
                rows = rows.filter((r) => r[col] === val);
            }
            return rows;
        }
    }

    class FakeSqlite {
        tables = new Map<string, Map<string, Record<string, unknown>>>();
        ensure(name: string) {
            if (!this.tables.has(name)) this.tables.set(name, new Map());
            return this.tables.get(name)!;
        }
        exec(_sql: string) {}
        prepare(sql: string) {
            return new FakeStmt(this, sql);
        }
        close() {}
    }

    beforeEach(() => {
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === 'better-sqlite3') {
                return class {
                    constructor() {
                        return new FakeSqlite();
                    }
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
    });
    afterEach(() => {
        Mod._load = originalLoad;
    });

    it('covers sessions/memories/learnings/knowledge/traces/schedules', async () => {
        const db = new SqliteAgentDb({ path: ':memory:' });
        expect(db.type).toBe('sqlite');
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
        expect((await db.getSessions({ agentId: 'a1', userId: 'u1', limit: 5 })).length).toBe(1);
        expect((await db.renameSession('s1', 'Named', 'u1'))?.session_data).toContain('Named');

        const m = await db.upsertMemory({ memory: 'cats', userId: 'u1', agentId: 'a1', topics: ['t'] });
        expect(await db.getMemory(m.memory_id, 'u1')).toBeTruthy();
        expect((await db.getMemories({ userId: 'u1', search: 'cat' })).length).toBeGreaterThan(0);
        expect(await db.deleteMemory(m.memory_id, 'u1')).toBe(true);
        await db.upsertMemory({ memory: 'x', userId: 'u1' });
        await db.clearMemories('u1');

        await db.upsertLearning({ id: 'l1', learningType: 'x', content: { a: 1 }, userId: 'u1' });
        expect(await db.getLearning({ learningType: 'x', userId: 'u1' })).toBeTruthy();
        expect(await db.deleteLearning('l1')).toBe(true);

        await db.upsertKnowledge({ id: 'k1', content: 'c', linkedTo: 'd', status: 'ready' });
        expect(await db.getKnowledge('k1')).toBeTruthy();
        const [items, total] = await db.getKnowledgeItems({ linkedTo: 'd', status: 'ready', limit: 10 });
        expect(total).toBeGreaterThanOrEqual(1);
        expect(items.length).toBeGreaterThanOrEqual(1);
        expect(await db.deleteKnowledge('k1')).toBe(true);

        await db.upsertTrace({ trace_id: 't1', session_id: 's1', agent_id: 'a1', user_id: 'u1' });
        expect(await db.getTrace('t1')).toBeTruthy();
        const [traces] = await db.getTraces({ sessionId: 's1', limit: 5 });
        expect(traces.length).toBeGreaterThan(0);

        const sch = await db.createSchedule({ id: 'sch1', name: 'n', enabled: true } as any);
        expect(await db.getSchedule('sch1')).toBeTruthy();
        const updated = await db.updateSchedule('sch1', { enabled: false } as any);
        expect(updated).toBeTruthy();
        expect(Boolean(updated!.enabled)).toBe(false);
        expect(await db.deleteSchedule('sch1')).toBe(true);
        void sch;

        expect(await db.deleteSession('s1', 'u1')).toBe(true);
        await db.close();
    });
});

describe('DynamoDbAgentDb with fake AWS SDK', () => {
    const store = new Map<string, Record<string, unknown>>();

    beforeEach(() => {
        store.clear();
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === '@aws-sdk/client-dynamodb') {
                class ResourceInUseException extends Error {
                    name = 'ResourceInUseException';
                }
                class DynamoDBClient {
                    constructor(_o: unknown) {}
                    destroy() {}
                }
                class CreateTableCommand {
                    constructor(public input: unknown) {}
                }
                return { DynamoDBClient, CreateTableCommand, ResourceInUseException };
            }
            if (request === '@aws-sdk/lib-dynamodb') {
                class PutCommand {
                    constructor(public input: { Item: Record<string, unknown> }) {}
                }
                class GetCommand {
                    constructor(public input: { Key: { pk: string } }) {}
                }
                class DeleteCommand {
                    constructor(public input: { Key: { pk: string } }) {}
                }
                class ScanCommand {
                    constructor(public input: { ExpressionAttributeValues?: { ':entity': string } }) {}
                }
                const DynamoDBDocumentClient = {
                    from(client: any) {
                        return {
                            send: async (cmd: any) => {
                                if (cmd instanceof PutCommand || cmd.constructor?.name === 'PutCommand') {
                                    store.set(cmd.input.Item['pk'] as string, cmd.input.Item);
                                    return {};
                                }
                                if (cmd instanceof GetCommand || cmd.constructor?.name === 'GetCommand') {
                                    return { Item: store.get(cmd.input.Key.pk) };
                                }
                                if (cmd instanceof DeleteCommand || cmd.constructor?.name === 'DeleteCommand') {
                                    store.delete(cmd.input.Key.pk);
                                    return {};
                                }
                                if (cmd instanceof ScanCommand || cmd.constructor?.name === 'ScanCommand') {
                                    const entity = cmd.input.ExpressionAttributeValues?.[':entity'];
                                    const Items = [...store.values()].filter((i) => i['_entity'] === entity);
                                    return { Items };
                                }
                                // CreateTableCommand via doc client during init uses CreateTable from client-dynamodb
                                if (cmd.constructor?.name === 'CreateTableCommand') {
                                    return {};
                                }
                                return {};
                            },
                            _client: client,
                        };
                    },
                };
                return { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
    });
    afterEach(() => {
        Mod._load = originalLoad;
    });

    it('covers session CRUD and close', async () => {
        const db = new DynamoDbAgentDb({ tableName: 'T', region: 'us-east-1', endpoint: 'http://localhost:8000' });
        expect(db.type).toBe('dynamodb');
        await db.init();
        await db.init();

        const s = await db.upsertSession({
            sessionId: 's1',
            agentId: 'a1',
            userId: 'u1',
            sessionData: { messages: [] },
        });
        expect(s.session_id).toBe('s1');
        expect(await db.getSession('s1', 'u1')).toBeTruthy();
        expect(await db.getSession('s1', 'other')).toBeNull();
        expect((await db.getSessions({ agentId: 'a1' })).length).toBe(1);

        const m = await db.upsertMemory({ memory: 'hi', userId: 'u1' });
        expect(await db.getMemory(m.memory_id)).toBeTruthy();
        expect((await db.getMemories({ userId: 'u1' })).length).toBeGreaterThan(0);
        expect(await db.deleteMemory(m.memory_id)).toBe(true);

        await db.upsertLearning({ id: 'l1', learningType: 't', content: { x: 1 } });
        expect(await db.getLearning({ learningType: 't' })).toBeTruthy();
        expect(await db.deleteLearning('l1')).toBe(true);

        await db.upsertKnowledge({ id: 'k1', content: 'c' });
        expect(await db.getKnowledge('k1')).toBeTruthy();
        expect(await db.deleteKnowledge('k1')).toBe(true);

        await db.upsertTrace({ trace_id: 'tr1', agent_id: 'a1' });
        expect(await db.getTrace('tr1')).toBeTruthy();

        await db.createSchedule({ id: 'sch1', name: 'n', enabled: true } as any);
        expect(await db.getSchedule('sch1')).toBeTruthy();
        expect(await db.deleteSchedule('sch1')).toBe(true);

        expect(await db.deleteSession('s1')).toBe(true);
        await db.close();
    });
});

describe('TursoAgentDb with fake @libsql/client', () => {
    class FakeLibsql {
        tables = new Map<string, Map<string, Record<string, unknown>>>();
        ensure(name: string) {
            if (!this.tables.has(name)) this.tables.set(name, new Map());
            return this.tables.get(name)!;
        }
        async execute(input: string | { sql: string; args: unknown[] }) {
            const sql = typeof input === 'string' ? input : input.sql;
            const args = typeof input === 'string' ? [] : input.args;
            const s = sql.replace(/\s+/g, ' ').trim();
            if (/^CREATE /i.test(s)) return { rows: [], rowsAffected: 0 };
            if (/^INSERT INTO/i.test(s)) {
                const m = /INSERT INTO (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                const colsMatch = /\(([^)]+)\)\s*VALUES/i.exec(s);
                const cols = (colsMatch?.[1] ?? '').split(',').map((c) => c.trim());
                const row: Record<string, unknown> = {};
                cols.forEach((c, i) => {
                    row[c] = args[i];
                });
                const pk =
                    (row['session_id'] as string) ??
                    (row['memory_id'] as string) ??
                    (row['learning_id'] as string) ??
                    (row['trace_id'] as string) ??
                    (row['id'] as string) ??
                    String(args[0]);
                this.ensure(table).set(pk, { ...this.ensure(table).get(pk), ...row });
                return { rows: [], rowsAffected: 1 };
            }
            if (/^UPDATE/i.test(s)) {
                const m = /UPDATE (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                const id = args[args.length - 1];
                const row = this.ensure(table).get(String(id));
                if (row && /session_data/i.test(s)) {
                    row['session_data'] = args[0];
                    row['updated_at'] = args[1];
                }
                return { rows: [], rowsAffected: row ? 1 : 0 };
            }
            if (/^DELETE FROM/i.test(s)) {
                const m = /DELETE FROM (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                if (args.length === 0) {
                    this.ensure(table).clear();
                    return { rows: [], rowsAffected: 1 };
                }
                const ok = this.ensure(table).delete(String(args[0]));
                return { rows: [], rowsAffected: ok ? 1 : 0 };
            }
            if (/SELECT count\(\*\)/i.test(s)) {
                const m = /FROM (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                return { rows: [{ 'count(*)': this.ensure(table).size }], rowsAffected: 0 };
            }
            if (/SELECT created_at/i.test(s)) {
                const m = /FROM (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                const row = this.ensure(table).get(String(args[0]));
                return { rows: row ? [{ created_at: row['created_at'], access_count: row['access_count'] ?? 0 }] : [], rowsAffected: 0 };
            }
            if (/SELECT \*/i.test(s)) {
                const m = /FROM (\w+)/i.exec(s);
                const table = m?.[1] ?? 't';
                let rows = [...this.ensure(table).values()];
                if (/WHERE/i.test(s) && args.length) {
                    // first equality typically pk
                    const where = s.split(/WHERE/i)[1] ?? '';
                    const col = where.split('=')[0]?.trim();
                    if (col && !col.includes('LIKE')) {
                        rows = rows.filter((r) => r[col] === args[0]);
                        if (args[1] !== undefined && /user_id/i.test(where)) {
                            rows = rows.filter((r) => r['user_id'] === args[1] || r[col!] === args[0]);
                            // re-filter properly
                            const parts = where.split(/AND/i).map((p) => p.trim());
                            rows = [...this.ensure(table).values()];
                            let ai = 0;
                            for (const p of parts) {
                                const c = p.split('=')[0]?.trim();
                                if (!c || c.includes('LIKE') || c.includes('ORDER')) continue;
                                const v = args[ai++];
                                rows = rows.filter((r) => r[c] === v);
                            }
                        }
                    }
                }
                return { rows, rowsAffected: 0 };
            }
            return { rows: [], rowsAffected: 0 };
        }
        close() {}
    }

    beforeEach(() => {
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === '@libsql/client') {
                return {
                    createClient: () => new FakeLibsql(),
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
    });
    afterEach(() => {
        Mod._load = originalLoad;
    });

    it('covers sessions + close', async () => {
        const db = new TursoAgentDb({ url: 'file:test.db', authToken: 'tok' });
        expect(db.type).toBe('turso');
        await db.init();
        await db.init();
        const s = await db.upsertSession({
            sessionId: 's1',
            agentId: 'a1',
            userId: 'u1',
            sessionData: { messages: [] },
        });
        expect(s.session_id).toBe('s1');
        expect(await db.getSession('s1', 'u1')).toBeTruthy();
        expect((await db.getSessions({ userId: 'u1' })).length).toBe(1);
        expect(await db.deleteSession('s1', 'u1')).toBe(true);
        await db.close();
    });
});
