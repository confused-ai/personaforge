/**
 * Mastra-parity integration tests.
 *
 * Covers the new framework layers wired into the agentic runner:
 * - processors (input/output/error + tripwire)
 * - structured output (schema, fallback)
 * - durable goals (in-loop judge + objective budget)
 * - agent approval (requireApproval → suspend → resume)
 * - code mode (sandboxed multi-tool computation)
 * - durable agents (stream + observe replay)
 * - Memory bundle (threads / working memory / processors)
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { z } from 'zod';
import { AgenticRunner, toToolRegistry } from '@personaforge/agentic';
import type { AgenticRunConfig, AgenticStreamHooks } from '@personaforge/agentic';
import type { GenerateResult, LLMProvider, Message, ToolCall as LLMToolCall } from '@personaforge/core';
import { UnicodeNormalizer, ModerationProcessor, TokenLimiter } from '@personaforge/processors';
import { createCodeMode, VMSandbox, LocalSandbox } from '@personaforge/code-mode';
import { createDurableAgent } from '@personaforge/durable';
import { createStaticJudge } from '@personaforge/goals';
import { Memory } from '@personaforge/memory';
import { tool } from '@personaforge/tools';
import type { Tool, ToolRegistry } from '@personaforge/tools';
import { createAgent } from '../src/create-agent.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

type GenerateFn = (messages: Message[]) => GenerateResult;

function makeMockLLM(responses: GenerateFn | GenerateResult[]): LLMProvider {
    let callIdx = 0;
    return {
        generateText: vi.fn(async (messages: Message[]): Promise<GenerateResult> => {
            if (typeof responses === 'function') return responses(messages);
            const r = responses[callIdx % responses.length];
            callIdx++;
            return r ?? { text: '', finishReason: 'stop' as const };
        }),
    };
}

function makeToolCall(name: string, args: Record<string, unknown> = {}, id = `call-${name}`): LLMToolCall {
    return { id, name, arguments: args };
}

function makeSimpleResult(text: string): GenerateResult {
    return { text, finishReason: 'stop' as const };
}

function makeTool(
    name: string,
    executeFn: (args: Record<string, unknown>) => unknown = () => `result of ${name}`,
    extra: Partial<Tool> = {},
): Tool {
    return {
        id: name,
        name,
        description: `Mock tool: ${name}`,
        parameters: z.object({}) as unknown as Tool['parameters'],
        permissions: { allowNetwork: false, allowFileSystem: false, maxExecutionTimeMs: 1_000 } as Tool['permissions'],
        category: 'utility' as Tool['category'],
        version: '1.0.0',
        execute: vi.fn(async (params: Record<string, unknown>): Promise<{ success: boolean; data: unknown; executionTimeMs: number; metadata: Record<string, never> }> => {
            const data = await Promise.resolve(executeFn(params));
            return { success: true, data, executionTimeMs: 0, metadata: {} };
        }),
        validate: () => true,
        ...extra,
    };
}

function makeRunner(config: { llm: LLMProvider; tools?: Tool[] }) {
    const registry: ToolRegistry = toToolRegistry(config.tools ?? []);
    return new AgenticRunner({
        llm: config.llm,
        tools: registry,
        retry: { maxRetries: 0, backoffMs: 1 },
    });
}

// ── Processors ───────────────────────────────────────────────────────────────

describe('processors', () => {
    it('UnicodeNormalizer normalizes input messages before the loop', async () => {
        const llm = makeMockLLM((msgs) => {
            const last = msgs[msgs.length - 1];
            return makeSimpleResult(`got: ${String((last as Message).content)}`);
        });
        const runner = makeRunner({ llm });
        const result = await runner.run({
            instructions: 'You reply.',
            prompt: '  h\u00e9llo\u0000   world  ',
            processors: { input: new UnicodeNormalizer({ stripControlChars: true, collapseWhitespace: true }) },
        });
        const userMsg = result.messages.find((m) => m.role === 'user');
        expect(userMsg?.content).toBe('h\u00e9llo world');
        expect(result.text).toBe('got: h\u00e9llo world');
    });

    it('ModerationProcessor blocks harmful input with a tripwire', async () => {
        const llm = makeMockLLM(() => makeSimpleResult('should not run'));
        const runner = makeRunner({ llm });
        const result = await runner.run({
            instructions: 'You reply.',
            prompt: 'I hate you.',
            processors: { input: new ModerationProcessor({ strategy: 'block' }) },
        });
        expect(result.finishReason).toBe('aborted');
        expect(result.tripwire?.processorId).toBe('moderation-processor');
        expect(result.text).toBe('');
    });

    it('TokenLimiter trims old messages over the budget', async () => {
        const llm = makeMockLLM(() => makeSimpleResult('ok'));
        const runner = makeRunner({ llm });
        const messages: Message[] = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'a'.repeat(400) },
            { role: 'user', content: 'b'.repeat(400) },
            { role: 'user', content: 'final' },
        ];
        const result = await runner.run({
            instructions: 'hi',
            prompt: 'final',
            messages,
            processors: { input: new TokenLimiter(60) },
        });
        const userCount = result.messages.filter((m) => m.role === 'user').length;
        expect(userCount).toBeLessThan(3);
    });
});

// ── Structured output ────────────────────────────────────────────────────────

describe('structured output', () => {
    it('returns result.object matching the schema', async () => {
        const schema = z.object({ summary: z.string(), tags: z.array(z.string()) });
        const llm = makeMockLLM(() =>
            makeSimpleResult(JSON.stringify({ summary: 'done', tags: ['a', 'b'] })),
        );
        const runner = makeRunner({ llm });
        const result = await runner.run({
            instructions: 'Return JSON.',
            prompt: 'do it',
            structuredOutput: { schema, errorStrategy: 'strict' },
        });
        expect(result.object).toEqual({ summary: 'done', tags: ['a', 'b'] });
        expect(result.structuredOutput).toEqual(result.object);
    });

    it('returns fallbackValue when validation fails and errorStrategy is fallback', async () => {
        const schema = z.object({ summary: z.string() });
        const llm = makeMockLLM(() => makeSimpleResult('not json at all'));
        const runner = makeRunner({ llm });
        const result = await runner.run({
            instructions: 'Return JSON.',
            prompt: 'do it',
            structuredOutput: { schema, errorStrategy: 'fallback', fallbackValue: { summary: 'fallback' } },
        });
        expect(result.object).toEqual({ summary: 'fallback' });
    });
});

// ── Goals ────────────────────────────────────────────────────────────────────

describe('durable goals', () => {
    it('keeps iterating until the judge passes, emitting goal evaluations', async () => {
        let attempts = 0;
        const llm = makeMockLLM(() => {
            attempts++;
            return makeSimpleResult(`attempt ${attempts}`);
        });
        const runner = makeRunner({ llm });
        const evaluations: unknown[] = [];
        const streamHooks: AgenticStreamHooks = {
            onGoal: (e) => evaluations.push(e),
        };
        const result = await runner.run(
            {
                instructions: 'Complete the task.',
                prompt: 'work',
                goal: {
                    objective: 'Ship the endpoint',
                    judge: createStaticJudge(async (text) => attempts >= 3),
                    maxRuns: 5,
                },
            },
            streamHooks,
        );
        expect(attempts).toBe(3);
        expect(result.finishReason).toBe('stop');
        expect(evaluations.length).toBe(3);
        const last = evaluations[2] as { passed: boolean; status: string };
        expect(last.passed).toBe(true);
        expect(last.status).toBe('done');
    });

    it('pauses when maxRuns is exhausted', async () => {
        const llm = makeMockLLM(() => makeSimpleResult('nope'));
        const runner = makeRunner({ llm });
        const result = await runner.run({
            instructions: 'Do it.',
            prompt: 'work',
            goal: {
                objective: 'Never completes',
                judge: (text) => ({ passed: false, reason: 'keep going' }),
                maxRuns: 2,
            },
        });
        expect(result.finishReason).toBe('max_runs');
    });
});

// ── Agent approval ───────────────────────────────────────────────────────────

describe('agent approval', () => {
    it('suspends a tool call before execute and resumes after approval', async () => {
        const executed = vi.fn();
        const danger = makeTool('danger', (args) => {
            executed(args);
            return 'ok';
        }, { requireApproval: true });
        const llm = makeMockLLM([
            { text: '', toolCalls: [makeToolCall('danger', { id: 'x' }, 'call-danger')], finishReason: 'tool_calls' as const },
            makeSimpleResult('done'),
        ]);
        const runner = makeRunner({ llm, tools: [danger] });

        let approvalReq: unknown;
        const hooks: AgenticStreamHooks = {
            onApproval: (req) => { approvalReq = req; },
        };

        // Run 1 — the tool call requires approval and must NOT execute.
        const suspended = await runner.run(
            { instructions: 'Use tools.', prompt: 'use danger', requireToolApproval: true, runId: 'r1' },
            hooks,
        );
        expect(suspended.finishReason).toBe('suspended');
        expect(suspended.suspendPayload?.toolName).toBe('danger');
        expect(suspended.suspendPayload?.requiresApproval).toBe(true);
        expect(executed).not.toHaveBeenCalled();
        expect(approvalReq).toBeTruthy();

        // Run 2 — resume with the pending call approved; the tool executes.
        const resumed = await runner.run({
            instructions: 'Use tools.',
            prompt: 'use danger',
            requireToolApproval: true,
            runId: 'r1',
            approvedToolCalls: ['call-danger'],
            resumePendingTool: {
                toolCall: { id: 'call-danger', name: 'danger', arguments: { id: 'x' } },
                approved: true,
                step: 0,
            },
        });
        expect(executed).toHaveBeenCalledTimes(1);
        expect(resumed.finishReason).toBe('stop');
    });
});

// ── Code mode ────────────────────────────────────────────────────────────────

describe('code mode', () => {
    const addTool = tool({
        name: 'add',
        description: 'Add two numbers',
        parameters: z.object({ x: z.number(), y: z.number() }),
        execute: async ({ x, y }) => ({ sum: x + y }),
    });

    it('runs a script that orchestrates external tools in-process (vm)', async () => {
        const { tool: codeTool } = createCodeMode({
            tools: { add: addTool },
            sandbox: new VMSandbox(),
        });
        const res = await codeTool.execute(
            { code: 'const a = await external_add({ x: 1, y: 2 }); return a.sum * 10;' },
            { agentId: 'a', sessionId: 's' },
        );
        expect(res.success).toBe(true);
        expect((res.data as { result: unknown }).result).toBe(30);
    });

    it('runs a script in the isolated local sandbox (subprocess)', async () => {
        const { tool: codeTool } = createCodeMode({
            tools: { add: addTool },
            sandbox: new LocalSandbox(),
        });
        const res = await codeTool.execute(
            { code: 'const a = await external_add({ x: 5, y: 7 }); return a.sum;' },
            { agentId: 'a', sessionId: 's' },
        );
        expect(res.success).toBe(true);
        expect((res.data as { result: unknown }).result).toBe(12);
    });
});

// ── Durable agents ───────────────────────────────────────────────────────────

describe('durable agents', () => {
    it('publishes events to a run topic and replays them on observe', async () => {
        const fakeAgent = {
            name: 'fake',
            streamEvents: async function* (_prompt: string, _opts: unknown) {
                yield { type: 'text-delta', delta: 'hello' };
                yield {
                    type: 'run-finish',
                    run: {
                        text: 'hello',
                        markdown: { name: 'r.md', content: 'hello', mimeType: 'text/markdown', type: 'markdown' },
                        messages: [],
                        steps: 1,
                        finishReason: 'stop',
                    },
                };
            },
        } as never;

        const durable = createDurableAgent({ agent: fakeAgent as never });
        const { runId, output } = await durable.stream('hi');
        const events: Array<{ type: string; delta?: string }> = [];
        for await (const e of output.fullStream) {
            events.push(e);
        }
        expect(events.map((e) => e.type)).toContain('text-delta');
        expect(events.map((e) => e.type)).toContain('run-finish');

        // observe() replays the cached events.
        const { output: obs } = await durable.observe(runId);
        const replayed: Array<{ type: string; delta?: string }> = [];
        for await (const e of obs.fullStream) {
            replayed.push(e);
        }
        expect(replayed.some((e) => e.type === 'text-delta' && e.delta === 'hello')).toBe(true);
    });
});

// ── Memory bundle ────────────────────────────────────────────────────────────

describe('Memory bundle', () => {
    it('persists threads and exposes working memory + processors', async () => {
        const mem = new Memory({ lastMessages: 5 });
        const thread = await mem.createThread({ resourceId: 'user-1' });
        await mem.saveMessages({
            threadId: thread.id,
            messages: [
                { role: 'user' as const, content: 'hello' },
                { role: 'assistant' as const, content: 'hi there' },
            ],
        });
        const history = await mem.getMessages(thread.id);
        expect(history).toHaveLength(2);
        expect(history[0]?.role).toBe('user');

        await mem.setWorkingMemory({ threadId: thread.id, resourceId: 'user-1', workingMemory: 'Name: Alice' });
        const wm = await mem.getWorkingMemory({ threadId: thread.id, resourceId: 'user-1' });
        expect(wm).toContain('Alice');
        expect(await mem.renderWorkingMemory(thread.id, 'user-1')).toContain('Alice');

        const procs = mem.getProcessors();
        expect(procs.input?.length).toBeGreaterThan(0);
        expect(procs.output?.length).toBeGreaterThan(0);
    });
});

// ── createAgent end-to-end (supervisor + processors + structured) ────────────

describe('createAgent integration', () => {
    it('exposes durable + approval + goal methods and runs with a subagent tool', async () => {
        const sub = createAgent({
            name: 'writer',
            instructions: 'You write.',
            llm: makeMockLLM(() => makeSimpleResult('written')),
            tools: [],
        });

        const llm = makeMockLLM([
            { text: '', toolCalls: [makeToolCall('writer', { prompt: 'write it' })], finishReason: 'tool_calls' as const },
            makeSimpleResult('final answer'),
        ]);
        const supervisor = createAgent({
            name: 'boss',
            instructions: 'You delegate.',
            llm,
            tools: [],
            agents: { writer: sub as never },
        });

        const stream = supervisor.streamEvents('write it', {});
        const types: string[] = [];
        for await (const chunk of stream) {
            if (chunk.type !== 'text-delta') types.push(chunk.type);
        }
        expect(types).toContain('tool-result');
        expect(supervisor.observe).toBeTypeOf('function');
        expect(supervisor.approveToolCall).toBeTypeOf('function');
        expect(supervisor.setObjective).toBeTypeOf('function');
        expect(supervisor.listSuspendedRuns).toBeTypeOf('function');
        expect(typeof supervisor.runId).toBe('undefined'); // runId is per-run, not on the handle
    });
});
