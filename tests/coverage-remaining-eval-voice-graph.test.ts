/**
 * Hermetic coverage for eval/dataset, eval/regression, voice/stream, graph/testing.
 * tests include glob: tests/coverage-remaining-*.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDataset } from '../src/eval/dataset.js';
import { runRegression, printRegressionReport } from '../src/eval/regression.js';
import { VoiceStreamSession } from '../src/voice/stream.js';
import type { VoiceProvider } from '../src/voice/voice-provider.js';
import {
    createMockLLMProvider,
    createTestRunner,
    expectEventSequence,
    assertExactEventSequence,
} from '../src/graph/testing/graph-runner.js';
import { GraphBuilder } from '../src/graph/builder.js';
import { GraphEventType, ExecutionStatus } from '../src/graph/types.js';

describe('loadDataset', () => {
    it('parses raw JSON array, JSONL, CSV, and file path', async () => {
        const arr = await loadDataset({
            raw: true,
            source: JSON.stringify([
                { id: '1', input: 'q', expected: 'a' },
                { question: 'q2', answer: 'a2' },
            ]),
        });
        expect(arr).toHaveLength(2);
        expect(arr[0]!.expected).toBe('a');
        expect(arr[1]!.input).toBe('q2');

        const jsonl = await loadDataset({
            raw: true,
            source: '{"prompt":"p1","answer":"a1"}\n{"input":"p2","expected":"a2"}\n',
        });
        expect(jsonl).toHaveLength(2);

        const csv = await loadDataset({
            raw: true,
            source: 'input,expected\n"hello","world"\nfoo,bar\n',
        });
        expect(csv[0]!.input).toBe('hello');
        expect(csv[1]!.expected).toBe('bar');

        expect(await loadDataset({ raw: true, source: 'input\n' })).toEqual([]);
        await expect(
            loadDataset({ raw: true, source: 'x,y\n1,2\n', inputColumn: 'missing' }),
        ).rejects.toThrow(/column/);

        const dir = mkdtempSync(join(tmpdir(), 'ds-'));
        try {
            const path = join(dir, 'd.json');
            writeFileSync(path, '[{"input":"from-file","expected":"ok"}]');
            const fromFile = await loadDataset({ source: path });
            expect(fromFile[0]!.input).toBe('from-file');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('runRegression + printRegressionReport', () => {
    it('scores batches, baseline deltas, and prints report', async () => {
        const report = await runRegression({
            samples: [
                { id: '1', input: 'a', expected: 'a' },
                { id: '2', input: 'b', expected: 'x' },
                { id: '3', input: 'c', expected: 'c' },
            ],
            run: async (input) => input,
            score: (c, e) => (c === e ? 1 : 0),
            threshold: 0.5,
            concurrency: 2,
            baseline: { meanScore: 0.9, passRate: 0.9 },
            regressionTolerance: 0.05,
        });
        expect(report.totalSamples).toBe(3);
        expect(report.passed).toBe(2);
        expect(report.failed).toBe(1);
        expect(report.baselineRegression).toBe(true);
        expect(report.baselineDelta?.meanScore).toBeDefined();

        const ok = await runRegression({
            samples: [{ input: 'z', expected: 'z' }],
            run: async (i) => i,
            score: () => 1,
            baseline: { meanScore: 0.5, passRate: 0.5 },
        });
        expect(ok.baselineRegression).toBe(false);

        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        printRegressionReport(report);
        printRegressionReport(ok);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('VoiceStreamSession', () => {
    function makeVoice(opts?: { sttFail?: boolean; ttsFail?: boolean; empty?: boolean }): VoiceProvider {
        return {
            name: 'mock',
            async textToSpeech(text: string) {
                if (opts?.ttsFail) throw new Error('tts');
                const audio = new TextEncoder().encode(text).buffer;
                return { audio, format: 'mp3' as const };
            },
            async speechToText(_audio: ArrayBuffer) {
                if (opts?.sttFail) throw new Error('stt');
                if (opts?.empty) return { text: '   ' };
                return { text: 'hello world' };
            },
        } as VoiceProvider;
    }

    it('processes utterance through STT → agent → TTS and drains events', async () => {
        const session = new VoiceStreamSession({
            stt: makeVoice(),
            tts: makeVoice(),
            run: async (t) => `reply:${t}`,
            silenceThresholdMs: 20,
            voiceId: 'nova',
            sessionId: 'vs-1',
        });

        const collected: string[] = [];
        const drain = (async () => {
            for await (const ev of session.events()) {
                collected.push(ev.type);
            }
        })();

        session.pushChunk(new Uint8Array([1, 2, 3]));
        session.pushChunk(new ArrayBuffer(2));
        await new Promise((r) => setTimeout(r, 40));
        await session.end();
        session.pushChunk(new Uint8Array([9]));
        await drain;

        expect(collected).toContain('transcript');
        expect(collected).toContain('agent_start');
        expect(collected).toContain('text_delta');
        expect(collected).toContain('agent_end');
        expect(collected).toContain('audio');
    });

    it('emits STT/agent/TTS errors', async () => {
        const sttFail = new VoiceStreamSession({
            stt: makeVoice({ sttFail: true }),
            tts: makeVoice(),
            run: async () => 'x',
            silenceThresholdMs: 5,
        });
        const events1: string[] = [];
        const d1 = (async () => {
            for await (const ev of sttFail.events()) events1.push(ev.type + ':' + (ev.error ?? ''));
        })();
        sttFail.pushChunk(new Uint8Array([1]));
        await new Promise((r) => setTimeout(r, 15));
        await sttFail.end();
        await d1;
        expect(events1.some((e) => e.startsWith('error:STT'))).toBe(true);

        const agentFail = new VoiceStreamSession({
            stt: makeVoice(),
            tts: makeVoice(),
            run: async () => {
                throw new Error('agent');
            },
            silenceThresholdMs: 5,
        });
        const events2: string[] = [];
        const d2 = (async () => {
            for await (const ev of agentFail.events()) events2.push(ev.type + ':' + (ev.error ?? ''));
        })();
        agentFail.pushChunk(new Uint8Array([1]));
        await new Promise((r) => setTimeout(r, 15));
        await agentFail.end();
        await d2;
        expect(events2.some((e) => e.startsWith('error:Agent'))).toBe(true);

        const ttsFail = new VoiceStreamSession({
            stt: makeVoice(),
            tts: makeVoice({ ttsFail: true }),
            run: async () => 'ok',
            silenceThresholdMs: 5,
        });
        const events3: string[] = [];
        const d3 = (async () => {
            for await (const ev of ttsFail.events()) events3.push(ev.type + ':' + (ev.error ?? ''));
        })();
        ttsFail.pushChunk(new Uint8Array([1]));
        await new Promise((r) => setTimeout(r, 15));
        await ttsFail.end();
        await d3;
        expect(events3.some((e) => e.startsWith('error:TTS'))).toBe(true);

        const empty = new VoiceStreamSession({
            stt: makeVoice({ empty: true }),
            tts: makeVoice(),
            run: async () => 'x',
            silenceThresholdMs: 5,
        });
        const events4: string[] = [];
        const d4 = (async () => {
            for await (const ev of empty.events()) events4.push(ev.type);
        })();
        empty.pushChunk(new Uint8Array([1]));
        await new Promise((r) => setTimeout(r, 15));
        await empty.end();
        await d4;
        expect(events4).not.toContain('transcript');
    });
});

describe('graph/testing/graph-runner', () => {
    it('mock LLM, test runner, and event sequence helpers', async () => {
        expect(() => createMockLLMProvider('x', [])).toThrow(/empty/);
        const llm = createMockLLMProvider('mock', [
            { content: 'a', toolCalls: [{ id: '1', name: 't', arguments: {} }] },
            { content: 'b' },
        ]);
        const r1 = await llm.generate([{ role: 'user', content: 'q' }]);
        expect(r1.finishReason).toBe('tool_calls');
        const r2 = await llm.generate([{ role: 'user', content: 'q' }]);
        expect(r2.content).toBe('b');
        const r3 = await llm.generate([{ role: 'user', content: 'q' }]);
        expect(r3.content).toBe('b');

        const graph = new GraphBuilder('t')
            .addNode('n1', {
                kind: 'task',
                execute: async () => ({ ok: true }),
            })
            .build();

        const runner = createTestRunner({ maxConcurrency: 2 });
        const result = await runner.run(graph, { seed: 1 });
        expect(result.status).toBe(ExecutionStatus.COMPLETED);
        expect(result.eventStore).toBeDefined();
        expectEventSequence(result.eventTypes, [
            GraphEventType.EXECUTION_STARTED,
            GraphEventType.EXECUTION_COMPLETED,
        ]);

        expect(() =>
            expectEventSequence([GraphEventType.EXECUTION_STARTED], [
                GraphEventType.EXECUTION_STARTED,
                GraphEventType.EXECUTION_COMPLETED,
            ]),
        ).toThrow(/could not find/);

        assertExactEventSequence(['a', 'b'], ['a', 'b']);
        expect(() => assertExactEventSequence(['a'], ['a', 'b'])).toThrow(/length mismatch/);
        expect(() => assertExactEventSequence(['a', 'x'], ['a', 'b'])).toThrow(/mismatch at index/);
    });
});
