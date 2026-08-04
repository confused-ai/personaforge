/**
 * Tests for the continuous improvement subsystem (src/learning/improvement):
 * feedback, rewards, metrics, scoring, bandits, versioned policies (any-DB),
 * automatic optimization, the adaptive pipeline, sources and the improvement loop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    // feedback
    InMemoryFeedbackRepo,
    SqliteFeedbackRepo,
    DbFeedbackRepo,
    DbPolicyStore,
    createExecutionSignal,
    // rewards
    clamp01,
    tokenContainment,
    exactMatchReward,
    includesReward,
    similarityReward,
    successReward,
    ratingReward,
    latencyReward,
    costReward,
    stepsReward,
    metricReward,
    composeReward,
    compositeReward,
    // metrics
    exactMatchMetric,
    includesMetric,
    containmentMetric,
    f1Metric,
    similarityMetric,
    successMetric,
    latencyBudgetMetric,
    costBudgetMetric,
    stepsBudgetMetric,
    scoreEvaluation,
    meanEvaluationScore,
    tokenF1,
    levenshteinSimilarity,
    DEFAULT_METRICS,
    // scoring
    scoreFeedback,
    feedbackQuality,
    scoreAgent,
    performanceDelta,
    performanceTrend,
    // bandit
    BanditSelector,
    // policy
    InMemoryPolicyStore,
    SqlitePolicyStore,
    // optimizers
    suggestOptimizations,
    ALL_DOMAINS,
    OptimizationDomain,
    // pipeline
    LearningPipeline,
    contentHash,
    mulberry32,
    seededShuffle,
    // sources
    toLearningExamples,
    toFineTuneJsonl,
    examplesFromSimulation,
    examplesFromEval,
    fromProductionFeedback,
    enrichWithAiCritique,
    // stores factory
    createFeedbackRepo,
    createPolicyStore,
    createImprovementStores,
    resolveBackend,
    // loop
    ImprovementLoop,
} from '@personaforge/learning';
import type {
    ExecutionFeedback,
    ExecutionSignal,
    PipelineRun,
    PolicyStore,
    PolicyVariant,
} from '@personaforge/learning';
import { InMemoryAgentDb } from '@personaforge/db';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function signal(partial: Partial<ExecutionSignal> & { id?: string }): ExecutionSignal {
    return createExecutionSignal({
        id: partial.id ?? crypto.randomUUID(),
        runId: partial.runId,
        agentId: partial.agentId,
        taskType: partial.taskType,
        model: partial.model,
        prompt: partial.prompt,
        output: partial.output,
        expected: partial.expected,
        passed: partial.passed,
        steps: partial.steps,
        latencyMs: partial.latencyMs,
        costUsd: partial.costUsd,
        toolCalls: partial.toolCalls,
        memoryUsed: partial.memoryUsed,
    });
}

function fb(partial: Partial<ExecutionFeedback> & { runId: string }): ExecutionFeedback {
    return {
        id: crypto.randomUUID(),
        agentId: partial.agentId ?? 'agent-a',
        runId: partial.runId,
        source: partial.source ?? 'human',
        signal: partial.signal,
        score: partial.score,
        reward: partial.reward,
        rating: partial.rating,
        comment: partial.comment,
        createdAt: partial.createdAt ?? new Date().toISOString(),
    };
}

/** Standard mixed dataset: 5 strong passing runs + 5 failing runs (quality mix). */
function mixedRuns(): ExecutionFeedback[] {
    const passing: ExecutionFeedback[] = Array.from({ length: 5 }, (_, i) =>
        fb({
            runId: `ok-${i}`,
            signal: signal({
                runId: `ok-${i}`, taskType: 'qa', model: 'm1', passed: true,
                prompt: `question ${i}`, output: `answer ${i}`, expected: `answer ${i}`,
                latencyMs: 100, costUsd: 0.001, steps: 2,
            }),
        }));
    const failing: ExecutionFeedback[] = Array.from({ length: 5 }, (_, i) =>
        fb({
            runId: `bad-${i}`,
            signal: signal({
                runId: `bad-${i}`, taskType: 'qa', model: 'm1', passed: false,
                prompt: `question ${i}`, output: 'wrong', expected: `answer ${i}`,
                latencyMs: 500, costUsd: 0.005, steps: 6,
            }),
        }));
    return [...passing, ...failing];
}

// ── Reward functions ──────────────────────────────────────────────────────────

describe('reward functions', () => {
    it('exactMatchReward returns 1/0', () => {
        expect(exactMatchReward({ expected: 'Yes', actual: ' yes ' })).toBe(1);
        expect(exactMatchReward({ expected: 'Yes', actual: 'No' })).toBe(0);
    });

    it('includesReward and similarityReward', () => {
        expect(includesReward({ expected: 'Paris', actual: 'The capital is Paris.' })).toBe(1);
        expect(similarityReward({ expected: 'hello world foo', actual: 'hello world baz' })).toBeGreaterThan(0);
        expect(similarityReward({ expected: 'hello world foo', actual: 'hello world foo' })).toBe(1);
    });

    it('successReward uses the pass/fail signal', () => {
        expect(successReward({ passed: true })).toBe(1);
        expect(successReward({ passed: false })).toBe(0);
    });

    it('ratingReward maps thumbs to 0/0.5/1', () => {
        expect(ratingReward({ metrics: { rating: 1 } })).toBe(1);
        expect(ratingReward({ metrics: { rating: 0 } })).toBe(0.5);
        expect(ratingReward({ metrics: { rating: -1 } })).toBe(0);
    });

    it('latency/cost/steps rewards are clamped budgets', () => {
        expect(latencyReward(1000)({ signal: signal({ latencyMs: 500 }) })).toBe(0.5);
        expect(costReward(0.01)({ signal: signal({ costUsd: 0.005 }) })).toBe(0.5);
        expect(stepsReward(4)({ signal: signal({ steps: 2 }) })).toBe(1);
        expect(clamp01(-5)).toBe(0);
        expect(clamp01(2)).toBe(1);
    });

    it('metricReward passes through a named metric', () => {
        expect(metricReward('f1')({ metrics: { f1: 0.8 } })).toBe(0.8);
    });

    it('composeReward blends and normalises', () => {
        const r = composeReward([successReward, successReward], [1, 1]);
        expect(r({ passed: true })).toBe(1);
        expect(r({ passed: false })).toBe(0);
    });

    it('compositeReward is a weighted quality/cost/latency blend', () => {
        const r = compositeReward();
        const score = r({ passed: true, signal: signal({ latencyMs: 0, costUsd: 0 }) });
        expect(score).toBeGreaterThan(0.9);
    });

    it('tokenContainment handles empties', () => {
        expect(tokenContainment('', '')).toBe(1);
        expect(tokenContainment('a b c', 'b c d')).toBe(2 / 3);
    });
});

// ── Evaluation metrics ────────────────────────────────────────────────────────

describe('evaluation metrics', () => {
    it('text metrics', () => {
        expect(exactMatchMetric.score({ expected: 'x', actual: 'x' })).toBe(1);
        expect(exactMatchMetric.score({ expected: 'x', actual: 'y' })).toBe(0);
        expect(includesMetric.score({ expected: 'sun', actual: 'the sun shines' })).toBe(1);
        expect(containmentMetric.score({ expected: 'a b', actual: 'a b c' })).toBeCloseTo(2 / 3);
        expect(f1Metric.score({ expected: 'the cat sat', actual: 'the cat sat' })).toBe(1);
        expect(similarityMetric.score({ expected: 'hello', actual: 'hallo' })).toBeGreaterThan(0.5);
        expect(successMetric.score({ passed: true })).toBe(1);
        expect(tokenF1('a b', 'a b c')).toBeGreaterThan(0);
        expect(levenshteinSimilarity('abc', 'abc')).toBe(1);
    });

    it('budget metrics are clamping', () => {
        expect(latencyBudgetMetric(1000).score({ signal: signal({ latencyMs: 100 }) })).toBe(0.9);
        expect(costBudgetMetric(0.01).score({ signal: signal({ costUsd: 0.02 }) })).toBe(0);
        expect(stepsBudgetMetric(4).score({ signal: signal({ steps: 8 }) })).toBe(0.5);
    });

    it('scoreEvaluation produces a name→score map', () => {
        const scores = scoreEvaluation({ expected: 'a', actual: 'a' }, [exactMatchMetric, successMetric]);
        expect(scores.exact_match).toBe(1);
        expect(scores.success).toBe(0);
    });

    it('meanEvaluationScore and DEFAULT_METRICS', () => {
        expect(meanEvaluationScore({ expected: 'yes', actual: 'yes', passed: true }, DEFAULT_METRICS)).toBe(1);
        expect(meanEvaluationScore({ passed: true }, [])).toBe(1);
    });
});

// ── Feedback repo (in-memory + sqlite + any-db) ───────────────────────────────

describe('FeedbackRepo implementations', () => {
    it('in-memory CRUD and filters', async () => {
        const repo = new InMemoryFeedbackRepo();
        const a = await repo.append(fb({ runId: 'r1', score: 0.9, source: 'human' }));
        await repo.append({ ...fb({ runId: 'r2', score: 0.3, source: 'ai-critique' }), signal: signal({ taskType: 'qa' }) });

        expect((await repo.get(a.id))?.score).toBe(0.9);
        expect(await repo.count({ agentId: 'agent-a' })).toBe(2);
        expect(await repo.count({ source: 'human' })).toBe(1);
        expect((await repo.list()).length).toBe(2);
        const qa = await repo.list({ taskType: 'qa' });
        expect(qa).toHaveLength(1);
        expect(qa[0]!.runId).toBe('r2');
        expect(await repo.delete(a.id)).toBe(true);
        expect(await repo.count()).toBe(1);
    });

    it('sqlite CRUD and filters', async () => {
        const repo = new SqliteFeedbackRepo();
        const a = await repo.append(fb({ runId: 's1', score: 0.7 }));
        await repo.append({ ...fb({ runId: 's2', source: 'reward' }), signal: signal({ taskType: 'code' }) });
        expect((await repo.get(a.id))?.score).toBe(0.7);
        expect(await repo.count({ source: 'reward' })).toBe(1);
        expect((await repo.list({ taskType: 'code' }))[0]!.runId).toBe('s2');
        expect(await repo.delete(a.id)).toBe(true);
        expect(await repo.count()).toBe(1);
    });

    it('any-DB: DbFeedbackRepo works on an AgentDb backend', async () => {
        const db = new InMemoryAgentDb();
        const repo = new DbFeedbackRepo(db);
        await repo.append({ ...fb({ runId: 'd1', rating: 1, source: 'user' }), signal: signal({ taskType: 'qa' }) });
        await repo.append(fb({ runId: 'd2', comment: 'bad' }));
        expect(await repo.count({ agentId: 'agent-a' })).toBe(2);
        const one = await repo.list({ runId: 'd1' });
        expect(one).toHaveLength(1);
        expect(one[0]!.rating).toBe(1);
        expect((await repo.list({ taskType: 'qa' }))[0]!.runId).toBe('d1');
        expect(await repo.delete(one[0]!.id)).toBe(true);
        expect(await repo.count({ agentId: 'agent-a' })).toBe(1);

        const fresh = new DbFeedbackRepo(new InMemoryAgentDb());
        await fresh.append(fb({ runId: 'z1' }));
        expect(await fresh.count()).toBe(1);
    });
});

// ── Performance scoring ───────────────────────────────────────────────────────

describe('performance scoring', () => {
    it('feedbackQuality resolves score/reward/rating/signal', () => {
        expect(feedbackQuality({ id: '1', runId: 'a', source: 'human', score: 0.8 })).toBe(0.8);
        expect(feedbackQuality({ id: '1', runId: 'a', source: 'human', rating: 1 })).toBe(1);
        expect(feedbackQuality({ id: '1', runId: 'a', source: 'human', signal: signal({ passed: true }) })).toBe(1);
        expect(feedbackQuality({ id: '1', runId: 'a', source: 'human' })).toBe(0.5);
    });

    it('scoreFeedback aggregates pass rate, cost and latency', () => {
        const s = scoreFeedback(mixedRuns());
        expect(s.samples).toBe(10);
        expect(s.successRate).toBe(0.5);
        expect(s.errorRate).toBe(0.5);
        expect(s.meanLatencyMs).toBe(300);
        expect(s.composite).toBeGreaterThan(0);
        expect(s.bySource.human).toBeDefined();
    });

    it('scoreAgent reads from a repo; performanceTrend buckets', async () => {
        const repo = new InMemoryFeedbackRepo();
        for (const e of mixedRuns()) await repo.append(e);
        const score = await scoreAgent(repo, { agentId: 'agent-a' });
        expect(score.samples).toBe(10);
        const trend = await performanceTrend(repo, 'agent-a', { bucketSize: 5 });
        expect(trend).toHaveLength(2);
        expect(performanceDelta(trend[1]!, trend[0]!)).toBeDefined();
    });
});

// ── Bandit ────────────────────────────────────────────────────────────────────

describe('BanditSelector', () => {
    it('streamlines untouched arms first', () => {
        const b = new BanditSelector(['a', 'b', 'c'], { rng: () => 0 });
        const first = b.select();
        expect(['a', 'b', 'c']).toContain(first);
        b.update(first, 1);
        const second = b.select();
        expect(second).not.toBe(first);
    });

    it('epsilon-greedy exploits the best mean when rng never explores', () => {
        const b = new BanditSelector(['a', 'b'], { strategy: 'epsilon-greedy', epsilon: 0.1, rng: () => 0.99 });
        b.update('a', 1);
        b.update('b', 0);
        expect(b.select()).toBe('a');
    });

    it('ucb1 picks the highest mean after all arms are pulled', () => {
        const b = new BanditSelector(['x', 'y'], { strategy: 'ucb1', rng: () => 0 });
        b.update('x', 1);
        b.update('x', 1);
        b.update('y', 0);
        expect(b.select()).toBe('x');
        const stats = b.stats();
        expect(stats.x!.pulls).toBe(2);
        expect(stats.x!.avgReward).toBe(1);
    });

    it('throws when no arms are registered', () => {
        const b = new BanditSelector([]);
        expect(() => b.select()).toThrow(/no arms/);
    });
});

// ── Versioned policy store ────────────────────────────────────────────────────

describe('policy store: promote / rollback / audit', () => {
    async function seed(store, agentId = 'agent-p'): Promise<{ v1: string; v2: string}> {
        const v1 = await store.registerVariant({
            id: 'v1', agentId, domain: OptimizationDomain.PROMPT, config: { instruction: 'p1' },
            description: 'v1', createdBy: 'baseline',
        });
        const v2 = await store.registerVariant({
            id: 'v2', agentId, domain: OptimizationDomain.PROMPT, config: { instruction: 'p2' },
            description: 'v2', createdBy: 'feedback', parentId: 'v1',
        });
        return { v1: v1.id, v2: v2.id };
    }

    it('in-memory promote → supersede → idempotent → rollback', async () => {
        const store = new InMemoryPolicyStore();
        const { v1, v2 } = await seed(store);

        const p1 = await store.promote(v1);
        expect(p1!.version).toBe(1);
        expect(p1!.status).toBe('active');
        expect((await store.getActive('agent-p', OptimizationDomain.PROMPT))!.variantId).toBe('v1');

        // Idempotent: promoting the active variant returns it unchanged.
        expect((await store.promote(v1))!.version).toBe(1);

        const p2 = await store.promote(v2, { rationale: 'second gen' });
        expect(p2!.version).toBe(2);
        expect((await store.getActive('agent-p', OptimizationDomain.PROMPT))!.variantId).toBe('v2');
        const history = await store.history('agent-p', OptimizationDomain.PROMPT);
        expect(history).toHaveLength(2);
        expect(history.find((v) => v.version === 1)!.status).toBe('superseded');

        // Deterministic rollback to v1.
        const rolled = await store.rollback('agent-p', OptimizationDomain.PROMPT);
        expect(rolled!.version).toBe(1);
        expect((await store.getActive('agent-p', OptimizationDomain.PROMPT))!.version).toBe(1);
        const audit = await store.audit('agent-p');
        expect(audit.some((e) => e.action === 'rollback')).toBe(true);
        expect(audit.some((e) => e.action === 'promote')).toBe(true);
    });

    it('sqlite supports promote/history/rollback', async () => {
        const store = new SqlitePolicyStore();
        const { v1, v2 } = await seed(store);
        await store.promote(v1);
        await store.promote(v2);
        const active = await store.getActive('agent-p', OptimizationDomain.PROMPT);
        expect(active!.variantId).toBe('v2');
        expect(active!.config).toEqual({ instruction: 'p2' });
        const rolled = await store.rollback('agent-p', OptimizationDomain.PROMPT);
        expect(rolled!.version).toBe(1);
        expect((await store.history('agent-p', OptimizationDomain.PROMPT)).length).toBe(2);
    });

    it('any-DB policy store works on an AgentDb backend', async () => {
        const db = new InMemoryAgentDb();
        const store = new DbPolicyStore(db);
        const { v1, v2 } = await seed(store, 'agent-db');
        await store.promote(v1);
        await store.promote(v2);
        expect((await store.getActive('agent-db', OptimizationDomain.PROMPT))!.variantId).toBe('v2');
        const rolled = await store.rollback('agent-db', OptimizationDomain.PROMPT);
        expect(rolled!.version).toBe(1);
        expect((await store.listVariants({ agentId: 'agent-db' })).length).toBe(2);
        const events = await store.audit('agent-db');
        expect(events.length).toBeGreaterThanOrEqual(3); // register x2 + promote x2 + rollback
    });

    it('reject refuses to reject an active policy', async () => {
        const store = new InMemoryPolicyStore();
        await seed(store);
        const pending = await store.registerVariant({
            id: 'v3', agentId: 'agent-p', domain: OptimizationDomain.PROMPT, config: {}, description: 'x',
        });
        await store.promote('v1');
        expect(await store.reject('v1')).toBe(false);
        expect(await store.reject(pending.id)).toBe(true);
        expect((await store.getVariant(pending.id))!.status).toBe('rejected');
    });
});

// ── Factories (choose-style) ──────────────────────────────────────────────────

describe('store factory', () => {
    it('createImprovementStores picks concrete backends', async () => {
        const mem = await createImprovementStores('memory');
        expect(mem.feedback).toBeInstanceOf(InMemoryFeedbackRepo);
        expect(mem.policy).toBeInstanceOf(InMemoryPolicyStore);
        const sqlite = await createImprovementStores('sqlite');
        expect(sqlite.feedback).toBeInstanceOf(SqliteFeedbackRepo);
        expect(sqlite.policy).toBeInstanceOf(SqlitePolicyStore);
    });

    it('db spec routes to the any-DB adapters', async () => {
        const db = new InMemoryAgentDb();
        const feedback = await createFeedbackRepo(db);
        const policy = await createPolicyStore(db);
        expect(feedback).toBeInstanceOf(DbFeedbackRepo);
        expect(policy).toBeInstanceOf(DbPolicyStore);
    });

    it('object specs and sqlite paths are honoured', async () => {
        const f = await createFeedbackRepo({ type: 'sqlite' });
        expect(f).toBeInstanceOf(SqliteFeedbackRepo);
        const p = await createPolicyStore({ type: 'memory' });
        expect(p).toBeInstanceOf(InMemoryPolicyStore);
    });
});

// ── Optimizers ────────────────────────────────────────────────────────────────

describe('suggestOptimizations', () => {
    it('produces prompt demos from passing runs', () => {
        const suggestions = suggestOptimizations(mixedRuns(), { instruction: 'base' }, { domains: [OptimizationDomain.PROMPT] });
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions[0]!.domain).toBe(OptimizationDomain.PROMPT);
        expect((suggestions[0]!.patch as any).demos).toHaveLength(3);
    });

    it('tool selection: disables failing tools, orders by success', () => {
        const entries = [
            fb({ runId: 't1', signal: signal({ toolCalls: [
                { name: 'search', ok: true, durationMs: 10 },
                { name: 'scrape', ok: false, durationMs: 3000 },
                { name: 'scrape', ok: false, durationMs: 3000 },
            ] }) }),
            fb({ runId: 't2', signal: signal({ toolCalls: [
                { name: 'search', ok: true, durationMs: 10 },
                { name: 'scrape', ok: true, durationMs: 3000 },
            ] }) }),
        ];
        const s = suggestOptimizations(entries, {}, { domains: [OptimizationDomain.TOOL_SELECTION], minSamples: 2 });
        expect(s.length).toBe(1);
        const patch = s[0]!.patch as any;
        expect(patch.disabledTools).toContain('scrape');
        expect(patch.toolOrder[0]).toBe('search');
    });

    it('model routing picks the quality frontier at lowest cost', () => {
        const entries = [
            fb({ runId: 'r1', signal: signal({ taskType: 'qa', model: 'big', passed: true, latencyMs: 100, costUsd: 0.01 }) }),
            fb({ runId: 'r2', signal: signal({ taskType: 'qa', model: 'big', passed: true, latencyMs: 100, costUsd: 0.01 }) }),
            fb({ runId: 'r3', signal: signal({ taskType: 'qa', model: 'small', passed: true, latencyMs: 200, costUsd: 0.001 }) }),
            fb({ runId: 'r4', signal: signal({ taskType: 'qa', model: 'small', passed: true, latencyMs: 200, costUsd: 0.001 }) }),
        ];
        const s = suggestOptimizations(entries, {}, { domains: [OptimizationDomain.MODEL_ROUTING], minSamples: 2 });
        expect(s.length).toBe(1);
        expect((s[0]!.patch as any).routing.qa).toBe('small');
    });

    it('cost and latency produce patches when out of budget', () => {
        const slow = [
            fb({ runId: 'l1', signal: signal({ taskType: 'chat', model: 'm', latencyMs: 9000, costUsd: 0.001, passed: true }) }),
            fb({ runId: 'l2', signal: signal({ taskType: 'chat', model: 'm', latencyMs: 7000, costUsd: 0.001, passed: true }) }),
        ];
        const lat = suggestOptimizations(slow, {}, { domains: [OptimizationDomain.LATENCY], latencyBudgetMs: 1000, minSamples: 2 });
        expect(lat.length).toBeGreaterThan(0);
        expect(lat[0]!.domain).toBe(OptimizationDomain.LATENCY);

        const pricey = [
            fb({ runId: 'c1', signal: signal({ taskType: 'qa', model: 'big', costUsd: 0.05, passed: true }) }),
            fb({ runId: 'c2', signal: signal({ taskType: 'qa', model: 'big', costUsd: 0.05, passed: true }) }),
            fb({ runId: 'c3', signal: signal({ taskType: 'qa', model: 'cheap', costUsd: 0.001, passed: true }) }),
            fb({ runId: 'c4', signal: signal({ taskType: 'qa', model: 'cheap', costUsd: 0.001, passed: true }) }),
        ];
        const cost = suggestOptimizations(pricey, {}, { domains: [OptimizationDomain.COST], costBudgetUsd: 0.01, minSamples: 2 });
        expect(cost.length).toBeGreaterThan(0);
        expect(cost[0]!.domain).toBe(OptimizationDomain.COST);

        const workflow = suggestOptimizations(
            [fb({ runId: 'w1', signal: signal({ passed: false, steps: 8 }) })],
            { maxSteps: 8 },
            { domains: [OptimizationDomain.WORKFLOW], minSamples: 1 },
        );
        expect(workflow.some((s) => s.domain === OptimizationDomain.WORKFLOW)).toBe(true);

        const memory = suggestOptimizations(
            [fb({ runId: 'm1', signal: signal({ passed: true, memoryUsed: 10_000, tokensIn: 30_000 }) })],
            { blockLimit: 40, retrievalTopK: 8 },
            { domains: [OptimizationDomain.MEMORY], minSamples: 1 },
        );
        expect(memory.some((s) => s.domain === OptimizationDomain.MEMORY)).toBe(true);
    });
});

// ── Sources ───────────────────────────────────────────────────────────────────

describe('data source adapters', () => {
    it('toLearningExamples flattens signals', () => {
        const examples = toLearningExamples(mixedRuns());
        expect(examples.length).toBe(10);
        expect(examples.filter((e) => e.passed).length).toBe(5);
    });

    it('toFineTuneJsonl produces chat-format training lines', () => {
        const lines = toFineTuneJsonl(toLearningExamples(mixedRuns())).split('\n').filter(Boolean);
        expect(lines.length).toBe(10); // one per labelled example (input + expected)
        const first = JSON.parse(lines[0]!) as { messages: Array<{ role: string; content: string }> };
        expect(first.messages[0]!.role).toBe('user');
        expect(first.messages[1]!.role).toBe('assistant');
    });

    it('examplesFromSimulation converts outcomes', () => {
        const report = {
            total: 2, passed: 1, failed: 1, passRate: 0.5,
            outcomes: [
                { name: 'a', prompt: 'p1', text: 'ok', steps: 2, finishReason: 'stop', passed: true, executionId: 'e1' },
                { name: 'b', prompt: 'p2', text: 'bad', steps: 6, finishReason: 'max', passed: false, executionId: 'e2' },
            ],
        } as never;
        const examples = examplesFromSimulation(report as any);
        expect(examples).toHaveLength(2);
        expect(examples[0]!.source).toBe('simulation');
        expect(examples[1]!.passed).toBe(false);
    });

    it('fromProductionFeedback maps ratings/comments', () => {
        const adapted = fromProductionFeedback(
            [{ runId: 'r1', rating: 1, comment: 'good', timestamp: '2026-01-01T00:00:00Z' }] as any,
            'agent-x',
        );
        expect(adapted[0]!.source).toBe('human');
        expect(adapted[0]!.rating).toBe(1);
        expect(adapted[0]!.agentId).toBe('agent-x');
    });

    it('examplesFromEval maps eval cases', () => {
        const summary = {
            total: 1, succeeded: 1, failed: 0, meanOverallScore: 0.8, criteriaScores: {},
            results: [{ id: 'case-1', result: { overallScore: 0.8, criteria: [] }, durationMs: 10 }],
        } as any;
        const examples = examplesFromEval(summary as never);
        expect(examples[0]!.source).toBe('benchmark');
    });

    it('enrichWithAiCritique adds ai-critique feedback', async () => {
        const seeded = mixedRuns().filter((e) => e.signal?.passed);
        const critique = vi.fn().mockResolvedValue({ score: 0.9, rationale: 'good' });
        const enriched = await enrichWithAiCritique(seeded, critique);
        expect(enriched).toHaveLength(5);
        expect(enriched[0]!.source).toBe('ai-critique');
        expect(enriched[0]!.score).toBe(0.9);
    });
});

// ── Pipeline ──────────────────────────────────────────────────────────────────

describe('LearningPipeline', () => {
    function pipelineConfig(extra: Record<string, unknown> = {}) {
        return {
            agentId: 'agent-a',
            domains: [OptimizationDomain.PROMPT] as const,
            currentConfig: { instruction: 'base' },
            feedback: new InMemoryFeedbackRepo(),
            policy: new InMemoryPolicyStore(),
            ...extra,
        };
    }

    it('promotes a candidate derived from strong runs (offline scoring)', async () => {
        const cfg = pipelineConfig();
        for (const e of mixedRuns()) await cfg.feedback.append(e);
        const run = await new LearningPipeline(cfg).run();

        expect(run.status).toBe('succeeded');
        expect(run.decision!.action).toBe('promote');
        expect(run.decision!.version).toBeGreaterThan(0);
        const active = await cfg.policy.getActive('agent-a', OptimizationDomain.PROMPT);
        expect(active).not.toBeNull();
        expect(active!.config.demos).toBeDefined();
    });

    it('noops when nothing beats the incumbent (regression gate)', async () => {
        const cfg = pipelineConfig();
        const allPass = Array.from({ length: 6 }, (_, i) =>
            fb({ runId: `p-${i}`, signal: signal({ passed: true, prompt: `q${i}`, output: `a${i}`, expected: `a${i}` }) }));
        for (const e of allPass) await cfg.feedback.append(e);
        const run = await new LearningPipeline(cfg).run();
        // incumbent ≈ 1.0; candidates ≤ 1.0 cannot beat 1.05 threshold
        expect(run.decision!.action).toBe('noop');
        expect(run.decision!.reason).toMatch(/regression gate/);
    });

    it('reproducibility: same seed+data → same hash; different seed → different hash', async () => {
        const base = { agentId: 'agent-a', domains: [OptimizationDomain.PROMPT] as const, currentConfig: {} };
        const feedbackA = new InMemoryFeedbackRepo();
        const feedbackB = new InMemoryFeedbackRepo();
        for (const e of mixedRuns()) { await feedbackA.append(e); await feedbackB.append(e); }
        const run1 = await new LearningPipeline({ ...base, feedback: feedbackA, seed: 7 }).run();
        const run2 = await new LearningPipeline({ ...base, feedback: feedbackB, seed: 7 }).run();
        const run3 = await new LearningPipeline({ ...base, feedback: feedbackA, seed: 8 }).run();
        expect(run1.datasetHash).toBe(run2.datasetHash);
        expect(run1.datasetHash).not.toBe(run3.datasetHash);
    });

    it('emits observable pipeline events', async () => {
        const events: string[] = [];
        const cfg = pipelineConfig({ onEvent: (e: { type: string }) => events.push(e.type) });
        for (const e of mixedRuns()) await cfg.feedback.append(e);
        await new LearningPipeline(cfg).run();
        for (const expected of ['pipeline-started', 'dataset-built', 'incumbent-scored', 'candidates-generated', 'candidate-evaluated', 'decision', 'pipeline-finished']) {
            expect(events).toContain(expected);
        }
    });

    it('runAsync can be cancelled at a safe checkpoint', async () => {
        const cfg = pipelineConfig({
            feedback: new InMemoryFeedbackRepo(),
            policy: new InMemoryPolicyStore(),
            evaluate: async (): Promise<{ variantId: string; score: number; successRate: number; meanLatencyMs: number; meanCostUsd: number; samples: number }> => {
                await new Promise((r) => setTimeout(r, 60));
                return { variantId: 'x', score: 0.5, successRate: 0.5, meanLatencyMs: 0, meanCostUsd: 0, samples: 1 };
            },
        });
        for (const e of mixedRuns()) await cfg.feedback.append(e);
        const handle = new LearningPipeline(cfg).runAsync();
        setTimeout(() => handle.cancel(), 10);
        const run = await handle.promise;
        expect(run.status).toBe('cancelled');
    });

    it('supports an injected evaluator for promotion decisions', async () => {
        const cfg = pipelineConfig({
            feedback: new InMemoryFeedbackRepo(),
            policy: new InMemoryPolicyStore(),
            evaluate: async (variant: PolicyVariant) => ({
                variantId: variant.id,
                score: variant.id === 'baseline' ? 0.4 : 0.95,
                successRate: 0.9,
                meanLatencyMs: 10,
                meanCostUsd: 0,
                samples: 1,
            }),
        });
        await cfg.feedback.append(fb({ runId: 'x', signal: signal({ passed: true, prompt: 'q', output: 'a', expected: 'a' }) }));
        const run: PipelineRun = await new LearningPipeline(cfg).run();
        expect(run.decision!.action).toBe('promote');
        expect(run.incumbentScore).toBe(0.4);
    });
});

// ── store factory: production-grade any-DB routing ────────────────────────────

describe('store factory (production-grade, any DB)', () => {
    it('routes a real backend config (json files) to any-DB stores on one shared instance', async () => {
        const { mkdtempSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const dir = mkdtempSync(`${tmpdir()}/personaforge-improve-`);
        try {
            const stores = await createImprovementStores({ type: 'json', dir });
            expect(stores.feedback).toBeInstanceOf(DbFeedbackRepo);
            expect(stores.policy).toBeInstanceOf(DbPolicyStore);

            await stores.feedback.append(fb({ runId: 'r-json-1' }));
            await stores.policy.registerVariant({
                id: 'v-json', agentId: 'agent-json', domain: OptimizationDomain.PROMPT, config: { p: 1 }, description: 'x',
            });
            await stores.policy.promote('v-json');
            expect(await stores.feedback.count({ agentId: 'agent-a' })).toBe(1);
            expect((await stores.policy.getActive('agent-json', OptimizationDomain.PROMPT))!.version).toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('non-sqlite URL strings resolve through createAgentDb', async () => {
        expect(await resolveBackend('memory')).toBe('memory');
        expect(await resolveBackend('sqlite')).toBe('sqlite');
        expect(await resolveBackend('sqlite:///tmp/prod.db')).toBe('sqlite');
        // A postgres URL resolves to a real AgentDb backend (no connection yet).
        const backend = await resolveBackend('postgres://user:pass@localhost:5432/db');
        expect(backend).not.toBe('memory');
        expect(backend).not.toBe('sqlite');
        expect((backend as { type: string }).type).toBe('postgres');
    });

    it('serializes concurrent promotions — version numbers never collide (any-DB)', async () => {
        const db = new InMemoryAgentDb();
        const store = new DbPolicyStore(db);
        const ids = Array.from({ length: 8 }, (_, i) => `c${i}`);
        for (const id of ids) {
            await store.registerVariant({
                id, agentId: 'conc', domain: OptimizationDomain.PROMPT, config: { i: Number(id.slice(1)) }, description: 'v',
            });
        }
        await Promise.all(ids.map((id) => store.promote(id)));
        const history = await store.history('conc', OptimizationDomain.PROMPT);
        const versions = history.map((v) => v.version);
        expect(versions).toHaveLength(8);
        expect(new Set(versions).size).toBe(8); // unique, watched by the lock
        expect((await store.getActive('conc', OptimizationDomain.PROMPT))!.status).toBe('active');
        expect((await store.audit('conc')).filter((e) => e.action === 'promote')).toHaveLength(8);
    });

    it('serializes concurrent promotions on the dedicated sqlite + in-memory stores', async () => {
        for (const make of [
            () => new SqlitePolicyStore(':memory:'),
            () => new InMemoryPolicyStore(),
        ] as Array<() => PolicyStore>) {
            const store = make();
            const ids = Array.from({ length: 5 }, (_, i) => `s${i}`);
            for (const id of ids) {
                await store.registerVariant({
                    id, agentId: 'conc2', domain: OptimizationDomain.PROMPT, config: {}, description: 'v',
                });
            }
            await Promise.all(ids.map((id) => store.promote(id)));
            const history = await store.history('conc2', OptimizationDomain.PROMPT);
            expect(history.length).toBe(5);
            expect(new Set(history.map((v) => v.version)).size).toBe(5);
        }
    });
});

// ── Continuous improvement loop ───────────────────────────────────────────────

describe('ImprovementLoop', () => {
    let clock: Date;

    beforeEach(() => {
        clock = new Date('2026-01-01T00:00:00.000Z');
    });

    const advance = (ms: number): void => { clock = new Date(clock.getTime() + ms); };

    it('gates: requires feedback before the first run', async () => {
        const loop = new ImprovementLoop({ agentId: 'a', now: () => clock, minIntervalMs: 0 });
        const result = await loop.maybeImprove();
        expect(result.skipped).toBe('insufficient new feedback');
    });

    it('runs the pipeline after feedback is submitted', async () => {
        const feedback = new InMemoryFeedbackRepo();
        const policy = new InMemoryPolicyStore();
        const loop = new ImprovementLoop({
            agentId: 'agent-a',
            feedback,
            policy,
            domains: [OptimizationDomain.PROMPT],
            minIntervalMs: 0,
            now: () => clock,
        });
        for (const e of mixedRuns()) await loop.submit(e);
        expect(loop.state().newFeedbackSinceLastRun).toBe(10);
        const result = await loop.maybeImprove();
        expect(result.run).toBeDefined();
        expect(result.run!.decision!.action).toBe('promote');
        expect(loop.state().runsCompleted).toBe(1);
        expect(loop.state().newFeedbackSinceLastRun).toBe(0);
        expect(loop.state().totalPromotions).toBe(1);
    });

    it('enforces the promotion budget within a rolling window', async () => {
        const loop = new ImprovementLoop({
            agentId: 'agent-a',
            domains: [OptimizationDomain.PROMPT],
            minIntervalMs: 0,
            maxPromotionsPerWindow: 1,
            windowMs: 10_000,
            now: () => clock,
        });
        for (const e of mixedRuns()) await loop.submit(e);
        const first = await loop.maybeImprove();
        expect(first.run!.decision!.action).toBe('promote');

        // Add new feedback; still within the window and budget is exhausted.
        advance(1_000);
        await loop.submit(fb({ runId: 'extra', signal: signal({ passed: true, prompt: 'q', output: 'a', expected: 'a' }) }));
        const second = await loop.maybeImprove();
        expect(second.skipped).toBe('promotion budget exhausted for window');

        // After the window slides, a new promotion is allowed.
        advance(10_000);
        await loop.submit(fb({ runId: 'extra2', signal: signal({ passed: true, prompt: 'q', output: 'a', expected: 'a' }) }));
        const third = await loop.maybeImprove();
        expect(third.run).toBeDefined();
    });

    it('auto-rolls-back when post-promotion performance regresses', async () => {
        let degrade = false;
        const feedback = new InMemoryFeedbackRepo();
        const policy = new InMemoryPolicyStore();
        const loop = new ImprovementLoop({
            agentId: 'agent-a',
            feedback,
            policy,
            domains: [OptimizationDomain.PROMPT],
            minIntervalMs: 0,
            maxPromotionsPerWindow: 3,
            autoRollbackThreshold: 0.2,
            now: () => clock,
            evaluate: async (variant: PolicyVariant) => ({
                variantId: variant.id,
                score: variant.id === 'baseline' ? 0.4 : degrade ? 0.05 : 0.95,
                successRate: 0.9,
                meanLatencyMs: 10,
                meanCostUsd: 0,
                samples: 3,
            }),
        });
        for (const e of mixedRuns()) await loop.submit(e);
        const first = await loop.maybeImprove();
        expect(first.run!.decision!.action).toBe('promote');
        expect((await policy.getActive('agent-a', OptimizationDomain.PROMPT))!.version).toBe(1);

        // Promote a second time → version 2 becomes active (target of the rollback).
        await loop.submit(fb({ runId: 'again', signal: signal({ passed: true, prompt: 'q', output: 'a', expected: 'a' }) }));
        const second = await loop.maybeImprove();
        expect(second.run!.decision!.action).toBe('promote');
        expect((await policy.getActive('agent-a', OptimizationDomain.PROMPT))!.version).toBe(2);

        // Active policy now performs terribly → deterministic rollback to v1.
        degrade = true;
        const rolled = await loop.checkRegression();
        expect(rolled).toBe(true);
        expect((await policy.getActive('agent-a', OptimizationDomain.PROMPT))!.version).toBe(1);
        expect(loop.state().totalRollbacks).toBe(1);
    });

    it('supports the any-DB db spec', async () => {
        const loop = new ImprovementLoop({
            agentId: 'db-loop',
            db: new InMemoryAgentDb(),
            minIntervalMs: 0,
            now: () => clock,
        });
        const e = await loop.submit(fb({ runId: 'r', agentId: 'db-loop', signal: signal({ passed: true, prompt: 'q', output: 'a', expected: 'a' }) }));
        expect(e.id).toBeTruthy();
        expect(await loop.pendingFeedback()).toBe(1);
    });

    it('start()/stop() manage the periodic timer', () => {
        const loop = new ImprovementLoop({ agentId: 'a', now: () => clock });
        expect(loop.isRunning).toBe(false);
        loop.start();
        expect(loop.isRunning).toBe(true);
        loop.start(); // idempotent
        loop.stop();
        expect(loop.isRunning).toBe(false);
    });
});

// ── Deterministic utilities ───────────────────────────────────────────────────

describe('deterministic utilities', () => {
    it('mulberry32 + seededShuffle are stable', () => {
        const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 42).join(',');
        const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 42).join(',');
        expect(a).toBe(b);
        expect(mulberry32(1)()).toBe(mulberry32(1)());
    });

    it('contentHash is deterministic FNV-1a', () => {
        expect(contentHash('abc')).toBe(contentHash('abc'));
        expect(contentHash('abc')).not.toBe(contentHash('abd'));
    });
});

// ── sanity: OptimizeDomain enum + ALL_DOMAINS ────────────────────────────────

describe('OptimizationDomain coverage', () => {
    it('enumerates all seven domains', () => {
        expect(ALL_DOMAINS).toHaveLength(7);
        expect(ALL_DOMAINS).toContain(OptimizationDomain.PROMPT);
        expect(ALL_DOMAINS).toContain(OptimizationDomain.LATENCY);
    });
});
