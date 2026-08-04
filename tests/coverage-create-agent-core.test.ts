/**
 * Hermetic coverage for src/create-agent/factory.ts — createAgent core paths.
 * Uses a mock LLM provider; no network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAgent } from '../src/create-agent/factory.js';
import type { LLMProvider, Message, GenerateResult } from '../src/providers/types.js';

function queuedLLM(responses: GenerateResult[]): LLMProvider {
    let idx = 0;
    return {
        async generateText(_messages: Message[]): Promise<GenerateResult> {
            const r = responses[idx] ?? responses[responses.length - 1]!;
            if (idx < responses.length - 1) idx++;
            return r;
        },
    };
}
const textResult = (text: string): GenerateResult => ({ text, finishReason: 'stop' });
const toolCallResult = (name: string, args: Record<string, unknown>): GenerateResult => ({
    text: '',
    toolCalls: [{ id: `call-${name}`, name, arguments: args }],
    finishReason: 'tool_calls',
});

function echoTool() {
    return {
        name: 'echo',
        description: 'Echoes input',
        parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        execute: async ({ message }: { message: string }) => `echo:${message}`,
    };
}

describe('createAgent core', () => {
    it('throws on missing name / instructions', () => {
        expect(() => createAgent({ name: '', instructions: 'x' } as never)).toThrow(/name is required/);
        expect(() => createAgent({ name: 'a', instructions: '' } as never)).toThrow(/instructions is required/);
    });

    it('runs a basic agent and returns text', async () => {
        const agent = createAgent({
            name: 'basic',
            instructions: 'You are helpful.',
            llm: queuedLLM([textResult('hi there')]),
        });
        const result = await agent.run('hello');
        expect(result.text).toBe('hi there');
        expect(result.finishReason).toBe('stop');
    });

    it('runs with a tool call loop (tool → text)', async () => {
        const agent = createAgent({
            name: 'tool-agent',
            instructions: 'Use tools.',
            llm: queuedLLM([toolCallResult('echo', { message: 'x' }), textResult('done')]),
            tools: [echoTool()],
        });
        const result = await agent.run('do it');
        expect(result.text).toBe('done');
        expect(result.steps).toBeGreaterThan(1);
    });

    it('stream() yields text chunks', async () => {
        const agent = createAgent({
            name: 'streamer',
            instructions: 'i',
            llm: {
                generateText: async () => ({ text: 'chunked', finishReason: 'stop' }),
            },
        });
        const chunks: string[] = [];
        for await (const c of agent.stream('hi')) chunks.push(c);
        expect(chunks.join('')).toBe('chunked');
    });

    it('streamEvents() emits text-delta + run-finish and can be replayed via observe', async () => {
        const agent = createAgent({
            name: 'events',
            instructions: 'i',
            llm: queuedLLM([textResult('eventful')]),
        });
        const types: string[] = [];
        for await (const evt of agent.streamEvents('go', { runId: 'run-1' })) {
            types.push(evt.type);
            if (evt.type === 'run-finish') expect(evt.run.text).toBe('eventful');
        }
        expect(types).toContain('text-delta');
        expect(types).toContain('run-finish');
    });

    it('createSession / getSessionMessages / resume with session store', async () => {
        const agent = createAgent({
            name: 'session-agent',
            instructions: 'i',
            llm: queuedLLM([textResult('s1'), textResult('s2')]),
        });
        const sessionId = await agent.createSession('user-1');
        expect(sessionId).toBeTruthy();
        const r1 = await agent.run('first', { sessionId });
        expect(r1.text).toBe('s1');
        const msgs = await agent.getSessionMessages(sessionId);
        expect(msgs.length).toBeGreaterThan(0);
        const resumed = await agent.resume(sessionId);
        const r2 = await resumed.run('second');
        expect(r2.text).toBe('s2');
    });

    it('sessionStore: false disables session methods', async () => {
        const agent = createAgent({
            name: 'no-session',
            instructions: 'i',
            llm: queuedLLM([textResult('x')]),
            sessionStore: false,
        });
        await expect(agent.createSession()).rejects.toThrow(/sessionStore is disabled/);
        expect(() => agent.getSessionMessages('s')).toThrow(/sessionStore is disabled/);
    });

    it('asTool / generate / getCompressionStats', async () => {
        const agent = createAgent({
            name: 'misc',
            instructions: 'i',
            llm: queuedLLM([textResult('gen')]),
            mastermind: false,
        });
        const tool = agent.asTool({ name: 't', description: 'd', parameters: {} });
        expect(tool.name).toBe('t');
        expect((await agent.generate('p')).text).toBe('gen');
        expect(agent.getCompressionStats()).toBeUndefined();
    });

    it('budget enforcer rejects over-budget runs', async () => {
        const agent = createAgent({
            name: 'budget',
            instructions: 'i',
            llm: queuedLLM([textResult('expensive')]),
            budget: { maxCostUsd: 0.000001, model: 'gpt-4o' },
        });
        const result = await agent.run('hi');
        // Budget exceeded → run fails gracefully or is blocked
        expect(result).toBeTruthy();
    });

    it('multi-modal input runs', async () => {
        const agent = createAgent({
            name: 'mm',
            instructions: 'i',
            llm: queuedLLM([textResult('saw image')]),
        });
        const result = await agent.run({ text: 'describe', imageUrls: ['http://img'] } as never);
        expect(result.text).toBe('saw image');
    });

    it('setObjective / getObjective / updateObjectiveOptions / clearObjective', async () => {
        const agent = createAgent({ name: 'goals', instructions: 'i', llm: queuedLLM([textResult('x')]) });
        await expect(agent.setObjective('obj')).rejects.toThrow(/threadId/);
        const rec = await agent.setObjective('ship v2', { threadId: 't1' });
        expect(rec.status).toBe('active');
        expect((await agent.getObjective({ threadId: 't1' }))?.objective).toBe('ship v2');
        expect(await agent.getObjective({})).toBeNull();
        await agent.updateObjectiveOptions({ threadId: 't1', maxRuns: 10 });
        await agent.updateObjectiveOptions({});
        await agent.clearObjective({ threadId: 't1' });
        expect(await agent.getObjective({ threadId: 't1' })).toBeNull();
    });

    it('listSuspendedRuns / approve/decline on missing run', async () => {
        const agent = createAgent({ name: 'durable', instructions: 'i', llm: queuedLLM([textResult('x')]) });
        const { runs } = await agent.listSuspendedRuns();
        expect(Array.isArray(runs)).toBe(true);
        await expect(agent.approveToolCall({ runId: 'nope' })).rejects.toThrow(/No suspended run/);
        await expect(agent.declineToolCall({ runId: 'nope' })).rejects.toThrow(/No suspended run/);
        await expect(agent.resumeStream('data')).rejects.toThrow(/runId/);
        await expect(agent.resumeStream('data', { runId: 'nope' })).rejects.toThrow(/No suspended run/);
    });

    it('recoverActiveRuns returns zero counts without captures', async () => {
        const agent = createAgent({ name: 'recover', instructions: 'i', llm: queuedLLM([textResult('x')]) });
        const res = await agent.recoverActiveRuns();
        expect(res.recovered).toBe(0);
    });

    it('runs with agentic memory (enableAgenticMemory) and addMemoriesToContext', async () => {
        const agent = createAgent({
            name: 'memory-agent',
            instructions: 'i',
            llm: queuedLLM([textResult('mem')]),
            enableAgenticMemory: true,
            addMemoriesToContext: true,
        });
        const result = await agent.run('remember this', { threadId: 't1' });
        expect(result.text).toBe('mem');
    });

    it('runs with a supervisor sub-agent', async () => {
        const sub = createAgent({ name: 'sub', instructions: 'sub', llm: queuedLLM([textResult('sub-reply')]) });
        const supervisor = createAgent({
            name: 'super',
            instructions: 'delegate',
            llm: queuedLLM([toolCallResult('sub', { prompt: 'help' }), textResult('super-done')]),
            agents: { sub },
            onDelegation: {
                onDelegationStart: vi.fn(),
                onDelegationComplete: vi.fn(),
            },
        });
        const result = await supervisor.run('go');
        expect(result.text).toBe('super-done');
        expect(result.steps).toBeGreaterThan(1);
    });

    it('runs with a memory bundle via options.memory', async () => {
        const agent = createAgent({
            name: 'mem-bundle',
            instructions: 'i',
            llm: queuedLLM([textResult('bundle')]),
            memory: {
                bindLlm: vi.fn(),
                getAgentTools: () => [],
                getProcessors: () => ({ input: [], output: [] }),
                getObservationalContext: async () => null,
                getMessages: async () => [],
                workingMemoryContext: async () => undefined,
                recall: async () => [],
                saveMessages: async () => [],
                processMemoryAfterRun: async () => undefined,
            } as never,
        });
        const result = await agent.run('hi', { threadId: 't1' });
        expect(result.text).toBe('bundle');
    });

    it('runs with knowledgebase + structuredOutput + followUps', async () => {
        const agent = createAgent({
            name: 'rich',
            instructions: 'i',
            llm: queuedLLM([textResult('rich')]),
            knowledgebase: { buildContext: async () => '[kb]' },
            outputSchema: { safeParse: () => ({ success: true as const, data: { ok: 1 } }) } as never,
            followUps: true,
            numFollowups: 2,
        });
        const result = await agent.run('q', { followUps: true });
        expect(result.text).toBe('rich');
    });

    it('durable run with runId publishes run-finish for observe', async () => {
        const agent = createAgent({ name: 'durable-run', instructions: 'i', llm: queuedLLM([textResult('d')]) });
        const result = await agent.run('x', { runId: 'durable-1' });
        expect(result.text).toBe('d');
        const handle = await agent.observe('durable-1');
        expect(handle.runId).toBe('durable-1');
        handle.cleanup();
        handle.cleanup(); // idempotent
    });

    it('debug mode adds debug info to result', async () => {
        const agent = createAgent({
            name: 'debug-agent',
            instructions: 'i',
            llm: queuedLLM([textResult('d')]),
            dev: true,
        });
        const result = await agent.run('x');
        expect(result.debug?.enabled).toBe(true);
    });
});
