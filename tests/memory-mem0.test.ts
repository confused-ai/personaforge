/**
 * Tests for the mem0-style memory engine: CRUD, keyword + vector search,
 * LLM extraction (ADD/UPDATE/NONE/DELETE), audit history and agent tools.
 */

import { describe, it, expect } from 'vitest';
import { Mem0Memory, InMemoryMem0Store, createMem0MemoryTools } from '../src/memory/mem0.js';
import { HashingEmbedder } from '../src/memory/token-estimator.js';
import { InMemoryVectorStore } from '../src/memory/in-memory-vector-store.js';
import type { LLMProvider } from '../src/contracts/interfaces.js';

function extractionLlm(ops: Array<Record<string, unknown>>): LLMProvider {
    return {
        generateText: async () => ({
            text: JSON.stringify({ memories: ops }),
            finishReason: 'stop' as const,
        }),
    };
}

describe('Mem0Memory — CRUD', () => {
    it('add + addMemories + getAll round-trip', async () => {
        const mem = new Mem0Memory({ store: new InMemoryMem0Store() });
        const id = await mem.add('User prefers dark mode', { userID: 'alice' });
        expect(id).toBeTruthy();
        const ids = await mem.addMemories(['Works at Acme', 'Likes TypeScript'], { userID: 'alice' });
        expect(ids).toHaveLength(2);
        const all = await mem.getAll({ userID: 'alice' });
        expect(all.map((f) => f.content)).toEqual(expect.arrayContaining(['User prefers dark mode', 'Works at Acme']));
    });

    it('add deduplicates identical facts (hash match updates instead of inserting)', async () => {
        const store = new InMemoryMem0Store();
        const mem = new Mem0Memory({ store });
        const first = await mem.add('User uses vim', { userID: 'alice' });
        await mem.add('User uses vim', { userID: 'alice' });
        expect(await store.list()).toHaveLength(1);
        const again = await mem.add('User uses vim', { userID: 'alice', metadata: { source: 'onboarding' } });
        expect(again).toBe(first);
        expect((await store.get(first))?.metadata['source']).toBe('onboarding');
    });

    it('update/delete/reset mutate state; delete returns boolean', async () => {
        const mem = new Mem0Memory({ store: new InMemoryMem0Store() });
        const id = await mem.add('Likes coffee', { userID: 'bob' });
        const updated = await mem.update(id, 'Likes tea', { userID: 'bob' });
        expect(updated.content).toBe('Likes tea');
        expect(await mem.getHistory()).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'UPDATE' })]));
        expect(await mem.delete(id)).toBe(true);
        expect(await mem.delete(id)).toBe(false);
        await mem.add('x', { userID: 'bob' });
        await mem.reset();
        expect(await mem.getAll()).toHaveLength(0);
    });
});

describe('Mem0Memory — search', () => {
    it('keyword search ranks facts by token overlap when no embedder is configured', async () => {
        const mem = new Mem0Memory({ store: new InMemoryMem0Store() });
        await mem.add('Prefers dark mode IDE theme', { userID: 'alice' });
        await mem.add('Rainy weather in Seattle', { userID: 'alice' });
        const results = await mem.search('dark theme', { userID: 'alice' });
        expect(results[0]?.content).toContain('dark mode');
        expect(results[0]?.score).toBeGreaterThan(0);
    });

    it('vector search works with an embedder + vector store', async () => {
        const mem = new Mem0Memory({
            store: new InMemoryMem0Store(),
            embedder: new HashingEmbedder(),
            vectorStore: new InMemoryVectorStore(),
        });
        await mem.add('User prefers dark mode', { userID: 'alice' });
        await mem.add('The cat sat on the mat', { userID: 'alice' });
        const results = await mem.search('dark mode preference', { userID: 'alice' });
        expect(results[0]?.content).toContain('dark mode');
    });

    it('fileter by runID excludes other runs', async () => {
        const mem = new Mem0Memory({ store: new InMemoryMem0Store() });
        await mem.add('remember me', { userID: 'u', runID: 'run-1' });
        await mem.add('also me', { userID: 'u', runID: 'run-2' });
        expect((await mem.getAll({ userID: 'u', runID: 'run-1' })).map((f) => f.content)).toEqual(['remember me']);
    });
});

describe('Mem0Memory — LLM extraction pipeline', () => {
    const messages = [
        { role: 'user' as const, content: 'My name is Alice and I work at Acme.' },
        { role: 'assistant' as const, content: 'Noted!' },
    ];

    it('extract returns the LLM-decided operations without applying them', async () => {
        const mem = new Mem0Memory({
            llm: extractionLlm([
                { content: 'User is Alice', op: 'ADD' },
                { content: 'User is Bob', op: 'UPDATE', old_content: 'User is Alice' },
                { content: 'Trivial', op: 'NONE' },
            ]),
        });
        const extracted = await mem.extract(messages);
        expect(extracted).toEqual([
            { content: 'User is Alice', op: 'ADD' },
            { content: 'User is Bob', op: 'UPDATE', oldContent: 'User is Alice' },
            { content: 'Trivial', op: 'NONE' },
        ]);
        expect(await mem.getAll()).toHaveLength(0);
    });

    it('processMessages applies ADD / UPDATE / DELETE against the store', async () => {
        const llm = extractionLlm([
            { content: 'User is Bob', op: 'UPDATE', old_content: 'User is Alice' },
            { content: 'Loves hiking', op: 'ADD' },
            { content: 'Old memory invalid', op: 'DELETE', old_content: 'User is Alice' },
        ]);
        const applied = new Mem0Memory({ store: new InMemoryMem0Store(), llm });
        await applied.add('User is Alice', { userID: 'alice' });
        const ops = await applied.processMessages(
            [
                { role: 'user', content: "It's Bob now, and I love hiking." },
                { role: 'assistant', content: 'Updated.' },
            ],
            { userID: 'alice' },
        );
        expect(ops.map((o) => o.op)).toEqual(['UPDATE', 'ADD', 'DELETE']);
        const all = await applied.getAll({ userID: 'alice' });
        expect(all.map((f) => f.content)).toEqual(expect.arrayContaining(['User is Bob', 'Loves hiking']));
        expect(all.some((f) => f.content === 'User is Alice')).toBe(false);
    });
});

describe('Mem0Memory — agent tools', () => {
    it('exposes search/add/get_all/delete tools that execute against the engine', async () => {
        const mem = new Mem0Memory({ store: new InMemoryMem0Store() });
        const tools = createMem0MemoryTools(mem);
        expect(Object.keys(tools).sort()).toEqual(['add_mem0', 'delete_memory', 'get_all_memories', 'search_mem0']);

        const added = await tools.add_mem0.execute({ fact: 'User lives in Berlin' });
        expect(added.stored).toBe(true);

        const found = await tools.search_mem0.execute({ query: 'where does the user live?' });
        expect(found.memories[0]?.content).toContain('Berlin');

        const listed = await tools.get_all_memories.execute({});
        expect(listed.memories).toHaveLength(1);

        const deleted = await tools.delete_memory.execute({ id: added.id });
        expect(deleted.deleted).toBe(true);
    });
});
