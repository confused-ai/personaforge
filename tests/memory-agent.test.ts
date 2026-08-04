/**
 * End-to-end: a Mastra-style `Memory` wired onto `createAgent` — message
 * persistence across runs, working-memory injection and thread scoping.
 */

import { describe, it, expect } from 'vitest';
import { createAgent } from '../src/create-agent/index.js';
import { Memory } from '../src/memory/memory.js';
import { InMemoryThreadStore } from '../src/memory/in-memory-thread-store.js';
import type { LLMProvider } from '../src/contracts/interfaces.js';

function stub(final?: string): LLMProvider {
    return {
        generateText: async () => ({ text: final ?? 'ok.', finishReason: 'stop' as const }),
    };
}

describe('createAgent + Memory (e2e)', () => {
    it('persists threads/messages across runs and injects working memory', async () => {
        const store = new InMemoryThreadStore();
        const memory = new Memory({
            storage: store,
            options: {
                lastMessages: 20,
                workingMemory: { template: '# Profile\n- Name:' },
            },
        });
        const agent = createAgent({
            name: 'assistant',
            instructions: 'You are a helpful assistant.',
            llm: stub(),
            memory,
        });

        const r1 = await agent.run('Hi, remember I am Alice.', { memory: { thread: 't1', resource: 'alice' } });
        expect(r1.text).toBe('ok.');

        // thread was created + messages persisted
        const thread = await memory.getThreadById('t1');
        expect(thread?.resourceId).toBe('alice');
        const msgs = await memory.getMessages('t1');
        expect(msgs.length).toBeGreaterThanOrEqual(2); // user + assistant

        // working memory is available for the resource
        const wm = await memory.workingMemoryContext('alice');
        expect(wm).toContain('# Profile');

        // second run on the same thread grows history
        await agent.run('And I work at Acme.', { memory: { thread: 't1', resource: 'alice' } });
        expect((await memory.getMessages('t1')).length).toBeGreaterThan(msgs.length);

        // resource scoping
        expect((await memory.getThreadByResourceId('alice')).map((t) => t.id)).toContain('t1');
    });

    it('recall returns remembered content after indexing (inline agent path)', async () => {
        const store = new InMemoryThreadStore();
        const memory = new Memory({
            storage: store,
            options: { semanticRecall: true, lastMessages: 20 },
        });
        const agent = createAgent({
            name: 'assistant',
            instructions: 'You are a helpful assistant.',
            llm: stub(),
            memory,
        });
        await agent.run('My favorite color is teal.', { memory: { thread: 't2', resource: 'alice' } });

        const hits = await memory.recall('t2', 'alice', 'favorite color');
        expect(hits.some((h) => h.includes('teal'))).toBe(true);
    });
});
