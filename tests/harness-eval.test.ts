/**
 * Tests for the evaluation harness engine:
 * toHarnessRunner/fromAgent/fromTask/fromWorkflow/fromFn and evaluate().
 */

import { describe, it, expect, vi } from 'vitest';
import {
    toHarnessRunner,
    fromAgent,
    fromTask,
    fromWorkflow,
    fromFn,
    evaluate,
    formatHarnessReport,
} from '../src/harness/index.js';
import { exactMatchScorer, wordOverlapScorer } from '../src/eval/benchmark.js';
import { task } from '../src/dx/task.js';

const DATASET = [
    { id: '1', input: 'what is 2+2?', expected: '4' },
    { id: '2', input: 'capital of france', expected: 'paris' },
];

// ── toHarnessRunner / factories ─────────────────────────────────────────────

describe('toHarnessRunner()', () => {
    it('normalises a plain function subject', async () => {
        const runner = toHarnessRunner(async (q: string) => `fn:${q}`);
        const outcome = await runner('hi');
        expect(outcome.output).toBe('fn:hi');
        expect(outcome.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('extracts text + tokens from an agent-like subject', async () => {
        const agentLike = {
            run: vi.fn().mockResolvedValue({
                text: 'A:done',
                steps: 2,
                usage: { totalTokens: 7 },
            }),
        };
        const runner = toHarnessRunner(agentLike);
        const outcome = await runner('go');
        expect(outcome.output).toBe('A:done');
        expect(outcome.tokensUsed).toBe(7);
        expect(agentLike.run).toHaveBeenCalledWith('go', undefined);
    });

    it('forwards sessionId to agent-like subjects', async () => {
        const agentLike = { run: vi.fn().mockResolvedValue({ text: 'ok' }) };
        await toHarnessRunner(agentLike, { sessionId: 'sess-1' })('x');
        expect(agentLike.run).toHaveBeenCalledWith('x', { sessionId: 'sess-1' });
    });

    it('normalises a workflow-like subject by JSON-stringifying results', async () => {
        const wfLike = {
            execute: vi.fn().mockResolvedValue({ status: 'completed', results: { answer: 'wf' } }),
        };
        const outcome = await toHarnessRunner(wfLike)('q');
        expect(wfLike.execute).toHaveBeenCalledWith({ input: 'q' });
        expect(outcome.output).toContain('"answer":"wf"');
    });

    it('normalises a task() handle', async () => {
        const t = task({
            name: 't',
            run: async (q: unknown) => (typeof q === 'string' ? `T:${q}` : JSON.stringify(q)),
        });
        const outcome = await toHarnessRunner(t)('go');
        expect(outcome.output).toBe('T:go');
    });

    it('extracts cost via costOf option', async () => {
        const runner = toHarnessRunner(
            { run: async () => ({ text: 'x' }) },
            { costOf: (raw) => (raw as { text: string }).text === 'x' ? 1.5 : 0 },
        );
        const outcome = await runner('1');
        expect(outcome.costUsd).toBe(1.5);
    });

    it('rejects unsupported subjects with a helpful error', async () => {
        expect(() => toHarnessRunner({ nope: 1 } as never)).toThrow(/unsupported subject/);
    });

    it('factory aliases behave like toHarnessRunner', async () => {
        const agentLike = { run: async () => ({ text: 'A' }) };
        const wfLike = { execute: async () => ({ status: 'completed', results: {} }) };
        expect((await fromAgent(agentLike)('1')).output).toBe('A');
        expect(fromWorkflow(wfLike)).toBeTypeOf('function');
        expect(fromFn((q: string) => `f:${q}`)).toBeTypeOf('function');
        expect(fromTask({ run: async (q) => `t:${String(q)}` })).toBeTypeOf('function');
    });
});

// ── evaluate() — single subject ─────────────────────────────────────────────

describe('evaluate() — single subject', () => {
    it('scores a dataset and reports pass rate + markdown/JSON', async () => {
        const report = await evaluate({
            name: 'qa',
            dataset: DATASET,
            subject: async (input: string) => (input.includes('2+2') ? '4' : 'paris'),
            scorers: [exactMatchScorer()],
        });

        expect(report.variants).toHaveLength(1);
        expect(report.variants[0]!.variant).toBe('default');
        expect(report.variants[0]!.benchmark.summary.passRate).toBe(1);
        expect(report.passes).toBe(true);
        expect(report.comparison).toHaveLength(0);

        const json = report.toJSON();
        expect(JSON.parse(JSON.stringify(json))).toEqual(json as unknown as object);
        expect(json.variants[0]!.samples).toHaveLength(2);

        const md = report.formatMarkdown();
        expect(md).toContain('# Harness: qa');
        expect(md).toContain('default');
    });

    it('marks failures below the pass threshold', async () => {
        const report = await evaluate({
            name: 'bad',
            dataset: DATASET,
            subject: async () => 'wrong answer',
            scorers: [exactMatchScorer()],
            passThreshold: 0.7,
        });
        expect(report.passes).toBe(false);
        expect(report.variants[0]!.benchmark.summary.passRate).toBe(0);
    });

    it('aggregates token/cost usage reported by the subject', async () => {
        const report = await evaluate({
            name: 'usage',
            dataset: DATASET,
            subject: {
                run: async () => ({ text: '4', usage: { totalTokens: 10 } }),
            },
            scorers: [exactMatchScorer()],
            costOf: () => 0.25,
        });

        expect(report.variants[0]!.usage.totalTokens).toBe(20);
        expect(report.variants[0]!.usage.avgTokensPerSample).toBe(10);
        expect(report.variants[0]!.usage.totalCostUsd).toBeCloseTo(0.5, 5);
    });

    it('invokes onSample per sample with the variant name', async () => {
        const spy = vi.fn();
        await evaluate({
            name: 'progress',
            dataset: DATASET,
            subject: async (q) => q,
            scorers: [wordOverlapScorer()],
            onSample: spy,
        });
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy).toHaveBeenCalledWith('default', expect.any(Object), expect.any(Number), 2);
    });
});

// ── evaluate() — A/B / model comparison ─────────────────────────────────────

describe('evaluate() — A/B and comparison', () => {
    it('compares variants and picks a winner per metric', async () => {
        const report = await evaluate({
            name: 'ab',
            dataset: DATASET,
            subject: {
                good: async (input: string) => (input.includes('2+2') ? '4' : 'paris'),
                bad: async () => 'nope',
            },
            scorers: [exactMatchScorer()],
            concurrency: 2,
        });

        expect(report.variants).toHaveLength(2);
        expect(report.variants.map((v) => v.variant).sort()).toEqual(['bad', 'good']);

        const score = report.comparison.find((c) => c.metric === 'score');
        expect(score?.winner).toBe('good');
        expect(score?.values['good']).toBe(1);

        expect(report.passes).toBe(false); // "bad" variant fails

        const md = formatHarnessReport(report);
        expect(md).toContain('Head-to-head');
        expect(md).toContain('| score | good |');
    });

    it('ranks the cheapest/fastest winner for tokens and cost', async () => {
        const report = await evaluate({
            name: 'cost-ab',
            dataset: DATASET,
            subject: {
                expensive: {
                    run: async () => ({ text: '4', usage: { totalTokens: 100 } }),
                },
                cheap: {
                    run: async () => ({ text: '4', usage: { totalTokens: 5 } }),
                },
            },
            scorers: [exactMatchScorer()],
            costOf: () => 0.01,
        });

        const tokens = report.comparison.find((c) => c.metric === 'tokens');
        expect(tokens?.winner).toBe('cheap');
    });

    it('restricts evaluation to selected variants via only', async () => {
        const report = await evaluate({
            name: 'only',
            dataset: DATASET,
            subject: {
                a: async () => '4',
                b: async () => 'paris',
            },
            scorers: [exactMatchScorer()],
            only: ['a'],
        });
        expect(report.variants).toHaveLength(1);
        expect(report.variants[0]!.variant).toBe('a');
    });

    it('throws when no variants are selected', async () => {
        await expect(
            evaluate({
                name: 'none',
                dataset: DATASET,
                subject: { a: async () => 'x' },
                only: ['missing'],
            }),
        ).rejects.toThrow(/no variants selected/);
    });
});
