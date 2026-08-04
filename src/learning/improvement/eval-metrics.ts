/**
 * Custom evaluation metrics.
 *
 * Metrics are the building blocks of structured feedback: each one scores an
 * execution in [0, 1] and gets recorded as `feedback.metrics`, which reward
 * functions, bandits and pipelines can then consume. Unlike external judges,
 * metrics are deterministic, offline and cost nothing to run — they are the
 * unit-test layer of an evaluation strategy.
 */

import { clamp01, tokenContainment } from './reward.js';
import type { EvaluationMetric, EvaluationMetricInput } from './types.js';

// ── Text similarity primitives ────────────────────────────────────────────────

/** F1 over shared tokens — standard for QA / summarisation eval. */
export function tokenF1(expected: string, actual: string): number {
    const a = expected.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const b = actual.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    const counter = new Map<string, number>();
    for (const t of a) counter.set(t, (counter.get(t) ?? 0) + 1);
    let overlap = 0;
    for (const t of b) {
        const n = counter.get(t) ?? 0;
        if (n > 0) {
            overlap++;
            counter.set(t, n - 1);
        }
    }
    const precision = overlap / b.length;
    const recall = overlap / a.length;
    if (precision + recall === 0) return 0;
    return (2 * precision * recall) / (precision + recall);
}

/** Normalised Levenshtein similarity in [0, 1]. */
export function levenshteinSimilarity(a: string, b: string): number {
    const s = a.toLowerCase();
    const t = b.toLowerCase();
    if (s === t) return 1;
    if (s.length === 0 || t.length === 0) return 0;
    const m = s.length;
    const n = t.length;
    let prev = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = s[i - 1] === t[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return 1 - prev[n]! / Math.max(m, n);
}

// ── Metric factories ──────────────────────────────────────────────────────────

/** Exact string match after trimming + lowercasing. */
export const exactMatchMetric: EvaluationMetric = {
    name: 'exact_match',
    score: (i) => {
        if (i.expected === undefined || i.actual === undefined) return i.passed ? 1 : 0;
        return i.actual.trim().toLowerCase() === i.expected.trim().toLowerCase() ? 1 : 0;
    },
};

/** Expected answer must appear in the actual answer. */
export const includesMetric: EvaluationMetric = {
    name: 'includes',
    score: (i) => {
        if (i.expected === undefined || i.actual === undefined) return i.passed ? 1 : 0;
        return i.actual.toLowerCase().includes(i.expected.trim().toLowerCase()) ? 1 : 0;
    },
};

/** Token containment (how much of the expected is present in the actual). */
export const containmentMetric: EvaluationMetric = {
    name: 'containment',
    score: (i) => {
        if (i.expected === undefined || i.actual === undefined) return i.passed ? 1 : 0;
        return tokenContainment(i.expected, i.actual);
    },
};

/** Token F1 between expected and actual. */
export const f1Metric: EvaluationMetric = {
    name: 'f1',
    score: (i) => {
        if (i.expected === undefined || i.actual === undefined) return i.passed ? 1 : 0;
        return tokenF1(i.expected, i.actual);
    },
};

/** Levenshtein-based similarity. */
export const similarityMetric: EvaluationMetric = {
    name: 'similarity',
    score: (i) => {
        if (i.expected === undefined || i.actual === undefined) return i.passed ? 1 : 0;
        return levenshteinSimilarity(i.expected, i.actual);
    },
};

/** Binary pass/fail as a metric. */
export const successMetric: EvaluationMetric = {
    name: 'success',
    score: (i) => (i.passed === true ? 1 : 0),
};

/** Latency budget: 1 at 0ms, declining linearly to 0 at/after `targetMs`. */
export function latencyBudgetMetric(targetMs: number): EvaluationMetric {
    return {
        name: 'latency',
        score: (i) => {
            const latency = i.signal?.latencyMs ?? i.metrics?.latencyMs;
            if (latency === undefined) return 0.5;
            return clamp01(1 - latency / Math.max(1, targetMs));
        },
    };
}

/** Cost budget: 1 at $0, declining linearly to 0 at/after `budgetUsd`. */
export function costBudgetMetric(budgetUsd: number): EvaluationMetric {
    return {
        name: 'cost',
        score: (i) => {
            const cost = i.signal?.costUsd ?? i.metrics?.costUsd;
            if (cost === undefined) return 0.5;
            return clamp01(1 - cost / Math.max(1e-9, budgetUsd));
        },
    };
}

/** Step budget: 1 within budget, declining to 0 with excess steps. */
export function stepsBudgetMetric(budget: number): EvaluationMetric {
    return {
        name: 'steps',
        score: (i) => {
            const steps = i.signal?.steps ?? i.metrics?.steps;
            if (steps === undefined) return 0.5;
            return clamp01(budget / Math.max(1, steps));
        },
    };
}

// ── Batch helpers ─────────────────────────────────────────────────────────────

/** Score one input against many metrics → `{ [metricName]: 0..1 }`. */
export function scoreEvaluation(
    input: EvaluationMetricInput,
    metrics: readonly EvaluationMetric[],
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of metrics) out[m.name] = clamp01(m.score(input));
    return out;
}

/** Mean of all metric scores for one input (empty metrics → passed ? 1 : 0). */
export function meanEvaluationScore(
    input: EvaluationMetricInput,
    metrics: readonly EvaluationMetric[],
): number {
    if (metrics.length === 0) return input.passed === true ? 1 : 0;
    const scores = scoreEvaluation(input, metrics);
    const values = Object.values(scores);
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Predefined standard metric set tuned for QA / agentic task evaluation. */
export const DEFAULT_METRICS: readonly EvaluationMetric[] = [
    exactMatchMetric,
    includesMetric,
    f1Metric,
    successMetric,
];
