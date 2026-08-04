/**
 * Tests for the Mastra-style thread/message stores:
 *   - InMemoryThreadStore (zero-dep)
 *   - LibSqlThreadStore (default; `@libsql/client`)
 *   - SqliteThreadStore (better-sqlite3)
 *   - createThreadStore factory (libSQL-first with fallback)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { InMemoryThreadStore } from '../src/memory/in-memory-thread-store.js';
import { LibSqlThreadStore } from '../src/memory/libsql-thread-store.js';
import { SqliteThreadStore } from '../src/memory/sqlite-thread-store.js';
import { createThreadStore } from '../src/memory/thread-store-factory.js';
import type { StorageMessage } from '../src/memory/threads.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function canLoadBetterSqlite3(): boolean {
    try {
        const Database = createRequire(import.meta.url)('better-sqlite3') as new (path: string) => unknown;
        // Instantiating forces the native binding to load — Bun fails here.
        new Database(':memory:');
        return true;
    } catch {
        return false;
    }
}

const msg = (role: StorageMessage['role'], content: string): StorageMessage => ({ role, content });

function exerciseStore(name: string, store: () => import('../src/memory/thread-store.js').ThreadStore) {
    describe(name, () => {
        it('createThread → getThread round-trip with metadata + title', async () => {
            const s = store();
            const t = await s.createThread({ id: 't1', resourceId: 'alice', title: 'Hi', metadata: { tags: ['a'] } });
            const got = await s.getThread('t1');
            expect(got?.id).toBe('t1');
            expect(got?.resourceId).toBe('alice');
            expect(got?.title).toBe('Hi');
            expect(got?.metadata).toEqual({ tags: ['a'] });
            await expect(s.createThread({ id: 't1', resourceId: 'alice' })).rejects.toThrow();
        });

        it('getThreadByResourceId + listThreads filter by resource + title', async () => {
            const s = store();
            await s.createThread({ id: 'a1', resourceId: 'alice', title: 'Order status' });
            await s.createThread({ id: 'b1', resourceId: 'bob' });
            expect((await s.getThreadByResourceId('alice')).map((x) => x.id)).toEqual(['a1']);
            expect((await s.listThreads({ resourceId: 'bob' })).map((x) => x.id)).toEqual(['b1']);
            expect((await s.listThreads({ title: 'order' })).map((x) => x.id)).toEqual(['a1']);
        });

        it('updateThread sets title/metadata/state; missing thread rejects', async () => {
            const s = store();
            await s.createThread({ id: 't2', resourceId: 'alice' });
            const updated = await s.updateThread('t2', { title: 'New', state: { observedUntilId: 'm10' } });
            expect(updated.title).toBe('New');
            expect(updated.state?.observedUntilId).toBe('m10');
            await expect(s.updateThread('nope', {})).rejects.toThrow();
        });

        it('saveMessages assigns ids/timestamps and getMessages returns oldest-first', async () => {
            const s = store();
            await s.createThread({ id: 't3', resourceId: 'alice' });
            const stored = await s.saveMessages('t3', [msg('user', 'first'), msg('assistant', 'second')]);
            expect(stored[0]).toMatchObject({ id: expect.any(String), threadId: 't3', createdAt: expect.any(String) });
            const all = await s.getMessages('t3');
            expect(all.map((m) => m.content)).toEqual(['first', 'second']);
        });

        it('afterId cursor (OM semantics) returns younger messages only', async () => {
            const s = store();
            await s.createThread({ id: 't4', resourceId: 'alice' });
            const [a, b, c] = await s.saveMessages('t4', [msg('user', 'A'), msg('user', 'B'), msg('user', 'C')]);
            const rest = await s.getMessages('t4', { afterId: a.id });
            expect(rest.map((m) => m.content)).toEqual(['B', 'C']);
            await s.deleteMessages('t4', [b.id!]);
            expect((await s.getMessages('t4')).map((m) => m.content)).toEqual(['A', 'C']);
        });

        it('getMessageCount + deleteThread cascade', async () => {
            const s = store();
            await s.createThread({ id: 't5', resourceId: 'alice' });
            await s.saveMessages('t5', [msg('user', 'x'), msg('user', 'y')]);
            expect(await s.getMessageCount('t5')).toBe(2);
            await s.deleteThread('t5');
            expect(await s.getMessages('t5')).toEqual([]);
            expect(await s.getThread('t5')).toBeNull();
        });
    });
}

for (const make of [
    () => new InMemoryThreadStore(),
    () => createThreadStore({ driver: 'memory' }),
]) {
    exerciseStore('InMemoryThreadStore', make);
}

let sqliteDir: string;
beforeAll(() => {
    sqliteDir = mkdtempSync(join(tmpdir(), 'pf-memory-'));
});
afterAll(() => {
    rmSync(sqliteDir, { recursive: true, force: true });
});

if (canLoadBetterSqlite3()) {
    exerciseStore('SqliteThreadStore', () => new SqliteThreadStore({ path: join(sqliteDir, `s-${Math.random()}.db`) }));
} else {
    describe('SqliteThreadStore (skipped)', () => {
        it.skip('better-sqlite3 is not supported in this runtime (Bun)', () => {});
    });
}
exerciseStore('LibSqlThreadStore (file)', () => new LibSqlThreadStore({ url: join(sqliteDir, `l-${Math.random()}.db`) }));
exerciseStore('createThreadStore (libsql default)', () => createThreadStore({ url: join(sqliteDir, `m-${Math.random()}.db`) }));

describe('createThreadStore — libSQL-first defaults', () => {
    it('defaults to a libsql-backed store when @libsql/client is installed', async () => {
        const store = createThreadStore();
        expect(store).toBeInstanceOf(LibSqlThreadStore);
    });

    it('explicit driver:memory is a pure in-memory store', () => {
        expect(createThreadStore({ driver: 'memory' })).toBeInstanceOf(InMemoryThreadStore);
    });
});
