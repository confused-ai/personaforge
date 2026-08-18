/**
 * AgenticRunner hardening — loop detection, idempotent-tool memoization,
 * response cache + in-flight coalescing, admission control, W3C trace headers,
 * and tool-result `name` on tool messages (audit items 1/7/12/13/15/18).
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { AgenticRunner } from '../src/agentic/index.js';
import type {
    AgenticRunnerConfig,
    AgenticRunConfig,
    GenerateOptions,
    GenerateResult,
    LLMProvider,
    Message,
    ToolCall as LLMToolCall,
} from '../src/agentic/index.js';
import type { ToolRegistry, Tool, ToolResult } from '../src/agentic/_tool-types.js';
import { LoadShedError } from '../src/core/errors.js';

// ── Helpers (mirror tests/agentic-runner.test.ts) ────────────────────────────

function makeToolCall(name: string, args: Record<string, unknown> = {}, id = `call-${name}`): LLMToolCall {
    return { id, name, arguments: args };
}

type GenerateFn = (messages: Message[]) => GenerateResult;
type MockLLM = Omit<LLMProvider, 'generateText'> & {
    generateText: ReturnType<typeof vi.fn<GenerateFn>>;
};

function makeMockLLM(responses: GenerateFn | GenerateResult[]): MockLLM {
    let callIdx = 0;
    const generateText = vi.fn(async (messages: Message[], _options?: GenerateOptions): Promise<GenerateResult> => {
        if (typeof responses === 'function') return responses(messages);
        const r = responses[callIdx % responses.length];
        callIdx++;
        return r ?? { text: '', toolCalls: undefined, finishReason: 'stop' as const };
    });
    return { generateText } as unknown as MockLLM;
}

function makeSimpleResult(text: string): GenerateResult {
    return { text, finishReason: 'stop' as const };
}

function makeLLMToolResult(toolCalls: LLMToolCall[]): GenerateResult {
    return { text: '', toolCalls, finishReason: 'tool_calls' as const };
}

function makeTool(
    name: string,
    opts: { idempotent?: boolean; executeFn?: (args: Record<string, unknown>) => unknown } = {},
): Tool {
    const executeFn = opts.executeFn ?? (() => `result of ${name}`);
    const execute = vi.fn(async (params: Record<string, unknown>): Promise<ToolResult> => {
        const data = await Promise.resolve(executeFn(params));
        return {
            success: true,
            data,
            executionTimeMs: 0,
            metadata: { startTime: new Date(), endTime: new Date(), retries: 0 },
        };
    });
    return {
        id: name,
        name,
        description: `Mock tool: ${name}`,
        parameters: z.object({}) as unknown as Tool['parameters'],
        permissions: {
            allowNetwork: false,
            allowFileSystem: false,
            maxExecutionTimeMs: 1_000,
        } as Tool['permissions'],
        category: 'utility' as Tool['category'],
        version: '1.0.0',
        execute,
        ...(opts.idempotent !== undefined && { idempotent: opts.idempotent }),
    } as unknown as Tool & { execute: ReturnType<typeof vi.fn> };
}

function makeRegistry(tools: Tool[]): ToolRegistry {
    const map = new Map(tools.map((t) => [t.name, t]));
    return {
        register: vi.fn(),
        unregister: vi.fn(() => false),
        get: vi.fn((id) => map.get(id)),
        getByName: vi.fn((name) => map.get(name)),
        list: vi.fn(() => tools),
        listByCategory: vi.fn(() => []),
        search: vi.fn(() => []),
        has: vi.fn((id) => map.has(id)),
    } as unknown as ToolRegistry;
}

const NOOP_REGISTRY = makeRegistry([]);

function makeRunnerConfig(overrides: Partial<AgenticRunnerConfig> = {}): AgenticRunnerConfig {
    const llm: AgenticRunnerConfig['llm'] = overrides.llm ?? makeMockLLM([makeSimpleResult('Hello!')]);
    return {
        llm,
        tools: NOOP_REGISTRY,
        maxSteps: 20,
        timeoutMs: 5_000,
        retry: { maxRetries: 0 },
        ...overrides,
    };
}

function makeRunConfig(overrides: Partial<AgenticRunConfig> = {}): AgenticRunConfig {
    return {
        instructions: 'You are a helpful assistant.',
        prompt: 'Say hello.',
        ...overrides,
    };
}

// ── Item 1: loop detection ───────────────────────────────────────────────────

describe('AgenticRunner — loop detection (item 1)', () => {
    it('exits with loop_detected when the model repeats the same action', async () => {
        const llm = makeMockLLM((_messages) => makeLLMToolResult([makeToolCall('echo', { x: 1 })]));
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: makeRegistry([makeTool('echo')]) }));
        const result = await runner.run(makeRunConfig());
        expect(result.finishReason).toBe('loop_detected');
        // must not have burned the whole budget
        expect(result.steps).toBeLessThan(20);
    });

    it('respects loopDetection.enabled=false', async () => {
        const llm = makeMockLLM((_messages) => makeLLMToolResult([makeToolCall('echo', { x: 1 })]));
        const runner = new AgenticRunner(makeRunnerConfig({
            llm,
            tools: makeRegistry([makeTool('echo')]),
            maxSteps: 6,
            loopDetection: { enabled: false },
        }));
        const result = await runner.run(makeRunConfig());
        expect(result.finishReason).toBe('max_steps');
        expect(result.steps).toBe(6);
    });
});

// ── Item 12: idempotent-tool memoization ─────────────────────────────────────

describe('AgenticRunner — idempotent tool memoization (item 12)', () => {
    it('executes an idempotent tool once for repeated identical calls in a run', async () => {
        let calls = 0;
        const tool = makeTool('echo', { idempotent: true, executeFn: () => { calls++; return 'ok'; } });
        const runner = new AgenticRunner(makeRunnerConfig({
            llm: makeMockLLM((messages) => {
                const toolMsgCount = messages.filter((m) => m.role === 'tool').length;
                if (toolMsgCount < 2) return makeLLMToolResult([makeToolCall('echo', { a: 1 })]);
                return makeSimpleResult('done');
            }),
            tools: makeRegistry([tool]),
            toolConcurrency: 1,   // sequential so the first call caches before the second
        }));

        const result = await runner.run(makeRunConfig());
        expect(result.finishReason).toBe('stop');
        expect(calls).toBe(1);

        // every tool-result message carries the tool name (item 18)
        for (const m of result.messages) {
            if (m.role === 'tool') expect((m as { name?: string }).name).toBe('echo');
        }
    });

    it('does not memoize non-idempotent tools', async () => {
        let calls = 0;
        const tool = makeTool('echo', { executeFn: () => { calls++; return 'ok'; } });
        const runner = new AgenticRunner(makeRunnerConfig({
            llm: makeMockLLM((messages) => {
                const toolMsgCount = messages.filter((m) => m.role === 'tool').length;
                if (toolMsgCount < 2) return makeLLMToolResult([makeToolCall('echo', { a: 1 })]);
                return makeSimpleResult('done');
            }),
            tools: makeRegistry([tool]),
            toolConcurrency: 1,
        }));

        await runner.run(makeRunConfig());
        expect(calls).toBe(2);
    });
});

// ── Item 13: response cache + in-flight coalescing ───────────────────────────

describe('AgenticRunner — response cache + coalescing (item 13)', () => {
    it('serves a cached response without calling the provider', async () => {
        const llm = makeMockLLM([makeSimpleResult('cached-text')]);
        const cache = {
            get: vi.fn(async () => ({ text: 'from-cache', finishReason: 'stop' as const })),
            set: vi.fn(async () => undefined),
        };
        const runner = new AgenticRunner(makeRunnerConfig({ llm, responseCache: cache }));
        const result = await runner.run(makeRunConfig());
        expect(result.text).toBe('from-cache');
        expect(llm.generateText).not.toHaveBeenCalled();
    });

    it('writes to the cache on a miss', async () => {
        const llm = makeMockLLM([makeSimpleResult('fresh')]);
        const cache = {
            get: vi.fn(async () => undefined),
            set: vi.fn(async () => undefined),
        };
        const runner = new AgenticRunner(makeRunnerConfig({ llm, responseCache: cache }));
        await runner.run(makeRunConfig());
        expect(llm.generateText).toHaveBeenCalledTimes(1);
        expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('coalesces two concurrent identical runs into one provider call', async () => {
        let resolveCall!: (r: GenerateResult) => void;
        const gate = new Promise<GenerateResult>((res) => { resolveCall = res; });
        const generateText = vi.fn(async () => gate);
        const llm = { generateText } as unknown as LLMProvider;
        const cache = { get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) };
        const runner = new AgenticRunner(makeRunnerConfig({ llm, responseCache: cache, budgetModelId: 'gpt-test' }));

        const p1 = runner.run(makeRunConfig());
        const p2 = runner.run(makeRunConfig());
        await new Promise((r) => setTimeout(r, 10));   // let both reach the provider gate
        resolveCall({ text: 'shared', finishReason: 'stop' });

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.text).toBe('shared');
        expect(r2.text).toBe('shared');
        expect(generateText).toHaveBeenCalledTimes(1);
    });
});

// ── Item 7: admission control ────────────────────────────────────────────────

describe('AgenticRunner — admission control (item 7)', () => {
    it('rejects the run with LoadShedError when admissionControl sheds load', async () => {
        const runner = new AgenticRunner(makeRunnerConfig({
            admissionControl: async () => ({ admit: false, reason: 'overloaded', retryAfterMs: 1_000 }),
        }));
        await expect(runner.run(makeRunConfig())).rejects.toBeInstanceOf(LoadShedError);
    });

    it('admits the run when admissionControl accepts', async () => {
        const runner = new AgenticRunner(makeRunnerConfig({
            admissionControl: async () => ({ admit: true }),
        }));
        const result = await runner.run(makeRunConfig());
        expect(result.text).toBe('Hello!');
    });
});

// ── Item 15: W3C traceparent headers ─────────────────────────────────────────

describe('AgenticRunner — W3C traceparent (item 15)', () => {
    it('injects a traceparent header into the provider call from traceId', async () => {
        const llm = makeMockLLM([makeSimpleResult('ok')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        const traceId = '0'.repeat(32);
        await runner.run(makeRunConfig({ traceId }));
        const opts = llm.generateText.mock.calls[0]?.[1] as GenerateOptions | undefined;
        const headers = opts?.headers as Record<string, string> | undefined;
        expect(headers?.traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
    });

    it('omits headers when no traceId is supplied', async () => {
        const llm = makeMockLLM([makeSimpleResult('ok')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        await runner.run(makeRunConfig());
        const opts = llm.generateText.mock.calls[0]?.[1] as GenerateOptions | undefined;
        expect(opts?.headers).toBeUndefined();
    });
});

// ── Item 18: tool-result name ────────────────────────────────────────────────

describe('AgenticRunner — tool message identity (item 18)', () => {
    it('emits tool messages with both toolCallId and name', async () => {
        const runner = new AgenticRunner(makeRunnerConfig({
            llm: makeMockLLM((messages) => {
                if (!messages.some((m) => m.role === 'tool')) return makeLLMToolResult([makeToolCall('sum', { a: 1 })]);
                return makeSimpleResult('done');
            }),
            tools: makeRegistry([makeTool('sum')]),
        }));
        const result = await runner.run(makeRunConfig());
        const toolMsg = result.messages.find((m) => m.role === 'tool') as Message & { toolCallId?: string; name?: string };
        expect(toolMsg).toBeDefined();
        expect(toolMsg.toolCallId).toBe('call-sum');
        expect(toolMsg.name).toBe('sum');
    });
});
