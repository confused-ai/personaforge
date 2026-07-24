/**
 * Tests for the pure in-memory backends:
 *   - InMemoryStore        (memory/in-memory-store.ts)
 *   - InMemoryVectorStore  (memory/in-memory-vector-store.ts)
 *
 * Verifies CRUD, retrieval, filtering, retention, and vector similarity search
 * — the semantics every higher-level memory feature depends on.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/memory/in-memory-store.js';
import { InMemoryVectorStore } from '../src/memory/in-memory-vector-store.js';
import { MemoryType } from '../src/memory/types.js';

describe('InMemoryStore — CRUD & lifecycle', () => {
    let store: InMemoryStore;
    beforeEach(() => { store = new InMemoryStore(); });

    it('store() assigns id + createdAt and round-trips via get()', async () => {
        const e = await store.store({
            type: MemoryType.SHORT_TERM,
            content: 'hello',
            metadata: { source: 'test', tags: ['a'] },
        });
        expect(e.id).toBeTruthy();
        expect(e.createdAt).toBeInstanceOf(Date);
        const got = await store.get(e.id);
        expect(got?.content).toBe('hello');
    });

    it('get() returns null for unknown id', async () => {
        expect(await store.get('nonexistent')).toBeNull();
    });

    it('update() applies partial updates and rejects unknown id', async () => {
        const e = await store.store({ type: MemoryType.LONG_TERM, content: 'v1', metadata: {} });
        const updated = await store.update(e.id, { content: 'v2' });
        expect(updated.content).toBe('v2');
        await expect(store.update('nope', { content: 'x' })).rejects.toThrow();
    });

    it('delete() returns true when removed and false otherwise', async () => {
        const e = await store.store({ type: MemoryType.LONG_TERM, content: 'x', metadata: {} });
        expect(await store.delete(e.id)).toBe(true);
        expect(await store.delete('nope')).toBe(false);
        expect(await store.get(e.id)).toBeNull();
    });

    it('clear() removes all when no type given, only that type when specified', async () => {
        await store.store({ type: MemoryType.SHORT_TERM, content: 's', metadata: {} });
        await store.store({ type: MemoryType.LONG_TERM,  content: 'l', metadata: {} });
        await store.clear(MemoryType.SHORT_TERM);
        expect((await store.snapshot()).length).toBe(1);
        await store.clear();
        expect((await store.snapshot()).length).toBe(0);
    });

    it('getRecent() returns newest-first, respects limit and type filter', async () => {
        const a = await store.store({ type: MemoryType.LONG_TERM, content: 'A', metadata: {} });
        // Small yield so createdAt differs
        await new Promise((r) => setTimeout(r, 5));
        const b = await store.store({ type: MemoryType.LONG_TERM, content: 'B', metadata: {} });
        await store.store({ type: MemoryType.SHORT_TERM, content: 'C', metadata: {} });

        const recent = await store.getRecent(10, MemoryType.LONG_TERM);
        expect(recent.map((r) => r.id)).toEqual([b.id, a.id]);

        const one = await store.getRecent(1);
        expect(one.length).toBe(1);
    });
});

describe('InMemoryStore — retrieve()', () => {
    let store: InMemoryStore;
    beforeEach(() => { store = new InMemoryStore(); });

    it('substring text search returns matching entries', async () => {
        await store.store({ type: MemoryType.SEMANTIC, content: 'the cat sat on the mat', metadata: {} });
        await store.store({ type: MemoryType.SEMANTIC, content: 'the dog barked', metadata: {} });
        const results = await store.retrieve({ query: 'cat', type: MemoryType.SEMANTIC });
        expect(results.length).toBe(1);
        expect(results[0]!.entry.content).toContain('cat');
    });

    it('respects the type filter', async () => {
        await store.store({ type: MemoryType.SHORT_TERM, content: 'find me', metadata: {} });
        await store.store({ type: MemoryType.LONG_TERM,  content: 'find me', metadata: {} });
        const results = await store.retrieve({ query: 'find', type: MemoryType.LONG_TERM });
        expect(results.every((r) => r.entry.type === MemoryType.LONG_TERM)).toBe(true);
    });

    it('respects the limit', async () => {
        for (let i = 0; i < 5; i++) {
            await store.store({ type: MemoryType.SEMANTIC, content: `hit ${i}`, metadata: {} });
        }
        const results = await store.retrieve({ query: 'hit', limit: 2 });
        expect(results.length).toBe(2);
    });
});

describe('InMemoryVectorStore', () => {
    it('upsert + search returns nearest first by cosine similarity', async () => {
        const store = new InMemoryVectorStore();
        await store.upsert([
            { id: 'a', vector: [1, 0, 0], metadata: { tag: 'x-axis' } },
            { id: 'b', vector: [0, 1, 0], metadata: { tag: 'y-axis' } },
            { id: 'c', vector: [0, 0, 1], metadata: { tag: 'z-axis' } },
        ]);
        const results = await store.search([0.9, 0.1, 0], 2);
        expect(results[0]!.id).toBe('a');
        expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it('delete() removes items so they do not appear in search results', async () => {
        const store = new InMemoryVectorStore();
        await store.upsert([
            { id: 'a', vector: [1, 0, 0], metadata: {} },
            { id: 'b', vector: [1, 0, 0], metadata: {} },
        ]);
        await store.delete(['a']);
        const results = await store.search([1, 0, 0], 5);
        expect(results.map((r) => r.id)).not.toContain('a');
    });

    it('search with limit=0 returns empty', async () => {
        const store = new InMemoryVectorStore();
        await store.upsert([{ id: 'a', vector: [1, 0, 0], metadata: {} }]);
        const results = await store.search([1, 0, 0], 0);
        expect(results.length).toBe(0);
    });

    it('upsert() overwrites existing entries with the same id', async () => {
        const store = new InMemoryVectorStore();
        await store.upsert([{ id: 'a', vector: [1, 0, 0], metadata: { v: 1 } }]);
        await store.upsert([{ id: 'a', vector: [0, 1, 0], metadata: { v: 2 } }]);
        const results = await store.search([0, 1, 0], 1);
        expect(results[0]!.id).toBe('a');
        expect(results[0]!.metadata).toEqual({ v: 2 });
    });

    it('search filters by metadata when a filter is provided', async () => {
        const store = new InMemoryVectorStore();
        await store.upsert([
            { id: 'a', vector: [1, 0, 0], metadata: { tag: 'x' } },
            { id: 'b', vector: [1, 0, 0], metadata: { tag: 'y' } },
        ]);
        const results = await store.search([1, 0, 0], 5, { tag: 'x' });
        expect(results.map((r) => r.id)).toEqual(['a']);
    });

    it('get() returns null for unknown id and the entry for a known one', async () => {
        const store = new InMemoryVectorStore();
        await store.upsert([{ id: 'a', vector: [1, 0, 0], metadata: { k: 'v' } }]);
        expect(await store.get('nope')).toBeNull();
        const got = await store.get('a');
        expect(got?.metadata).toEqual({ k: 'v' });
    });

    it('clear() empties the store', async () => {
        const store = new InMemoryVectorStore();
        await store.upsert([{ id: 'a', vector: [1, 0, 0], metadata: {} }]);
        await store.clear();
        expect(await store.get('a')).toBeNull();
    });
});
