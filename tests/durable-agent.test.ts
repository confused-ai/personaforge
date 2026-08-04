/**
 * Hermetic unit tests for the durable agent layer (src/durable).
 *
 * Uses a fake `CreateAgentResult` whose `streamEvents` replays a scripted
 * sequence of `StreamChunk`s, so no network or LLM is involved.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AgentRunResult, CreateAgentResult, StreamChunk } from '../src/create-agent/types.js';
import { createDurableAgent, DurableAgent, durableRunId } from '@personaforge/durable';
import { InMemoryServerCache } from '@personaforge/durable';
import { InMemorySuspendedRunStore, type SuspendedRun } from '@personaforge/approval';

// ── Helpers ──────────────────────────────────────────────────────────────────

const md = (text: string) => ({ name: 'answer.md', content: text, mimeType: 'text/markdown', type: 'markdown' } as const);

function makeResult(partial: Partial<AgentRunResult> = {}): AgentRunResult {
    return {
        text: '',
        markdown: md(''),
        messages: [],
        steps: 1,
        finishReason: 'stop',
        ...partial,
    };
}

interface ScriptedAgent {
    agent: CreateAgentResult;
    /** Push the next streamEvents response (array of chunks). */
    push(chunks: StreamChunk[]): void;
    /** Number of times streamEvents has been called. */
    calls: number;
}

function makeScriptedAgent(): ScriptedAgent {
    const queue: StreamChunk[][] = [];
    const calls = { count: 0 };
    const agent = {
        name: 'scripted',
        instructions: 'test',
        createSession: vi.fn(async () => 'sess'),
        getSessionMessages: vi.fn(async () => []),
        getCompressionStats: () => undefined,
        resume: () => ({ run: async () => makeResult(), stream: (async function* () {})(), streamEvents: (async function* () {})() }),
        run: vi.fn(async () => makeResult()),
        stream: vi.fn(async function* () {}),
        streamEvents: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
            calls.count++;
            const chunks = queue.shift() ?? [];
            for (const c of chunks) yield c;
        }),
    };
    return {
        agent: agent as unknown as CreateAgentResult,
        push: (chunks) => queue.push(chunks),
        get calls() {
            return calls.count;
        },
    };
}

const done = (partial: Partial<AgentRunResult> = {}): StreamChunk => ({
    type: 'run-finish',
    run: makeResult({ text: 'final', ...partial }),
});
const delta = (text: string): StreamChunk => ({ type: 'text-delta', delta: text });
const errChunk = (message: string): StreamChunk => ({ type: 'error', error: new Error(message) });
const suspended = (toolCallId: string, toolName: string): StreamChunk => ({
    type: 'run-finish',
    run: makeResult({
        text: '',
        finishReason: 'suspended',
        suspendPayload: { toolCallId, toolName, args: { q: 1 }, requiresApproval: true },
    }),
});

function makeDurable(scripted: ScriptedAgent, cache = new InMemoryServerCache(), suspendedStore = new InMemorySuspendedRunStore()) {
    return createDurableAgent({ agent: scripted.agent, cache, suspendedStore });
}

// ── Streams ──────────────────────────────────────────────────────────────────

describe('durable agent streams', () => {
    it('fullStream and textStream are independently consumable (regression for shared generator)', async () => {
        const scripted = makeScriptedAgent();
        scripted.push([delta('Hello '), delta('world'), done({ text: 'Hello world' })]);
        const durable = makeDurable(scripted);
        const { runId, output } = await durable.stream('hi');

        // Consume textStream first — with the old shared generator this would
        // drain fullStream.
        const text = [];
        for await (const t of output.textStream) text.push(t);
        expect(text.join('')).toBe('Hello world');

        // fullStream must still yield every event (text deltas + run-finish).
        const events = [];
        for await (const e of output.fullStream) events.push(e);
        expect(events.filter((e) => e.type === 'text-delta').map((e) => e.delta)).toEqual(['Hello ', 'world']);
        expect(events.some((e) => e.type === 'run-finish')).toBe(true);

        // The run result resolves too.
        const result = await output.runResult;
        expect(result.text).toBe('Hello world');
        expect(runId).toMatch(/^run_/);
    });

    it('replays cached events for a late observer', async () => {
        const cache = new InMemoryServerCache();
        const scripted = makeScriptedAgent();
        scripted.push([delta('a'), done({ text: 'a' })]);
        const durable = makeDurable(scripted, cache);
        const { runId, output } = await durable.stream('x');
        await output.runResult;

        // A fresh DurableAgent sharing the same cache can observe the run and
        // replay its events even though the run handle is gone from this one.
        const observer = makeDurable(makeScriptedAgent(), cache);
        const { output: observed } = await observer.observe(runId);
        const events = [];
        for await (const e of observed.fullStream) events.push(e);
        expect(events.some((e) => e.type === 'run-finish')).toBe(true);
    });

    it('registryOutput exposes both streams independently', async () => {
        const { DurableRunRegistry, registryOutput } = await import('@personaforge/durable');
        const cache = new InMemoryServerCache();
        const registry = new DurableRunRegistry(cache);
        const runId = 'run-reg';
        const handle = registry.create({ runId, input: 'x' });
        await registry.publish(runId, delta('one'));
        await registry.publish(runId, delta('two'));
        await registry.publish(runId, done({ text: 'onetwo' }));
        // Mark the run terminal so the event iterators terminate.
        handle.closed = true;
        handle.notify();

        const output = registryOutput(registry, runId, Promise.resolve(makeResult({ text: 'onetwo' })));
        const text = [];
        for await (const t of output.textStream) text.push(t);
        expect(text.join('')).toBe('onetwo');
        const events = [];
        for await (const e of output.fullStream) events.push(e);
        expect(events).toHaveLength(3);
    });
});

// ── Error propagation ────────────────────────────────────────────────────────

describe('durable agent errors', () => {
    it('continuation runResult rejects with the real error (regression for _rejectContinuations)', async () => {
        const scripted = makeScriptedAgent();
        scripted.push([errChunk('boom')]);
        const durable = makeDurable(scripted);
        const { output } = await durable.stream('x');
        await expect(output.runResult).rejects.toThrow('boom');
    });

    it('a stream that throws mid-iteration rejects the runResult', async () => {
        const queue: StreamChunk[][] = [];
        const agent = {
            name: 'throwing',
            instructions: 'test',
            createSession: async () => 's',
            getSessionMessages: async () => [],
            getCompressionStats: () => undefined,
            resume: () => ({ run: async () => makeResult(), stream: (async function* () {})(), streamEvents: (async function* () {})() }),
            run: async () => makeResult(),
            stream: async function* () {},
            streamEvents: async function* () {
                yield delta('partial');
                throw new Error('mid-stream failure');
            },
        };
        const durable = makeDurable({ agent: agent as unknown as CreateAgentResult, push: () => {}, get calls() { return 0; } });
        void queue;
        const { output } = await durable.stream('x');
        await expect(output.runResult).rejects.toThrow('mid-stream failure');
    });
});

// ── Suspend / approve / decline / resume ─────────────────────────────────────

describe('durable agent approval + resume', () => {
    it('suspends, approves, and replays to completion', async () => {
        const scripted = makeScriptedAgent();
        // Call 1: run → suspended. Call 2 (approval replay): run → done.
        scripted.push([delta('thinking'), suspended('call-1', 'check')]);
        scripted.push([delta('approved!'), done({ text: 'approved!' })]);
        const suspendedStore = new InMemorySuspendedRunStore();
        const durable = makeDurable(scripted, new InMemoryServerCache(), suspendedStore);

        const { runId, output } = await durable.stream('do it');
        const result = await output.runResult;
        expect(result.finishReason).toBe('suspended');
        expect(result.suspendPayload?.toolCallId).toBe('call-1');

        const pending = await durable.listSuspendedRuns();
        expect(pending.runs).toHaveLength(1);
        expect(pending.runs[0].status).toBe('approval');
        expect(pending.runs[0].toolCalls[0].toolCallId).toBe('call-1');

        const { output: approvedOutput } = await durable.approveToolCall({ runId, toolCallId: 'call-1' });
        const approvedResult = await approvedOutput.runResult;
        expect(approvedResult.text).toBe('approved!');
        expect(scripted.calls).toBe(2);
    });

    it('decline marks the tool call rejected and completes the replay', async () => {
        const scripted = makeScriptedAgent();
        scripted.push([suspended('call-1', 'check')]);
        scripted.push([delta('declined'), done({ text: 'declined' })]);
        const durable = makeDurable(scripted);
        const { runId, output } = await durable.stream('x');
        await output.runResult;

        const { output: declinedOutput } = await durable.declineToolCall({ runId, toolCallId: 'call-1' });
        const result = await declinedOutput.runResult;
        expect(result.text).toBe('declined');
    });

    it('resumeStream resumes a self-suspended tool with resume data', async () => {
        const scripted = makeScriptedAgent();
        scripted.push([suspended('call-9', 'ask')]);
        scripted.push([delta('resumed'), done({ text: 'resumed' })]);
        const durable = makeDurable(scripted);
        const { runId, output } = await durable.stream('x');
        await output.runResult;

        const { output: resumedOutput } = await durable.resumeStream('data', { runId, toolCallId: 'call-9' });
        const result = await resumedOutput.runResult;
        expect(result.text).toBe('resumed');
    });

    it('throws on approve/decline for an unknown run', async () => {
        const durable = makeDurable(makeScriptedAgent());
        await expect(durable.approveToolCall({ runId: 'nope' })).rejects.toThrow(/No suspended run found/);
    });
});

// ── Recovery + cache ─────────────────────────────────────────────────────────

describe('durable agent recovery + cache', () => {
    it('recoverActiveRuns re-drives a still-running run', async () => {
        const scripted = makeScriptedAgent();
        // First streamEvents call stays "in flight" (never yields a terminal
        // chunk) so the run stays in `running` status; the recovery replay is
        // the second call, which completes.
        scripted.push([delta('in progress')]);
        scripted.push([done({ text: 'recovered' })]);
        const durable = makeDurable(scripted);
        const { runId, output } = await durable.stream('x');

        const res = await durable.recoverActiveRuns({ runId });
        expect(res.recovered).toBe(1);
        const recoveredResult = await output.runResult;
        expect(recoveredResult.text).toBe('recovered');
    });

    it('InMemoryServerCache stores, expires, deletes, and scans', async () => {
        const cache = new InMemoryServerCache();
        await cache.set('a', '1', 1);
        await cache.set('b', '2');
        expect(await cache.get('a')).toBe('1');
        expect(await cache.get('b')).toBe('2');
        expect(await cache.scanKeys('a')).toEqual(['a']);
        await cache.delete('a');
        expect(await cache.get('a')).toBeNull();
    });

    it('durableRunId() is unique', () => {
        expect(durableRunId()).not.toBe(durableRunId());
    });
});
