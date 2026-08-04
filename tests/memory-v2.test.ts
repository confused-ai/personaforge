/**
 * Tests for the unified `Memory` class (threads, working memory, semantic
 * recall, agent tools + inline `createAgent` integration surface).
 */

import { describe, it, expect } from 'vitest';
import { Memory, createMem0MemoryTools } from '../src/memory/memory.js';
import { InMemoryThreadStore } from '../src/memory/in-memory-thread-store.js';
import { HashingEmbedder } from '../src/memory/token-estimator.js';
import { Mem0Memory } from '../src/memory/mem0.js';
import type { LLMProvider } from '../src/contracts/interfaces.js';

function stub(final?: string): LLMProvider {
    return {
        generateText: async () => ({ text: final ?? 'ok.', finishReason: 'stop' as const }),
    };
}

describe('Memory — message history + threads', () => {
    it('lazy-creates a thread and round-trips messages via the legacy 3-arg saveMessages', async () => {
        const m = new Memory({ storage: new InMemoryThreadStore() });
        await m.saveMessages('t1', 'alice', [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi!' },
        ]);
        const [user, assistant] = await m.getMessages('t1');
        expect(user.content).toBe('hello');
        expect(assistant.content).toBe('hi!');
        expect((await m.getThreadById('t1'))?.resourceId).toBe('alice');
    });

    it('ensureThread is idempotent and enforces a single owner per thread', async () => {
        const m = new Memory({ storage: new InMemoryThreadStore() });
        const t = await m.ensureThread({ threadId: 't2', resourceId: 'alice' });
        const again = await m.ensureThread({ threadId: 't2', resourceId: 'alice' });
        expect(again.id).toBe(t.id);
        await expect(m.ensureThread({ threadId: 't2', resourceId: 'bob' })).rejects.toThrow(/single owner/);
    });

    it('listMessages paginates and reports totals', async () => {
        const m = new Memory({ storage: new InMemoryThreadStore() });
        await m.createThread({ threadId: 't3', resourceId: 'alice' });
        await m.saveMessages('t3', 'alice', Array.from({ length: 12 }, (_, i) => ({ role: 'user' as const, content: `m${i}` })));
        const page1 = await m.listMessages({ threadId: 't3', perPage: 5, page: 1 });
        expect(page1.messages).toHaveLength(5);
        expect(page1.total).toBe(12);
        const page3 = await m.listMessages({ threadId: 't3', perPage: 5, page: 3 });
        expect(page3.messages).toHaveLength(2);
    });

    it('deleteThread scoped to resource owner', async () => {
        const m = new Memory({ storage: new InMemoryThreadStore() });
        await m.createThread({ threadId: 't4', resourceId: 'alice' });
        await expect(m.deleteThread('t4', { resourceId: 'bob' })).rejects.toThrow(/owned by/);
        await m.deleteThread('t4', { resourceId: 'alice' });
        expect(await m.getThreadById('t4')).toBeNull();
    });
});

describe('Memory — working memory', () => {
    it('template kind: update replaces; workingMemoryContext renders the block or template', async () => {
        const m = new Memory({
            storage: new InMemoryThreadStore(),
            options: { workingMemory: { template: '# Profile\n- Name:\n- Style:' } },
        });
        await m.createThread({ threadId: 'w1', resourceId: 'alice' });

        // unset → template with placeholder shown to the model
        const before = await m.workingMemoryContext('alice');
        expect(before).toContain('# Profile');

        await m.updateWorkingMemory({ threadId: 'w1', resourceId: 'alice', workingMemory: '# Profile\n- Name: Alice\n- Style: Casual' });
        const after = await m.workingMemoryContext('alice');
        expect(after).toContain('Name: Alice');
        expect(after).toContain('- Style: Casual'); // replaced verbatim — the stored block IS the newest content
    });

    it('schema kind: deep-merges updates and null deletes fields', async () => {
        const m = new Memory({
            storage: new InMemoryThreadStore(),
            options: {
                workingMemory: {
                    schema: { type: 'object', properties: {} },
                    scope: 'resource',
                },
            },
        });
        await m.createThread({ threadId: 'w2', resourceId: 'bob' });
        await m.updateWorkingMemory({ threadId: 'w2', resourceId: 'bob', workingMemory: '{"name":"Bob","prefs":{"theme":"dark"}}' });
        await m.updateWorkingMemory({ threadId: 'w2', resourceId: 'bob', workingMemory: '{"prefs":{"lang":"ts"},"nick":null}' });
        const value = await m.getWorkingMemory({ threadId: 'w2', resourceId: 'bob' });
        const parsed = JSON.parse(value!);
        expect(parsed).toEqual({ name: 'Bob', prefs: { theme: 'dark', lang: 'ts' } });
    });

    it('exposes an updateWorkingMemory agent tool when agent-managed', async () => {
        const m = new Memory({
            storage: new InMemoryThreadStore(),
            options: { workingMemory: { template: '# P' } },
        });
        const tools = m.getAgentTools();
        expect(tools.some((t) => t.name === 'updateWorkingMemory')).toBe(true);
        await m.createThread({ threadId: 'w3', resourceId: 'alice' });
        const tool = tools.find((t) => t.name === 'updateWorkingMemory')!;
        const out = await tool.execute({ threadId: 'w3', resourceId: 'alice', workingMemory: '# Profile\n- Name: X' });
        expect(out).toEqual({ updated: true });
        expect(await m.getWorkingMemory({ threadId: 'w3', resourceId: 'alice' })).toBe('# Profile\n- Name: X');
    });
});

describe('Memory — semantic recall (zero-config hashing embedder)', () => {
    it('indexes messages and recalls them by meaning (legacy string[] API)', async () => {
        const m = new Memory({
            storage: new InMemoryThreadStore(),
            options: { semanticRecall: true, lastMessages: 100 },
        });
        const stored = await m.saveMessages('r1', 'alice', [
            { role: 'user', content: 'I prefer dark mode and use TypeScript everywhere' },
            { role: 'user', content: 'The weather is rainy today in Seattle' },
        ]);
        await m.indexStoredMessages('r1', 'alice', stored);

        const matches = await m.recall('r1', 'alice', 'prefer dark mode');
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0]).toContain('dark mode');
    });

    it('recall({ threadId, vectorSearchString }) returns structured messages', async () => {
        const m = new Memory({
            storage: new InMemoryThreadStore(),
            options: { semanticRecall: true },
        });
        await m.createThread({ threadId: 'r2', resourceId: 'alice' });
        const stored = await m.saveMessages('r2', 'alice', [{ role: 'user', content: 'Book me a flight to Tokyo on Friday' }]);
        await m.indexStoredMessages('r2', 'alice', stored);
        const { messages } = await m.recall({ threadId: 'r2', vectorSearchString: 'book a flight to tokyo', perPage: 3 });
        expect(messages.some((msg) => String(msg.content).includes('Tokyo'))).toBe(true);
    });

    it('throws a clear error when semantic recall is not configured', async () => {
        const m = new Memory({ storage: new InMemoryThreadStore() });
        await expect(m.recall({ threadId: 'r3', vectorSearchString: 'x' })).rejects.toThrow(/semantic recall requires/);
    });
});

describe('Memory — mem0 engine + tools', () => {
    it('auto-builds a Mem0Memory and exposes mem0 agent tools', async () => {
        const m = new Memory({
            storage: new InMemoryThreadStore(),
            llm: stub(),
            options: { mem0: { autoExtract: false } },
        });
        expect(m.mem0).toBeInstanceOf(Mem0Memory);
        const names = m.getAgentTools().map((t) => t.name);
        expect(names).toContain('search_mem0');
        expect(names).toContain('add_mem0');
        expect(names).toContain('get_all_memories');
        expect(names).toContain('delete_memory');

        const engine = new Mem0Memory();
        const tools = createMem0MemoryTools(engine);
        const added = await tools.add_mem0.execute({ fact: 'User prefers dark mode' });
        expect(added.stored).toBe(true);
        const results = await tools.search_mem0.execute({ query: 'dark theme?' });
        expect(results.memories.some((r) => r.content.includes('dark mode'))).toBe(true);
    });

    it('HashingEmbedder produces normalised, dim-consistent vectors', async () => {
        const e = new HashingEmbedder();
        expect(e.getDimension()).toBe(384);
        const [a, b] = await e.embedBatch(['hello dark mode', 'hello dark mode']);
        expect(a).toHaveLength(384);
        const dot = a.reduce((acc, v, i) => acc + v * (b[i] ?? 0), 0);
        expect(dot).toBeCloseTo(1, 2);
    });
});
