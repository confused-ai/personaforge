/**
 * Dynamic reward functions.
 *
 * Reward functions turn raw execution outcomes (expected/actual/passed plus
 * telemetry) into a single normalised `number` in [0, 1]. They are the numeric
 * language of the improvement subsystem: feedback can carry a reward, bandits
 * select variants by reward, and pipelines optimise the reward distribution.
 *
 * Rewards are pure and composable — `composeReward` blends several objectives
 * (quality, cost, latency) into one scalar with tunable weights.
 */

import type { RewardContext, RewardFunction } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

/** Token-ish containment: how much of the shorter text is in the longer one. */
export function tokenContainment(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const tokensB = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    if (tokensA.size === 0 && tokensB.size === 0) return 1;
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    let hit = 0;
    for (const t of tokensA) if (tokensB.has(t)) hit++;
    return Math.min(hit / tokensA.size, hit / tokensB.size);
}

// ── Quality rewards ───────────────────────────────────────────────────────────

/** 1 when the actual answer exactly matches the expected one, else 0. */
export function exactMatchReward(ctx: RewardContext): number {
    if (ctx.expected === undefined || ctx.actual === undefined) return ctx.passed ? 1 : 0;
    return ctx.actual.trim().toLowerCase() === ctx.expected.trim().toLowerCase() ? 1 : 0;
}

/** 1 when the expected answer appears in the actual answer. */
export function includesReward(ctx: RewardContext): number {
    if (ctx.expected === undefined || ctx.actual === undefined) return ctx.passed ? 1 : 0;
    return ctx.actual.toLowerCase().includes(ctx.expected.trim().toLowerCase()) ? 1 : 0;
}

/** Fractional overlap reward — partial credit for partially correct answers. */
export function similarityReward(ctx: RewardContext): number {
    if (ctx.expected === undefined || ctx.actual === undefined) return ctx.passed ? 1 : 0;
    return tokenContainment(ctx.expected, ctx.actual);
}

/** Binary success reward from the execution's pass/fail signal. */
export function successReward(ctx: RewardContext): number {
    return ctx.passed === true ? 1 : ctx.passed === false ? 0 : exactMatchReward(ctx);
}

/**
 * Reward from a discrete rating: 1 → 1, 0 → 0.5 (neutral), -1 → 0.
 * Ratings are the RLHF/stacking signal: `ctx.metrics.rating` or the
 * corresponding thumb in `ctx.metrics`/`ctx.signal.metadata`.
 */
export function ratingReward(ctx: RewardContext): number {
    const rating = ctx.metrics?.rating ?? ctx.signal?.metadata?.rating;
    if (rating === 1) return 1;
    if (rating === -1) return 0;
    if (rating === 0) return 0.5;
    return 0.5;
}

// ── Efficiency rewards ────────────────────────────────────────────────────────

/** Linear latency reward: 1 at 0ms, 0 at/beyond `targetMs`. */
export function latencyReward(targetMs: number): RewardFunction {
    return (ctx) => {
        const latency = ctx.signal?.latencyMs ?? ctx.metrics?.latencyMs;
        if (latency === undefined) return 0.5;
        return clamp01(1 - latency / Math.max(1, targetMs));
    };
}

/** Linear cost reward: 1 at $0, 0 at/beyond `budgetUsd`. */
export function costReward(budgetUsd: number): RewardFunction {
    return (ctx) => {
        const cost = ctx.signal?.costUsd ?? ctx.metrics?.costUsd;
        if (cost === undefined) return 0.5;
        return clamp01(1 - cost / Math.max(1e-9, budgetUsd));
    };
}

/** Step-budget reward: 1 within budget, smooth decay when over. */
export function stepsReward(budget: number): RewardFunction {
    return (ctx) => {
        const steps = ctx.signal?.steps ?? ctx.metrics?.steps;
        if (steps === undefined) return 0.5;
        return clamp01(budget / Math.max(1, steps));
    };
}

/** Pass-through reward of a named metric (must already be 0…1). */
export function metricReward(name: string): RewardFunction {
    return (ctx) => {
        const value = ctx.metrics?.[name];
        if (value === undefined) return 0.5;
        return clamp01(value);
    };
}

// ── Composition ───────────────────────────────────────────────────────────────

/**
 * Blend several reward functions into one by explicit weights (defaults equal).
 * The result is normalised to [0, 1] so it stays comparable across runs.
 */
export function composeReward(
    functions: readonly RewardFunction[],
    weights?: readonly number[],
): RewardFunction {
    const w = functions.map((_, i) => weights?.[i] ?? 1);
    const total = w.reduce((a, b) => a + b, 0) || 1;
    return (ctx) => {
        let sum = 0;
        for (let i = 0; i < functions.length; i++) {
            let r = functions[i]!(ctx);
            if (!Number.isFinite(r)) r = 0;
            sum += r * w[i]!;
        }
        return clamp01(sum / total);
    };
}

/**
 * Convenience composite: quality + cost + latency under one objective blend.
 * Mirrors `PerformanceWeights` so pipeline and scoring agree on the metric.
 */
export function compositeReward({ quality = 1, cost = 0.2, latency = 0.2 } = {}): RewardFunction {
    return composeReward(
        [successReward, latencyReward(5_000), costReward(0.01)],
        [quality, latency, cost],
    );
}
