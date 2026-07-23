/**
 * Tests for the AgenticRunner (ReAct-style loop)
 *
 * Covers:
 * 1. Basic run — no tools, simple prompt → text response
 * 2. ReAct loop — tool call → tool result → final answer
 * 3. Multi-step loops — multiple tool rounds
 * 4. Max steps limit
 * 5. Timeout
 * 6. Tool error handling — tool throws, runner recovers
 * 7. Lifecycle hooks — beforeRun, afterRun, beforeStep, afterStep,
 *                       beforeToolCall, afterToolCall, onError
 * 8. Stream hooks — onChunk, onToolCall, onToolResult, onStep
 * 9. Guardrail — tool-level check blocks tool, passes clean input
 * 10. Human-in-the-loop — beforeToolCall approval/rejection, beforeFinish rejection
 * 11. AbortSignal cancellation
 * 12. background() helper — fire-and-forget hooks
 * 13. Concurrent runs isolation
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { z } from 'zod';
import { AgenticRunner, background } from '@personaforge/agentic';
import type {
    AgenticRunnerConfig,
    AgenticRunConfig,
    AgenticStreamHooks,
    AgenticLifecycleHooks,
    AgenticRunResult,
} from '@personaforge/agentic';
import type { GenerateOptions, GenerateResult, LLMProvider, Message, ToolCall as LLMToolCall } from '@personaforge/core';
import type { ToolRegistry, Tool, ToolResult } from '@personaforge/tools';
import type { GuardrailEngine, GuardrailContext, GuardrailResult, GuardrailViolation, HumanInTheLoopHooks } from '@personaforge/guardrails';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeToolCall(name: string, args: Record<string, unknown> = {}, id = `call-${name}`): LLMToolCall {
    return { id, name, arguments: args };
}

type GenerateFn = (messages: Message[]) => GenerateResult;
type MockLLM = Omit<LLMProvider, 'generateText'> & {
    generateText: Mock<(messages: Message[], options?: GenerateOptions) => Promise<GenerateResult>>;
    _callIdx: () => number;
};

function makeMockLLM(responses: GenerateFn | GenerateResult[]): MockLLM {
    let callIdx = 0;
    const generateText = vi.fn(async (messages: Message[], _options?: GenerateOptions): Promise<GenerateResult> => {
        if (typeof responses === 'function') return responses(messages);
        const r = responses[callIdx % responses.length];
        callIdx++;
        return r ?? { text: '', toolCalls: undefined, finishReason: 'stop' as const };
    });
    return { generateText, _callIdx: () => callIdx };
}

function makeSimpleResult(text: string): GenerateResult {
    return { text, finishReason: 'stop' as const };
}

function makeLLMToolResult(toolCalls: LLMToolCall[]): GenerateResult {
    return { text: '', toolCalls, finishReason: 'tool_calls' as const };
}

function makeTool(
    name: string,
    executeFn: (args: Record<string, unknown>) => unknown = () => `result of ${name}`,
): Tool {
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
        execute: vi.fn(async (params: Record<string, unknown>): Promise<ToolResult> => {
            const data = await Promise.resolve(executeFn(params));
            return {
                success: true,
                data,
                executionTimeMs: 0,
                metadata: { startTime: new Date(), endTime: new Date(), retries: 0 },
            };
        }),
    } as unknown as Tool;
}

function makeRegistry(tools: Tool[]): ToolRegistry {
    const map = new Map(tools.map(t => [t.name, t]));
    return {
        register: vi.fn(),
        unregister: vi.fn(() => false),
        get: vi.fn(id => map.get(id)),
        getByName: vi.fn(name => map.get(name)),
        list: vi.fn(() => tools),
        listByCategory: vi.fn(() => []),
        search: vi.fn(() => []),
        has: vi.fn(id => map.has(id)),
    } as unknown as ToolRegistry;
}

const NOOP_REGISTRY = makeRegistry([]);

function asResponseModel(schema: z.ZodTypeAny): NonNullable<AgenticRunConfig['responseModel']> {
    return schema as unknown as NonNullable<AgenticRunConfig['responseModel']>;
}

function isGuardrailViolation(value: unknown): value is GuardrailViolation {
    return typeof value === 'object' && value !== null
        && 'rule' in value
        && 'message' in value
        && 'severity' in value;
}

function makeBlockedGuardrailResult(violation: GuardrailViolation): GuardrailResult {
    return {
        passed: false,
        rule: violation.rule,
        message: violation.message,
        details: violation,
    };
}

function getGuardrailViolations(results: GuardrailResult[]): GuardrailViolation[] {
    return results.flatMap((result) => {
        if (result.passed) {
            return [];
        }

        if (isGuardrailViolation(result.details)) {
            return [result.details];
        }

        return [{
            rule: result.rule,
            message: result.message ?? 'Guardrail violation',
            severity: 'error',
        }];
    });
}

function makeRunnerConfig(overrides: Partial<AgenticRunnerConfig> = {}): AgenticRunnerConfig {
    const llm: AgenticRunnerConfig['llm'] = overrides.llm ?? makeMockLLM([makeSimpleResult('Hello!')]);
    return {
        llm,
        tools: NOOP_REGISTRY,
        maxSteps: 5,
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

// ── Basic run ─────────────────────────────────────────────────────────────────

describe('AgenticRunner — basic run', () => {
    it('returns text response for a simple no-tool prompt', async () => {
        const llm = makeMockLLM([makeSimpleResult('Hello, world!')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        const result = await runner.run(makeRunConfig({ prompt: 'Say hello.' }));

        expect(result.text).toBe('Hello, world!');
        expect(result.steps).toBe(1);
        expect(result.finishReason).toBe('stop');
        expect(result.markdown.type).toBe('markdown');
        expect(result.markdown.content).toBe('Hello, world!');
    });

    it('includes full message history in result', async () => {
        const llm = makeMockLLM([makeSimpleResult('Sure thing!')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        const result = await runner.run(makeRunConfig({ prompt: 'Do something.' }));

        const roles = result.messages.map(m => m.role);
        expect(roles).toContain('system');
        expect(roles).toContain('user');
        expect(roles).toContain('assistant');
    });

    it('preserves provided messages history', async () => {
        const existing: Message[] = [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hey there' },
        ];
        const llm = makeMockLLM([makeSimpleResult('Follow-up answer')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        const result = await runner.run(makeRunConfig({ messages: existing }));

        // Original messages preserved at the start of the conversation
        expect(result.messages[0]).toEqual({ role: 'user', content: 'Hi' });
        expect(result.messages[1]).toEqual({ role: 'assistant', content: 'Hey there' });
    });

    it('passes runId and traceId through to result', async () => {
        const llm = makeMockLLM([makeSimpleResult('Done')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        const result = await runner.run(makeRunConfig({ runId: 'run-42', traceId: 'trace-99' }));

        expect(result.runId).toBe('run-42');
        expect(result.traceId).toBe('trace-99');
    });
});

// ── ReAct loop ────────────────────────────────────────────────────────────────

describe('AgenticRunner — ReAct tool loop', () => {
    it('executes a tool call and feeds result back to LLM', async () => {
        const weather = makeTool('get_weather', () => '72°F, sunny');
        const registry = makeRegistry([weather]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('get_weather', { city: 'SF' })]),
            makeSimpleResult('It is 72°F and sunny in San Francisco.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        const result = await runner.run(makeRunConfig({ prompt: 'What is the weather in SF?' }));

        expect(result.text).toContain('72°F');
        expect(weather.execute).toHaveBeenCalledOnce();
        expect(result.steps).toBe(2);
        expect(result.finishReason).toBe('stop');
    });

    it('handles multiple sequential tool calls across steps', async () => {
        const search = makeTool('search', () => 'result-1');
        const fetch = makeTool('fetch_url', () => 'result-2');
        const registry = makeRegistry([search, fetch]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('search', { q: 'TypeScript' })]),
            makeLLMToolResult([makeToolCall('fetch_url', { url: 'https://example.com' })]),
            makeSimpleResult('Done! Here is what I found.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        const result = await runner.run(makeRunConfig({ prompt: 'Research TypeScript.' }));

        expect(result.text).toBe('Done! Here is what I found.');
        expect(search.execute).toHaveBeenCalledOnce();
        expect(fetch.execute).toHaveBeenCalledOnce();
        expect(result.steps).toBe(3);
    });

    it('handles parallel tool calls in a single step', async () => {
        const toolA = makeTool('tool_a', () => 'A-result');
        const toolB = makeTool('tool_b', () => 'B-result');
        const registry = makeRegistry([toolA, toolB]);

        const llm = makeMockLLM([
            makeLLMToolResult([
                makeToolCall('tool_a', {}, 'call-1'),
                makeToolCall('tool_b', {}, 'call-2'),
            ]),
            makeSimpleResult('Both done.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        const result = await runner.run(makeRunConfig({ prompt: 'Run both tools.' }));

        expect(toolA.execute).toHaveBeenCalledOnce();
        expect(toolB.execute).toHaveBeenCalledOnce();
        expect(result.text).toBe('Both done.');
    });

    it('passes tool args correctly to execute()', async () => {
        const calc = makeTool('calculate', ({ a, b }: Record<string, unknown>) => Number(a) + Number(b));
        const registry = makeRegistry([calc]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('calculate', { a: 3, b: 7 })]),
            makeSimpleResult('3 + 7 = 10.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        await runner.run(makeRunConfig({ prompt: 'What is 3 + 7?' }));

        expect(calc.execute).toHaveBeenCalledWith(
            expect.objectContaining({ a: 3, b: 7 }),
            expect.any(Object),
        );
    });

    it('adds tool result messages after each tool call', async () => {
        const echo = makeTool('echo', (args) => `echo: ${JSON.stringify(args)}`);
        const registry = makeRegistry([echo]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('echo', { msg: 'hello' })]),
            makeSimpleResult('I echoed your message.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        const result = await runner.run(makeRunConfig({ prompt: 'Echo something.' }));

        const toolMessages = result.messages.filter(m => m.role === 'tool');
        expect(toolMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('returns error message in tool result when tool name is unknown', async () => {
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('nonexistent_tool')]),
            makeSimpleResult('Tool not found, unable to proceed.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: NOOP_REGISTRY }));
        const result = await runner.run(makeRunConfig());

        const toolMessages = result.messages.filter(m => m.role === 'tool');
        expect(toolMessages.length).toBeGreaterThanOrEqual(1);
        const hasUnknownError = toolMessages.some(
            m => typeof m.content === 'string' && m.content.includes('Unknown tool'),
        );
        expect(hasUnknownError).toBe(true);
    });
});

// ── Max steps ─────────────────────────────────────────────────────────────────

describe('AgenticRunner — max steps', () => {
    it('stops at maxSteps and returns max_steps finishReason', async () => {
        // LLM always returns a tool call — infinite loop without maxSteps
        const loopTool = makeTool('loop_tool', () => 'keep going');
        const registry = makeRegistry([loopTool]);
        const llm = makeMockLLM(() => makeLLMToolResult([makeToolCall('loop_tool')]));

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, maxSteps: 3 }));
        const result = await runner.run(makeRunConfig({ maxSteps: 3 }));

        expect(result.finishReason).toBe('max_steps');
        expect(result.steps).toBe(3);
    });

    it('per-run maxSteps overrides config maxSteps', async () => {
        const loopTool = makeTool('loop_tool');
        const registry = makeRegistry([loopTool]);
        const llm = makeMockLLM(() => makeLLMToolResult([makeToolCall('loop_tool')]));

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, maxSteps: 10 }));
        const result = await runner.run(makeRunConfig({ maxSteps: 2 }));

        expect(result.steps).toBe(2);
        expect(result.finishReason).toBe('max_steps');
    });
});

// ── Timeout ───────────────────────────────────────────────────────────────────

describe('AgenticRunner — timeout', () => {
    it('returns timeout finishReason when run exceeds timeoutMs', async () => {
        // Tool is slow (300ms), run timeout is short (30ms).
        // After step 1 the deadline is expired; step 2 starts and sees expired → 'timeout'.
        const slowTool = makeTool('slow', async () => {
            await new Promise(r => setTimeout(r, 300));
            return 'done';
        });
        const registry = makeRegistry([slowTool]);

        const llm = makeMockLLM(() => makeLLMToolResult([makeToolCall('slow')]));
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, timeoutMs: 30, maxSteps: 10 }));
        const result = await runner.run(makeRunConfig({ timeoutMs: 30, maxSteps: 10 }));

        expect(result.finishReason).toBe('timeout');
    });
});

// ── Tool error handling ────────────────────────────────────────────────────────

describe('AgenticRunner — tool error handling', () => {
    it('catches tool execution errors and feeds error back as tool result', async () => {
        const failTool = makeTool('fail_tool');
        (failTool.execute as Mock).mockRejectedValueOnce(new Error('tool exploded'));
        const registry = makeRegistry([failTool]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('fail_tool')]),
            makeSimpleResult('The tool failed but I recovered.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        const result = await runner.run(makeRunConfig({ prompt: 'Use fail_tool.' }));

        // Runner should not throw — it feeds the error back as a tool result message
        expect(result.finishReason).toBe('stop');
        const toolMessages = result.messages.filter(m => m.role === 'tool');
        const hasError = toolMessages.some(
            m => typeof m.content === 'string' && m.content.toLowerCase().includes('error'),
        );
        expect(hasError).toBe(true);
    });

    it('throws LLMError when the LLM fails permanently', async () => {
        const llm = { generateText: vi.fn().mockRejectedValue(new Error('LLM unavailable')) };
        const runner = new AgenticRunner(makeRunnerConfig({ llm, retry: { maxRetries: 0 } }));

        await expect(runner.run(makeRunConfig())).rejects.toThrow('LLM unavailable');
    });

    it('calls onError lifecycle hook when LLM fails', async () => {
        const llm = { generateText: vi.fn().mockRejectedValue(new Error('oops')) };
        const onError = vi.fn();
        const runner = new AgenticRunner(makeRunnerConfig({ llm, retry: { maxRetries: 0 }, hooks: { onError } }));

        await expect(runner.run(makeRunConfig())).rejects.toThrow('oops');
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);
    });
});

// ── Lifecycle hooks ───────────────────────────────────────────────────────────

describe('AgenticRunner — lifecycle hooks', () => {
    it('calls beforeRun and can modify the prompt', async () => {
        const llm = makeMockLLM([makeSimpleResult('Done')]);
        const beforeRun = vi.fn(async (prompt: string) => `MODIFIED: ${prompt}`);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, hooks: { beforeRun } }));
        await runner.run(makeRunConfig({ prompt: 'original' }));

        expect(beforeRun).toHaveBeenCalledWith('original', expect.any(Object));
        // LLM should receive the modified prompt as the user message
        const llmCalls = llm.generateText.mock.calls;
        const messages = llmCalls[0]?.[0] as Message[];
        const userMsg = messages.find(m => m.role === 'user');
        expect(typeof userMsg?.content === 'string' ? userMsg.content : '').toMatch(/MODIFIED/);
    });

    it('calls afterRun and can override result', async () => {
        const llm = makeMockLLM([makeSimpleResult('Original')]);
        const afterRun = vi.fn(async (result: AgenticRunResult) => ({ ...result, text: 'OVERRIDDEN' }));

        const runner = new AgenticRunner(makeRunnerConfig({ llm, hooks: { afterRun } }));
        const result = await runner.run(makeRunConfig());

        expect(afterRun).toHaveBeenCalledOnce();
        expect(result.text).toBe('OVERRIDDEN');
    });

    it('calls beforeStep once per step', async () => {
        const tool = makeTool('step_tool');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('step_tool')]),
            makeSimpleResult('Done'),
        ]);

        const beforeStep = vi.fn(async (_step: number, msgs: Message[]) => msgs);
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, hooks: { beforeStep } }));
        await runner.run(makeRunConfig());

        expect(beforeStep).toHaveBeenCalledTimes(2); // step 1 (tool call) + step 2 (final answer)
        expect(beforeStep).toHaveBeenNthCalledWith(1, 1, expect.any(Array));
    });

    it('calls afterStep once per step', async () => {
        const tool = makeTool('step_tool');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('step_tool')]),
            makeSimpleResult('Done'),
        ]);

        const afterStep = vi.fn();
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, hooks: { afterStep } }));
        await runner.run(makeRunConfig());

        expect(afterStep).toHaveBeenCalledTimes(2);
    });

    it('calls beforeToolCall and can rewrite args', async () => {
        const calc = makeTool('calc', ({ x }: Record<string, unknown>) => Number(x) * 2);
        const registry = makeRegistry([calc]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('calc', { x: 5 })]),
            makeSimpleResult('Result computed.'),
        ]);

        const beforeToolCall = vi.fn(async (_name: string, args: Record<string, unknown>) => ({ ...args, x: 99 }));
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, hooks: { beforeToolCall } }));
        await runner.run(makeRunConfig());

        expect(beforeToolCall).toHaveBeenCalledWith('calc', { x: 5 }, 1);
        expect(calc.execute).toHaveBeenCalledWith(expect.objectContaining({ x: 99 }), expect.any(Object));
    });

    it('calls afterToolCall and can rewrite tool result visible to LLM', async () => {
        const tool = makeTool('my_tool', () => 'original-result');
        const registry = makeRegistry([tool]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('my_tool')]),
            makeSimpleResult('Done'),
        ]);

        const afterToolCall = vi.fn(async () => 'MODIFIED-RESULT');
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, hooks: { afterToolCall } }));
        const result = await runner.run(makeRunConfig());

        expect(afterToolCall).toHaveBeenCalledOnce();
        const toolMessages = result.messages.filter(m => m.role === 'tool');
        const hasModified = toolMessages.some(m => String(m.content).includes('MODIFIED-RESULT'));
        expect(hasModified).toBe(true);
    });

    it('per-run hooks are merged with runner-level hooks (both fire)', async () => {
        const configBeforeRun = vi.fn(async (p: string) => p);
        const perRunBeforeRun = vi.fn(async (p: string) => `per-run: ${p}`);

        const llm = makeMockLLM([makeSimpleResult('response')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm, hooks: { beforeRun: configBeforeRun } }));

        await runner.run(makeRunConfig({ prompt: 'test', hooks: { beforeRun: perRunBeforeRun } }));

        // mergeLifecycleHooks: config-level fires first, per-run fires after
        expect(configBeforeRun).toHaveBeenCalledOnce();
        expect(perRunBeforeRun).toHaveBeenCalledOnce();
    });
});

// ── Stream hooks ──────────────────────────────────────────────────────────────

describe('AgenticRunner — stream hooks', () => {
    it('calls onStep for each reasoning step', async () => {
        const tool = makeTool('step_tool');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('step_tool')]),
            makeSimpleResult('Done'),
        ]);

        const onStep = vi.fn();
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        await runner.run(makeRunConfig(), { onStep });

        expect(onStep).toHaveBeenCalledTimes(2);
        expect(onStep).toHaveBeenNthCalledWith(1, 1);
        expect(onStep).toHaveBeenNthCalledWith(2, 2);
    });

    it('calls onToolCall with tool name and args when dispatching', async () => {
        const tool = makeTool('my_tool');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('my_tool', { x: 1 })]),
            makeSimpleResult('Done'),
        ]);

        const onToolCall = vi.fn();
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        await runner.run(makeRunConfig(), { onToolCall });

        expect(onToolCall).toHaveBeenCalledWith('my_tool', { x: 1 });
    });

    it('calls onToolResult with tool name and result', async () => {
        const tool = makeTool('my_tool', () => 'tool-output-value');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('my_tool')]),
            makeSimpleResult('Done'),
        ]);

        const onToolResult = vi.fn();
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        await runner.run(makeRunConfig(), { onToolResult });

        expect(onToolResult).toHaveBeenCalledWith('my_tool', expect.anything());
    });
});

// ── Guardrails ────────────────────────────────────────────────────────────────

describe('AgenticRunner — guardrails', () => {
    it('blocks tool execution when guardrail detects violation', async () => {
        const dangerTool = makeTool('danger_tool');
        const registry = makeRegistry([dangerTool]);

        const violation: GuardrailViolation = { rule: 'content-policy', message: 'Forbidden action', severity: 'error' } as GuardrailViolation;

        const guardrails: GuardrailEngine = {
            checkToolCall: vi.fn(async () => [makeBlockedGuardrailResult(violation)]),
            validateOutput: vi.fn(async () => []),
            checkAll: vi.fn(async () => []),
            getViolations: vi.fn(getGuardrailViolations),
        };

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('danger_tool')]),
            makeSimpleResult('Cannot execute: guardrail blocked that.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        runner.setGuardrails(guardrails as unknown as GuardrailEngine);
        const result = await runner.run(makeRunConfig());

        // Tool should NOT be executed
        expect(dangerTool.execute).not.toHaveBeenCalled();
        // Run should still complete (LLM sees error message and provides final response)
        expect(result.finishReason).toBe('stop');
    });

    it('allows tool execution when guardrail finds no violations', async () => {
        const safeTool = makeTool('safe_tool', () => 'safe-output');
        const registry = makeRegistry([safeTool]);

        const guardrails: GuardrailEngine = {
            checkToolCall: vi.fn(async () => []),
            validateOutput: vi.fn(async () => []),
            checkAll: vi.fn(async () => []),
            getViolations: vi.fn(() => []),
        };

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('safe_tool')]),
            makeSimpleResult('All good.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        runner.setGuardrails(guardrails as unknown as GuardrailEngine);
        const result = await runner.run(makeRunConfig());

        expect(safeTool.execute).toHaveBeenCalledOnce();
        expect(result.text).toBe('All good.');
    });

    it('calls HITL onViolation when input guardrail fires and HITL is configured', async () => {
        const blockedTool = makeTool('blocked_tool');
        const registry = makeRegistry([blockedTool]);

        const inputViolation: GuardrailViolation = { rule: 'policy', message: 'Input blocked', severity: 'error' } as GuardrailViolation;

        const guardrails: GuardrailEngine = {
            checkToolCall: vi.fn(async () => [makeBlockedGuardrailResult(inputViolation)]),
            validateOutput: vi.fn(async () => []),
            checkAll: vi.fn(async () => []),
            getViolations: vi.fn(getGuardrailViolations),
        };

        const onViolation = vi.fn(async () => {});
        const hitl: HumanInTheLoopHooks = { onViolation };

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('blocked_tool')]),
            makeSimpleResult('Guardrail blocked the tool.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        runner.setGuardrails(guardrails as unknown as GuardrailEngine);
        runner.setHumanInTheLoop(hitl);
        await runner.run(makeRunConfig());

        expect(onViolation).toHaveBeenCalledWith(inputViolation, expect.any(Object));
        expect(blockedTool.execute).not.toHaveBeenCalled();
    });
});

// ── Human-in-the-loop ─────────────────────────────────────────────────────────

describe('AgenticRunner — human-in-the-loop', () => {
    it('executes tool when beforeToolCall approves (returns true)', async () => {
        const sensitiveAction = makeTool('delete_file', () => 'file deleted');
        const registry = makeRegistry([sensitiveAction]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('delete_file', { path: '/tmp/test.txt' })]),
            makeSimpleResult('File deleted.'),
        ]);

        const hitl: HumanInTheLoopHooks = {
            beforeToolCall: vi.fn(async () => true),
        };

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        runner.setHumanInTheLoop(hitl);
        const result = await runner.run(makeRunConfig());

        expect(hitl.beforeToolCall).toHaveBeenCalledWith('delete_file', { path: '/tmp/test.txt' }, expect.any(Object));
        expect(sensitiveAction.execute).toHaveBeenCalledOnce();
        expect(result.finishReason).toBe('stop');
    });

    it('blocks tool and feeds error to LLM when beforeToolCall returns false', async () => {
        const dangerTool = makeTool('danger');
        const registry = makeRegistry([dangerTool]);

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('danger')]),
            makeSimpleResult('Tool was blocked, I cannot proceed.'),
        ]);

        const hitl: HumanInTheLoopHooks = {
            beforeToolCall: vi.fn(async () => false),
        };

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        runner.setHumanInTheLoop(hitl);
        const result = await runner.run(makeRunConfig());

        expect(dangerTool.execute).not.toHaveBeenCalled();
        // LLM sees the rejection and responds — run still completes with stop
        expect(result.finishReason).toBe('stop');
        const toolMessages = result.messages.filter(m => m.role === 'tool');
        const hasRejection = toolMessages.some(m => String(m.content).includes('rejected'));
        expect(hasRejection).toBe(true);
    });

    it('ends run with human_rejected when beforeFinish returns false', async () => {
        const llm = makeMockLLM([makeSimpleResult('My final answer')]);

        const hitl: HumanInTheLoopHooks = {
            beforeFinish: vi.fn(async () => false),
        };

        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        runner.setHumanInTheLoop(hitl);
        const result = await runner.run(makeRunConfig());

        expect(hitl.beforeFinish).toHaveBeenCalledWith('My final answer', expect.any(Object));
        expect(result.finishReason).toBe('human_rejected');
    });

    it('completes run normally when beforeFinish approves (returns true)', async () => {
        const llm = makeMockLLM([makeSimpleResult('Approved answer')]);

        const hitl: HumanInTheLoopHooks = {
            beforeFinish: vi.fn(async () => true),
        };

        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        runner.setHumanInTheLoop(hitl);
        const result = await runner.run(makeRunConfig());

        expect(result.finishReason).toBe('stop');
        expect(result.text).toBe('Approved answer');
    });
});

// ── AbortSignal cancellation ──────────────────────────────────────────────────

describe('AgenticRunner — AbortSignal', () => {
    it('returns aborted finishReason when signal is already aborted before run', async () => {
        const llm = makeMockLLM([makeSimpleResult('Should not run')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));

        const signal: AgenticRunConfig['signal'] = { aborted: true };
        const result = await runner.run(makeRunConfig({ signal }));

        expect(result.finishReason).toBe('aborted');
        expect((llm as ReturnType<typeof makeMockLLM>).generateText).not.toHaveBeenCalled();
    });
});

// ── background() helper ───────────────────────────────────────────────────────

describe('background() helper', () => {
    it('returns a sync wrapper that fires async work without blocking', async () => {
        const underlying = vi.fn().mockResolvedValue(undefined);
        const wrapped = background(underlying);

        expect(typeof wrapped).toBe('function');
        wrapped('a', 'b');

        await new Promise(r => setImmediate(r));
        expect(underlying).toHaveBeenCalledWith('a', 'b');
    });

    it('silently swallows errors from the background function', async () => {
        const throwing = vi.fn().mockRejectedValue(new Error('background error'));
        const wrapped = background(throwing);

        // Should not throw synchronously or async
        await expect(async () => {
            wrapped();
            await new Promise(r => setImmediate(r));
        }).not.toThrow();
    });

    it('integrates with lifecycle hooks as a fire-and-forget afterStep', async () => {
        const sideEffect = vi.fn().mockResolvedValue(undefined);
        const hooks: AgenticLifecycleHooks = {
            afterStep: background(sideEffect),
        };

        const llm = makeMockLLM([makeSimpleResult('Done')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm, hooks }));
        await runner.run(makeRunConfig());

        await new Promise(r => setImmediate(r));
        expect(sideEffect).toHaveBeenCalledOnce();
    });
});

// ── Concurrent runs isolation ─────────────────────────────────────────────────

describe('AgenticRunner — concurrent runs', () => {
    it('completes all concurrent runs without state leakage', async () => {
        const llm = {
            generateText: vi.fn(async () => {
                await new Promise(r => setTimeout(r, 5));
                return makeSimpleResult('response');
            }),
        };

        const runner = new AgenticRunner(makeRunnerConfig({ llm }));

        const results = await Promise.all([
            runner.run(makeRunConfig({ prompt: 'Run 1' })),
            runner.run(makeRunConfig({ prompt: 'Run 2' })),
            runner.run(makeRunConfig({ prompt: 'Run 3' })),
        ]);

        for (const result of results) {
            expect(result.finishReason).toBe('stop');
            expect(result.steps).toBe(1);
        }
    });
});

// ── System prompt customization ───────────────────────────────────────────────

describe('AgenticRunner — system prompt', () => {
    it('appends RAG context to system prompt when ragContext is provided', async () => {
        const llm = makeMockLLM([makeSimpleResult('RAG-informed response')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        await runner.run(makeRunConfig({ ragContext: 'Fact: The sky is blue.' }));

        const messages = (llm as ReturnType<typeof makeMockLLM>).generateText.mock.calls[0]?.[0] as Message[];
        const systemMsg = messages.find(m => m.role === 'system');
        expect(typeof systemMsg?.content === 'string' ? systemMsg.content : '').toContain('Fact: The sky is blue.');
    });

    it('uses buildSystemPrompt lifecycle hook when provided', async () => {
        const llm = makeMockLLM([makeSimpleResult('Custom prompt response')]);
        const buildSystemPrompt = vi.fn(async (instructions: string) => `[CUSTOM] ${instructions}`);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, hooks: { buildSystemPrompt } }));
        await runner.run(makeRunConfig());

        expect(buildSystemPrompt).toHaveBeenCalledWith(
            'You are a helpful assistant.',
            undefined,
        );
        const messages = (llm as ReturnType<typeof makeMockLLM>).generateText.mock.calls[0]?.[0] as Message[];
        const systemMsg = messages.find(m => m.role === 'system');
        expect(typeof systemMsg?.content === 'string' ? systemMsg.content : '').toMatch(/\[CUSTOM\]/);
    });
});

// ── Streaming ─────────────────────────────────────────────────────────────────

describe('AgenticRunner — streaming', () => {
    it('uses streamText when onChunk hook is provided and llm.streamText exists', async () => {
        const chunks = ['Hello', ', ', 'world', '!'];
        const streamText = vi.fn(async (_messages: Message[], options?: GenerateOptions) => {
            // Simulate streaming by calling onChunk for each chunk
            for (const chunk of chunks) {
                options?.onChunk?.(chunk);
            }
            return { text: 'Hello, world!', finishReason: 'stop' as const };
        });

        const llm = { generateText: vi.fn(), streamText };
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));

        const receivedChunks: string[] = [];
        const result = await runner.run(makeRunConfig(), { onChunk: (t) => receivedChunks.push(t) });

        expect(streamText).toHaveBeenCalledOnce();
        expect(llm.generateText).not.toHaveBeenCalled();
        expect(receivedChunks).toEqual(chunks);
        expect(result.text).toBe('Hello, world!');
    });
});

// ── Checkpoint store ──────────────────────────────────────────────────────────

describe('AgenticRunner — checkpoint store', () => {
    function makeCheckpointStore() {
        return {
            load: vi.fn(async (_runId: string) => null),
            save: vi.fn(async () => {}),
            delete: vi.fn(async () => {}),
        };
    }

    it('calls checkpointStore.save after each tool step and delete on completion', async () => {
        const tool = makeTool('cp_tool');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('cp_tool')]),
            makeSimpleResult('Done'),
        ]);

        const checkpointStore = makeCheckpointStore();
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, checkpointStore: checkpointStore as any }));
        await runner.run(makeRunConfig({ runId: 'run-cp-1' }));

        // save is called after step 1 (tool step, not max_steps)
        expect(checkpointStore.save).toHaveBeenCalledWith('run-cp-1', 1, expect.objectContaining({ messages: expect.any(Array) }));
        // delete is called at the end (finishReason = 'stop')
        expect(checkpointStore.delete).toHaveBeenCalledWith('run-cp-1');
    });

    it('loads and restores state from an existing checkpoint', async () => {
        const storedMessages: Message[] = [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
        ];

        const checkpointStore = makeCheckpointStore();
        checkpointStore.load.mockResolvedValueOnce({
            step: 2,
            state: { messages: storedMessages },
        } as any);

        const llm = makeMockLLM([makeSimpleResult('Resumed answer')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm, checkpointStore: checkpointStore as any }));
        const result = await runner.run(makeRunConfig({ runId: 'run-resume-1' }));

        expect(checkpointStore.load).toHaveBeenCalledWith('run-resume-1');
        // Restored messages should be in the result
        expect(result.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: 'You are helpful.' }),
        ]));
    });

    it('does not call save when there is no runId', async () => {
        const tool = makeTool('notool');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('notool')]),
            makeSimpleResult('Done'),
        ]);

        const checkpointStore = makeCheckpointStore();
        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry, checkpointStore: checkpointStore as any }));
        // No runId provided in runConfig
        await runner.run(makeRunConfig());

        expect(checkpointStore.save).not.toHaveBeenCalled();
        expect(checkpointStore.delete).not.toHaveBeenCalled();
    });
});

// ── Structured output ──────────────────────────────────────────────────────────

describe('AgenticRunner — structured output', () => {
    it('parses and returns structuredOutput when responseModel matches LLM text', async () => {
        const schema = z.object({ name: z.string(), score: z.number() });
        const llm = makeMockLLM([makeSimpleResult('```json\n{"name":"Alice","score":42}\n```')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));

        const result = await runner.run(makeRunConfig({ responseModel: asResponseModel(schema) }));

        expect(result.structuredOutput).toEqual({ name: 'Alice', score: 42 });
    });

    it('returns undefined structuredOutput when JSON does not match schema', async () => {
        const schema = z.object({ count: z.number() });
        const llm = makeMockLLM([makeSimpleResult('This is just plain text, no JSON.')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));

        const result = await runner.run(makeRunConfig({ responseModel: asResponseModel(schema) }));

        expect(result.structuredOutput).toBeUndefined();
    });

    it('includes responseModel directive in system prompt', async () => {
        const schema = z.object({ answer: z.string() });
        const llm = makeMockLLM([makeSimpleResult('{"answer":"42"}')]);
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        await runner.run(makeRunConfig({ responseModel: asResponseModel(schema) }));

        const messages = llm.generateText.mock.calls[0]?.[0] as Message[];
        const systemMsg = messages.find(m => m.role === 'system');
        // System prompt should contain structured output directive
        expect(typeof systemMsg?.content === 'string' ? systemMsg.content : '').toMatch(/JSON|json|format|schema/i);
    });
});

// ── LLM usage tracking ────────────────────────────────────────────────────────

describe('AgenticRunner — LLM usage tracking', () => {
    it('populates result.usage when LLM returns token counts', async () => {
        const llm = {
            generateText: vi.fn(async () => ({
                text: 'Response with usage',
                finishReason: 'stop' as const,
                usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            })),
        };
        const runner = new AgenticRunner(makeRunnerConfig({ llm }));
        const result = await runner.run(makeRunConfig());

        expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    });

    it('calls budgetEnforcer.addStepCost with token usage per step', async () => {
        const llm = {
            generateText: vi.fn(async () => ({
                text: 'Response',
                finishReason: 'stop' as const,
                usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
            })),
        };
        const budgetEnforcer = {
            addStepCost: vi.fn(),
            recordAndCheck: vi.fn(async () => {}),
        };
        const runner = new AgenticRunner(makeRunnerConfig({ llm, budgetEnforcer: budgetEnforcer as any, budgetModelId: 'gpt-4o' }));
        await runner.run(makeRunConfig());

        expect(budgetEnforcer.addStepCost).toHaveBeenCalledWith('gpt-4o', 200, 80);
        expect(budgetEnforcer.recordAndCheck).toHaveBeenCalledOnce();
    });
});

// ── Output guardrails ─────────────────────────────────────────────────────────

describe('AgenticRunner — output guardrails', () => {
    it('replaces tool output with error when output guardrail fires', async () => {
        const leakyTool = makeTool('leaky_tool', () => 'sensitive-data-12345');
        const registry = makeRegistry([leakyTool]);

        const outputViolation: GuardrailViolation = { rule: 'pii-detection', message: 'PII detected', severity: 'error' } as GuardrailViolation;

        const guardrails: GuardrailEngine = {
            checkToolCall: vi.fn(async () => []),   // input OK
            validateOutput: vi.fn(async () => [makeBlockedGuardrailResult(outputViolation)]),
            checkAll: vi.fn(async () => []),
            getViolations: vi.fn(getGuardrailViolations),
        };

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('leaky_tool')]),
            makeSimpleResult('Sanitized response.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        runner.setGuardrails(guardrails as unknown as GuardrailEngine);
        const result = await runner.run(makeRunConfig());

        // The tool result message should contain the output guardrail error
        const toolMessages = result.messages.filter(m => m.role === 'tool');
        const hasOutputViolation = toolMessages.some(m => String(m.content).includes('guardrail'));
        expect(hasOutputViolation).toBe(true);
    });

    it('calls onViolation when output guardrail fires and HITL onViolation is set', async () => {
        const leakyTool2 = makeTool('leaky2', () => 'secret-data');
        const registry = makeRegistry([leakyTool2]);

        const outputViolation2: GuardrailViolation = { rule: 'pii', message: 'Secret leaked', severity: 'error' } as GuardrailViolation;

        const guardrails2: GuardrailEngine = {
            checkToolCall: vi.fn(async () => []),
            validateOutput: vi.fn(async () => [makeBlockedGuardrailResult(outputViolation2)]),
            checkAll: vi.fn(async () => []),
            getViolations: vi.fn(getGuardrailViolations),
        };

        const onViolation = vi.fn(async () => {});
        const hitl2: HumanInTheLoopHooks = { onViolation };

        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('leaky2')]),
            makeSimpleResult('Sanitized.'),
        ]);

        const runner = new AgenticRunner(makeRunnerConfig({ llm, tools: registry }));
        runner.setGuardrails(guardrails2 as unknown as GuardrailEngine);
        runner.setHumanInTheLoop(hitl2);
        await runner.run(makeRunConfig());

        expect(onViolation).toHaveBeenCalledWith(outputViolation2, expect.any(Object));
    });
});

// ── Tool middleware ────────────────────────────────────────────────────────────

describe('AgenticRunner — tool middleware', () => {
    it('calls beforeExecute middleware before tool execution', async () => {
        const tool = makeTool('mdw_tool');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('mdw_tool', { key: 'val' })]),
            makeSimpleResult('Done'),
        ]);

        const beforeExecute = vi.fn();
        const runner = new AgenticRunner(makeRunnerConfig({
            llm,
            tools: registry,
            toolMiddleware: [{ beforeExecute }],
        }));
        await runner.run(makeRunConfig());

        expect(beforeExecute).toHaveBeenCalledWith(tool, { key: 'val' }, expect.any(Object));
    });

    it('calls afterExecute middleware after tool execution', async () => {
        const tool = makeTool('mdw_tool2');
        const registry = makeRegistry([tool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('mdw_tool2')]),
            makeSimpleResult('Done'),
        ]);

        const afterExecute = vi.fn();
        const runner = new AgenticRunner(makeRunnerConfig({
            llm,
            tools: registry,
            toolMiddleware: [{ afterExecute }],
        }));
        await runner.run(makeRunConfig());

        expect(afterExecute).toHaveBeenCalledWith(tool, expect.any(Object), expect.any(Object));
    });

    it('calls middleware onError when tool throws', async () => {
        const failTool = makeTool('fail_tool2');
        (failTool.execute as Mock).mockRejectedValueOnce(new Error('middleware error test'));
        const registry = makeRegistry([failTool]);
        const llm = makeMockLLM([
            makeLLMToolResult([makeToolCall('fail_tool2')]),
            makeSimpleResult('Recovered'),
        ]);

        const middlewareOnError = vi.fn();
        const runner = new AgenticRunner(makeRunnerConfig({
            llm,
            tools: registry,
            toolMiddleware: [{ onError: middlewareOnError }],
        }));
        const result = await runner.run(makeRunConfig());

        expect(middlewareOnError).toHaveBeenCalledWith(failTool, expect.any(Error), expect.any(Object));
        expect(result.finishReason).toBe('stop'); // Runner recovers
    });
});
