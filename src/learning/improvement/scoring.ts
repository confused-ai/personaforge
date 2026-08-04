/**
 * Agent performance scoring.
 *
 * Aggregates the structured feedback collected during a window into a single
 * `PerformanceScore` per agent (or task type): success rate, mean reward /
 * rating / score, cost and latency, plus a weighted composite — the scalar
 * improvement loops optimise against.
 */

import type {
    ExecutionFeedback,
    FeedbackSource,
    PerformanceScore,
    PerformanceWeights,
} from './types.js';
import type { FeedbackFilter, FeedbackRepo } from './feedback.js';

const DEFAULT_WEIGHTS: PerformanceWeights = { quality: 1, cost: 0.2, latency: 0.2 };
const DEFAULT_COST_BUDGET_USD = 0.01;
const DEFAULT_LATENCY_BUDGET_MS = 5_000;

/** Bring a single feedback entry into a 0…1 normalised "quality" measure. */
export function feedbackQuality(entry: ExecutionFeedback): number {
    // score (0..1) takes priority; then reward; then rating; then pass signal.
    if (entry.score !== undefined) return Math.max(0, Math.min(1, entry.score));
    if (entry.reward !== undefined) return Math.max(0, Math.min(1, entry.reward));
    if (entry.rating === 1) return 1;
    if (entry.rating === 0) return 0.5;
    if (entry.rating === -1) return 0;
    if (entry.signal?.passed === true) return 1;
    if (entry.signal?.passed === false) return 0;
    return 0.5;
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

/** Aggregate feedback into a `PerformanceScore`. */
export function scoreFeedback(
    entries: readonly ExecutionFeedback[],
    weights: PerformanceWeights = DEFAULT_WEIGHTS,
    windowEnd: Date = new Date(),
): PerformanceScore {
    const samples = entries.length;
    const passed = entries.filter((e) => e.signal?.passed === true).length;
    const failed = entries.filter((e) => e.signal?.passed === false).length;
    const successRate = samples ? passed / samples : 0;
    const errorRate = samples ? failed / samples : 0;

    const qualities = entries.map(feedbackQuality);
    const rewards = entries.filter((e) => e.reward !== undefined).map((e) => e.reward!);
    const ratings = entries.filter((e) => e.rating !== undefined).map((e) => e.rating!);
    const latencies = entries
        .map((e) => e.signal?.latencyMs)
        .filter((v): v is number => v !== undefined);
    const costs = entries
        .map((e) => e.signal?.costUsd)
        .filter((v): v is number => v !== undefined);

    const qualityNorm = successRate * 0.5 + mean(qualities) * 0.5;
    const costNorm = 1 - Math.min(1, mean(costs) / DEFAULT_COST_BUDGET_USD);
    const latencyNorm = 1 - Math.min(1, mean(latencies) / DEFAULT_LATENCY_BUDGET_MS);
    const total = weights.quality + weights.cost + weights.latency;
    const composite =
        samples === 0 ? 0 : (weights.quality * qualityNorm + weights.cost * costNorm + weights.latency * latencyNorm) / total * 100;

    const bySource: Partial<Record<FeedbackSource, number>> = {};
    const grouped = new Map<FeedbackSource, number[]>();
    for (const e of entries) {
        if (!grouped.has(e.source)) grouped.set(e.source, []);
        grouped.get(e.source)!.push(feedbackQuality(e));
    }
    for (const [source, values] of grouped) bySource[source] = mean(values);

    const firstAt = entries[0]?.createdAt ?? windowEnd.toISOString();
    return {
        samples,
        successRate,
        meanScore: mean(qualities),
        meanReward: rewards.length ? mean(rewards) : 0,
        meanRating: ratings.length ? (ratings.reduce<number>((a, b) => a + b, 0) / ratings.length + 1) / 2 : 0,
        errorRate,
        meanLatencyMs: mean(latencies),
        meanCostUsd: mean(costs),
        composite: Math.round(composite * 100) / 100,
        bySource,
        windowStart: firstAt,
        windowEnd: windowEnd.toISOString(),
    };
}

/** Score an agent's stored feedback using the repo + filter. */
export async function scoreAgent(
    repo: FeedbackRepo,
    filter: FeedbackFilter = {},
    weights: PerformanceWeights = DEFAULT_WEIGHTS,
): Promise<PerformanceScore> {
    const entries = await repo.list({ ...filter, limit: 10_000 });
    return scoreFeedback(entries, weights);
}

/** Signed improvement of `now` over `baseline` (positive = better). */
export function performanceDelta(now: PerformanceScore, baseline: PerformanceScore): number {
    return now.composite - baseline.composite;
}

/**
 * Rolling-window scores: bucket feedback by ISO day (or bucket by index when
 * `bucketSize` provided) so trends can be observed and acted upon.
 */
export async function performanceTrend(
    repo: FeedbackRepo,
    agentId: string,
    opts: { bucketSize?: number; limit?: number } = {},
): Promise<PerformanceScore[]> {
    const entries = (await repo.list({ agentId, limit: 10_000 })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const bucketSize = opts.bucketSize ?? 50;
    const scores: PerformanceScore[] = [];
    let start = 0;
    while (start < entries.length) {
        const slice = entries.slice(start, start + bucketSize);
        scores.push(scoreFeedback(slice, DEFAULT_WEIGHTS, new Date(slice[slice.length - 1]?.createdAt ?? Date.now())));
        start += bucketSize;
    }
    return scores.slice(-(opts.limit ?? scores.length));
}
