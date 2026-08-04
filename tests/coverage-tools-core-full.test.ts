/**
 * Hermetic coverage for src/tools/core infrastructure:
 * base-tool, as-tool, domain adapters (memory/knowledge/prompt/agent/
 * workflow/pipeline), tool-helper, registry, trie, cache, compressor,
 * gateway-http, wrappers, zod-to-schema.
 *
 * Complements (does not replace) the existing coverage-tools-core.test.ts,
 * everything-as-tool.test.ts, tool-cache-compression.test.ts,
 * tool-gateway.test.ts, tool-schema-generation.test.ts, and
 * agent-workflow-tool-hooks.test.ts.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { z } from 'zod';

import { BaseTool, type BaseToolConfig } from '../src/tools/core/base-tool.js';
import { asTool, toTool } from '../src/tools/core/as-tool.js';
import { agentAsTool, toRunnableAgent, multiAgentTool, getAgentToolDepth } from '../src/tools/core/agent-as-tool.js';
import { workflowAsTool } from '../src/tools/core/workflow-as-tool.js';
import { pipelineAsTool } from '../src/tools/core/pipeline-as-tool.js';
import { memoryAsTool, type MemoryStoreLike } from '../src/tools/core/memory-as-tool.js';
import { knowledgeAsTool, type KnowledgeBaseLike } from '../src/tools/core/knowledge-as-tool.js';
import { promptAsTool, type PromptRegistryLike } from '../src/tools/core/prompt-as-tool.js';
import {
    tool, createTool, createTools, defineTool, ToolBuilder, extendTool, wrapTool,
    pipeTools, versionTool, isLightweightTool,
} from '../src/tools/core/tool-helper.js';
import type { LightweightTool } from '../src/tools/core/tool-helper.js';
import { toToolRegistry, ToolRegistryImpl } from '../src/tools/core/registry.js';
import { ToolCache } from '../src/tools/core/tool-cache.js';
import { ToolCompressor } from '../src/tools/core/tool-compressor.js';
import { withCache, withCompression } from '../src/tools/core/tool-wrappers.js';
import { handleToolGatewayRequest } from '../src/tools/core/tool-gateway-http.js';
import { ToolNameTrie, NGramIndex } from '../src/tools/core/trie.js';
import { toolToLLMDef, zodToJsonSchema } from '../src/tools/core/zod-to-schema.js';
import { ToolCategory, type ToolContext, type Tool, type ToolResult } from '../src/tools/core/types.js';

function ctx(over: Partial<ToolContext> = {}): ToolContext {
    return {
        toolId: 'tool_test',
        agentId: 'agent_test',
        sessionId: 'sess_test',
        permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        ...over,
    };
}

function makeResult<T>(data: T): ToolResult<T> {
    const now = new Date();
    return { success: true, data, executionTimeMs: 5, metadata: { startTime: now, endTime: now, retries: 0 } };
}

function makeErrorResult(): ToolResult<unknown> {
    const now = new Date();
    return {
        success: false,
        error: { code: 'EXECUTION_ERROR', message: 'boom' },
        executionTimeMs: 1,
        metadata: { startTime: now, endTime: now, retries: 0 },
    };
}

// ── base-tool.ts ─────────────────────────────────────────────────────────────

const schema = z.object({ value: z.number() });

class ProbeTool extends BaseTool<typeof schema, { value: number }> {
    private mode: 'resolve' | 'never' | 'throw' | 'throw-string' | 'throw-object';
    public readonly performed: Array<{ params: { value: number }; context: ToolContext }> = [];

    constructor(config: BaseToolConfig<typeof schema> & { mode?: 'resolve' | 'never' | 'throw' | 'throw-string' | 'throw-object' }) {
        super(config);
        this.mode = config.mode ?? 'resolve';
    }

    protected async performExecute(
        params: { value: number },
        context: ToolContext,
    ): Promise<{ value: number }> {
        this.performed.push({ params, context });
        if (this.mode === 'never') return new Promise(() => { /* never resolves */ });
        if (this.mode === 'throw') throw new Error('kaboom');
        if (this.mode === 'throw-string') throw 'string-boom';
        if (this.mode === 'throw-object') throw { code: 'OBJ' };
        return params;
    }
}

/** Non-async performExecute that throws a primitive synchronously. */
class SyncThrowTool extends BaseTool<typeof schema, { value: number }> {
    protected performExecute(): never {
        throw 'sync-string-boom';
    }
}

describe('BaseTool', () => {
    it('applies constructor defaults', () => {
        const t = new ProbeTool({ name: 'defaults', description: 'd', parameters: schema });
        expect(t.name).toBe('defaults');
        expect(t.description).toBe('d');
        expect(t.parameters).toBe(schema);
        expect(t.id).toMatch(/^tool_/);
        expect(t.permissions).toEqual({ allowNetwork: false, allowFileSystem: false, maxExecutionTimeMs: 30_000 });
        expect(t.category).toBe(ToolCategory.UTILITY);
        expect(t.version).toBe('1.0.0');
        expect(t.author).toBeUndefined();
        expect(t.tags).toBeUndefined();
    });

    it('honours every explicit config field', () => {
        const t = new ProbeTool({
            id: 'custom-id',
            name: 'full',
            description: 'full desc',
            parameters: schema,
            permissions: {
                allowNetwork: true,
                allowFileSystem: true,
                allowedPaths: ['/tmp'],
                allowedHosts: ['example.com'],
                maxExecutionTimeMs: 500,
            },
            category: ToolCategory.API,
            version: '2.3.4',
            author: 'me',
            tags: ['a', 'b'],
        });
        expect(t.id).toBe('custom-id');
        expect(t.permissions).toEqual({
            allowNetwork: true,
            allowFileSystem: true,
            allowedPaths: ['/tmp'],
            allowedHosts: ['example.com'],
            maxExecutionTimeMs: 500,
        });
        expect(t.category).toBe(ToolCategory.API);
        expect(t.version).toBe('2.3.4');
        expect(t.author).toBe('me');
        expect(t.tags).toEqual(['a', 'b']);
    });

    it('returns VALIDATION_ERROR for invalid params', async () => {
        const t = new ProbeTool({ name: 'v', description: 'd', parameters: schema });
        const result = await t.execute({ value: 'nope' } as never, ctx());
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('VALIDATION_ERROR');
        expect(result.error?.message).toContain('Invalid parameters');
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
        expect(result.metadata.retries).toBe(0);
        expect(t.performed).toHaveLength(0);
    });

    it('denies execution when network is disallowed in context', async () => {
        const t = new ProbeTool({
            name: 'net',
            description: 'd',
            parameters: schema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        });
        const result = await t.execute({ value: 1 }, ctx({ permissions: { allowNetwork: false, allowFileSystem: false, maxExecutionTimeMs: 1000 } }));
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('PERMISSION_DENIED');
        expect(result.error?.message).toBe('Network access not permitted in context');
        expect(t.performed).toHaveLength(0);
    });

    it('denies execution when filesystem is disallowed in context', async () => {
        const t = new ProbeTool({
            name: 'fs',
            description: 'd',
            parameters: schema,
            permissions: { allowNetwork: false, allowFileSystem: true, maxExecutionTimeMs: 30_000 },
        });
        const result = await t.execute({ value: 1 }, ctx());
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('PERMISSION_DENIED');
        expect(result.error?.message).toBe('Filesystem access not permitted in context');
        expect(t.performed).toHaveLength(0);
    });

    it('returns success data and metadata on happy path', async () => {
        const t = new ProbeTool({ name: 'ok', description: 'd', parameters: schema });
        const context = ctx({ timeoutMs: 2000 });
        const result = await t.execute({ value: 7 }, context);
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ value: 7 });
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
        expect(result.metadata.retries).toBe(0);
        expect(result.metadata.endTime).toBeInstanceOf(Date);
        expect(t.performed[0].context).toBe(context);
    });

    it('uses context.timeoutMs over the permission default', async () => {
        const t = new ProbeTool({ name: 't', description: 'd', parameters: schema });
        const context = ctx({ timeoutMs: 5000 });
        await t.execute({ value: 1 }, context);
        expect(t.performed[0].context.timeoutMs).toBe(5000);
    });

    it('returns a timeout error when performExecute never resolves', async () => {
        const t = new ProbeTool({ name: 'slow', description: 'd', parameters: schema, mode: 'never' });
        const result = await t.execute({ value: 1 }, ctx({ timeoutMs: 10 }));
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('EXECUTION_ERROR');
        expect(result.error?.message).toContain('timed out after');
    });

    it('returns EXECUTION_ERROR when performExecute throws an Error', async () => {
        const t = new ProbeTool({ name: 'th', description: 'd', parameters: schema, mode: 'throw' });
        const result = await t.execute({ value: 1 }, ctx());
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('EXECUTION_ERROR');
        expect(result.error?.message).toBe('kaboom');
    });

    it('stringifies non-Error throws', async () => {
        const t = new ProbeTool({ name: 'th', description: 'd', parameters: schema, mode: 'throw-string' });
        const result = await t.execute({ value: 1 }, ctx());
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe('string-boom');

        const t2 = new ProbeTool({ name: 'th2', description: 'd', parameters: schema, mode: 'throw-object' });
        const r2 = await t2.execute({ value: 1 }, ctx());
        expect(r2.success).toBe(false);
        expect(r2.error?.message).toBe('[object Object]');
    });

    it('stringifies a synchronously-thrown primitive from performExecute', async () => {
        const t = new SyncThrowTool({ name: 'sync', description: 'd', parameters: schema });
        const result = await t.execute({ value: 1 }, ctx());
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('EXECUTION_ERROR');
        expect(result.error?.message).toBe('sync-string-boom');
    });

    it('validate() returns a type-guard boolean', () => {
        const t = new ProbeTool({ name: 'val', description: 'd', parameters: schema });
        expect(t.validate({ value: 1 })).toBe(true);
        expect(t.validate({ value: 'x' })).toBe(false);
        expect(t.validate(null as never)).toBe(false);
    });

    it('emits debug logging only when debug is enabled', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => { /* noop */ });
        try {
            const quiet = new ProbeTool({ name: 'quiet', description: 'd', parameters: schema });
            await quiet.execute({ value: 1 }, ctx());
            expect(debugSpy).not.toHaveBeenCalled();

            debugSpy.mockClear();
            const loud = new ProbeTool({ name: 'loud', description: 'd', parameters: schema, debug: true });
            await loud.execute({ value: 1 }, ctx());
            expect(debugSpy).toHaveBeenCalled();
            const messages = debugSpy.mock.calls.map(c => String(c[0])).join(' ');
            expect(messages).toContain('Starting');
            expect(messages).toContain('Completed');
        } finally {
            debugSpy.mockRestore();
        }
    });
});

// ── tool-helper.ts ───────────────────────────────────────────────────────────

function makeEchoTool() {
    return tool({
        name: 'echo',
        description: 'Echo input',
        parameters: z.object({ msg: z.string() }),
        execute: async ({ msg }) => msg,
    });
}

describe('tool() helper', () => {
    it('applies defaults for category/tags/needsApproval/strict/timeoutMs', () => {
        const t = makeEchoTool();
        expect(t.category).toBe(ToolCategory.CUSTOM);
        expect(t.tags).toEqual([]);
        expect(t.needsApproval).toBe(false);
        expect(t.strict).toBe(true);
        expect(t.name).toBe('echo');
        expect(t.description).toBe('Echo input');
    });

    it('executes and returns a success result', async () => {
        const t = makeEchoTool();
        const result = await t.execute({ msg: 'hi' });
        expect(result.success).toBe(true);
        expect(result.data).toBe('hi');
        expect(result.metadata.retries).toBe(0);
        expect(typeof result.executionTimeMs).toBe('number');
    });

    it('defaults unknown agent/session ids in context', async () => {
        const t = makeEchoTool();
        const seen: unknown[] = [];
        const t2 = tool({
            name: 'capture',
            description: 'capture ctx',
            parameters: z.object({}),
            execute: async (_p, c) => { seen.push(c); return 'ok'; },
        });
        await t2.execute({} as never);
        await t2.execute({} as never, { agentId: 'a', sessionId: 's', abortSignal: new AbortController().signal });
        expect(seen[0]).toMatchObject({ agentId: 'unknown', sessionId: 'unknown' });
        expect((seen[1] as { agentId: string }).agentId).toBe('a');
        expect((seen[1] as { sessionId: string }).sessionId).toBe('s');
        expect((seen[1] as { abortSignal: AbortSignal }).abortSignal).toBeInstanceOf(AbortSignal);

        // placeholder to satisfy lint about unused t variable in this scope
        expect(t.name).toBe('echo');
    });

    it('returns VALIDATION_ERROR on invalid input', async () => {
        const t = makeEchoTool();
        const result = await t.execute({ msg: 123 } as never);
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('cancels execution when beforeExecute returns false', async () => {
        const t = tool({
            name: 'guarded',
            description: 'g',
            parameters: z.object({ x: z.number() }),
            beforeExecute: async () => false,
            execute: async () => 'should-not-run',
        });
        const result = await t.execute({ x: 1 });
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('CANCELLED');
        expect(result.error?.message).toContain('guarded');
    });

    it('notifies onInputAvailable streaming hook', async () => {
        const spy = vi.fn();
        const t = tool({
            name: 'streamy',
            description: 's',
            parameters: z.object({ x: z.number() }),
            onInputAvailable: spy,
            execute: async ({ x }) => x,
        });
        await t.execute({ x: 3 });
        expect(spy).toHaveBeenCalledWith('streamy', { x: 3 });
    });

    it('times out and clears the timeout handle', async () => {
        const t = tool({
            name: 'hang',
            description: 'h',
            parameters: z.object({}),
            timeoutMs: 10,
            execute: () => new Promise(() => { /* never */ }),
        });
        const result = await t.execute({});
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('EXECUTION_ERROR');
        expect(result.error?.message).toContain('timed out after 10ms');
    });

    it('validates output when outputSchema is provided', async () => {
        const ok = tool({
            name: 'out',
            description: 'o',
            parameters: z.object({ n: z.number() }),
            outputSchema: z.object({ doubled: z.number() }),
            execute: async ({ n }) => ({ doubled: n * 2 }),
        });
        const good = await ok.execute({ n: 2 });
        expect(good.success).toBe(true);
        expect(good.data).toEqual({ doubled: 4 });

        const bad = tool({
            name: 'out2',
            description: 'o',
            parameters: z.object({ n: z.number() }),
            outputSchema: z.object({ doubled: z.number() }),
            execute: async () => ({ wrong: 1 }),
        });
        const res = await bad.execute({ n: 2 });
        expect(res.success).toBe(false);
        expect(res.error?.code).toBe('OUTPUT_VALIDATION_ERROR');
        expect(res.error?.message).toContain('output validation failed');
    });

    it('applies toModelOutput and afterExecute on success', async () => {
        const afterSpy = vi.fn();
        const transformSpy = vi.fn().mockImplementation((o: number) => ({ value: o }));
        const t = tool({
            name: 't',
            description: 'd',
            parameters: z.object({ x: z.number() }),
            toModelOutput: transformSpy,
            afterExecute: afterSpy,
            execute: async ({ x }) => x,
        });
        const result = await t.execute({ x: 5 });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ value: 5 });
        expect(transformSpy).toHaveBeenCalledWith(5);
        expect(afterSpy).toHaveBeenCalledWith({ value: 5 }, { x: 5 }, expect.any(Object));
    });

    it('uses onError fallback and returns a success result', async () => {
        const t = tool({
            name: 'fragile',
            description: 'f',
            parameters: z.object({}),
            onError: (err) => `handled:${err.message}`,
            execute: async () => { throw new Error('boom'); },
        });
        const result = await t.execute({});
        expect(result.success).toBe(true);
        expect(result.data).toBe('handled:boom');
    });

    it('handles non-Error throws in onError', async () => {
        const t = tool({
            name: 'fragile2',
            description: 'f',
            parameters: z.object({}),
            onError: (err) => `wrapped:${(err as Error).message}`,
            execute: async () => { throw 'plain-string'; },
        });
        const result = await t.execute({});
        expect(result.success).toBe(true);
        expect(result.data).toBe('wrapped:plain-string');
    });

    it('returns EXECUTION_ERROR when no onError and execute throws', async () => {
        const t = tool({
            name: 'fragile3',
            description: 'f',
            parameters: z.object({}),
            execute: async () => { throw new Error('nope'); },
        });
        const result = await t.execute({});
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('EXECUTION_ERROR');
        expect(result.error?.message).toBe('nope');
    });

    it('stringifies non-Error throws without onError', async () => {
        const t = tool({
            name: 'fragile4',
            description: 'f',
            parameters: z.object({}),
            execute: async () => { throw 42; },
        });
        const result = await t.execute({});
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe('42');
    });

    it('validate() supports strict variants', () => {
        const base = tool({
            name: 'v',
            description: 'd',
            parameters: z.object({ a: z.number() }),
            execute: async ({ a }) => a,
        });
        expect(base.validate({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
        expect(base.validate({ a: 'x' })).toEqual({ success: false, error: expect.anything() });

        const loose = tool({
            name: 'v2',
            description: 'd',
            strict: false,
            parameters: z.object({ a: z.number() }),
            execute: async ({ a }) => a,
        });
        expect(loose.validate({ a: 1, extra: true })).toEqual({ success: true, data: { a: 1 } });
    });

    it('toFrameworkTool wraps execute and validate with permissions', async () => {
        const t = tool({
            name: 'fw',
            description: 'fw desc',
            parameters: z.object({ msg: z.string() }),
            timeoutMs: 1234,
            tags: ['x'],
            category: ToolCategory.WEB,
            execute: async ({ msg }) => msg,
        });
        const fw = t.toFrameworkTool();
        expect(fw.id).toBe('fw');
        expect(fw.name).toBe('fw');
        expect(fw.description).toBe('fw desc');
        expect(fw.version).toBe('1.0.0');
        expect(fw.tags).toEqual(['x']);
        expect(fw.category).toBe(ToolCategory.WEB);
        expect(fw.permissions).toEqual({ allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 1234 });

        const good = await fw.execute({ msg: 'hey', agentId: 'a1', sessionId: 's1' } as never);
        expect(good.success).toBe(true);
        expect(good.data).toBe('hey');

        const missing = await fw.execute({ msg: 'hey' } as never);
        expect(missing.success).toBe(true);

        expect(fw.validate({ msg: 'x' })).toBe(true);
        expect(fw.validate({ msg: 5 })).toBe(false);
    });

    it('toJSONSchema builds a function-calling schema (strict + loose)', () => {
        const strict = tool({
            name: 'js',
            description: 'js desc',
            parameters: z.object({ q: z.string() }),
            execute: async ({ q }) => q,
        });
        const s = strict.toJSONSchema() as {
            type: string;
            function: { name: string; description: string; strict: boolean; parameters: Record<string, unknown> };
        };
        expect(s.type).toBe('function');
        expect(s.function.name).toBe('js');
        expect(s.function.description).toBe('js desc');
        expect(s.function.strict).toBe(true);
        expect((s.function.parameters as { type: string }).type).toBe('object');

        const loose = tool({
            name: 'js2',
            description: 'd',
            strict: false,
            parameters: z.object({}),
            execute: async () => 'ok',
        });
        const l = loose.toJSONSchema() as { function: { strict: boolean; parameters: { additionalProperties?: boolean } } };
        expect(l.function.strict).toBe(false);
        expect(l.function.parameters.additionalProperties).toBe(true);
    });

    it('exposes hooks and toModelOutput on the instance', () => {
        const start = vi.fn();
        const delta = vi.fn();
        const avail = vi.fn();
        const before = vi.fn();
        const after = vi.fn();
        const onerr = vi.fn();
        const tm = vi.fn();
        const t = tool({
            name: 'h',
            description: 'd',
            parameters: z.object({}),
            onInputStart: start,
            onInputDelta: delta,
            onInputAvailable: avail,
            beforeExecute: before,
            afterExecute: after,
            onError: onerr,
            toModelOutput: tm,
            execute: async () => 'out',
        });
        expect(t.hooks.onInputStart).toBe(start);
        expect(t.hooks.onInputDelta).toBe(delta);
        expect(t.hooks.onInputAvailable).toBe(avail);
        expect(t.hooks.beforeExecute).toBe(before);
        expect(t.hooks.afterExecute).toBe(after);
        expect(t.hooks.onError).toBe(onerr);
        expect(t.toModelOutput).toBe(tm);
    });
});

describe('createTools / createTool / isLightweightTool', () => {
    it('createTools builds one tool per definition keyed by name', async () => {
        const tools = createTools({
            getWeather: {
                description: 'Weather',
                parameters: z.object({ city: z.string() }),
                execute: async ({ city }) => `weather:${city}`,
            },
            getNews: {
                description: 'News',
                parameters: z.object({ topic: z.string() }),
                execute: async ({ topic }) => `news:${topic}`,
            },
        });
        expect(Object.keys(tools)).toEqual(['getWeather', 'getNews']);
        expect(tools.getWeather.name).toBe('getWeather');
        const r = await tools.getWeather.execute({ city: 'Seattle' });
        expect(r.success).toBe(true);
        expect(r.data).toBe('weather:Seattle');
    });

    it('createTool is an alias of tool()', async () => {
        const t = createTool({
            name: 'alias',
            description: 'd',
            parameters: z.object({ q: z.number() }),
            execute: async ({ q }) => q * 2,
        });
        const r = await t.execute({ q: 3 });
        expect(r.success).toBe(true);
        expect(r.data).toBe(6);
    });

    it('isLightweightTool discriminates correctly', () => {
        const t = makeEchoTool();
        expect(isLightweightTool(t)).toBe(true);
        expect(isLightweightTool(null)).toBe(false);
        expect(isLightweightTool('str')).toBe(false);
        expect(isLightweightTool(42)).toBe(false);
        expect(isLightweightTool({})).toBe(false);
        expect(isLightweightTool({ name: 'a' })).toBe(false);
        expect(isLightweightTool({ name: 'a', description: 'b' })).toBe(false);
        expect(isLightweightTool({
            name: 'a',
            description: 'b',
            toFrameworkTool: () => ({}) as never,
            execute: async () => ({ success: true } as never),
            validate: () => true,
        })).toBe(true);
        // missing validate → false
        expect(isLightweightTool({
            name: 'a',
            description: 'b',
            toFrameworkTool: () => ({}) as never,
            execute: async () => ({ success: true } as never),
        })).toBe(false);
    });
});

describe('defineTool() / ToolBuilder', () => {
    it('builds a fully-configured tool via the fluent chain', async () => {
        const start = vi.fn();
        const delta = vi.fn();
        const ready = vi.fn();
        const before = vi.fn();
        const after = vi.fn();
        const onerr = vi.fn();
        const transform = vi.fn().mockImplementation((o: { v: number }) => ({ result: o.v }));

        const t = defineTool()
            .name('fluent')
            .description('Fluent tool')
            .parameters(z.object({ n: z.number() }))
            .execute(async ({ n }, _ctx) => ({ v: n }))
            .approval()
            .category(ToolCategory.AI)
            .tag('one')
            .tag('two')
            .tags(['three'])
            .timeout(999)
            .loose()
            .onStart(start)
            .onDelta(delta)
            .onReady(ready)
            .transform(transform)
            .before(before)
            .after(after)
            .onError(onerr)
            .build();

        expect(t.name).toBe('fluent');
        expect(t.category).toBe(ToolCategory.AI);
        expect(t.tags).toEqual(['three']);
        expect((t as unknown as { timeoutMs?: number }).needsApproval).not.toBe(false);
        expect(transform).not.toHaveBeenCalled();

        const result = await t.execute({ n: 4 });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 4 });
        expect(transform).toHaveBeenCalledWith({ v: 4 });
        expect(before).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
        expect(start).not.toHaveBeenCalled();
        expect(delta).not.toHaveBeenCalled();
        expect(ready).toHaveBeenCalledWith('fluent', { n: 4 });
    });

    it('loose() affects the generated schema', () => {
        const t = defineTool()
            .name('l')
            .description('d')
            .parameters(z.object({ a: z.number() }))
            .execute(async ({ a }) => a)
            .loose()
            .build();
        const js = t.toJSONSchema() as { function: { strict: boolean; parameters: { additionalProperties?: boolean } } };
        expect(js.function.strict).toBe(false);
        expect(js.function.parameters.additionalProperties).toBe(true);
    });

    it('approval(boolean) and approval(fn) are accepted', async () => {
        const t = defineTool()
            .name('app')
            .description('d')
            .parameters(z.object({ v: z.number() }))
            .approval(false)
            .execute(async ({ v }) => v)
            .build();
        expect(t.needsApproval).toBe(false);

        const fn = vi.fn().mockResolvedValue(true);
        const t2 = defineTool()
            .name('app2')
            .description('d')
            .parameters(z.object({ v: z.number() }))
            .approval(fn)
            .execute(async ({ v }) => v)
            .build();
        expect(t2.needsApproval).toBe(fn);
    });

    it('throws when required fields are missing before build', () => {
        expect(() => new ToolBuilder().build()).toThrow(/name/);
        expect(() => new ToolBuilder().name('x').build()).toThrow(/description/);
        expect(() => new ToolBuilder().name('x').description('d').build()).toThrow(/parameters/);
        expect(() =>
            new ToolBuilder().name('x').description('d').parameters(z.object({})).build(),
        ).toThrow(/execute/);
    });

    it('defineTool returns a fresh builder each call', () => {
        expect(defineTool()).toBeInstanceOf(ToolBuilder);
        expect(defineTool()).not.toBe(defineTool());
    });
});

describe('extendTool()', () => {
    it('overrides name/description and merges tags/category/timeout', () => {
        const base = tool({
            name: 'orig',
            description: 'orig desc',
            parameters: z.object({ q: z.string() }),
            tags: ['base'],
            execute: async ({ q }) => q.toUpperCase(),
        });
        const ext = extendTool(base, {
            name: 'renamed',
            description: 'renamed desc',
            tags: ['extra'],
            category: ToolCategory.DATABASE,
            timeoutMs: 777,
        });
        expect(ext.name).toBe('renamed');
        expect(ext.description).toBe('renamed desc');
        expect(ext.tags).toEqual(['base', 'extra']);
        expect((ext as unknown as { category?: ToolCategory }).category).toBe(ToolCategory.DATABASE);
    });

    it('uses base name/description when not overridden', () => {
        const base = makeEchoTool();
        const ext = extendTool(base, {});
        expect(ext.name).toBe('echo');
        expect(ext.description).toBe('Echo input');
    });

    it('applies transformInput and transformOutput around execution', async () => {
        const base = tool({
            name: 'b',
            description: 'd',
            parameters: z.object({ n: z.number() }),
            execute: async ({ n }) => n * 10,
        });
        const ext = extendTool(base, {
            transformInput: async (p) => ({ n: (p.n as number) + 1 }),
            transformOutput: async (o) => (o as number) + 5,
        });
        const r = await ext.execute({ n: 1 });
        expect(r.success).toBe(true);
        expect(r.data).toBe(25); // (1+1)*10 + 5
    });

    it('throws a cancellation error when beforeExecute returns false', async () => {
        const base = makeEchoTool();
        const ext = extendTool(base, {
            beforeExecute: async () => false,
        });
        const r = await ext.execute({ msg: 'x' });
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('cancelled by beforeExecute');
    });

    it('invokes afterExecute after success', async () => {
        const base = makeEchoTool();
        const spy = vi.fn();
        const ext = extendTool(base, { afterExecute: spy });
        await ext.execute({ msg: 'x' });
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('falls back via onError when the base tool fails', async () => {
        const failing = tool({
            name: 'fail',
            description: 'd',
            parameters: z.object({}),
            execute: async () => { throw new Error('base-down'); },
        });
        const ext = extendTool(failing, {
            onError: async (err) => `recovered:${err.message}`,
        });
        const r = await ext.execute({});
        expect(r.success).toBe(true);
        expect(r.data).toBe('recovered:base-down');
    });

    it('rethrows when the base tool fails and no onError is given', async () => {
        const failing = tool({
            name: 'fail2',
            description: 'd',
            parameters: z.object({}),
            execute: async () => { throw new Error('base-down'); },
        });
        const ext = extendTool(failing, {});
        const r = await ext.execute({});
        expect(r.success).toBe(false);
        expect(r.error?.message).toBe('base-down');
    });

    it('propagates failed ToolResult from base.execute as an error', async () => {
        const base = makeEchoTool();
        const ext = extendTool(base, {
            transformInput: async () => ({ msg: 5 as never }),
        });
        const r = await ext.execute({ msg: 'valid' });
        expect(r.success).toBe(false);
    });
});

describe('wrapTool()', () => {
    it('returns the base untouched for an empty middleware list', () => {
        const base = makeEchoTool();
        expect(wrapTool(base, [])).toBe(base);
    });

    it('runs middlewares first-to-last around the base', async () => {
        const order: string[] = [];
        const base = makeEchoTool();
        const wrapped = wrapTool(base, [
            async (p, _c, next) => { order.push('mw1-in'); const r = await next(p, _c); order.push('mw1-out'); return r; },
            async (p, _c, next) => { order.push('mw2-in'); const r = await next(p, _c); order.push('mw2-out'); return r; },
        ]);
        const res = await wrapped.execute({ msg: 'hi' });
        expect(res.success).toBe(true);
        expect(res.data).toBe('hi');
        expect(order).toEqual(['mw1-in', 'mw2-in', 'mw2-out', 'mw1-out']);
    });

    it('lets a middleware short-circuit without calling next', async () => {
        const base = makeEchoTool();
        const wrapped = wrapTool(base, [
            async () => 'short-circuit',
        ]);
        const res = await wrapped.execute({ msg: 'x' });
        expect(res.success).toBe(true);
        expect(res.data).toBe('short-circuit');
    });

    it('propagates failures from the base through middleware', async () => {
        const failing = tool({
            name: 'f',
            description: 'd',
            parameters: z.object({}),
            execute: async () => { throw new Error('down'); },
        });
        const wrapped = wrapTool(failing, [
            async (p, c, next) => next(p, c),
        ]);
        const res = await wrapped.execute({});
        expect(res.success).toBe(false);
        expect(res.error?.message).toBe('down');
    });

    it('applies name/description/tags overrides and passes through outputSchema', () => {
        const base = tool({
            name: 'o',
            description: 'o',
            parameters: z.object({}),
            outputSchema: z.object({ y: z.number() }),
            execute: async () => ({ y: 1 }),
        });
        const wrapped = wrapTool(base, [async (p, c, n) => n(p, c)], {
            name: 'wrapped_name',
            description: 'wrapped desc',
            tags: ['w'],
        });
        expect(wrapped.name).toBe('wrapped_name');
        expect(wrapped.description).toBe('wrapped desc');
        expect(wrapped.tags).toEqual(['w']);
        expect(wrapped.outputSchema).toBe(base.outputSchema);
    });
});

describe('pipeTools()', () => {
    const first = tool({
        name: 'fetch',
        description: 'fetch url',
        parameters: z.object({ url: z.string() }),
        execute: async ({ url }) => ({ body: `html-${url}` }),
    });
    const second = tool({
        name: 'parse',
        description: 'parse html',
        parameters: z.object({ html: z.string() }),
        execute: async ({ html }) => ({ title: `title-${html}` }),
    });

    it('adapts first output into second input', async () => {
        const pipe = pipeTools(first, second, {
            name: 'fetch_and_parse',
            description: 'fetch then parse',
            tags: ['p'],
            adapter: (firstOutput) => ({ html: (firstOutput as { body: string }).body }),
        });
        const r = await pipe.execute({ url: 'https://x.com' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ title: 'title-html-https://x.com' });
    });

    it('throws when the first tool fails', async () => {
        const badFirst = tool({
            name: 'b1',
            description: 'd',
            parameters: z.object({}),
            execute: async () => { throw new Error('first down'); },
        });
        const pipe = pipeTools(badFirst, second, {
            name: 'x',
            description: 'x',
            adapter: (o) => ({ html: String(o) }),
        });
        const r = await pipe.execute({});
        expect(r.success).toBe(false);
        expect(r.error?.message).toBe('first down');
    });

    it('throws when the second tool fails', async () => {
        const badSecond = tool({
            name: 'b2',
            description: 'd',
            parameters: z.object({ html: z.string() }),
            execute: async () => { throw new Error('second down'); },
        });
        const pipe = pipeTools(first, badSecond, {
            name: 'x2',
            description: 'x',
            adapter: (o) => ({ html: (o as { body: string }).body }),
        });
        const r = await pipe.execute({ url: 'u' });
        expect(r.success).toBe(false);
        expect(r.error?.message).toBe('second down');
    });

    it('propagates failure ToolResult from first.execute', async () => {
        const pipe = pipeTools(first, second, {
            name: 'x3',
            description: 'x',
            adapter: () => ({ html: '' }),
        });
        // force first result failure by injecting params that fail validation
        const r = await pipe.execute({ url: 5 as never });
        expect(r.success).toBe(false);
        expect(r.error?.code).toBe('VALIDATION_ERROR');
    });
});

describe('versionTool()', () => {
    it('renames with dots→underscores and tags the version', () => {
        const base = makeEchoTool();
        const vt = versionTool(base, '2.0.1');
        expect(vt.name).toBe('echo_v2_0_1');
        expect(vt.tags).toEqual(['v2.0.1']);
        expect(vt.description).toBe('Echo input');
    });

    it('appends changelog text', () => {
        const base = makeEchoTool();
        const vt = versionTool(base, '1.1', { changelog: 'faster now' });
        expect(vt.description).toBe('Echo input v1.1: faster now');
    });

    it('marks deprecated with replacedBy hint', () => {
        const base = makeEchoTool();
        const vt = versionTool(base, '0.9', { deprecated: true, replacedBy: 'echo_v1_0' });
        expect(vt.description).toContain('[DEPRECATED — use echo_v1_0 instead]');
        expect(vt.tags).toContain('deprecated');
    });

    it('marks deprecated without replacedBy', () => {
        const base = makeEchoTool();
        const vt = versionTool(base, '0.9', { deprecated: true });
        expect(vt.description).toContain('[DEPRECATED]');
        expect(vt.tags).toContain('deprecated');
    });
});

// ── registry.ts ──────────────────────────────────────────────────────────────

function fakeTool(id: string, name: string, opts: Partial<Tool> = {}): Tool {
    return {
        id,
        name,
        description: opts.description ?? `desc for ${name}`,
        parameters: z.object({}) as never,
        permissions: { allowNetwork: false, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        category: opts.category ?? ToolCategory.UTILITY,
        version: '1.0.0',
        tags: opts.tags,
        execute: async () => makeResult('ok'),
        validate: () => true,
        ...opts,
    } as Tool;
}

describe('ToolRegistryImpl / toToolRegistry', () => {
    it('toToolRegistry builds a registry from an array', () => {
        const reg = toToolRegistry([fakeTool('1', 'a'), fakeTool('2', 'b')]);
        expect(reg).toBeInstanceOf(ToolRegistryImpl);
        expect(reg.size()).toBe(2);
    });

    it('toToolRegistry passes through an existing registry', () => {
        const reg = new ToolRegistryImpl();
        reg.register(fakeTool('1', 'a'));
        expect(toToolRegistry(reg)).toBe(reg);
    });

    it('registers and retrieves by id and name', () => {
        const reg = new ToolRegistryImpl();
        const t = fakeTool('i1', 'alpha');
        reg.register(t);
        expect(reg.size()).toBe(1);
        expect(reg.get('i1')).toBe(t);
        expect(reg.get('missing')).toBeUndefined();
        expect(reg.getByName('alpha')).toBe(t);
        expect(reg.getByName('missing')).toBeUndefined();
        expect(reg.has('i1')).toBe(true);
        expect(reg.has('x')).toBe(false);
        expect(reg.hasName('alpha')).toBe(true);
        expect(reg.hasName('x')).toBe(false);
        expect(reg.list()).toEqual([t]);
    });

    it('throws on duplicate id or name', () => {
        const reg = new ToolRegistryImpl();
        reg.register(fakeTool('id1', 'n1'));
        expect(() => reg.register(fakeTool('id1', 'n2'))).toThrow(/already registered/);
        expect(() => reg.register(fakeTool('id2', 'n1'))).toThrow(/already registered/);
    });

    it('indexes tools by category for listByCategory', () => {
        const reg = new ToolRegistryImpl();
        const web = fakeTool('1', 'w', { category: ToolCategory.WEB, tags: ['net'] });
        const db = fakeTool('2', 'd', { category: ToolCategory.DATABASE, tags: [] });
        const noCat = fakeTool('3', 'n');
        reg.register(web);
        reg.register(db);
        reg.register(noCat);
        expect(reg.listByCategory(ToolCategory.WEB)).toEqual([web]);
        expect(reg.listByCategory(ToolCategory.DATABASE)).toEqual([db]);
        expect(reg.listByCategory(ToolCategory.API)).toEqual([]);
    });

    it('searches via prefix, full-text n-grams, and empty query', () => {
        const reg = new ToolRegistryImpl();
        reg.register(fakeTool('1', 'search_engine', { description: 'find anything fast', tags: ['lookup'] }));
        reg.register(fakeTool('2', 'math_lib', { description: 'compute numbers', tags: [] }));

        expect(reg.search('')).toHaveLength(2);
        expect(reg.search('sea')).toHaveLength(1);
        expect(reg.search('se')).toHaveLength(1);
        expect(reg.search('zz')).toHaveLength(0);

        expect(reg.searchByPrefix('search_eng')).toHaveLength(1);
        expect(reg.searchByPrefix('zzz')).toHaveLength(0);

        expect(reg.search('anything')).toHaveLength(1);
        expect(reg.search('compute')).toHaveLength(1);
        expect(reg.search('math')).toHaveLength(1);
        expect(reg.search('absent_querystring')).toHaveLength(0);
    });

    it('unregisters by id and cleans indexes', () => {
        const reg = new ToolRegistryImpl();
        const web = fakeTool('1', 'alpha', { category: ToolCategory.WEB, description: 'alpha marker' });
        reg.register(web);
        reg.register(fakeTool('2', 'beta'));
        expect(reg.unregister('missing')).toBe(false);
        expect(reg.unregister('1')).toBe(true);
        expect(reg.get('1')).toBeUndefined();
        expect(reg.getByName('alpha')).toBeUndefined();
        expect(reg.hasName('alpha')).toBe(false);
        expect(reg.size()).toBe(1);
        expect(reg.listByCategory(ToolCategory.WEB)).toEqual([]);
        expect(reg.searchByPrefix('alpha')).toHaveLength(0);
        expect(reg.search('marker')).toHaveLength(0);
    });

    it('clear() wipes everything', () => {
        const reg = new ToolRegistryImpl();
        reg.register(fakeTool('1', 'a'));
        reg.register(fakeTool('2', 'b'));
        reg.clear();
        expect(reg.size()).toBe(0);
        expect(reg.list()).toEqual([]);
        expect(reg.search('')).toEqual([]);
    });
});

// ── tool-cache.ts ────────────────────────────────────────────────────────────

describe('ToolCache gaps', () => {
    it('updates an existing entry in place when set twice', () => {
        const cache = new ToolCache({ maxEntries: 10, ttlMs: 5000 });
        cache.set('t', { k: 1 }, makeResult('v1'));
        cache.set('t', { k: 1 }, makeResult('v2'));
        expect(cache.get('t', { k: 1 })?.data).toBe('v2');
        expect(cache.getStats().size).toBe(1);
    });

    it('handles an empty store during LRU eviction (maxEntries=0)', () => {
        const cache = new ToolCache({ maxEntries: 0 });
        cache.set('t', { k: 1 }, makeResult('v'));
        expect(cache.getStats().evictions).toBe(0);
    });

    it('invalidate returns 0 when nothing matches', () => {
        const cache = new ToolCache();
        cache.set('t', { k: 1 }, makeResult(1));
        expect(cache.invalidate('other')).toBe(0);
    });

    it('tracks expiry eviction in stats', async () => {
        const cache = new ToolCache({ ttlMs: 5 });
        cache.set('t', {}, makeResult('v'));
        await new Promise(r => setTimeout(r, 15));
        expect(cache.get('t', {})).toBeNull();
        expect(cache.getStats().evictions).toBe(1);
        expect(cache.getStats().misses).toBe(1);
    });

    it('uses custom key fn to collapse params', () => {
        const cache = new ToolCache({ cacheKeyFn: () => 'fixed' });
        cache.set('a', { x: 1 }, makeResult('v'));
        expect(cache.get('pretend', { anything: true })?.data).toBe('v');
    });
});

// ── tool-compressor.ts ───────────────────────────────────────────────────────

describe('ToolCompressor gaps', () => {
    it('serialises circular values via String() fallback', () => {
        const c = new ToolCompressor({ maxBytes: 5 });
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        // JSON.stringify throws → String(value)
        expect(c.shouldCompress(circular)).toBe(true);
    });

    it('handles values that JSON.stringify maps to undefined (?? "")', async () => {
        const c = new ToolCompressor({ maxBytes: 10 });
        const out = await c.compress(undefined);
        expect(out).toBeUndefined();

        const fn = () => 'x';
        expect(c.compressSync(fn as never)).toBe(fn);
        expect(c.shouldCompress(fn as never)).toBe(false);
    });

    it('compress() returns below-threshold values unchanged', async () => {
        const c = new ToolCompressor({ maxBytes: 100 });
        const obj = { a: 1 };
        expect(await c.compress(obj)).toBe(obj);
        expect(c.compressSync('short')).toBe('short');
    });
});

// ── tool-wrappers.ts ─────────────────────────────────────────────────────────

describe('tool-wrappers edge cases', () => {
    it('withCache passes through failed results without caching', async () => {
        const spy = vi.fn();
        const failing = tool({
            name: 'f',
            description: 'd',
            parameters: z.object({}),
            execute: async () => { spy(); throw new Error('x'); },
        });
        const cache = new ToolCache({ ttlMs: 60_000 });
        const wrapped = withCache(failing, cache);
        await wrapped.execute({});
        await wrapped.execute({});
        expect(spy).toHaveBeenCalledTimes(2);
        expect(cache.getStats().size).toBe(0);
    });

    it('withCache decorates metadata on cache hits', async () => {
        const cache = new ToolCache({ ttlMs: 60_000 });
        const base = makeEchoTool();
        const wrapped = withCache(base, cache);
        const now = new Date();
        const cached: ToolResult<string> = {
            success: true,
            data: 'cached',
            executionTimeMs: 5,
            metadata: { startTime: now, endTime: now, retries: 0 },
        };
        cache.set(base.name, { msg: 'x' }, cached);
        const hit = await wrapped.execute({ msg: 'x' });
        expect((hit.metadata as { cached: boolean }).cached).toBe(true);
        expect(hit.data).toBe('cached');
        expect(hit.executionTimeMs).toBe(5);
        const meta = hit.metadata as { startTime: Date; endTime: Date };
        expect(meta.startTime).toEqual(now);
        expect(meta.endTime).toEqual(now);
    });

    it('withCompression passes through undefined data and small results', async () => {
        const compressor = new ToolCompressor({ maxBytes: 100 });
        const undef = tool({
            name: 'u',
            description: 'd',
            parameters: z.object({}),
            execute: async () => undefined,
        });
        const w1 = withCompression(undef, compressor);
        const r1 = await w1.execute({});
        expect(r1.success).toBe(true);
        expect(r1.data).toBeUndefined();

        const small = withCompression(makeEchoTool(), compressor);
        const r2 = await small.execute({ msg: 'tiny' });
        expect(r2.data).toBe('tiny');
    });
});

// ── tool-gateway-http.ts ─────────────────────────────────────────────────────

describe('handleToolGatewayRequest full matrix', () => {
    const okTool: Tool = {
        id: 'ok',
        name: 'ok_tool',
        description: 'works',
        parameters: z.object({ n: z.number() }) as never,
        permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 1000 },
        category: ToolCategory.UTILITY,
        version: '1.0.0',
        execute: async (p) => makeResult({ squared: (p as { n: number }).n ** 2 }),
        validate: () => true,
    } as Tool;
    const failTool: Tool = {
        ...okTool,
        id: 'fail',
        name: 'fail_tool',
        execute: async () => makeErrorResult(),
    } as Tool;
    const throwTool: Tool = {
        ...okTool,
        id: 'throw',
        name: 'throw_tool',
        execute: async () => { throw new Error('gateway boom'); },
    } as Tool;

    it('GET /tools and /v1/tools list tools; query strings are stripped', async () => {
        const tools = [okTool];
        for (const path of ['/tools', '/v1/tools', '/tools?refresh=1']) {
            const r = await handleToolGatewayRequest('GET', path, undefined, tools);
            expect(r.statusCode).toBe(200);
            expect(r.body.tools).toHaveLength(1);
            expect(r.body.tools[0]).toMatchObject({ id: 'ok', name: 'ok_tool', description: 'works' });
        }
    });

    it('POST /invoke and /v1/invoke execute a tool successfully', async () => {
        for (const path of ['/invoke', '/v1/invoke']) {
            const r = await handleToolGatewayRequest('POST', path, JSON.stringify({ toolId: 'ok', args: { n: 3 } }), [okTool]);
            expect(r.statusCode).toBe(200);
            expect(r.body).toMatchObject({ success: true, data: { squared: 9 } });
            expect(typeof r.body.executionTimeMs).toBe('number');
        }
    });

    it('returns 422 when the tool reports failure', async () => {
        const r = await handleToolGatewayRequest('POST', '/invoke', JSON.stringify({ toolId: 'fail', args: {} }), [failTool]);
        expect(r.statusCode).toBe(422);
        expect(r.body.success).toBe(false);
    });

    it('returns 500 when the tool execute throws', async () => {
        const r = await handleToolGatewayRequest('POST', '/invoke', JSON.stringify({ toolId: 'throw', args: {} }), [throwTool]);
        expect(r.statusCode).toBe(500);
        expect(r.body.error).toBe('gateway boom');
    });

    it('returns 400 for invalid JSON and missing/invalid toolId', async () => {
        const badJson = await handleToolGatewayRequest('POST', '/invoke', '{not json', [okTool]);
        expect(badJson.statusCode).toBe(400);
        expect(badJson.body.error).toBe('Invalid JSON body');

        const missing = await handleToolGatewayRequest('POST', '/invoke', undefined, [okTool]);
        expect(missing.statusCode).toBe(400);
        expect(missing.body.error).toBe('Missing toolId');

        const emptyBody = await handleToolGatewayRequest('POST', '/invoke', '', [okTool]);
        expect(emptyBody.statusCode).toBe(400);

        const numeric = await handleToolGatewayRequest('POST', '/invoke', JSON.stringify({ toolId: 42, args: {} }), [okTool]);
        expect(numeric.statusCode).toBe(400);
        expect(numeric.body.error).toBe('Missing toolId');
    });

    it('returns 404 for unknown tool ids', async () => {
        const r = await handleToolGatewayRequest('POST', '/invoke', JSON.stringify({ toolId: 'nope', args: {} }), [okTool]);
        expect(r.statusCode).toBe(404);
        expect(r.body.error).toBe('Unknown tool: nope');
    });

    it('returns 404 with a hint for unmatched methods/paths', async () => {
        const r1 = await handleToolGatewayRequest('DELETE', '/tools', undefined, [okTool]);
        expect(r1.statusCode).toBe(404);
        expect(r1.body.hint).toContain('GET /tools or POST /invoke');

        const r2 = await handleToolGatewayRequest('GET', '/anything', undefined, [okTool]);
        expect(r2.statusCode).toBe(404);
    });

    it('uses empty args when args is omitted or not an object', async () => {
        const r1 = await handleToolGatewayRequest('POST', '/invoke', JSON.stringify({ toolId: 'ok' }), [okTool]);
        expect(r1.statusCode).toBe(200);

        const r2 = await handleToolGatewayRequest('POST', '/invoke', JSON.stringify({ toolId: 'ok', args: 'nope' }), [okTool]);
        expect(r2.statusCode).toBe(200);
    });
});

// ── trie.ts ──────────────────────────────────────────────────────────────────

describe('ToolNameTrie', () => {
    it('insert, exactMatch, size (with dedupe)', () => {
        const trie = new ToolNameTrie();
        trie.insert('alpha', 'id1');
        trie.insert('alpha', 'id2');
        trie.insert('alpine', 'id3');
        trie.insert('alpha', 'id1'); // duplicate -> no size change
        expect(trie.size).toBe(3);
        expect(trie.exactMatch('alpha')).toEqual(new Set(['id1', 'id2']));
        expect(trie.exactMatch('alpine')).toEqual(new Set(['id3']));
        expect(trie.exactMatch('none')).toEqual(new Set());
        expect(trie.exactMatch('al')).toEqual(new Set()); // prefix, not terminal
    });

    it('supports empty-string names', () => {
        const trie = new ToolNameTrie();
        trie.insert('', 'rootId');
        expect(trie.size).toBe(1);
        expect(trie.exactMatch('')).toEqual(new Set(['rootId']));
        expect(trie.hasPrefix('')).toBe(true);
    });

    it('prefixSearch returns all names sharing a prefix', () => {
        const trie = new ToolNameTrie();
        trie.insert('apple', 'a');
        trie.insert('applet', 'b');
        trie.insert('apricot', 'c');
        expect(trie.prefixSearch('app')).toEqual(expect.arrayContaining(['a', 'b']));
        expect(trie.prefixSearch('app').sort()).toEqual(['a', 'b']);
        expect(trie.prefixSearch('ap')).toEqual(expect.arrayContaining(['a', 'b', 'c']));
        expect(trie.prefixSearch('banana')).toEqual([]);
        expect(trie.prefixSearch('')).toEqual(['a', 'b', 'c']);
    });

    it('handles unicode names (accented + emoji) and long words', () => {
        const trie = new ToolNameTrie();
        trie.insert('héllo', 'acc');
        trie.insert('🚀-launch', 'rocket');
        trie.insert('a'.repeat(1000), 'long');
        expect(trie.exactMatch('héllo')).toEqual(new Set(['acc']));
        expect(trie.prefixSearch('hé')).toEqual(['acc']);
        expect(trie.exactMatch('🚀-launch')).toEqual(new Set(['rocket']));
        expect(trie.prefixSearch('🚀')).toEqual(['rocket']);
        expect(trie.exactMatch('a'.repeat(1000))).toEqual(new Set(['long']));
        expect(trie.hasPrefix('a'.repeat(500))).toBe(true);
    });

    it('delete removes terminals and prunes empty branches', () => {
        const trie = new ToolNameTrie();
        trie.insert('cat', 'c1');
        trie.insert('cat', 'c2');
        trie.insert('category', 'c3');
        trie.insert('dog', 'd1');

        // missing name path → early return
        trie.delete('zzz', 'nope');
        expect(trie.size).toBe(4);

        // name exists but tool id not terminal → early return, size unchanged
        trie.delete('cat', 'ghost');
        expect(trie.size).toBe(4);

        // delete one terminal id from a multi-terminal node
        trie.delete('cat', 'c1');
        expect(trie.size).toBe(3);
        expect(trie.exactMatch('cat')).toEqual(new Set(['c2']));

        // delete the terminal node that still has children → no prune of shared prefix
        trie.delete('cat', 'c2');
        expect(trie.size).toBe(2);
        expect(trie.hasPrefix('cat')).toBe(true); // 'category' still below
        expect(trie.prefixSearch('cat')).toEqual(['c3']);

        // delete leaf that prunes unreachable branches
        trie.delete('category', 'c3');
        expect(trie.size).toBe(1);
        expect(trie.prefixSearch('cat')).toEqual([]);
        expect(trie.hasPrefix('cat')).toBe(false);
        expect(trie.exactMatch('dog')).toEqual(new Set(['d1']));

        trie.delete('dog', 'd1');
        expect(trie.size).toBe(0);
        expect(trie.prefixSearch('')).toEqual([]);
    });
});

describe('NGramIndex', () => {
    it('indexes and searches n-grams (default n=3)', () => {
        const index = new NGramIndex();
        index.add('t1', 'alpha tool');
        index.add('t2', 'alpha compute');
        expect(index.search('alp')).toEqual(new Set(['t1', 't2']));
        expect(index.search('comp')).toEqual(new Set(['t2']));
        expect(index.search('nope')).toEqual(new Set());
    });

    it('intersects across all query grams', () => {
        const index = new NGramIndex();
        index.add('solo', 'foo bar baz');
        index.add('joint', 'foo qux alpha');
        expect(index.search('foo')).toEqual(new Set(['solo', 'joint']));
        // 'o q' and ' qu' grams only exist in the second document
        expect(index.search('foo qux')).toEqual(new Set(['joint']));
    });

    it('handles short text (< n) as a single gram and empty queries', () => {
        const index = new NGramIndex(3);
        index.add('tiny', 'ab');
        expect(index.search('ab')).toEqual(new Set(['tiny']));

        expect(index.search('')).toEqual(new Set());
        expect(index.search('   ')).toEqual(new Set());
    });

    it('respects a custom n and the Math.max(1, n) guard', () => {
        const index = new NGramIndex(1);
        index.add('x', 'hello');
        expect(index.search('h')).toEqual(new Set(['x']));

        const zero = new NGramIndex(0);
        zero.add('x', 'hello');
        expect(zero.search('h')).toEqual(new Set(['x']));
    });

    it('remove deletes a tool id from postings, empty postings short-circuit', () => {
        const index = new NGramIndex();
        index.add('t1', 'shared term');
        index.add('t2', 'shared other');
        expect(index.search('shared')).toEqual(new Set(['t1', 't2']));
        index.remove('t1', 'shared term');
        expect(index.search('shared')).toEqual(new Set(['t2']));
        // remove leaves an empty posting for 'term' → searching 'term' short-circuits
        expect(index.search('term')).toEqual(new Set());
        expect(index.search('shared term')).toEqual(new Set());
    });

    it('n=1 intersect skips ids missing some query grams', () => {
        const index = new NGramIndex(1);
        index.add('t1', 'ab');
        index.add('t2', 'ac');
        index.add('t3', 'bd');
        // 'a' posting {t1,t2} and 'b' posting {t1,t3} have equal size → no switch,
        // so t2 (which lacks 'b') is filtered out by the intersect check.
        expect(index.search('ab')).toEqual(new Set(['t1']));
    });
});

// ── memory-as-tool.ts ────────────────────────────────────────────────────────

describe('memoryAsTool error / edge paths', () => {
    const baseMemory = (): MemoryStoreLike => ({
        store: vi.fn().mockResolvedValue({ id: 'mem1' }),
        retrieve: vi.fn().mockResolvedValue([]),
        getRecent: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(true),
        clear: vi.fn().mockResolvedValue(undefined),
    });

    it('stores with type + metadata and calls store', async () => {
        const memory = baseMemory();
        const t = memoryAsTool({
            name: 'm',
            description: 'm',
            memory,
            parameters: z.object({
                action: z.string(),
                content: z.string().optional(),
                type: z.string().optional(),
                metadata: z.record(z.string(), z.unknown()).optional(),
            }),
        });
        const r = await t.execute({ action: 'store', content: 'fact', type: 'long_term', metadata: { src: 't' } });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ action: 'stored', id: 'mem1', content: 'fact' });
        expect(memory.store).toHaveBeenCalledWith({ content: 'fact', type: 'long_term', metadata: { src: 't' } });
    });

    it('store with non-object metadata defaults to {}', async () => {
        const memory = baseMemory();
        const t = memoryAsTool({
            name: 'm',
            description: 'm',
            memory,
            parameters: z.object({
                action: z.string(),
                content: z.string().optional(),
                metadata: z.unknown().optional(),
            }),
        });
        const r = await t.execute({ action: 'store', content: 'x', metadata: 'nope' } as never);
        expect(r.success).toBe(true);
        expect(memory.store).toHaveBeenCalledWith({ content: 'x', metadata: {} });
    });

    it('recall maps entry-wrapped results and scores', async () => {
        const memory = baseMemory();
        memory.retrieve = vi.fn().mockResolvedValue([
            { entry: { id: 'a', content: 'plain', metadata: { k: 1 } }, score: 0.9 },
            { entry: { id: 'b', content: 'no-meta' } },
            { id: 'c', content: 'direct', score: 'not-a-number' },
        ]);
        const t = memoryAsTool({ name: 'm', description: 'm', memory });
        const r = await t.execute({ action: 'recall', query: 'q', limit: 5, type: 'semantic' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({
            action: 'recalled',
            count: 3,
            results: [
                { id: 'a', content: 'plain', metadata: { k: 1 }, score: 0.9 },
                { id: 'b', content: 'no-meta' },
                { id: 'c', content: 'direct' },
            ],
        });
        expect(memory.retrieve).toHaveBeenCalledWith({ query: 'q', limit: 5, type: 'semantic' });
    });

    it('recall falls back to a default query when query is blank', async () => {
        const memory = baseMemory();
        const t = memoryAsTool({ name: 'm', description: 'm', memory });
        await t.execute({ action: 'recall', query: '   ' });
        expect(memory.retrieve).toHaveBeenCalledWith({ query: 'recent context' });
    });

    it('get_recent returns entries with optional type', async () => {
        const memory = baseMemory();
        memory.getRecent = vi.fn().mockResolvedValue([
            { id: '1', content: 'a', metadata: { m: 1 }, type: 'short_term' } as never,
        ]);
        const t = memoryAsTool({ name: 'm', description: 'm', memory });
        const r = await t.execute({ action: 'get_recent', limit: 3, type: 'short_term' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ action: 'get_recent', count: 1, results: [{ id: '1', content: 'a', metadata: { m: 1 } }] });
        expect(memory.getRecent).toHaveBeenCalledWith(3, 'short_term');
    });

    it('throws when get_recent is unsupported by the store', async () => {
        const memory: MemoryStoreLike = {
            store: vi.fn(),
            retrieve: vi.fn().mockResolvedValue([]),
        };
        const t = memoryAsTool({ name: 'm', description: 'm', memory });
        const r = await t.execute({ action: 'get_recent' });
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('get_recent is unsupported');
    });

    it('delete: works, rejects missing id, rejects unsupported store', async () => {
        const memory = baseMemory();
        const t = memoryAsTool({ name: 'm', description: 'm', memory });
        const ok = await t.execute({ action: 'delete', id: 'mem1' });
        expect(ok.success).toBe(true);
        expect(ok.data).toEqual({ action: 'delete', id: 'mem1', deleted: true });

        const noId = await t.execute({ action: 'delete' });
        expect(noId.success).toBe(false);
        expect(noId.error?.message).toContain('requires an "id"');

        const unsupported = await memoryAsTool({
            name: 'm',
            description: 'm',
            memory: { store: vi.fn(), retrieve: vi.fn().mockResolvedValue([]) },
        }).execute({ action: 'delete', id: 'x' });
        expect(unsupported.success).toBe(false);
        expect(unsupported.error?.message).toContain('delete is unsupported');
    });

    it('clear invokes store.clear with optional type; unsupported throws', async () => {
        const memory = baseMemory();
        const t = memoryAsTool({ name: 'm', description: 'm', memory });
        const ok = await t.execute({ action: 'clear', type: 'long_term' });
        expect(ok.success).toBe(true);
        expect(ok.data).toEqual({ action: 'cleared' });
        expect(memory.clear).toHaveBeenCalledWith('long_term');

        const unsupported = await memoryAsTool({
            name: 'm',
            description: 'm',
            memory: { store: vi.fn(), retrieve: vi.fn().mockResolvedValue([]) },
        }).execute({ action: 'clear' });
        expect(unsupported.success).toBe(false);
        expect(unsupported.error?.message).toContain('clear is unsupported');
    });

    it('throws on unknown actions via permissive parameters', async () => {
        const memory = baseMemory();
        const t = memoryAsTool({
            name: 'm',
            description: 'm',
            memory,
            parameters: z.object({ action: z.string() }),
        });
        const r = await t.execute({ action: 'teleport' } as never);
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('unknown action "teleport"');
    });

    it('invalid memory type yields undefined (non-string handling)', async () => {
        const memory = baseMemory();
        const t = memoryAsTool({
            name: 'm',
            description: 'm',
            memory,
            parameters: z.object({ action: z.string(), type: z.unknown(), limit: z.number().optional() }),
        });
        const r = await t.execute({ action: 'clear', type: 42 } as never);
        expect(r.success).toBe(true);
        expect(memory.clear).toHaveBeenCalledWith(undefined);
    });
});

// ── knowledge-as-tool.ts ─────────────────────────────────────────────────────

describe('knowledgeAsTool add/search edge paths', () => {
    const kbWith = (over: Partial<KnowledgeBaseLike>): KnowledgeBaseLike => over;

    it('adds documents via addDocuments when ingest is missing', async () => {
        const addDocuments = vi.fn().mockResolvedValue(undefined);
        const kb = kbWith({ addDocuments });
        const t = knowledgeAsTool({ name: 'k', description: 'k', knowledge: kb });
        const r = await t.execute({
            action: 'add',
            documents: [
                { content: '  doc one  ', metadata: { src: 'x' } },
                { content: 'doc two' },
            ],
        });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ action: 'added', count: 2 });
        expect(addDocuments).toHaveBeenCalledWith([
            { id: expect.stringMatching(/^doc-0-/), content: 'doc one', metadata: { src: 'x' } },
            { id: expect.stringMatching(/^doc-1-/), content: 'doc two' },
        ]);
    });

    it('defaults documents to [] and errors for a missing array', async () => {
        const kb = kbWith({ ingest: vi.fn() });
        const t = knowledgeAsTool({ name: 'k', description: 'k', knowledge: kb });
        const r = await t.execute({ action: 'add' } as never);
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('non-empty "documents"');
    });

    it('throws when the knowledge base supports neither ingest nor addDocuments', async () => {
        const kb = kbWith({});
        const t = knowledgeAsTool({ name: 'k', description: 'k', knowledge: kb });
        const r = await t.execute({ action: 'add', documents: [{ content: 'x' }] });
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('does not support adding');
    });

    it('throws on unknown actions', async () => {
        const kb = kbWith({ retrieve: vi.fn().mockResolvedValue({ query: 'q', chunks: [] }) });
        const t = knowledgeAsTool({
            name: 'k',
            description: 'k',
            knowledge: kb,
            parameters: z.object({ action: z.string() }),
        });
        const r = await t.execute({ action: 'delete' } as never);
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('unknown action "delete"');
    });

    it('rejects blank search queries', async () => {
        const kb = kbWith({ buildContext: vi.fn() });
        const t = knowledgeAsTool({ name: 'k', description: 'k', knowledge: kb });
        const r = await t.execute({ action: 'search', query: '   ' });
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('non-empty "query"');
    });

    it('retrieve path passes limit and maps all chunk fields', async () => {
        const retrieve = vi.fn().mockResolvedValue({
            query: 'q',
            chunks: [
                { id: 'c1', content: 'one', score: 0.5, metadata: { a: 1 }, source: 'src1' },
                { id: 'c2', content: 'two' },
            ],
        });
        const kb = kbWith({ retrieve });
        const t = knowledgeAsTool({ name: 'k', description: 'k', knowledge: kb });
        const r = await t.execute({ action: undefined, query: 'q', limit: 7 });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({
            action: 'search',
            query: 'q',
            count: 2,
            results: [
                { id: 'c1', content: 'one', score: 0.5, metadata: { a: 1 }, source: 'src1' },
                { id: 'c2', content: 'two' },
            ],
        });
        expect(retrieve).toHaveBeenCalledWith('q', { limit: 7 });
    });

    it('buildContext fallback path (no limit passed)', async () => {
        const buildContext = vi.fn().mockResolvedValue('context here');
        const kb = kbWith({ buildContext });
        const t = knowledgeAsTool({ name: 'k', description: 'k', knowledge: kb });
        const r = await t.execute({ action: 'search', query: 'q' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ action: 'search', query: 'q', context: 'context here' });
        expect(buildContext).toHaveBeenCalledWith('q', undefined);
    });

    it('throws when neither retrieve nor buildContext is available for search', async () => {
        const kb = kbWith({});
        const t = knowledgeAsTool({ name: 'k', description: 'k', knowledge: kb });
        const r = await t.execute({ query: 'q' });
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('neither retrieve() nor buildContext()');
    });
});

// ── prompt-as-tool.ts ────────────────────────────────────────────────────────

describe('promptAsTool branches', () => {
    const registry = (): PromptRegistryLike => ({
        render: vi.fn().mockResolvedValue('rendered'),
    });

    it('passes through version/label selectors and object variables', async () => {
        const reg = registry();
        const t = promptAsTool({ name: 'p', description: 'p', registry: reg });
        const r = await t.execute({ name: 'tmpl', variables: { a: 1 }, version: 'v2', label: 'stable' });
        expect(r.success).toBe(true);
        expect(r.data).toBe('rendered');
        expect(reg.render).toHaveBeenCalledWith('tmpl', { a: 1 }, { version: 'v2', label: 'stable' });
    });

    it('defaults variables to {} and ignores non-string selectors', async () => {
        const reg = registry();
        const t = promptAsTool({
            name: 'p',
            description: 'p',
            registry: reg,
            parameters: z.object({
                name: z.string().optional(),
                variables: z.unknown().optional(),
                version: z.unknown().optional(),
                label: z.unknown().optional(),
            }),
        });
        await t.execute({ name: '  tmpl  ', variables: 'nope', version: 5, label: false });
        expect(reg.render).toHaveBeenCalledWith('  tmpl  ', {}, {});
    });

    it('forwards lifecycle hooks when provided', async () => {
        const before = vi.fn();
        const after = vi.fn();
        const onError = vi.fn();
        const reg = registry();
        const t = promptAsTool({
            name: 'p',
            description: 'p',
            registry: reg,
            beforeExecute: before,
            afterExecute: after,
            onError,
        });
        const r = await t.execute({ name: 'tmpl' });
        expect(r.success).toBe(true);
        expect(before).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });

    it('invokes onError when rendering throws', async () => {
        const reg = { render: vi.fn().mockRejectedValue(new Error('render fail')) };
        const onError = vi.fn().mockResolvedValue('fallback prompt');
        const t = promptAsTool({
            name: 'p',
            description: 'p',
            registry: reg as PromptRegistryLike,
            onError,
        });
        const r = await t.execute({ name: 'tmpl' });
        expect(r.success).toBe(true);
        expect(r.data).toBe('fallback prompt');
        expect(onError).toHaveBeenCalled();
    });
});

// ── agent-as-tool.ts ─────────────────────────────────────────────────────────

describe('agentAsTool depth guard / toRunnableAgent / multiAgentTool', () => {
    it('throws when nesting depth exceeds maxDepth', async () => {
        const mock = { run: vi.fn().mockResolvedValue({ text: 'ok' }) };
        const t = agentAsTool({
            name: 'inner',
            description: 'd',
            agent: mock,
            parameters: z.object({ prompt: z.string() }),
            maxDepth: 0,
        });
        const r = await t.execute({ prompt: 'go' });
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('exceeded maximum nesting depth');
    });

    it('tracks depth through nested execution', async () => {
        expect(getAgentToolDepth()).toBe(0);
        let innerDepth = -1;
        const mock = {
            run: vi.fn().mockImplementation(async () => {
                innerDepth = getAgentToolDepth();
                return { text: 'ok' };
            }),
        };
        const t = agentAsTool({ name: 'inner', description: 'd', agent: mock });
        await t.execute({ prompt: 'go' });
        expect(innerDepth).toBe(1);
        expect(getAgentToolDepth()).toBe(0);
    });

    it('toRunnableAgent returns duck-typed agents unchanged', () => {
        const agent = { run: vi.fn() };
        expect(toRunnableAgent(agent as never)).toBe(agent);
    });

    it('toRunnableAgent adapts CreateAgentResult-shaped agents', async () => {
        const inner = {
            instructions: 'be helpful',
            createSession: vi.fn().mockResolvedValue('sess'),
            run: vi.fn().mockResolvedValue({ text: 'done' }),
        };
        const adapted = toRunnableAgent(inner as never) as { run: (i: unknown, o?: { sessionId?: string }) => Promise<unknown> };

        await adapted.run('just a string', { sessionId: 's1' });
        expect(inner.run).toHaveBeenLastCalledWith('just a string', { sessionId: 's1' });

        await adapted.run({ prompt: 'obj prompt' });
        expect(inner.run).toHaveBeenLastCalledWith('obj prompt', undefined);

        await adapted.run({ other: 1 });
        expect(inner.run).toHaveBeenLastCalledWith('{"other":1}', undefined);

        await adapted.run(null);
        expect(inner.run).toHaveBeenLastCalledWith('null', undefined);

        await adapted.run(42);
        expect(inner.run).toHaveBeenLastCalledWith('42', undefined);

        await adapted.run({ prompt: 123 });
        expect(inner.run).toHaveBeenLastCalledWith('{"prompt":123}', undefined);
    });

    it('multiAgentTool builds one tool per agent with fallbacks and overrides', async () => {
        const tools = multiAgentTool({
            agents: {
                a: { run: vi.fn().mockResolvedValue({ text: 'A' }) },
                b: { run: vi.fn().mockResolvedValue({ text: 'B' }) },
            },
            descriptions: { a: 'Alpha agent' },
            parameters: z.object({ prompt: z.string() }),
            outputSchemas: { a: z.object({ text: z.string() }) },
            maxDepth: 3,
        });
        expect(tools).toHaveLength(2);
        expect(tools[0].name).toBe('a');
        expect(tools[0].description).toBe('Alpha agent');
        expect(tools[1].name).toBe('b');
        expect(tools[1].description).toBe('Delegate to b agent');
        const r = await tools[1].execute({ prompt: 'go' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ text: 'B' });
    });
});

// ── workflow-as-tool.ts / pipeline-as-tool.ts ────────────────────────────────

describe('workflowAsTool additional paths', () => {
    it('uses default input schema and applies transformOutput', async () => {
        const exec = vi.fn().mockResolvedValue({ status: 'completed', results: { total: 3 } });
        const transform = vi.fn().mockImplementation((o: unknown) => ({ ...(o as object), touched: true }));
        const t = workflowAsTool({
            name: 'wf',
            description: 'd',
            workflow: { execute: exec },
            transformOutput: transform,
        });
        const r = await t.execute({ input: { x: 1 } });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ total: 3, touched: true });
        expect(transform).toHaveBeenCalled();
        expect(exec).toHaveBeenCalledWith({ input: { x: 1 } });
    });

    it('returns the raw value for non-envelope results and passes through hooks', async () => {
        const before = vi.fn();
        const after = vi.fn();
        const onError = vi.fn();
        const t = workflowAsTool({
            name: 'wf2',
            description: 'd',
            workflow: { execute: vi.fn().mockResolvedValue({ plain: 'value' }) },
            beforeExecute: before,
            afterExecute: after,
            onError,
        });
        const r = await t.execute({ input: {} });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ plain: 'value' });
        expect(before).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });

    it('handles empty results envelope', async () => {
        const t = workflowAsTool({
            name: 'wf3',
            description: 'd',
            workflow: { execute: vi.fn().mockResolvedValue({ status: 'completed', results: undefined }) },
        });
        const r = await t.execute({ input: {} });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({});
    });
});

describe('pipelineAsTool additional paths', () => {
    it('uses mapInput, passes sessionId, and applies transformOutput', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'pipe out', steps: 2 });
        const mapInput = vi.fn().mockResolvedValue('built prompt');
        const transform = vi.fn().mockImplementation((o: unknown) => ({ ...(o as object), done: true }));
        const t = pipelineAsTool({
            name: 'pipe',
            description: 'd',
            pipeline: { run },
            parameters: z.object({ anything: z.number() }),
            mapInput,
            transformOutput: transform,
        });
        const r = await t.execute({ anything: 1 }, { sessionId: 'sess-9' } as never);
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ text: 'pipe out', steps: 2, done: true });
        expect(mapInput).toHaveBeenCalledWith({ anything: 1 });
        expect(run).toHaveBeenCalledWith('built prompt', { sessionId: 'sess-9' });
    });

    it('falls back to prompt string then JSON.stringify of params', async () => {
        const runViaPrompt = vi.fn().mockResolvedValue({ ok: 1 });
        const t1 = pipelineAsTool({
            name: 'p1',
            description: 'd',
            pipeline: { run: runViaPrompt },
        });
        await t1.execute({ prompt: 'direct prompt' } as never);
        expect(runViaPrompt).toHaveBeenCalledWith('direct prompt', { sessionId: undefined });

        const runViaJson = vi.fn().mockResolvedValue({ ok: 2 });
        const t2 = pipelineAsTool({
            name: 'p2',
            description: 'd',
            pipeline: { run: runViaJson },
            parameters: z.object({ foo: z.string() }),
        });
        await t2.execute({ foo: 'bar' }, { sessionId: 'real-sess' } as never);
        expect(runViaJson).toHaveBeenCalledWith('{"foo":"bar"}', { sessionId: 'real-sess' });
    });

    it('forwards lifecycle hooks and errors through onError', async () => {
        const before = vi.fn();
        const after = vi.fn();
        const onError = vi.fn().mockResolvedValue({ recovered: true });
        const t = pipelineAsTool({
            name: 'p3',
            description: 'd',
            pipeline: { run: vi.fn().mockRejectedValue(new Error('pipe down')) },
            beforeExecute: before,
            afterExecute: after,
            onError,
        });
        const r = await t.execute({ prompt: 'x' } as never);
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ recovered: true });
        expect(before).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalled();
        expect(after).not.toHaveBeenCalled();
    });
});

// ── as-tool.ts ───────────────────────────────────────────────────────────────

describe('asTool config routing', () => {
    const agent = { run: vi.fn().mockResolvedValue({ text: 'agent out' }) };
    const workflow = { execute: vi.fn().mockResolvedValue({ status: 'completed', results: { ok: 1 } }) };
    const pipeline = { run: vi.fn().mockResolvedValue({ text: 'pipe out' }) };
    const memory = {
        store: vi.fn().mockResolvedValue({ id: '1' }),
        retrieve: vi.fn().mockResolvedValue([]),
    };
    const knowledge = { buildContext: vi.fn().mockResolvedValue('ctx') };
    const prompt = { render: vi.fn().mockResolvedValue('rendered') };

    it('routes explicit kinds and forwards minimal configs', async () => {
        const agentTool = asTool(agent, { kind: 'agent', name: 'a', description: 'a' });
        expect(agentTool.name).toBe('a');
        expect((await agentTool.execute({ prompt: 'x' })).data).toEqual({ text: 'agent out' });

        const wfTool = asTool(workflow, { kind: 'workflow', name: 'w', description: 'w' });
        expect((await wfTool.execute({ input: {} })).data).toEqual({ ok: 1 });

        const pipeTool = asTool(pipeline, { kind: 'pipeline', name: 'p', description: 'p' });
        expect((await pipeTool.execute({ prompt: 'x' })).data).toEqual({ text: 'pipe out' });

        const memTool = asTool(memory, { kind: 'memory', name: 'm', description: 'm' });
        expect((await memTool.execute({ action: 'store', content: 'c' })).success).toBe(true);

        const kbTool = asTool(knowledge, { kind: 'knowledge', name: 'k', description: 'k' });
        expect((await kbTool.execute({ query: 'q' })).data.context).toBe('ctx');

        const promptTool = asTool(prompt, { kind: 'prompt', name: 'pr', description: 'pr' });
        expect((await promptTool.execute({ name: 'n' })).data).toBe('rendered');
    });

    it('forwards every optional field on the agent kind', async () => {
        const before = vi.fn();
        const after = vi.fn();
        const onError = vi.fn();
        const transform = vi.fn().mockImplementation((o: unknown) => ({ ...(o as object), x: true }));
        const agentTool = asTool(agent, {
            kind: 'agent',
            name: 'full',
            description: 'full',
            parameters: z.object({ prompt: z.string() }),
            outputSchema: z.object({ text: z.string(), x: z.boolean() }),
            category: ToolCategory.AGENT,
            tags: ['t'],
            timeoutMs: 500,
            needsApproval: true,
            beforeExecute: before,
            afterExecute: after,
            onError,
            transformOutput: transform,
            maxDepth: 4,
        });
        expect(agentTool.tags).toEqual(['t']);
        expect(agentTool.needsApproval).toBe(true);
        const r = await agentTool.execute({ prompt: 'go' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ text: 'agent out', x: true });
        expect(before).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
        expect(transform).toHaveBeenCalled();
    });

    it('forwards workflow pipeline memory knowledge prompt extras', async () => {
        const transform = vi.fn().mockImplementation((o: unknown) => o);
        const wfTool = asTool(workflow, {
            kind: 'workflow', name: 'w', description: 'w',
            transformOutput: transform, outputSchema: z.object({ ok: z.number() }),
        });
        await wfTool.execute({ input: {} });

        const mapInput = vi.fn().mockResolvedValue('mapped');
        const pipeTool = asTool(pipeline, {
            kind: 'pipeline', name: 'p', description: 'p',
            transformOutput: transform, mapInput, outputSchema: z.object({ text: z.string() }),
        });
        await pipeTool.execute({ a: 1 } as never);

        await asTool(memory, { kind: 'memory', name: 'm2', description: 'r', writeable: false }).execute({ action: 'store', content: 'x' } as never);
        await asTool(knowledge, { kind: 'knowledge', name: 'k2', description: 'r', writeable: false }).execute({ action: 'add', documents: [{ content: 'x' }] } as never);
        await asTool(prompt, { kind: 'prompt', name: 'p2', description: 'r', defaultName: 'template' }).execute({ variables: {} });
    });

    it('honours kind:auto', async () => {
        const t = asTool(agent, { kind: 'auto', name: 'aauto', description: 'aauto' });
        expect(t.name).toBe('aauto');
        const r = await t.execute({ prompt: 'x' });
        expect(r.success).toBe(true);
    });

    it('detects each automatic kind', async () => {
        const renderGet = { render: vi.fn(), get: vi.fn() };
        expect((await asTool(renderGet as never, { name: 'g', description: 'g' }).execute({ name: 'x' })).success).not.toBe(false);

        const renderNames = { render: vi.fn(), names: vi.fn() };
        const rt = asTool(renderNames as never, { name: 'rn', description: 'rn' });
        await rt.execute({ name: 'x' });

        const memAuto = asTool(memory as never, { name: 'ma', description: 'ma' });
        await memAuto.execute({ action: 'store', content: 'c' });

        const kbRetrieveAdd = asTool(
            { retrieve: vi.fn().mockResolvedValue({ query: 'q', chunks: [] }), addDocuments: vi.fn() } as never,
            { name: 'kb2', description: 'kb2' },
        );
        await kbRetrieveAdd.execute({ query: 'q' });

        const wfAuto = asTool(workflow as never, { name: 'wa', description: 'wa' });
        await wfAuto.execute({ input: {} });
    });

    it('toTool is an alias', () => {
        expect(toTool).toBe(asTool);
    });
});

// ── zod-to-schema.ts ─────────────────────────────────────────────────────────

describe('zod-to-schema toolToLLMDef', () => {
    it('converts through native toJSONSchema and strips $schema', () => {
        const params = Object.assign(z.object({ q: z.string() }), {
            toJSONSchema: () => ({
                $schema: 'http://json-schema.org/draft-07/schema#',
                type: 'object',
                properties: { q: { type: 'string' } },
            }),
        });
        const def = toolToLLMDef({
            name: 'native',
            description: 'desc',
            parameters: params,
        } as unknown as Tool);
        expect(def.name).toBe('native');
        expect(def.description).toBe('desc');
        expect(def.parameters).not.toHaveProperty('$schema');
        expect((def.parameters as { type: string }).type).toBe('object');
    });

    it('falls back to zodToJsonSchema when no toJSONSchema exists', () => {
        const params = z.object({ q: z.string() });
        const def = toolToLLMDef({
            name: 'plain',
            description: 'desc2',
            parameters: params,
        } as unknown as Tool);
        expect(def.name).toBe('plain');
        expect(def.parameters).toBeTruthy();
    });

    it('does not assume Zod schemas (plain object parameters hit the zod fallback)', () => {
        const def = toolToLLMDef({
            name: 'raw',
            description: 'desc3',
            parameters: {},
        } as unknown as Tool);
        expect(def.name).toBe('raw');
        expect(def.parameters).toEqual({ type: 'object', additionalProperties: true });
    });

    it('zodToJsonSchema re-export is callable', () => {
        const json = zodToJsonSchema(z.object({ a: z.number() }));
        expect(json).toBeTruthy();
        expect((json as { type: string }).type).toBe('object');
    });
});

// ── sanity / no leftovers ────────────────────────────────────────────────────

describe('withCache + withCompression wrapper metadata', () => {
    it('withCompression keeps success flag for large results', async () => {
        const big = tool({
            name: 'big',
            description: 'd',
            parameters: z.object({ n: z.number() }),
            execute: async ({ n }) => 'x'.repeat(n),
        });
        const compressor = new ToolCompressor({ maxBytes: 20, truncateSuffix: '…' });
        const wrapped = withCompression(big, compressor);
        const r = await wrapped.execute({ n: 100 });
        expect(r.success).toBe(true);
        expect((r.data as string).length).toBeLessThan(100);
    });
});

// ── tool-helper new-surface (requireApproval / suspend / resume / agent ctx) ─

describe('tool() approval / suspension surface', () => {
    it('exposes requireApproval, suspendSchema, resumeSchema', async () => {
        const susp = z.object({ reason: z.string() });
        const res = z.object({ ok: z.boolean() });
        const t = tool({
            name: 's',
            description: 'd',
            parameters: z.object({ x: z.number() }),
            suspendSchema: susp,
            resumeSchema: res,
            requireApproval: true,
            execute: async ({ x }) => x,
        });
        expect(t.needsApproval).toBe(true);
        expect(t.suspendSchema).toBe(susp);
        expect(t.resumeSchema).toBe(res);

        const fw = t.toFrameworkTool();
        expect(fw.requireApproval).toBe(true);
        expect(fw.suspendSchema).toBe(susp);
        expect(fw.resumeSchema).toBe(res);

        const r = await t.execute({ x: 1 });
        expect(r.success).toBe(true);
        expect(r.data).toBe(1);
    });

    it('function needsApproval yields requireApproval false', async () => {
        const fn = vi.fn().mockResolvedValue(true);
        const t = tool({
            name: 'a',
            description: 'd',
            parameters: z.object({}),
            needsApproval: fn,
            execute: async () => 'ok',
        });
        expect(t.needsApproval).toBe(fn);
        expect(t.toFrameworkTool().requireApproval).toBe(false);
    });

    it('toFrameworkTool passes signal/resumeData/agent through context', async () => {
        let seenCtx: Partial<{ agentId: string; sessionId: string; abortSignal: AbortSignal; resumeData: unknown; agent: unknown }> | undefined;
        const t = tool({
            name: 'c',
            description: 'd',
            parameters: z.object({ q: z.string() }),
            execute: async (_p, c) => { seenCtx = c; return 'ok'; },
        });
        const fw = t.toFrameworkTool();
        const signal = new AbortController().signal;
        const suspend = vi.fn();
        const agent = { resumeData: { r: 2 }, suspend } as never;
        const r = await fw.execute({ q: 'x' } as never, {
            agentId: 'ag',
            sessionId: 'se',
            signal,
            resumeData: { r: 1 },
            agent,
        } as never);
        expect(r.success).toBe(true);
        // lightweight.execute() forwards agentId/sessionId/abortSignal only
        expect(seenCtx).toMatchObject({
            agentId: 'ag',
            sessionId: 'se',
            abortSignal: signal,
        });

        // context-less call falls back to input agentId/sessionId
        const r2 = await fw.execute({ q: 'x', agentId: 'ia', sessionId: 'is' } as never);
        expect(r2.success).toBe(true);
    });

    it('toJSONSchema defaults to object type when the JSON schema has none', () => {
        const t = tool({
            name: 'noType',
            description: 'd',
            parameters: { properties: { q: { type: 'string' } } } as never,
            execute: async () => 'ok',
        });
        const js = t.toJSONSchema() as { function: { parameters: { type?: string; additionalProperties?: boolean } } };
        expect(js.function.parameters.type).toBe('object');
    });

    it('ToolBuilder supports output() schemas', async () => {
        const t = defineTool()
            .name('out_builder')
            .description('d')
            .parameters(z.object({ n: z.number() }))
            .output(z.object({ doubled: z.number() }))
            .execute(async ({ n }) => ({ doubled: n * 2 }))
            .build();
        expect(t.outputSchema).toBeDefined();
        const r = await t.execute({ n: 3 });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ doubled: 6 });
    });
});

// ── extendTool / wrapTool / pipeTools error-message fallbacks ────────────────

describe('extendTool / wrapTool / pipeTools fallbacks', () => {
    const noMsgResult = () => ({
        success: false,
        error: { code: 'X' },
        executionTimeMs: 0,
        metadata: { startTime: new Date(), endTime: new Date(), retries: 0 },
    });

    const noMsgBase = {
        name: 'nm',
        description: 'd',
        parameters: z.object({}),
        tags: [],
        execute: async () => noMsgResult(),
    } as unknown as LightweightTool<never, unknown>;

    const rejectBase = {
        name: 'rb',
        description: 'd',
        parameters: z.object({}),
        tags: [],
        execute: async () => { throw 'plain-string-error'; },
    } as unknown as LightweightTool<never, unknown>;

    const okBase = {
        name: 'ok',
        description: 'd',
        parameters: z.object({}),
        tags: [],
        execute: async () => makeResult({ ok: 1 }),
    } as unknown as LightweightTool<never, { ok: number }>;

    it('extendTool falls back to generic error text without error.message', async () => {
        const ext = extendTool(noMsgBase, {});
        const r = await ext.execute({});
        expect(r.success).toBe(false);
        expect(r.error?.message).toBe('Tool execution failed');
    });

    it('extendTool wraps non-Error rejections inside onError', async () => {
        const ext = extendTool(rejectBase, {
            onError: async (err) => `got:${(err as Error).message}`,
        });
        const r = await ext.execute({});
        expect(r.success).toBe(true);
        expect(r.data).toBe('got:plain-string-error');
    });

    it('extendTool passes outputSchema through when base has one', async () => {
        const withSchema = { ...okBase, outputSchema: z.object({ ok: z.number() }) } as unknown as LightweightTool<never, { ok: number }>;
        const ext = extendTool(withSchema, {});
        expect(ext.outputSchema).toBe(withSchema.outputSchema);
        const r = await ext.execute({});
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ ok: 1 });
    });

    it('extendTool beforeExecute returning undefined does not cancel', async () => {
        const before = vi.fn().mockResolvedValue(undefined);
        const ext = extendTool(okBase, { beforeExecute: before });
        const r = await ext.execute({});
        expect(r.success).toBe(true);
        expect(before).toHaveBeenCalledTimes(1);
    });

    it('wrapTool falls back to generic error text without error.message', async () => {
        const wrapped = wrapTool(noMsgBase, [async (p, c, n) => n(p, c)]);
        const r = await wrapped.execute({});
        expect(r.success).toBe(false);
        expect(r.error?.message).toBe('Tool execution failed');
    });

    it('pipeTools falls back to generic error text on first/second failure', async () => {
        const secondOk = { ...okBase, outputSchema: z.object({ ok: z.number() }) } as unknown as LightweightTool<never, { ok: number }>;
        const firstFail = pipeTools(noMsgBase as never, secondOk, {
            name: 'pf',
            description: 'd',
            adapter: () => ({}),
        });
        const r1 = await firstFail.execute({});
        expect(r1.success).toBe(false);
        expect(r1.error?.message).toBe('First tool failed');

        const secondFail = pipeTools(okBase as never, noMsgBase as never, {
            name: 'ps',
            description: 'd',
            adapter: () => ({}),
        });
        const r2 = await secondFail.execute({});
        expect(r2.success).toBe(false);
        expect(r2.error?.message).toBe('Second tool failed');
    });
});

// ── memory-as-tool remaining branches ────────────────────────────────────────

describe('memoryAsTool remaining branches', () => {
    const baseMemory = (): MemoryStoreLike => ({
        store: vi.fn().mockResolvedValue({ id: 'm1' }),
        retrieve: vi.fn().mockResolvedValue([]),
        getRecent: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(true),
        clear: vi.fn().mockResolvedValue(undefined),
    });

    it('blocks delete and clear when read-only', async () => {
        const t = memoryAsTool({ name: 'm', description: 'm', memory: baseMemory(), writeable: false });
        const del = await t.execute({ action: 'delete', id: 'x' });
        expect(del.success).toBe(false);
        expect(del.error?.message).toContain('read-only');

        const clr = await t.execute({ action: 'clear' });
        expect(clr.success).toBe(false);
        expect(clr.error?.message).toContain('read-only');
    });

    it('coerces non-string content to empty string for store', async () => {
        const t = memoryAsTool({
            name: 'm',
            description: 'm',
            memory: baseMemory(),
            parameters: z.object({ action: z.string(), content: z.unknown().optional() }),
        });
        const r = await t.execute({ action: 'store', content: 42 } as never);
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain('non-empty "content"');
    });

    it('get_recent defaults limit to 10 and type to undefined', async () => {
        const memory = baseMemory();
        const t = memoryAsTool({ name: 'm', description: 'm', memory });
        await t.execute({ action: 'get_recent' });
        expect(memory.getRecent).toHaveBeenCalledWith(10, undefined);
    });

    it('forwards lifecycle hooks', async () => {
        const before = vi.fn();
        const after = vi.fn();
        const onError = vi.fn();
        const t = memoryAsTool({
            name: 'm',
            description: 'm',
            memory: baseMemory(),
            beforeExecute: before,
            afterExecute: after,
            onError,
        });
        const r = await t.execute({ action: 'recall' });
        expect(r.success).toBe(true);
        expect(before).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });
});

// ── knowledge-as-tool remaining branches ─────────────────────────────────────

describe('knowledgeAsTool remaining branches', () => {
    it('ingests documents without content as empty string', async () => {
        const ingest = vi.fn().mockResolvedValue(undefined);
        const t = knowledgeAsTool({
            name: 'k',
            description: 'k',
            knowledge: { ingest },
            parameters: z.object({
                action: z.string(),
                documents: z.array(z.record(z.string(), z.unknown())).optional(),
            }),
        });
        const r = await t.execute({ action: 'add', documents: [{ metadata: { a: 1 } }] } as never);
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ action: 'added', count: 1 });
        expect(ingest).toHaveBeenCalledWith([{ content: '', metadata: { a: 1 } }]);
    });

    it('forwards lifecycle hooks', async () => {
        const before = vi.fn();
        const after = vi.fn();
        const onError = vi.fn();
        const kbt = knowledgeAsTool({
            name: 'k',
            description: 'k',
            knowledge: { buildContext: vi.fn().mockResolvedValue('c') },
            beforeExecute: before,
            afterExecute: after,
            onError,
        });
        const r = await kbt.execute({ query: 'q' });
        expect(r.success).toBe(true);
        expect(before).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });
});

// ── agent-as-tool multiAgentTool minimal overrides ───────────────────────────

describe('multiAgentTool minimal options', () => {
    it('builds a tool without outputSchemas/maxDepth/parameters overrides', async () => {
        const tools = multiAgentTool({
            agents: { solo: { run: vi.fn().mockResolvedValue({ ok: 1 }) } },
            descriptions: { solo: 'Solo agent' },
        });
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('solo');
        const r = await tools[0].execute({ prompt: 'p' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ ok: 1 });
    });
});

// ── cache / compressor / gateway remaining branches ──────────────────────────

describe('remaining primitive branches', () => {
    it('re-setting with ttlMs=0 never expires', () => {
        const cache = new ToolCache({ maxEntries: 1, ttlMs: 0 });
        cache.set('t', {}, makeResult('v1'));
        cache.set('t', {}, makeResult('v2'));
        expect(cache.get('t', {})?.data).toBe('v2');
        expect(cache.getStats().size).toBe(1);
    });

    it('ToolCompressor applies default maxBytes', () => {
        const c = new ToolCompressor();
        expect(c.shouldCompress('x'.repeat(5000))).toBe(false);
        expect(c.shouldCompress('x'.repeat(9000))).toBe(true);

        const c2 = new ToolCompressor({ truncateSuffix: '@' });
        expect(c2.compressSync('short')).toBe('short');
        expect(c2.compressSync('x'.repeat(9000)).length).toBeGreaterThan(0);
        expect(c2.getStats().compressions).toBe(1);
    });

    it('gateway stringifies non-Error tool throws', async () => {
        const okToolBase = {
            id: 'g',
            name: 'g',
            description: 'g',
            parameters: z.object({}) as never,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 1000 },
            category: ToolCategory.UTILITY,
            version: '1.0.0',
            execute: async () => makeResult('ok'),
            validate: () => true,
        } as Tool;
        const stringThrow: Tool = {
            ...okToolBase,
            id: 'sthrow',
            execute: async () => { throw 'plain-boom'; },
        } as Tool;
        const r = await handleToolGatewayRequest('POST', '/invoke', JSON.stringify({ toolId: 'sthrow', args: {} }), [stringThrow]);
        expect(r.statusCode).toBe(500);
        expect(r.body.error).toBe('plain-boom');
    });
});
