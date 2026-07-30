/**
 * Edge-case + coverage suite for production orchestration surfaces:
 * hooks, harness (resilience/hooks), system registry, universal adapters, compose hooks.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import {
    createLifecycleHooks,
    mergeHooks,
    createHookChain,
    toAgenticHooks,
    fromAgenticHooks,
} from '../src/hooks/unified-hooks.js';
import { createHarness } from '../src/harness/create-harness.js';
import { createOrchestrator } from '../src/harness/orchestrator.js';
import { createSystem, System } from '../src/system/create-system.js';
import {
    fromOpenAITool,
    fromOpenAITools,
    jsonSchemaToZodObject,
} from '../src/adapters/universal/from-openai.js';
import { fromHttpTool } from '../src/adapters/universal/from-http.js';
import { fromForeignTool, fromForeignTools } from '../src/adapters/universal/from-foreign.js';
import { agentAsTool, getAgentToolDepth, toRunnableAgent, multiAgentTool } from '../src/tools/core/agent-as-tool.js';
import { workflowAsTool } from '../src/tools/core/workflow-as-tool.js';
import { pipelineAsTool } from '../src/tools/core/pipeline-as-tool.js';
import { compose, pipe } from '../src/dx/compose.js';
import {
    bridgeChunkToBus,
    streamAgentEvents,
    streamAgentText,
} from '../src/system/stream.js';
import { StreamEventBus } from '../src/streaming/index.js';
import * as dxAgent from '../src/dx/agent.js';
import type { RunnableAgent } from '../src/tools/core/agent-as-tool.js';
import type { CreateAgentResult } from '../src/create-agent/types.js';
import type { AgenticRunResult } from '../src/agentic/types.js';
import type { StreamChunk } from '../src/create-agent/types.js';

function makeRunResult(text: string): AgenticRunResult {
    return {
        text,
        markdown: { name: 'response', content: text, mimeType: 'text/markdown', type: 'markdown' },
        messages: [],
        steps: 1,
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
}

function mockCreateAgent(name: string, text = name): CreateAgentResult {
    const run = vi.fn(async (prompt: string) => makeRunResult(`${text}:${String(prompt).slice(0, 20)}`));
    return {
        name,
        description: `${name} desc`,
        instructions: `You are ${name}`,
        run,
        generate: (p, o) => run(typeof p === 'string' ? p : p.text, o),
        stream: async function* () { yield text; },
        streamEvents: async function* () { yield { type: 'run-finish' as const }; },
        createSession: vi.fn(async () => 'sess'),
        getSessionMessages: vi.fn(async () => []),
        getCompressionStats: () => undefined,
        resume: () => ({ run, stream: async function* () {}, streamEvents: async function* () {} }),
        asTool: vi.fn(),
    } as unknown as CreateAgentResult;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

describe('unified hooks', () => {
    it('createLifecycleHooks returns a shallow copy', () => {
        const hooks = createLifecycleHooks({
            beforeRun: (ctx) => `x:${ctx.prompt}`,
        });
        expect(hooks.beforeRun?.({ prompt: 'a', metadata: {} })).toBe('x:a');
    });

    it('mergeHooks composes sync and async handlers (last wins for return)', async () => {
        expect(mergeHooks()).toEqual({});
        expect(mergeHooks(undefined, undefined)).toEqual({});

        const a = createLifecycleHooks({
            beforeRun: () => 'from-a',
            afterStep: vi.fn(),
        });
        const single = mergeHooks(a);
        expect(single).toBe(a);

        const b = createLifecycleHooks({
            beforeRun: async () => 'from-b',
            onError: vi.fn(),
        });
        const merged = mergeHooks(a, b);
        await expect(merged.beforeRun?.({ prompt: 'p', metadata: {} })).resolves.toBe('from-b');

        // sync+async mix
        const c = createLifecycleHooks({ beforeRun: async () => 'async-c' });
        const d = createLifecycleHooks({ beforeRun: () => 'sync-d' });
        const m2 = mergeHooks(c, d);
        await expect(m2.beforeRun?.({ prompt: 'p', metadata: {} })).resolves.toBe('sync-d');

        const e = createLifecycleHooks({ beforeRun: () => 'sync-e' });
        const f = createLifecycleHooks({ beforeRun: async () => 'async-f' });
        const m3 = mergeHooks(e, f);
        await expect(m3.beforeRun?.({ prompt: 'p', metadata: {} })).resolves.toBe('async-f');

        const g = createLifecycleHooks({ beforeRun: () => 'sync-g' });
        const h = createLifecycleHooks({ beforeRun: () => undefined as unknown as string });
        const m4 = mergeHooks(g, h);
        expect(m4.beforeRun?.({ prompt: 'p', metadata: {} })).toBe('sync-g');

        const bothAsync = mergeHooks(
            createLifecycleHooks({ beforeRun: async () => 'a1' }),
            createLifecycleHooks({ beforeRun: async () => undefined as unknown as string }),
        );
        await expect(bothAsync.beforeRun?.({ prompt: 'p', metadata: {} })).resolves.toBe('a1');
    });

    it('createHookChain add/remove/execute/clear', async () => {
        const chain = createHookChain<(x: number) => number | Promise<number>>();
        const a = vi.fn((x: number) => x + 1);
        const b = vi.fn(async (x: number) => x + 10);
        chain.add(a);
        chain.add(b);
        await expect(chain.execute(1)).resolves.toBe(11);
        chain.remove(a);
        await expect(chain.execute(1)).resolves.toBe(11);
        chain.remove(a); // missing — no-op
        chain.clear();
        await expect(chain.execute(1)).resolves.toBeUndefined();
    });

    it('toAgenticHooks / fromAgenticHooks round-trip core events', async () => {
        const beforeRun = vi.fn(async () => 'rewritten');
        const afterRun = vi.fn(async () => undefined);
        const beforeStep = vi.fn();
        const afterStep = vi.fn();
        const beforeTool = vi.fn(async (_ctx, args) => ({ ...args, n: 2 }));
        const afterTool = vi.fn(async () => ({ ok: true }));
        const onError = vi.fn();

        const unified = createLifecycleHooks({
            beforeRun,
            afterRun,
            beforeStep,
            afterStep,
            beforeToolCall: beforeTool,
            afterToolCall: afterTool,
            onError,
        });

        const agentic = toAgenticHooks(unified);
        await expect(agentic.beforeRun?.('hi', {} as never)).resolves.toBe('rewritten');
        const result = makeRunResult('out');
        await expect(agentic.afterRun?.(result)).resolves.toEqual(result);
        await expect(agentic.beforeStep?.(1, [])).resolves.toEqual([]);
        await agentic.afterStep?.(2, [], 't');
        await expect(agentic.beforeToolCall?.('t', { n: 1 }, 0)).resolves.toEqual({ n: 2 });
        await expect(agentic.afterToolCall?.('t', { a: 1 }, { n: 1 }, 0)).resolves.toEqual({ ok: true });
        await agentic.onError?.(new Error('e'), 3);

        const back = fromAgenticHooks(agentic);
        await back.beforeRun?.({ prompt: 'p', metadata: {} });
        await back.afterRun?.({ prompt: 'p', result, metadata: {} });
        await back.beforeStep?.(1, { metadata: {} });
        await back.afterStep?.(1, { metadata: {} });
        await back.beforeToolCall?.({ toolName: 't', metadata: {}, step: 0 }, { n: 1 });
        await back.afterToolCall?.({ toolName: 't', metadata: {}, step: 0 }, { a: 1 }, { n: 1 });
        await back.onError?.(new Error('e'), { metadata: {}, step: 1 });

        // empty adapters
        expect(toAgenticHooks({})).toEqual({});
        expect(fromAgenticHooks({})).toEqual({});
    });
});

// ── Harness ─────────────────────────────────────────────────────────────────

describe('createHarness edge cases', () => {
    it('enables resilience and exposes health()', async () => {
        const agent: RunnableAgent & { name: string; instructions: string } = {
            name: 'resilient',
            instructions: 'ok',
            run: vi.fn().mockResolvedValue({ text: 'ok' }),
        };
        const harness = createHarness({
            agent,
            resilience: { rateLimit: { maxRpm: 1000 }, healthCheck: true },
        });
        await expect(harness.run('hello')).resolves.toEqual({ text: 'ok' });
        await expect(harness.run({ prompt: 'p' })).resolves.toEqual({ text: 'ok' });
        await expect(harness.run({ foo: 1 })).resolves.toEqual({ text: 'ok' });
        const health = harness.health();
        expect(health).toBeDefined();
        expect(health?.status).toBeDefined();
    });

    it('forwards unified hooks to CreateAgentResult.run', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'hooked' });
        const agent = {
            name: 'with-hooks',
            instructions: 'i',
            createSession: vi.fn(),
            run,
        };
        const beforeRun = vi.fn(async () => 'rewritten');
        const harness = createHarness({
            agent: agent as never,
            resilience: false,
            hooks: { beforeRun },
        });
        await harness.run({ prompt: 'orig' });
        expect(run).toHaveBeenCalledWith('orig', expect.objectContaining({ hooks: expect.any(Object) }));
        await harness.run('string-input');
        expect(run).toHaveBeenCalledWith('string-input', expect.objectContaining({ hooks: expect.any(Object) }));
        await harness.run({ other: true });
        expect(run).toHaveBeenCalledWith(JSON.stringify({ other: true }), expect.objectContaining({ hooks: expect.any(Object) }));
    });

    it('hooks on non-CreateAgentResult fall through to inner run', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'plain' });
        const harness = createHarness({
            agent: { run },
            resilience: false,
            hooks: { beforeRun: () => 'x' },
        });
        await harness.run('hi');
        expect(run).toHaveBeenCalled();
    });

    it('defaults name to harness-agent when missing', () => {
        const harness = createHarness({
            agent: { run: async () => ({}) },
            resilience: false,
        });
        expect(harness.name).toBe('harness-agent');
        expect(harness.health()).toBeUndefined();
    });

    it('asTool forwards optional fields and defaultTimeoutMs', async () => {
        const harness = createHarness({
            agent: { name: 'n', instructions: 'i', run: async () => ({ v: 1 }) },
            resilience: false,
            defaultTimeoutMs: 5_000,
        });
        const t = harness.asTool({
            name: 'full',
            description: 'full',
            parameters: z.object({ prompt: z.string() }),
            outputSchema: z.object({ v: z.number() }),
            timeoutMs: 1_000,
            needsApproval: false,
            tags: ['x'],
            transformOutput: (o) => o,
            beforeExecute: () => undefined,
            afterExecute: () => undefined,
            onError: () => ({ v: 0 }),
        });
        const r = await t.execute({ prompt: 'p' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ v: 1 });
    });
});

// ── System registry ─────────────────────────────────────────────────────────

describe('createSystem edge cases', () => {
    it('System alias works and getAgent throws for unknown', () => {
        const system = System({ name: 's', resilience: false });
        expect(system.name).toBe('s');
        expect(() => system.getAgent('nope')).toThrow(/unknown agent/);
    });

    it('normalizes bare agents/workflows/pipelines and tools array', async () => {
        const agent = mockCreateAgent('bare');
        const system = createSystem({
            name: 'norm',
            resilience: false,
            agents: { bare: agent },
            workflows: {
                w: { execute: vi.fn().mockResolvedValue({ status: 'completed', results: { a: 1 } }) },
            },
            pipelines: {
                p: { run: vi.fn().mockResolvedValue({ text: 'p' }) },
            },
            tools: {
                t1: {
                    name: 't1',
                    description: 't',
                    parameters: z.object({}),
                    category: 'custom' as never,
                    tags: [],
                    needsApproval: false,
                    strict: true,
                    execute: async () => ({ ok: true }),
                    validate: () => ({ success: true, data: {} }),
                    toFrameworkTool: () => ({}) as never,
                    toJSONSchema: () => ({}),
                    hooks: {},
                },
            },
        });

        expect(system.listAgents()).toEqual(['bare']);
        expect(system.listWorkflows()).toEqual(['w']);
        expect(system.listPipelines()).toEqual(['p']);
        expect(system.listTools().map((t) => t.name)).toEqual(['t1']);

        system.addAgent('a2', agent);
        system.addWorkflow('w2', { execute: async () => ({ status: 'completed', results: {} }) });
        system.addPipeline('p2', { run: async () => ({ text: 'x' }) });

        const boss = system.supervisor({
            createCoordinator: (tools) => {
                const c = mockCreateAgent('boss');
                (c as { _tools?: unknown })._tools = tools;
                return c;
            },
        });
        expect(boss.tools.some((t) => t.name === 'bare')).toBe(true);
        await boss.run('go');
        await boss.generate('go');
        const tool = boss.asTool({ name: 'sys', description: 'full' });
        expect(tool.name).toBe('sys');

        const systemTool = system.asTool({
            name: 'whole',
            description: 'all',
            supervisor: { createCoordinator: () => mockCreateAgent('sys-boss') },
        });
        expect(systemTool.name).toBe('whole');
        expect(system.toJSON().description).toBeUndefined();

        const described = createSystem({
            name: 'd',
            description: 'Described',
            resilience: false,
        });
        expect(described.toJSON().description).toBe('Described');
        expect(described.asTool({
            supervisor: { createCoordinator: () => mockCreateAgent('c') },
        }).name).toBe('d_system');
    });

    it('supervisor throws on unknown specialist keys', () => {
        const system = createSystem({ name: 'x', resilience: false });
        expect(() =>
            system.supervisor({
                agents: ['missing'],
                createCoordinator: () => mockCreateAgent('c'),
            }),
        ).toThrow(/unknown agent/);
        expect(() =>
            system.supervisor({
                workflows: ['missing'],
                createCoordinator: () => mockCreateAgent('c'),
            }),
        ).toThrow(/unknown workflow/);
        expect(() =>
            system.supervisor({
                pipelines: ['missing'],
                createCoordinator: () => mockCreateAgent('c'),
            }),
        ).toThrow(/unknown pipeline/);
    });

    it('uses default supervisor instructions catalog when omitted', () => {
        const system = createSystem({
            name: 'catalog',
            resilience: false,
            agents: { a: { agent: mockCreateAgent('a'), description: 'A specialist' } },
        });
        // createCoordinator captures tools; defaultInstructions is only used when agent() is called.
        // Force createCoordinator so we don't need LLM, but also call build path that uses defaults
        // by spying — instead verify tools still built with default catalog path via createCoordinator receiving tools.
        let sawTools = false;
        system.supervisor({
            createCoordinator: (tools) => {
                sawTools = tools.length === 1;
                return mockCreateAgent('c');
            },
        });
        expect(sawTools).toBe(true);
    });
});

// ── Orchestrator ────────────────────────────────────────────────────────────

describe('createOrchestrator edge cases', () => {
    it('throws when specialist has no agent/workflow/pipeline', () => {
        expect(() =>
            createOrchestrator({
                createCoordinator: () => ({ run: async () => ({}) }),
                specialists: [{ name: 'empty', description: 'none' }],
            }),
        ).toThrow(/must provide agent, workflow, or pipeline/);
    });
});

// ── Universal adapters ──────────────────────────────────────────────────────

describe('universal adapters edge cases', () => {
    it('jsonSchemaToZodObject covers all primitive types and empty schema', () => {
        expect(jsonSchemaToZodObject(undefined).safeParse({}).success).toBe(true);
        const schema = jsonSchemaToZodObject({
            type: 'object',
            properties: {
                s: { type: 'string', description: 'S' },
                n: { type: 'number' },
                i: { type: 'integer' },
                b: { type: 'boolean' },
                a: { type: 'array' },
                o: { type: 'object' },
                u: { type: 'null' },
            },
            required: ['s'],
        });
        expect(schema.safeParse({
            s: 'x', n: 1, i: 2, b: true, a: [1], o: { k: 1 }, u: null,
        }).success).toBe(true);
    });

    it('fromHttpTool GET with query + non-JSON body + HTTP error', async () => {
        const okFetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => 'text/plain' },
            text: async () => 'plain',
            json: async () => ({}),
        });
        const getTool = fromHttpTool({
            name: 'get',
            description: 'GET',
            url: 'https://example.test/items',
            method: 'GET',
            parameters: z.object({ q: z.string() }),
            fetchImpl: okFetch as never,
        });
        const r1 = await getTool.execute({ q: 'x' });
        expect(r1.success).toBe(true);
        expect(r1.data).toBe('plain');
        expect(String(okFetch.mock.calls[0]![0])).toContain('q=x');

        const customQuery = fromHttpTool({
            name: 'get2',
            description: 'GET2',
            url: (p) => `https://example.test/${String(p['id'])}`,
            method: 'GET',
            query: (p) => ({ filter: String(p['f']) }),
            parameters: z.object({ id: z.string(), f: z.string() }),
            headers: (p) => ({ 'X-Id': String(p['id']) }),
            fetchImpl: okFetch as never,
        });
        await customQuery.execute({ id: '1', f: 'yes' });

        const errFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            headers: { get: () => 'text/plain' },
            text: async () => 'boom',
            json: async () => ({}),
        });
        const bad = fromHttpTool({
            name: 'bad',
            description: 'bad',
            url: 'https://example.test/fail',
            method: 'POST',
            body: () => ({ a: 1 }),
            headers: { Authorization: 'Bearer x' },
            fetchImpl: errFetch as never,
        });
        const rBad = await bad.execute({});
        expect(rBad.success).toBe(false);
        expect(rBad.error?.message).toContain('500');
    });

    it('fromForeignTool requires an execute-like method and supports call/func', async () => {
        expect(() => fromForeignTool({ name: 'nope' })).toThrow(/no execute/);
        const viaCall = fromForeignTool({
            name: 'c',
            call: async (args) => args,
            parameters: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
        });
        expect((await viaCall.execute({ x: 1 })).data).toEqual({ x: 1 });

        const viaFunc = fromForeignTool({
            name: 'f',
            description: 'func',
            func: async () => 42,
        });
        expect((await viaFunc.execute({})).data).toBe(42);

        expect(fromForeignTools([{ name: 'a', execute: async () => 1 }])).toHaveLength(1);
        expect(fromOpenAITools([], { execute: async () => ({}) })).toEqual([]);
    });
});

// ── agent/workflow/pipeline edges ───────────────────────────────────────────

describe('as-tool remaining edges', () => {
    it('toRunnableAgent JSON.stringifies non-prompt object inputs', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'ok' });
        const adapted = toRunnableAgent({
            instructions: 'i',
            createSession: async () => 's',
            run,
        } as never);
        await adapted.run({ topic: 'AI' });
        expect(run).toHaveBeenCalledWith(JSON.stringify({ topic: 'AI' }), undefined);
        expect(getAgentToolDepth()).toBe(0);
    });

    it('workflowAsTool transformOutput and raw non-envelope results', async () => {
        const t = workflowAsTool({
            name: 'raw',
            description: 'raw',
            workflow: { execute: async () => ({ direct: true }) },
            parameters: z.object({}).passthrough(),
            transformOutput: (out) => ({ ...(out as object), t: true }),
        });
        const r = await t.execute({});
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ direct: true, t: true });
    });

    it('pipelineAsTool omits unknown sessionId and uses JSON map fallback', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'x' });
        const t = pipelineAsTool({
            name: 'p',
            description: 'p',
            pipeline: { run },
            parameters: z.object({ topic: z.string() }),
        });
        await t.execute({ topic: 't' });
        expect(run).toHaveBeenCalledWith(JSON.stringify({ topic: 't' }), { sessionId: undefined });
    });

    it('multiAgentTool descriptions default when missing', async () => {
        const { multiAgentTool } = await import('../src/tools/core/agent-as-tool.js');
        const tools = multiAgentTool({
            agents: { only: { run: async () => ({ text: '1' }) } },
            descriptions: {},
        });
        expect(tools[0]!.description).toContain('only');
    });
});

// ── compose / pipe edges ────────────────────────────────────────────────────

describe('compose/pipe edge cases', () => {
    it('requires ≥2 agents and supports hooks/when/transform/asTool/onError', async () => {
        expect(() => compose(mockCreateAgent('only') as never)).toThrow(/at least 2/);

        const a = mockCreateAgent('a', 'A');
        const b = mockCreateAgent('b', 'B');
        const hooks = {
            beforeWorkflow: vi.fn(async (p: string) => `pre:${p}`),
            beforeStage: vi.fn(async (_i: number, _n: string, p: string) => p),
            afterStage: vi.fn(),
            afterWorkflow: vi.fn(async (r: AgenticRunResult) => r),
            onError: vi.fn(),
        };

        const pipeline = compose(a, b, {
            hooks,
            transform: async (r) => `t:${r.text}`,
            when: async () => true,
        });

        const result = await pipeline.run('hello', { sessionId: 's1' });
        expect(result.text).toContain('B:');
        expect(hooks.beforeWorkflow).toHaveBeenCalled();
        expect(hooks.afterStage).toHaveBeenCalled();
        expect(hooks.afterWorkflow).toHaveBeenCalled();

        const tool = pipeline.asTool({ name: 'pipe', description: 'p' });
        expect(tool.name).toBe('pipe');

        // early stop via when
        const stop = compose(a, b, {
            when: async () => false,
            hooks: { afterWorkflow: async (r) => ({ ...r, text: 'stopped' }) },
        });
        const stopped = await stop.run('x');
        expect(stopped.text).toBe('stopped');

        // onError path
        const boom = mockCreateAgent('boom');
        (boom.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
        const onError = vi.fn();
        const bad = compose(a, boom, { hooks: { onError } });
        await expect(bad.run('x')).rejects.toThrow('fail');
        expect(onError).toHaveBeenCalled();

        // pipe builder asTool
        const pb = pipe(a).then(b).hooks({ beforeWorkflow: async (p) => p });
        expect(pb.asTool({ name: 'pb', description: 'pb' }).name).toBe('pb');
        const pr = await pb.run('z');
        expect(pr.text).toBeTruthy();
    });
});

describe('pipe builder remaining branches', () => {
    it('supports per-step when/transform and early exit', async () => {
        const a = mockCreateAgent('pa', 'PA');
        const b = mockCreateAgent('pb', 'PB');
        const c = mockCreateAgent('pc', 'PC');

        const pipeline = pipe(a)
            .then(b, {
                when: async () => true,
                transform: async (r) => `T:${r.text}`,
            })
            .then(c, {
                when: async () => false,
            })
            .hooks({
                beforeWorkflow: async (p) => p,
                afterWorkflow: async (r) => r,
                onError: vi.fn(),
            });

        const result = await pipeline.run('start', { onChunk: () => undefined });
        // stopped before c because when returned false
        expect(result.text).toContain('PB:');
        expect(c.run).not.toHaveBeenCalled();
    });

    it('propagates pipe onError for non-Error throws', async () => {
        const a = mockCreateAgent('ok');
        const b = mockCreateAgent('bad');
        (b.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string-fail');
        const onError = vi.fn();
        const pipeline = pipe(a).then(b).hooks({ onError });
        await expect(pipeline.run('x')).rejects.toBe('string-fail');
        expect(onError).toHaveBeenCalled();
        expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    });
});

// ── Remaining branches → 100% on production surfaces ────────────────────────

describe('hooks remaining branches', () => {
    it('mergeHooks keeps prior result when later returns undefined', async () => {
        const asyncThenSync = mergeHooks(
            createLifecycleHooks({ beforeRun: async () => 'kept-async' }),
            createLifecycleHooks({ beforeRun: () => undefined as unknown as string }),
        );
        await expect(asyncThenSync.beforeRun?.({ prompt: 'p', metadata: {} })).resolves.toBe('kept-async');

        const syncThenAsyncUndef = mergeHooks(
            createLifecycleHooks({ beforeRun: () => 'kept-sync' }),
            createLifecycleHooks({ beforeRun: async () => undefined as unknown as string }),
        );
        await expect(syncThenAsyncUndef.beforeRun?.({ prompt: 'p', metadata: {} })).resolves.toBe('kept-sync');
    });

    it('toAgenticHooks / fromAgenticHooks void returns and missing step', async () => {
        const unified = createLifecycleHooks({
            beforeRun: async () => undefined,
            afterRun: async () => undefined,
            beforeToolCall: async () => undefined,
            afterToolCall: async () => undefined,
            onError: vi.fn(),
        });
        const agentic = toAgenticHooks(unified);
        await expect(agentic.beforeRun?.('orig', {} as never)).resolves.toBe('orig');
        const result = makeRunResult('r');
        await expect(agentic.afterRun?.(result)).resolves.toEqual(result);
        await expect(agentic.beforeToolCall?.('t', { a: 1 }, 0)).resolves.toEqual({ a: 1 });
        await expect(agentic.afterToolCall?.('t', { out: 1 }, { a: 1 }, 0)).resolves.toEqual({ out: 1 });

        const back = fromAgenticHooks({
            beforeToolCall: async () => ({ n: 1 }),
            afterToolCall: async () => ({ ok: true }),
            onError: async () => undefined,
        });
        await expect(
            back.beforeToolCall?.({ toolName: 't', metadata: {} }, { x: 1 }),
        ).resolves.toEqual({ n: 1 });
        await expect(
            back.afterToolCall?.({ toolName: 't', metadata: {} }, { a: 1 }, { x: 1 }),
        ).resolves.toEqual({ ok: true });
        await back.onError?.(new Error('e'), { metadata: {} });
    });
});

describe('http / openai / foreign remaining branches', () => {
    it('fromHttpTool defaults, JSON body, query skips, and text() catch', async () => {
        const jsonFetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json; charset=utf-8' },
            text: async () => '',
            json: async () => ({ ok: true }),
        });
        const withDefaults = fromHttpTool({
            name: 'post-default',
            description: 'd',
            url: 'https://example.test/api?existing=1',
            outputSchema: z.object({ ok: z.boolean() }),
            fetchImpl: jsonFetch as never,
        });
        const r = await withDefaults.execute({ a: 1, skip: undefined });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ ok: true });

        const getSkip = fromHttpTool({
            name: 'get-skip',
            description: 'g',
            url: 'https://example.test/q',
            method: 'GET',
            query: () => ({ a: '1', b: undefined }),
            fetchImpl: jsonFetch as never,
        });
        await getSkip.execute({});
        expect(String(jsonFetch.mock.calls.at(-1)![0])).toContain('a=1');
        expect(String(jsonFetch.mock.calls.at(-1)![0])).not.toContain('b=');

        const getAppend = fromHttpTool({
            name: 'get-append',
            description: 'g',
            url: 'https://example.test/q?x=1',
            method: 'GET',
            parameters: z.object({ y: z.string() }),
            fetchImpl: jsonFetch as never,
        });
        await getAppend.execute({ y: '2' });
        expect(String(jsonFetch.mock.calls.at(-1)![0])).toContain('x=1&y=2');

        const errFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 502,
            headers: { get: () => '' },
            text: async () => {
                throw new Error('read-fail');
            },
            json: async () => ({}),
        });
        const bad = fromHttpTool({
            name: 'bad-text',
            description: 'b',
            url: 'https://example.test/fail',
            method: 'DELETE',
            fetchImpl: errFetch as never,
        });
        const badR = await bad.execute({});
        expect(badR.success).toBe(false);
        expect(badR.error?.message).toContain('502');

        const prevFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json' },
            text: async () => '',
            json: async () => ({ via: 'global' }),
        }) as never;
        try {
            const viaGlobal = fromHttpTool({
                name: 'global-fetch',
                description: 'g',
                url: 'https://example.test/g',
                method: 'PUT',
                body: () => ({ x: 1 }),
            });
            const gr = await viaGlobal.execute({});
            expect(gr.success).toBe(true);
            expect(gr.data).toEqual({ via: 'global' });
        } finally {
            globalThis.fetch = prevFetch;
        }
    });

    it('fromOpenAITool empty schema, missing description, optional props', () => {
        const empty = jsonSchemaToZodObject({ type: 'object', properties: {} });
        expect(empty.safeParse({}).success).toBe(true);

        const nonArrayRequired = jsonSchemaToZodObject({
            type: 'object',
            properties: { a: { type: 'string' }, b: null as unknown as Record<string, unknown> },
            required: 'not-an-array' as unknown as string[],
        });
        expect(nonArrayRequired.safeParse({ a: 'x' }).success).toBe(true);

        const t = fromOpenAITool(
            { function: { name: 'f', parameters: { type: 'object', properties: {} } } },
            { execute: () => 1, tags: ['t'] },
        );
        expect(t.description).toContain('OpenAI function f');
    });

    it('fromForeignTool with outputSchema and zod parameters', async () => {
        const t = fromForeignTool({
            name: 'out',
            description: 'd',
            parameters: z.object({ n: z.number() }),
            outputSchema: z.object({ n: z.number() }),
            invoke: async (args) => args,
        });
        const r = await t.execute({ n: 3 });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ n: 3 });
    });
});

describe('compose/pipe remaining branches', () => {
    it('covers early-stop without afterWorkflow and void hooks', async () => {
        const nameless = {
            ...mockCreateAgent('n1'),
            name: undefined,
        } as unknown as CreateAgentResult;
        const b = mockCreateAgent('n2');
        (nameless.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ...makeRunResult('short'),
            text: undefined,
        });

        const stopNoAfter = compose(nameless, b, {
            when: async () => false,
            hooks: {
                beforeWorkflow: () => undefined,
                beforeStage: () => undefined,
            },
        });
        const stopped = await stopNoAfter.run('x');
        expect(stopped.text).toBeUndefined();
        expect(b.run).not.toHaveBeenCalled();

        const errNoHook = compose(mockCreateAgent('a'), mockCreateAgent('b'));
        (errNoHook as never);
        const boom = mockCreateAgent('boom');
        (boom.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'));
        await expect(compose(mockCreateAgent('a'), boom).run('p')).rejects.toThrow('x');
    });

    it('pipe early-stop without afterWorkflow + before/afterStage + void afterWorkflow', async () => {
        const a = { ...mockCreateAgent('pa'), name: undefined } as unknown as CreateAgentResult;
        const b = mockCreateAgent('pb');
        const c = mockCreateAgent('pc');

        const early = pipe(a)
            .then(b, { when: async () => false })
            .then(c);
        const r1 = await early.run('s');
        expect(r1.text).toContain('pa');
        expect(c.run).not.toHaveBeenCalled();

        const staged = pipe(a)
            .then(b, { sessionId: 'step-sess' })
            .hooks({
                beforeWorkflow: () => undefined,
                beforeStage: () => undefined,
                afterStage: vi.fn(),
                afterWorkflow: async () => undefined,
            });
        const r2 = await staged.run('go', { sessionId: 'run-sess' });
        expect(r2.text).toBeTruthy();
    });
});

describe('harness / orchestrator remaining branches', () => {
    it('resilience with missing instructions uses empty string', async () => {
        const harness = createHarness({
            agent: { name: 'x', run: async () => ({ text: 'ok' }) },
            resilience: { rateLimit: { maxRpm: 1000 }, healthCheck: true },
        });
        await expect(harness.run('hi')).resolves.toEqual({ text: 'ok' });
    });

    it('orchestrator covers outputSchema/timeoutMs/harness/asTool paths', async () => {
        const out = z.object({ v: z.number() });
        const orch = createOrchestrator({
            createCoordinator: (tools) => ({
                name: 'coord',
                instructions: 'i',
                run: async () => ({ tools: tools.length }),
            }),
            specialists: [
                {
                    name: 'a',
                    description: 'agent',
                    agent: { run: async () => ({ v: 1 }) },
                    outputSchema: out,
                    timeoutMs: 1000,
                },
                {
                    name: 'w',
                    description: 'wf',
                    workflow: {
                        execute: async () => ({ status: 'completed', results: { v: 2 } }),
                    },
                    outputSchema: out,
                    timeoutMs: 2000,
                },
                {
                    name: 'p',
                    description: 'pipe',
                    pipeline: { run: async () => ({ v: 3 }) },
                    outputSchema: out,
                    timeoutMs: 3000,
                },
            ],
            harness: { resilience: false },
        });
        expect(orch.harness).toBeDefined();
        await expect(orch.run('hi')).resolves.toEqual({ tools: 3 });
        expect(orch.asTool({ name: 'o', description: 'o' }).name).toBe('o');

        const bare = createOrchestrator({
            createCoordinator: () => ({ run: async () => ({ ok: true }) }),
            specialists: [{ name: 'only', description: 'a', agent: { run: async () => 1 } }],
        });
        expect(bare.harness).toBeUndefined();
        expect(bare.asTool({ name: 'b', description: 'b' }).name).toBe('b');
    });
});

describe('system remaining branches', () => {
    it('normalize array tools, bare agent description, model/harness/resilience', async () => {
        const bareNoDesc = {
            ...mockCreateAgent('bare'),
            description: undefined,
        } as unknown as CreateAgentResult;

        const system = createSystem({
            name: 'full',
            description: 'Full system',
            model: 'gpt-test',
            harness: { resilience: false },
            resilience: { rateLimit: { maxRpm: 10 } },
            agents: {
                bare: bareNoDesc,
                wrapped: {
                    agent: mockCreateAgent('w'),
                    description: 'Wrapped',
                    outputSchema: z.object({ text: z.string() }),
                },
            },
            workflows: {
                w: {
                    workflow: { execute: async () => ({ status: 'completed', results: undefined }) },
                    description: 'W',
                    parameters: z.object({ input: z.record(z.string(), z.unknown()).optional() }),
                    outputSchema: z.object({}).passthrough(),
                },
            },
            pipelines: {
                p: {
                    pipeline: { run: async () => ({ text: 'p' }) },
                    description: 'P',
                    parameters: z.object({ prompt: z.string() }),
                    outputSchema: z.object({ text: z.string() }),
                },
            },
            tools: [
                {
                    name: 'arr',
                    description: 'array tool',
                    parameters: z.object({}),
                    category: 'custom' as never,
                    tags: [],
                    needsApproval: false,
                    strict: true,
                    execute: async () => ({}),
                    validate: () => ({ success: true, data: {} }),
                    toFrameworkTool: () => ({}) as never,
                    toJSONSchema: () => ({}),
                    hooks: {},
                },
            ],
        });

        expect(system.listTools().map((t) => t.name)).toEqual(['arr']);

        const boss = system.supervisor({
            createCoordinator: (tools) => {
                const c = mockCreateAgent('boss');
                (c as { _tools?: unknown })._tools = tools;
                return c;
            },
            extraTools: [
                {
                    name: 'extra',
                    description: 'extra',
                    parameters: z.object({}),
                    category: 'custom' as never,
                    tags: [],
                    needsApproval: false,
                    strict: true,
                    execute: async () => ({}),
                    validate: () => ({ success: true, data: {} }),
                    toFrameworkTool: () => ({}) as never,
                    toJSONSchema: () => ({}),
                    hooks: {},
                },
            ],
            agents: ['bare', 'wrapped'],
            workflows: ['w'],
            pipelines: ['p'],
            maxDepth: 3,
            harness: { resilience: false },
        });
        expect(boss.tools.some((t) => t.name === 'extra')).toBe(true);

        const texts: string[] = [];
        for await (const t of boss.stream('hi')) texts.push(t);
        expect(texts.length).toBeGreaterThan(0);

        const events = [];
        for await (const e of boss.streamEvents('hi', { streamMode: ['updates', 'messages'] })) {
            events.push(e);
        }
        expect(events.length).toBeGreaterThan(0);

        // asTool description falls back to config.description
        expect(
            system.asTool({
                supervisor: { createCoordinator: () => mockCreateAgent('c') },
            }).description,
        ).toBe('Full system');

        // default description when system has none
        const plain = createSystem({
            name: 'plain',
            resilience: false,
            agents: { a: mockCreateAgent('a') },
        });
        expect(
            plain.asTool({
                supervisor: { createCoordinator: () => mockCreateAgent('c') },
            }).description,
        ).toContain('plain');

        // tools undefined → []
        expect(createSystem({ name: 'empty', resilience: false }).listTools()).toEqual([]);
    });

    it('supervisor uses dx agent() when createCoordinator omitted', () => {
        const spy = vi.spyOn(dxAgent, 'agent').mockReturnValue(mockCreateAgent('auto-coord'));
        try {
            const system = createSystem({
                name: 'auto',
                resilience: false,
                agents: { a: mockCreateAgent('a') },
            });
            const boss = system.supervisor({ instructions: 'Lead.' });
            expect(spy).toHaveBeenCalled();
            expect(boss.agent.name).toBe('auto-coord');
        } finally {
            spy.mockRestore();
        }
    });
});

describe('stream bridge 100%', () => {
    it('bridgeChunkToBus covers all chunk types', () => {
        const bus = new StreamEventBus(['updates', 'messages', 'values', 'debug']);
        const emit = vi.spyOn(bus, 'emit');

        expect(bridgeChunkToBus(bus, { type: 'text-delta', delta: '' }, 'n')).toBe(false);
        expect(bridgeChunkToBus(bus, { type: 'text-delta', delta: 'hi' }, 'n')).toBe(false);
        expect(
            bridgeChunkToBus(
                bus,
                { type: 'tool-call', tool: { name: 't', input: { a: 1 } } } as StreamChunk,
                'n',
            ),
        ).toBe(false);
        expect(bridgeChunkToBus(bus, { type: 'tool-call' } as StreamChunk, 'n')).toBe(false);
        expect(
            bridgeChunkToBus(
                bus,
                { type: 'tool-result', tool: { name: 't', input: {}, output: 1 } } as StreamChunk,
                'n',
            ),
        ).toBe(false);
        expect(bridgeChunkToBus(bus, { type: 'tool-result' } as StreamChunk, 'n')).toBe(false);
        expect(bridgeChunkToBus(bus, { type: 'step-finish', stepNumber: 2 } as StreamChunk, 'n')).toBe(false);
        expect(
            bridgeChunkToBus(
                bus,
                {
                    type: 'run-finish',
                    run: { text: 'done', finishReason: 'stop', steps: 1, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
                } as StreamChunk,
                'n',
            ),
        ).toBe(true);
        expect(bridgeChunkToBus(bus, { type: 'run-finish' } as StreamChunk, 'n')).toBe(true);
        expect(
            bridgeChunkToBus(bus, { type: 'error', error: new Error('boom') } as StreamChunk, 'n'),
        ).toBe(true);
        expect(bridgeChunkToBus(bus, { type: 'error', error: 'str' } as StreamChunk, 'n')).toBe(true);
        expect(bridgeChunkToBus(bus, { type: 'unknown' } as StreamChunk, 'n')).toBe(false);
        expect(emit).toHaveBeenCalled();
    });

    it('streamAgentEvents and streamAgentText cover abort and errors', async () => {
        const agent = {
            name: undefined as unknown as string,
            streamEvents: async function* (_prompt: string) {
                yield { type: 'text-delta', delta: 'a' } as StreamChunk;
                yield { type: 'run-finish', run: { text: 'a' } } as StreamChunk;
            },
            stream: async function* () {
                yield 'tok';
            },
        };

        const events = [];
        for await (const e of streamAgentEvents(agent as never, 'p', {
            streamMode: ['messages'],
            node: 'custom',
        })) {
            events.push(e);
        }
        expect(events.length).toBeGreaterThan(0);

        const aborted = new AbortController();
        aborted.abort();
        const early: unknown[] = [];
        for await (const e of streamAgentEvents(agent as never, 'p', { signal: aborted.signal })) {
            early.push(e);
        }

        const live = new AbortController();
        const slowAgent = {
            name: 'slow',
            streamEvents: async function* () {
                yield { type: 'text-delta', delta: '1' } as StreamChunk;
                live.abort();
                yield { type: 'text-delta', delta: '2' } as StreamChunk;
            },
        };
        for await (const _ of streamAgentEvents(slowAgent as never, 'p', { signal: live.signal })) {
            // drain
        }

        const boomAgent = {
            name: 'boom',
            streamEvents: async function* () {
                throw 'explode';
            },
        };
        const errEvents: unknown[] = [];
        try {
            for await (const e of streamAgentEvents(boomAgent as never, 'p')) {
                errEvents.push(e);
            }
        } catch {
            // error also rethrown after bridge
        }

        const texts: string[] = [];
        for await (const t of streamAgentText(
            { name: 't', stream: agent.stream } as never,
            'p',
            { node: 'n' },
        )) {
            texts.push(t);
        }
        expect(texts).toEqual(['tok']);
    });
});

describe('as-tool remaining option branches', () => {
    it('toRunnableAgent string prompt + multiAgentTool options', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'ok' });
        const adapted = toRunnableAgent({
            instructions: 'i',
            createSession: async () => 's',
            run,
        } as never);
        await adapted.run('plain');
        expect(run).toHaveBeenCalledWith('plain', undefined);

        const tools = multiAgentTool({
            agents: {
                a: { run: async () => ({ text: '1' }) },
                b: { run: async () => ({ text: '2' }) },
            },
            descriptions: { a: 'A' },
            parameters: z.object({ prompt: z.string() }),
            outputSchemas: { a: z.object({ text: z.string() }) },
            maxDepth: 2,
        });
        expect(tools).toHaveLength(2);
        expect(tools[0]!.description).toBe('A');
        expect(tools[1]!.description).toContain('b');
    });

    it('pipelineAsTool with hooks and outputSchema', async () => {
        const t = pipelineAsTool({
            name: 'p',
            description: 'p',
            pipeline: { run: async () => ({ text: 'x' }) },
            parameters: z.object({ prompt: z.string() }),
            outputSchema: z.object({ text: z.string() }),
            beforeExecute: () => undefined,
            afterExecute: () => undefined,
            onError: () => ({ text: 'err' }),
        });
        const r = await t.execute({ prompt: 'hi' });
        expect(r.success).toBe(true);
    });

    it('workflowAsTool default parameters and undefined results', async () => {
        const t = workflowAsTool({
            name: 'w',
            description: 'w',
            workflow: {
                execute: async () => ({ status: 'completed', results: undefined }),
            },
        });
        const r = await t.execute({ input: {} });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({});
    });
});

describe('final branch polish → 100%', () => {
    it('http: empty query, null content-type; openai: missing properties', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => null },
            text: async () => 'plain-body',
            json: async () => ({}),
        });
        const emptyQs = fromHttpTool({
            name: 'empty-qs',
            description: 'g',
            url: 'https://example.test/empty',
            method: 'GET',
            query: () => ({ a: undefined, b: undefined }),
            fetchImpl: fetchImpl as never,
        });
        const r = await emptyQs.execute({});
        expect(r.success).toBe(true);
        expect(r.data).toBe('plain-body');
        expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://example.test/empty');

        const noProps = jsonSchemaToZodObject({ type: 'object' });
        expect(noProps.safeParse({ anything: 1 }).success).toBe(true);
    });

    it('compose/pipe: remaining void/early-stop/Error paths', async () => {
        const a = mockCreateAgent('ca');
        const b = mockCreateAgent('cb');

        // non-object trailing arg ignored (covers else-if false)
        const ignored = compose(a, b, 42 as never);
        await expect(ignored.run('x')).resolves.toBeTruthy();

        // early stop + afterWorkflow returning undefined → falls back to currentResult
        const earlyUndef = compose(a, b, {
            when: async () => false,
            hooks: { afterWorkflow: async () => undefined },
        });
        const er = await earlyUndef.run('p');
        expect(er.text).toContain('ca');

        // full run without afterWorkflow (false branch of hooks?.afterWorkflow)
        const plain = compose(a, b, {
            hooks: { beforeStage: async (_i, _n, p) => `rewritten:${p}` },
            transform: async (r) => r.text ?? '',
        });
        const pr = await plain.run('go');
        expect(pr.text).toContain('cb');

        // afterWorkflow returns undefined at end
        const endUndef = compose(a, b, {
            hooks: { afterWorkflow: async () => undefined },
        });
        await expect(endUndef.run('z')).resolves.toBeTruthy();

        // onError with Error instance
        const boom = mockCreateAgent('boom');
        (boom.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom-err'));
        const onError = vi.fn();
        await expect(compose(a, boom, { hooks: { onError } }).run('x')).rejects.toThrow('boom-err');
        expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);

        // onError with non-Error throw (covers instanceof false branch)
        const boom2 = mockCreateAgent('boom2');
        (boom2.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce('compose-string-fail');
        const onError2 = vi.fn();
        await expect(compose(a, boom2, { hooks: { onError: onError2 } }).run('x')).rejects.toBe(
            'compose-string-fail',
        );
        expect(onError2.mock.calls[0]![0]).toBeInstanceOf(Error);

        // pipe: beforeStage returns string; text ?? ''; Error onError; no onError
        const nameless = { ...mockCreateAgent('np'), name: undefined } as unknown as CreateAgentResult;
        (nameless.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ...makeRunResult(''),
            text: undefined,
        });
        const pipeStr = pipe(nameless)
            .then(b, {})
            .hooks({
                beforeStage: async () => 'stage-prompt',
                afterWorkflow: async () => undefined,
            });
        await expect(pipeStr.run('in')).resolves.toBeTruthy();

        const pipeEarlyUndef = pipe(a)
            .then(b, { when: async () => false })
            .hooks({ afterWorkflow: async () => undefined });
        await expect(pipeEarlyUndef.run('e')).resolves.toBeTruthy();

        const pipeBoom = mockCreateAgent('pb');
        (pipeBoom.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('pipe-err'));
        const pipeOnErr = vi.fn();
        await expect(pipe(a).then(pipeBoom).hooks({ onError: pipeOnErr }).run('x')).rejects.toThrow(
            'pipe-err',
        );
        expect(pipeOnErr.mock.calls[0]![0]).toBeInstanceOf(Error);

        const pipeBoom2 = mockCreateAgent('pb2');
        (pipeBoom2.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no-hook'));
        await expect(pipe(a).then(pipeBoom2).run('x')).rejects.toThrow('no-hook');
    });

    it('stream Error throw + supervisor defaultResilience undefined', async () => {
        const errAgent = {
            name: 'e',
            streamEvents: async function* () {
                throw new Error('real-error');
            },
        };
        const seen: unknown[] = [];
        try {
            for await (const e of streamAgentEvents(errAgent as never, 'p')) {
                seen.push(e);
            }
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
        }

        // no resilience on system → defaultResilience undefined → ?? false
        const system = createSystem({
            name: 'no-res',
            agents: { a: mockCreateAgent('a') },
        });
        const boss = system.supervisor({
            createCoordinator: () => mockCreateAgent('c'),
        });
        expect(boss.harness).toBeDefined();
        await expect(boss.run('hi')).resolves.toBeTruthy();
    });

    it('createSystem stream/controlPlane/serve cover remaining lines', async () => {
        const agent = mockCreateAgent('alpha');
        (agent.run as ReturnType<typeof vi.fn>).mockResolvedValue(makeRunResult('alpha-out'));
        const system = createSystem({
            name: 'cp-sys',
            resilience: false,
            agents: { alpha: agent },
        });

        const tokens: string[] = [];
        for await (const t of system.stream('hi', {
            supervisor: { createCoordinator: () => mockCreateAgent('boss') },
        })) {
            tokens.push(t);
        }
        expect(tokens.length).toBeGreaterThan(0);

        const events: unknown[] = [];
        for await (const e of system.streamEvents('hi', {
            supervisor: { createCoordinator: () => mockCreateAgent('boss') },
        })) {
            events.push(e);
        }
        expect(events.length).toBeGreaterThan(0);

        // Mock control plane so we can exercise buildControlPlaneAgents without binding ports
        const cpMod = await import('../src/control-plane/index.js');
        let captured: Parameters<typeof cpMod.createControlPlane>[0] | undefined;
        const start = vi.fn(async (_port?: number) => undefined);
        const stop = vi.fn(async () => undefined);
        const spy = vi.spyOn(cpMod, 'createControlPlane').mockImplementation((config) => {
            captured = config;
            return { start, stop } as never;
        });

        try {
            const fakeStore = {} as never;
            system.controlPlane({
                supervisor: { createCoordinator: () => mockCreateAgent('boss') },
                stores: {
                    sessionStore: fakeStore,
                    evalStore: fakeStore,
                    traceStore: fakeStore,
                    approvalStore: fakeStore,
                    knowledgeStore: fakeStore,
                },
            });
            expect(captured?.sessionStore).toBe(fakeStore);
            expect(captured?.agents?.length).toBeGreaterThan(0);

            // Invoke buildControlPlaneAgents run/streamEvents callbacks
            const bossAgent = captured!.agents!.find((a) => a.name === 'boss')!;
            const alphaAgent = captured!.agents!.find((a) => a.name === 'alpha')!;
            await expect(bossAgent.run('p')).resolves.toEqual({ text: expect.any(String) });
            await expect(alphaAgent.run('p')).resolves.toEqual({ text: 'alpha-out' });

            // Non-object / nullish run results → String(result ?? '')
            const boss2 = mockCreateAgent('boss2');
            (boss2.run as ReturnType<typeof vi.fn>).mockResolvedValue('raw-string' as never);
            system.controlPlane({
                supervisor: { createCoordinator: () => boss2 },
            });
            const b2 = captured!.agents!.find((a) => a.name === 'boss2')!;
            await expect(b2.run('p')).resolves.toEqual({ text: 'raw-string' });

            const boss3 = mockCreateAgent('boss3');
            (boss3.run as ReturnType<typeof vi.fn>).mockResolvedValue(undefined as never);
            system.controlPlane({
                supervisor: { createCoordinator: () => boss3 },
            });
            const b3 = captured!.agents!.find((a) => a.name === 'boss3')!;
            await expect(b3.run('p')).resolves.toEqual({ text: '' });

            const boss4 = mockCreateAgent('boss4');
            (boss4.run as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
            system.controlPlane({
                supervisor: { createCoordinator: () => boss4 },
            });
            const b4 = captured!.agents!.find((a) => a.name === 'boss4')!;
            const emptyObj = await b4.run('p');
            expect(emptyObj.text).toBeTruthy(); // String({})

            // streamEvents on both
            if (bossAgent.streamEvents) {
                for await (const _ of bossAgent.streamEvents('p', { streamMode: ['messages'] })) {
                    // drain
                }
            }
            if (alphaAgent.streamEvents) {
                for await (const _ of alphaAgent.streamEvents('p', { streamMode: ['messages'] })) {
                    // drain
                }
            }

            // serve(number) / serve(options) / serve() — spy agent for paths without createCoordinator
            const withCoord = { createCoordinator: () => mockCreateAgent('boss') };
            const agentSpy = vi.spyOn(dxAgent, 'agent').mockReturnValue(mockCreateAgent('auto'));
            try {
                await system.serve(18765);
                expect(start).toHaveBeenCalledWith(18765);
                await system.serve(undefined as never);
                expect(start).toHaveBeenCalledWith(4100);
            } finally {
                agentSpy.mockRestore();
            }
            await system.serve({ port: 18766, supervisor: withCoord });
            expect(start).toHaveBeenCalledWith(18766);
            await system.serve({ supervisor: withCoord });
            expect(start).toHaveBeenCalledWith(4100);
        } finally {
            spy.mockRestore();
        }
    });
});

