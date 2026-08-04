/**
 * Hermetic coverage for src/agent.ts — the class-based `Agent` entrypoint.
 * Mocks `createAgent` so the fluent builder API, constructor branches, and
 * delegate accessors are all exercised without a real LLM. Vitest only.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock createAgent — we only assert on the Agent class surface, not the runtime.
const fakeDelegate = {
    name: 'Agent',
    instructions: 'i',
    run: vi.fn(async () => ({ answer: 'ok' })),
    stream: vi.fn(async function* () { yield 'chunk'; }),
    streamEvents: vi.fn(async function* () { yield { type: 'text-delta', delta: 'e' }; }),
    createSession: vi.fn(async () => 'sid'),
    getSessionMessages: vi.fn(async () => []),
    resume: vi.fn(() => ({ run: vi.fn(async () => ({ answer: 'r' })) })),
    adapters: { session: 'session-adapter' } as Record<string, unknown>,
    asTool: vi.fn(),
    generate: vi.fn(async () => ({ answer: 'g' })),
};
vi.mock('../src/create-agent.js', () => ({
    createAgent: vi.fn(() => fakeDelegate),
}));

import { Agent } from '../src/agent.js';
import { InMemorySessionStore } from '../src/session/index.js';
import { createAgent } from '../src/create-agent.js';

import type { Tool, ToolRegistry } from '../src/tools/core/index.js';

const fakeTool = { id: 't1', name: 't1', category: 'utility' } as unknown as Tool;
const fakeRegistry: ToolRegistry = {
    register: vi.fn(),
    unregister: vi.fn(() => true),
    get: vi.fn(),
    getByName: vi.fn(),
    list: vi.fn(() => []),
    listByCategory: vi.fn(() => []),
} as unknown as ToolRegistry;

function opts(a: Agent): Record<string, unknown> {
    return (a as any)._opts;
}

describe('Agent constructor branches', () => {
    it('defaults name, session store, and default web tools', () => {
        const a = new Agent({ instructions: 'You are helpful.' });
        const o = (a as any)._opts;
        expect(a.name).toBe('Agent');
        expect(a.instructions).toBe('You are helpful.');
        expect(a.learning).toBe(false);
        expect(o.sessionStore).toBeInstanceOf(InMemorySessionStore);
        expect(Array.isArray(o.tools)).toBe(true);
        expect((o.tools as unknown[]).length).toBe(2);
    });

    it('prefers sessionStore over db and derives memory from learning+memoryStore', () => {
        const db = new InMemorySessionStore();
        const mem = {} as any;
        const a = new Agent({ instructions: 'i', db, memoryStore: mem });
        const o = (a as any)._opts;
        expect(o.sessionStore).toBe(db);
        expect(o.enableAgenticMemory).toBe(true);
        expect(o.memoryStore).toBe(mem);
    });

    it('honours explicit sessionStore without creating a default', () => {
        const store = new InMemorySessionStore();
        const a = new Agent({ instructions: 'i', sessionStore: store });
        expect((a as any)._opts.sessionStore).toBe(store);
    });

    it('defaults enableAgenticMemory to false when no memoryStore is provided', () => {
        const a = new Agent({ instructions: 'i' });
        expect((a as any)._opts.enableAgenticMemory).toBe(false);
    });

    it('accepts a prebuilt ToolRegistry as tools', () => {
        const a = new Agent({ instructions: 'i', tools: fakeRegistry });
        expect((a as any)._opts.tools).toBe(fakeRegistry);
    });
});

describe('Agent fluent builder methods', () => {
    it('withName / withInstructions invalidate and update', () => {
        const a = new Agent({ instructions: 'i' }).withName('Bot').withInstructions('new');
        expect(a.name).toBe('Bot');
        expect(a.instructions).toBe('new');
    });

    it('model / apiKey / baseURL / llm / openRouter', () => {
        const a = new Agent({ instructions: 'i' })
            .model('gpt-4o')
            .apiKey('k')
            .baseURL('https://x')
            .llm({} as any)
            .openRouter({ apiKey: 'r', model: 'm' });
        const o = (a as any)._opts;
        expect(o.model).toBe('gpt-4o');
        expect(o.apiKey).toBe('k');
        expect(o.baseURL).toBe('https://x');
        expect(o.llm).toEqual({});
        expect(o.openRouter).toEqual({ apiKey: 'r', model: 'm' });
    });

    it('temperature / maxTokens / maxSteps / timeout', () => {
        const a = new Agent({ instructions: 'i' })
            .temperature(0.2)
            .maxTokens(128)
            .maxSteps(3)
            .timeout(5000);
        const o = (a as any)._opts;
        expect(o.temperature).toBe(0.2);
        expect(o.maxTokens).toBe(128);
        expect(o.maxSteps).toBe(3);
        expect(o.timeoutMs).toBe(5000);
    });

    it('tool() array, undefined, web, and registry branches', () => {
        // array branch
        const a1 = new Agent({ instructions: 'i' }).tool(fakeTool);
        expect((a1 as any)._opts.tools).toContain(fakeTool);

        // falsy tools branch — tool() bootstraps a fresh array
        const a2 = new Agent({ instructions: 'i', tools: false }).tool(fakeTool);
        expect((a2 as any)._opts.tools).toEqual([fakeTool]);

        // 'web' branch
        const a3 = new Agent({ instructions: 'i', tools: 'web' }).tool(fakeTool);
        expect((a3 as any)._opts.tools.length).toBe(3);

        // registry branch
        const a4 = new Agent({ instructions: 'i', tools: fakeRegistry }).tool(fakeTool);
        expect(fakeRegistry.register).toHaveBeenCalledWith(fakeTool);
    });

    it('tools() replaces the tool set', () => {
        const a = new Agent({ instructions: 'i' }).tools([fakeTool]);
        expect((a as any)._opts.tools).toEqual([fakeTool]);
    });

    it('toolMiddleware / toolRegistryAdapter', () => {
        const mw = (() => ({})) as any;
        const a = new Agent({ instructions: 'i' }).toolMiddleware(mw).toolRegistryAdapter({} as any);
        const o = (a as any)._opts;
        expect(o.toolMiddleware).toEqual([mw]);
        expect(o.toolRegistryAdapter).toBeDefined();
    });

    it('memory / withMemoryContext / memoryAdapter', () => {
        const a = new Agent({ instructions: 'i' })
            .memory({} as any)
            .withMemoryContext(7)
            .memoryAdapter({} as any);
        const o = (a as any)._opts;
        expect(o.memoryStore).toBeDefined();
        expect(o.enableAgenticMemory).toBe(true);
        expect(o.addMemoriesToContext).toBe(true);
        expect(o.numMemories).toBe(7);
        expect(o.memoryStoreAdapter).toBeDefined();
    });

    it('knowledgebase / ragAdapter', () => {
        const a = new Agent({ instructions: 'i' }).knowledgebase({} as any).ragAdapter({} as any);
        const o = (a as any)._opts;
        expect(o.knowledgebase).toBeDefined();
        expect(o.ragAdapter).toBeDefined();
    });

    it('session / sessionAdapter / historyRuns / historyMessages', () => {
        const store = new InMemorySessionStore();
        const a = new Agent({ instructions: 'i' })
            .session(store)
            .sessionAdapter({} as any)
            .historyRuns(2)
            .historyMessages(4);
        const o = (a as any)._opts;
        expect(o.sessionStore).toBe(store);
        expect(o.sessionStoreAdapter).toBeDefined();
        expect(o.numHistoryRuns).toBe(2);
        expect(o.numHistoryMessages).toBe(4);
    });

    it('guardrails / guardrailAdapter', () => {
        const a = new Agent({ instructions: 'i' }).guardrails({} as any).guardrailAdapter({} as any);
        const o = (a as any)._opts;
        expect(o.guardrails).toBeDefined();
        expect(o.guardrailAdapter).toBeDefined();
    });

    it('durable() with and without an explicit store', () => {
        const store = {} as any;
        const a1 = new Agent({ instructions: 'i' }).durable(store);
        expect((a1 as any)._opts.checkpointStore).toBe(store);

        const a2 = new Agent({ instructions: 'i' }).durable();
        expect((a2 as any)._opts.checkpointStore).toBeDefined();
    });

    it('storage / budget / compression', () => {
        const a = new Agent({ instructions: 'i' })
            .storage({} as any)
            .budget({ maxUsdPerRun: 1 } as any)
            .compression(false);
        const o = (a as any)._opts;
        expect(o.storage).toBeDefined();
        expect(o.budget).toEqual({ maxUsdPerRun: 1 });
        expect(o.mastermind).toBe(false);
    });

    it('hooks merges with existing hooks', () => {
        const a = new Agent({ instructions: 'i' }).hooks({ beforeRun: (async () => '') as any });
        expect((a as any)._opts.hooks.beforeRun).toBeDefined();
    });

    it('adapters / auth / rateLimit / auditLog adapters', () => {
        const a = new Agent({ instructions: 'i' })
            .adapters({} as any)
            .authAdapter({} as any)
            .rateLimitAdapter({} as any)
            .auditLogAdapter({} as any);
        const o = (a as any)._opts;
        expect(o.adapters).toBeDefined();
        expect(o.authAdapter).toBeDefined();
        expect(o.rateLimitAdapter).toBeDefined();
        expect(o.auditLogAdapter).toBeDefined();
    });

    it('retry / inputSchema / outputSchema', () => {
        const a = new Agent({ instructions: 'i' })
            .retry({ maxRetries: 2 })
            .inputSchema({} as any)
            .outputSchema({} as any);
        const o = (a as any)._opts;
        expect(o.retry).toEqual({ maxRetries: 2 });
        expect(o.inputSchema).toBeDefined();
        expect(o.outputSchema).toBeDefined();
    });

    it('dev / logger / followUps', () => {
        const a = new Agent({ instructions: 'i' }).dev(false).logger({} as any).followUps(5);
        const o = (a as any)._opts;
        expect(o.dev).toBe(false);
        expect(o.logger).toBeDefined();
        expect(o.followUps).toBe(true);
        expect(o.numFollowups).toBe(5);
    });
});

describe('Agent delegate accessors and run path', () => {
    it('lazily creates the delegate via createAgent', () => {
        const createAgentMock = createAgent as unknown as ReturnType<typeof vi.fn>;
        createAgentMock.mockClear();
        const a = new Agent({ instructions: 'i' });
        // Accessing resolvedAdapters forces delegate creation.
        expect(a.resolvedAdapters).toBe(fakeDelegate.adapters);
        expect(createAgentMock).toHaveBeenCalledOnce();

        // invalidate() clears the cached delegate; re-access rebuilds it.
        (a as any).withName('x');
        expect((a as any)._delegate).toBeUndefined();
        expect(a.resolvedAdapters).toBe(fakeDelegate.adapters);
        expect(createAgentMock).toHaveBeenCalledTimes(2);
    });

    it('run / stream / streamEvents delegate through', async () => {
        const a = new Agent({ instructions: 'i' });
        const res = await a.run('hi');
        expect(res.answer).toBe('ok');
        expect(fakeDelegate.run).toHaveBeenCalledWith('hi', undefined);

        const chunks: string[] = [];
        for await (const c of a.stream('hi')) chunks.push(c);
        expect(chunks).toEqual(['chunk']);

        const events: unknown[] = [];
        for await (const e of a.streamEvents('hi')) events.push(e);
        expect(events.length).toBe(1);
    });

    it('session helpers and resume delegate through', async () => {
        const a = new Agent({ instructions: 'i' });
        expect(await a.createSession('u1')).toBe('sid');
        expect(await a.getSessionMessages('sid')).toEqual([]);
        const s = a.resume('sid');
        expect(fakeDelegate.resume).toHaveBeenCalledWith('sid');
        expect(s.run).toBeDefined();
    });

    it('invalidate clears the cached delegate', () => {
        const a = new Agent({ instructions: 'i' });
        expect(a.resolvedAdapters).toBeDefined();
        (a as any).withName('x'); // triggers invalidate()
        expect((a as any)._delegate).toBeUndefined();
    });
});
