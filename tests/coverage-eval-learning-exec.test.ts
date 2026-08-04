/**
 * Hermetic coverage for eval (metrics, extract-json), learning (curator,
 * in-memory-store, decision-log-store), and execution (state-machine gaps).
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import { extractJson } from '../src/eval/_extract-json.js';
import { MetricsCollectorImpl } from '../src/eval/metrics.js';
import { MetricType } from '../src/eval/obs-types.js';
import { spanToSample, replayDataset, diffResults, summarizeDiff, type DiffEntry, type ReplayResult } from '../src/eval/trace-dataset.js';
import type { EvalSample } from '../src/eval/dataset.js';
import { Curator } from '../src/learning/curator.js';
import { InMemoryUserProfileStore } from '../src/learning/in-memory-store.js';
import type { LearnedKnowledge, UserMemory } from '../src/learning/types.js';
import { AgentStateMachine, stateMachine } from '../src/execution/state-machine.js';

// ── eval/trace-dataset ──────────────────────────────────────────────────────

describe('eval/trace-dataset', () => {
    it('spanToSample maps span to sample', () => {
        const s = spanToSample({ id: 's1', name: 'run', input: 'in', output: 'out', startTime: 1, endTime: 2, metadata: { extra: 1 } });
        expect(s).toMatchObject({ id: 's1', input: 'in', expected: 'out', metadata: { source: 'trace', spanName: 'run', extra: 1 } });
    });

    it('replayDataset runs all samples with concurrency, handles string/object output', async () => {
        const samples: EvalSample[] = [
            { id: 'a', input: 'q1', expected: 'x' },
            { id: 'b', input: 'q2' },
        ];
        const results = await replayDataset(samples, async (input) => (input === 'q1' ? 'x' : { text: 'y' }), { concurrency: 1 });
        expect(results.length).toBe(2);
        expect(results[0]).toMatchObject({ sample: samples[0], output: 'x' });
        expect(results[1]!.output).toBe('y');
        expect(typeof results[0]!.durationMs).toBe('number');
    });

    it('replayDataset with zero samples and zero concurrency edge', async () => {
        const results = await replayDataset([], async () => 'x');
        expect(results).toEqual([]);
    });

    it('diffResults: mismatch throws; diff entries computed', () => {
        const base: ReplayResult[] = [
            { sample: { id: 'a', input: 'q', expected: 'x' }, output: 'x', durationMs: 1 },
            { sample: { id: 'b', input: 'q2' }, output: 'z', durationMs: 1 },
        ];
        const cand: ReplayResult[] = [
            { sample: base[0]!.sample, output: 'y', durationMs: 1 },
            { sample: base[1]!.sample, output: 'z', durationMs: 1 },
        ];
        const diffs = diffResults(base, cand);
        expect(diffs[0]).toMatchObject({ sampleId: 'a', unchanged: false, newMatchesExpected: false, baselineMatchesExpected: true });
        expect(diffs[1]).toMatchObject({ unchanged: true, newMatchesExpected: undefined, baselineMatchesExpected: undefined });
        expect(() => diffResults(base, cand.slice(0, 1))).toThrow(/same length/);
    });

    it('summarizeDiff counts unchanged/changed/regressions/improvements', () => {
        const diffs: DiffEntry[] = [
            { input: '1', baselineOutput: 'a', newOutput: 'a', unchanged: true },
            { input: '2', baselineOutput: 'a', newOutput: 'b', unchanged: false, baselineMatchesExpected: true, newMatchesExpected: false },
            { input: '3', baselineOutput: 'b', newOutput: 'a', unchanged: false, baselineMatchesExpected: false, newMatchesExpected: true },
            { input: '4', baselineOutput: 'c', newOutput: 'd', unchanged: false },
        ];
        expect(summarizeDiff(diffs)).toEqual({ total: 4, unchanged: 1, changed: 3, regressions: 1, improvements: 1 });
        expect(summarizeDiff([])).toEqual({ total: 0, unchanged: 0, changed: 0, regressions: 0, improvements: 0 });
    });
});

// ── eval/_extract-json ──────────────────────────────────────────────────────

describe('eval/extract-json', () => {
    it('parses plain JSON, markdown blocks, and extracts object/array', () => {
        expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
        expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
        expect(extractJson('prefix text {"a": 1} suffix')).toEqual({ a: 1 });
        expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3]);
        expect(extractJson('```\n[1, 2]\n```')).toEqual([1, 2]);
    });

    it('throws a helpful error on invalid JSON', () => {
        expect(() => extractJson('not json at all')).toThrow(/Failed to parse JSON/);
    });
});

// ── eval/metrics ────────────────────────────────────────────────────────────

describe('eval/metrics MetricsCollectorImpl', () => {
    it('records counters, histograms, and returns copies', () => {
        const c = new MetricsCollectorImpl();
        c.counter('runs', 2, { agent: 'a' });
        c.histogram('latency', 10, { agent: 'a' });
        const all = c.getMetrics();
        expect(all.length).toBe(2);
        expect(all[0]!.type).toBe(MetricType.COUNTER);
        expect(all[1]!.type).toBe(MetricType.HISTOGRAM);
        // copy semantics
        all.push({} as never);
        expect(c.getMetrics().length).toBe(2);
    });

    it('gauge updates in place (stable key regardless of label order)', () => {
        const c = new MetricsCollectorImpl();
        c.gauge('cpu', 1, { a: '1', b: '2' });
        c.gauge('cpu', 2, { b: '2', a: '1' });
        const gauges = c.getMetrics().filter((m) => m.type === MetricType.GAUGE);
        expect(gauges.length).toBe(1);
        expect(gauges[0]!.value).toBe(2);
    });

    it('getMetricsByName, getMetricsByType, getLatestValue, clear', async () => {
        const c = new MetricsCollectorImpl();
        c.counter('a', 1);
        c.counter('b', 5);
        c.gauge('a', 3);
        expect(c.getMetricsByName('a').length).toBe(2);
        expect(c.getMetricsByType(MetricType.GAUGE).length).toBe(1);
        // separate timestamps so ordering is deterministic
        await new Promise((r) => setTimeout(r, 5));
        c.gauge('a', 4);
        expect(c.getLatestValue('a')).toBe(4);
        expect(c.getLatestValue('zzz')).toBeUndefined();
        c.clear();
        expect(c.getMetrics().length).toBe(0);
    });

    it('caps metrics at MAX_METRICS and rebuilds gauge index', async () => {
        const c = new MetricsCollectorImpl();
        // MAX_METRICS is 50k; counter() is the only cap-guarded path.
        for (let i = 0; i < 50_010; i++) {
            c.counter(`c${i}`, i);
        }
        const metrics = c.getMetrics();
        expect(metrics.length).toBe(50_000);
        expect(metrics[0]!.name).toBe('c10'); // first 10 dropped (slice(-50k))

        // After compaction, gauge index is rebuilt — updating a gauge works.
        await new Promise((r) => setTimeout(r, 5));
        c.gauge('my-gauge', 5);
        c.gauge('my-gauge', 9);
        expect(c.getLatestValue('my-gauge')).toBe(9);
    });
});

// ── learning/curator ────────────────────────────────────────────────────────

describe('learning/curator', () => {
    const oldMemory = (days: number): UserMemory => ({
        userId: 'u1',
        memories: [
            { id: 'old1', content: 'alpha', createdAt: new Date(Date.now() - days * 86_400_000 * 2).toISOString() },
            { id: 'new1', content: 'beta', createdAt: new Date().toISOString() },
            { id: 'dup1', content: '  Beta ', createdAt: new Date().toISOString() },
        ],
    });

    it('curate prunes old + dedupes memories and prunes decision log', async () => {
        let saved: UserMemory | null = null;
        const userMemory = {
            get: vi.fn(async () => oldMemory(100)),
            set: vi.fn(async (m: UserMemory) => {
                saved = m;
                return m;
            }),
        };
        const decisionLog = { prune: vi.fn(async () => 7) };
        const curator = new Curator({ userMemory: userMemory as never, decisionLog: decisionLog as never });

        const result = await curator.curate({ userId: 'u1', agentId: 'a1', maxAgeDays: 90, deduplicateMemories: true });
        expect(result.decisionLogPruned).toBe(7);
        expect(result.userMemoryPruned).toBe(1); // old1 removed
        expect(result.userMemoryDeduplicated).toBe(1); // Beta dup removed
        expect(saved!.memories.map((m) => m.id)).toEqual(['dup1']); // keeps last occurrence
    });

    it('curate no-op paths: no stores, no user id, no memories', async () => {
        const curator = new Curator({});
        expect(await curator.curate()).toEqual({ userMemoryPruned: 0, decisionLogPruned: 0, userMemoryDeduplicated: 0 });

        const userMemory = { get: vi.fn(async () => null), set: vi.fn() };
        const c2 = new Curator({ userMemory: userMemory as never });
        expect((await c2.curate({ userId: 'u1' })).userMemoryPruned).toBe(0);
        expect(userMemory.set).not.toHaveBeenCalled();
    });

    it('deduplicateKnowledge removes duplicate titles, keeps unique, no-op without store', async () => {
        const knowledge: LearnedKnowledge[] = [
            { title: 'Alpha', learning: 'x', namespace: 'global' },
            { title: 'alpha', learning: 'y', namespace: 'global' },
            { title: 'Beta', learning: 'z', namespace: 'ns1' },
        ];
        const del = vi.fn(async () => true);
        const store = {
            search: vi.fn(async () => knowledge),
            delete: del,
        };
        const curator = new Curator({ learnedKnowledge: store as never });
        expect(await curator.deduplicateKnowledge('global')).toBe(1);
        expect(del).toHaveBeenCalledWith('alpha', 'global');

        expect(await new Curator({}).deduplicateKnowledge()).toBe(0);
    });
});

// ── learning/in-memory-store ────────────────────────────────────────────────

describe('learning/in-memory-user-profile-store', () => {
    it('CRUD + list with filters and limit', async () => {
        const s = new InMemoryUserProfileStore();
        const p1 = await s.set({ userId: 'u1', metadata: { plan: 'free' } });
        const p2 = await s.set({ userId: 'u2', agentId: 'a1', metadata: {} });
        await s.set({ userId: 'u2', agentId: 'a2', metadata: {} });

        expect(p1.id).toMatch(/^profile-/);
        expect((await s.get('u1'))!.userId).toBe('u1');
        expect(await s.get('missing')).toBeNull();
        expect((await s.get('u2', 'a1'))!.agentId).toBe('a1');

        // update existing
        const upd = await s.update('u1', { displayName: 'Bob' });
        expect(upd.displayName).toBe('Bob');
        expect(upd.id).toBe(p1.id);

        // update creates when missing
        const created = await s.update('u3', { displayName: 'New', metadata: { x: 1 } });
        expect(created.id).toMatch(/^profile-/);
        expect(created.displayName).toBe('New');

        // list filters + limit
        expect(await s.list({ userId: 'u2' })).toHaveLength(2);
        expect(await s.list({ agentId: 'a1' })).toHaveLength(1);
        expect(await s.list({ limit: 1 })).toHaveLength(1);

        expect(await s.delete('u3')).toBe(true);
        expect(await s.delete('u3')).toBe(false);
        expect(await s.get('u3')).toBeNull();
    });
});

// ── execution/state-machine gaps ────────────────────────────────────────────

describe('execution/state-machine gaps', () => {
    type Ev = { type: 'GO' | 'NOPE' };
    it('send returns false when no transitions / no matching event', async () => {
        const sm = new AgentStateMachine<{ n: number }, Ev>({ idle: {} }, { initial: 'idle', context: { n: 0 } });
        await expect(sm.send({ type: 'GO' })).resolves.toBe(false);
        const sm2 = new AgentStateMachine<{ n: number }, Ev>(
            { idle: { transitions: { GO: 'planning' } }, planning: {} },
            { initial: 'idle', context: { n: 0 } },
        );
        await expect(sm2.send({ type: 'NOPE' })).resolves.toBe(false);
    });

    it('jumpTo runs onExit/onEntry and stateMachine() helper constructs', async () => {
        const trace: string[] = [];
        const sm = stateMachine<{ t: string[] }, Ev>(
            {
                idle: { onExit: (c) => c.t.push('idle:exit') },
                planning: { onEntry: (c) => c.t.push('planning:entry') },
            },
            { initial: 'idle', context: { t: trace } },
        );
        await sm.jumpTo('planning');
        expect(trace).toEqual(['idle:exit', 'planning:entry']);
        expect(sm.currentState).toBe('planning');
    });
});
