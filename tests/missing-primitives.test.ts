/**
 * Tests for the missing capability primitives:
 * eventBus()/AGENT_EVENT, AgentRegistry, and the DX factories
 * pipeline() / task() / guard() / model() / router().
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { eventBus, AGENT_EVENT, createAgentEventBus } from '../src/events/index.js';
import { AgentRegistry, createAgentRegistry } from '../src/registry/index.js';import { pipeline } from '../src/dx/pipeline.js';
import { task } from '../src/dx/task.js';
import { guard, GuardError } from '../src/dx/guard.js';
import { model, router } from '../src/dx/model.js';
import { createComposeAgent } from './helpers/compose-agent.js';

// ── eventBus() ─────────────────────────────────────────────────────────────

describe('eventBus() / AGENT_EVENT', () => {
    it('is a fully-typed bus wired to the core vocabulary', async () => {
        const bus = eventBus();
        const onFinished = vi.fn();
        bus.on(AGENT_EVENT.runFinished, onFinished);

        await bus.emit(AGENT_EVENT.runFinished, { agentId: 'a1', sessionId: 's1', result: { text: 'done' } });

        expect(onFinished).toHaveBeenCalledWith({ agentId: 'a1', sessionId: 's1', result: { text: 'done' } });
    });

    it('supports wildcard subscriptions', async () => {
        const bus = eventBus();
        const wild = vi.fn();
        bus.on('*', wild);

        await bus.emit(AGENT_EVENT.toolCalled, { name: 'search', input: {} });
        await bus.emit(AGENT_EVENT.error, { message: 'boom' });

        expect(wild).toHaveBeenCalledTimes(2);
    });

    it('waitFor resolves when the event fires and times out otherwise', async () => {
        const bus = eventBus();
        const waiter = bus.waitFor(AGENT_EVENT.workflowSuspended, 1_000);
        await bus.emit(AGENT_EVENT.workflowSuspended, { awaiting: 'approval', workflowId: 'wf1' });

        await expect(waiter).resolves.toMatchObject({ awaiting: 'approval', workflowId: 'wf1' });

        const nearDeadline = 50;
        const timedOut = bus.waitFor(AGENT_EVENT.workflowCompleted, 20);
        await expect(timedOut).rejects.toBeInstanceOf(Error);
    });

    it('supports replay buffers for late subscribers', async () => {
        const bus = eventBus({ replayBufferSize: 10 });
        await bus.emit(AGENT_EVENT.agentStarted, { agentId: 'a1' });

        const seen = vi.fn();
        bus.on(AGENT_EVENT.agentStarted, seen);
        expect(seen).toHaveBeenCalledWith({ agentId: 'a1' });
    });

    it('re-exports the generic createAgentEventBus', () => {
        const bus = createAgentEventBus<{ ping: { p: number } }>();
        expect(typeof bus.emit).toBe('function');
        expect(typeof bus.on).toBe('function');
    });
});

// ── AgentRegistry ───────────────────────────────────────────────────────────

describe('AgentRegistry', () => {
    function agentStub(name: string, text: string) {
        return { run: vi.fn().mockResolvedValue({ text, steps: 1 }) };
    }

    it('registers, resolves, lists, and removes agents', () => {
        const registry = createAgentRegistry();
        const a = agentStub('a', 'A');
        const b = agentStub('b', 'B');

        registry
            .register({ name: 'alpha', description: 'Alpha agent', tags: ['nlp'], agent: a })
            .register({ name: 'beta', agent: b });

        expect(registry.has('alpha')).toBe(true);
        expect(registry.get('alpha')?.agent).toBe(a);
        expect(registry.resolve('beta')).toBe(b);
        expect(registry.names()).toEqual(['alpha', 'beta']);
        expect(registry.size).toBe(2);
        expect(registry.list()).toHaveLength(2);

        expect(registry.remove('beta')).toBe(true);
        expect(registry.has('beta')).toBe(false);
    });

    it('rejects duplicate registrations', () => {
        const registry = createAgentRegistry();
        registry.register({ name: 'dup', agent: agentStub('d', 'D') });
        expect(() => registry.register({ name: 'dup', agent: agentStub('d2', 'D2') })).toThrow(/already registered/);
    });

    it('searches by name, description, and tags (AND semantics)', () => {
        const registry = createAgentRegistry();
        registry.registerMany([
            { name: 'translator', description: 'Translate text', tags: ['language'], agent: agentStub('t', 'T') },
            { name: 'summarizer', description: 'Summarize documents', tags: ['nlp'], agent: agentStub('s', 'S') },
        ]);

        expect(registry.search('translate')).toHaveLength(1);
        expect(registry.search('summarizer')).toHaveLength(1);
        expect(registry.search('nlp')).toHaveLength(1);
        expect(registry.search('language nlp')).toHaveLength(0); // AND semantics across terms
    });

    it('exposes agents as delegation tools', async () => {
        const a = agentStub('a', 'hello');
        const registry = createAgentRegistry();
        registry.register({ name: 'alpha', description: 'Alpha agent', agent: a });

        const tool = registry.asTool('alpha');
        const result = await tool.execute({ prompt: 'hi' });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ text: 'hello', steps: 1 });
        expect(a.run).toHaveBeenCalledWith({ prompt: 'hi' }, { sessionId: 'unknown' });

        const tools = registry.toTools();
        expect(tools).toHaveLength(1);
        expect(tools[0]?.name).toBe('alpha');
    });

    it('asTool throws for unknown agents', () => {
        const registry = createAgentRegistry();
        expect(() => registry.asTool('missing')).toThrow(/no agent named "missing"/);
    });
});

// ── pipeline() ──────────────────────────────────────────────────────────────

describe('pipeline()', () => {
    it('chains varargs stages sequentially', async () => {
        const p = pipeline(createComposeAgent('r', 'research'), createComposeAgent('w', 'written'));
        const result = await p.run('topic');
        expect(result.text).toContain('written');
    });

    it('accepts array form with options', async () => {
        const p = pipeline([createComposeAgent('a1', 'A'), createComposeAgent('a2', 'B')], {
            transform: (r) => `then: ${r.text}`,
        });
        const result = await p.run('x');
        expect(result.text).toContain('then:');
    });

    it('exposes an asTool() projection', async () => {
        const p = pipeline(createComposeAgent('x1', 'first'), createComposeAgent('x2', 'second'));
        const tool = p.asTool({ name: 'doc_pipeline', description: 'Run the doc pipeline.' });
        expect(tool.name).toBe('doc_pipeline');

        const result = await tool.execute({ prompt: 'go' });
        expect(result.success).toBe(true);
    });

    it('rejects fewer than two stages', () => {
        expect(() => pipeline([createComposeAgent('only', 'solo')])).toThrow(/at least 2/);
    });
});

// ── task() ─────────────────────────────────────────────────────────────────

describe('task()', () => {
    it('runs a wrapped function with an input value', async () => {
        const t = task({
            name: 'upper',
            description: 'Upper-case input',
            run: async ({ input }) => String(input).toUpperCase(),
        });

        expect(await t.run({ input: 'abc' })).toBe('ABC');
        expect(await t.invoker({ input: 'def' })).toBe('DEF');
    });

    it('exposes an asTool() that extracts the input envelope', async () => {
        const t = task({
            name: 'double',
            run: async ({ input }) => Number(input) * 2,
            parameters: z.object({ input: z.number() }),
        });

        const tool = t.asTool({ name: 'double', description: 'Double a number.' });
        const result = await tool.execute({ input: 21 });
        expect(result.success).toBe(true);
        expect(result.data).toBe(42);
    });

    it('passes tool context to the run function', async () => {
        const spy = vi.fn();
        const t = task({ name: 'ctx', run: async (_in, ctx) => { spy(ctx); return 'ok'; } });
        const tool = t.asTool({ name: 'ctx', description: 'ctx' });
        await tool.execute({ input: 1 }, { sessionId: 'sess-1' });
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }));
    });
});

// ── guard() ────────────────────────────────────────────────────────────────

describe('guard()', () => {
    it('validates input and output against schemas', async () => {
        const g = guard({
            name: 'bounds',
            input: z.object({ value: z.number().min(0).max(100) }),
            output: z.object({ result: z.number() }),
        });

        expect(await g.check({ value: 50 }, { result: 1 })).toMatchObject({ ok: true });
        const bad = await g.check({ value: 200 }, { result: 1 });
        expect(bad.ok).toBe(false);
        expect(bad.phase).toBe('input');

        const badOut = await g.check({ value: 50 }, { result: 'nope' });
        expect(badOut.ok).toBe(false);
        expect(badOut.phase).toBe('output');
    });

    it('runs a custom predicate and returns structured failures', async () => {
        const g = guard({
            name: 'no-injection',
            validate: (input) =>
                String((input as { prompt?: unknown }).prompt ?? '').startsWith('BEGIN')
                    ? { ok: false, reason: 'prompt-injection detected' }
                    : true,
        });

        expect(await g.check({ prompt: 'hello' })).toMatchObject({ ok: true });
        const bad = await g.check({ prompt: 'BEGIN PAYLOAD' });
        expect(bad).toMatchObject({ ok: false, reason: 'prompt-injection detected', phase: 'custom' });
    });

    it('wraps a runnable and throws GuardError on violation', async () => {
        const g = guard({
            input: z.object({ prompt: z.string().max(3) }),
            output: z.object({ text: z.string() }),
        });
        const runnable = { run: vi.fn().mockResolvedValue({ text: 'ok' }) };
        const wrapped = g.wrap(runnable);

        await expect(wrapped.run({ prompt: 'hi' })).resolves.toMatchObject({ text: 'ok' });
        await expect(wrapped.run({ prompt: 'too long' })).rejects.toBeInstanceOf(GuardError);

        runnable.run.mockResolvedValue({ text: 42 });
        await expect(wrapped.run({ prompt: 'hi' })).rejects.toBeInstanceOf(GuardError);
    });
});

// ── model() / router() ──────────────────────────────────────────────────────

describe('model() / router()', () => {
    it('resolves an OpenAI-compatible provider from a model string', () => {
        const llm = model('ollama:llama3.1');
        expect(typeof llm.generateText).toBe('function');
    });

    it('passes provider instances through unchanged', () => {
        const instance = { generateText: vi.fn() };
        expect(model(instance)).toBe(instance);
    });

    it('throws a helpful error for unknown provider prefixes', () => {
        expect(() => model('notaprovider:foo')).toThrow(/unknown provider in model string/);
    });

    it('builds a routing provider that is itself an LLMProvider', async () => {
        const cheap = { generateText: vi.fn().mockResolvedValue({ text: 'cheap answer' }) };
        const r = router(
            [{ model: 'gpt-4o-mini', provider: cheap, capabilities: ['conversation'], costTier: 'small' }],
            { strategy: 'cost' },
        );

        expect(typeof r.generateText).toBe('function');

        const result = await r.generateText([{ role: 'user', content: 'hi' }]);
        expect(result).toMatchObject({ text: 'cheap answer' });
    });
});
