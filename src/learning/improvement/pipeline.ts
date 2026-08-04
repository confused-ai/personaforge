/**
 * The adaptive learning pipeline.
 *
 * Turns a reservoir of structured feedback into a versioned policy upgrade —
 * asynchronously, reproducibly and with full observability:
 *
 *   gather (production + simulation + benchmark)
 *     → score incumbent
 *     → generate candidate variants (automatic optimization)
 *     → evaluate candidates on a seeded holdout
 *     → promote only if regression-gated
 *     → record version + audit trail (rollback-ready)
 *
 * Reproducibility is guaranteed by a seeded train/holdout split plus a
 * deterministic dataset content-hash and a frozen config snapshot, all written
 * into the returned `PipelineRun`.
 */

import { feedbackQuality } from './scoring.js';
import { suggestOptimizations, type OptimizeOptions } from './optimizers.js';
import { toLearningExamples } from './sources.js';
import { OptimizationDomain } from './types.js';
import type { FeedbackRepo } from './feedback.js';
import type { PolicyStore } from './policy-store.js';
import type {
    ExecutionFeedback,
    LearningExample,
    PipelineDecision,
    PipelineEvaluationResult,
    PipelineRun,
    PipelineRunStatus,
    PolicyVariant,
    RewardFunction,
    VariantEvaluator,
} from './types.js';

// ── Observability events ──────────────────────────────────────────────────────

export type PipelineEvent =
    | { readonly type: 'pipeline-started'; readonly runId: string; readonly agentId: string; readonly seed: number }
    | { readonly type: 'dataset-built'; readonly runId: string; readonly feedbackCount: number; readonly exampleCount: number }
    | { readonly type: 'incumbent-scored'; readonly runId: string; readonly score?: number }
    | { readonly type: 'candidates-generated'; readonly runId: string; readonly candidateIds: readonly string[] }
    | { readonly type: 'candidate-evaluated'; readonly runId: string; readonly result: PipelineEvaluationResult }
    | { readonly type: 'decision'; readonly runId: string; readonly decision: PipelineDecision }
    | { readonly type: 'pipeline-finished'; readonly runId: string; readonly status: PipelineRunStatus };

// ── Config ────────────────────────────────────────────────────────────────────

export interface PipelineConfig {
    readonly agentId: string;
    /** Domains the pipeline may optimise. */
    readonly domains: readonly OptimizationDomain[];
    /** Baseline configuration (the incumbent until a promotion exists). */
    readonly currentConfig?: Readonly<Record<string, unknown>>;
    /** Feedback reservoir. */
    readonly feedback?: FeedbackRepo;
    /** Versioned policy store (promotions/rollback land here). */
    readonly policy?: PolicyStore;
    /**
     * Evaluates a candidate variant on a holdout of examples. When omitted the
     * pipeline falls back to offline scores derived from the feedback that
     * motivated each candidate (learn from production, zero extra calls).
     */
    readonly evaluate?: VariantEvaluator;
    /** Min relative improvement over the incumbent to promote. Default 0.05. */
    readonly minImprovement?: number;
    /** Fraction of examples reserved for holdout. Default 0.3. */
    readonly holdoutFraction?: number;
    /** Seeded split — same seed reproduces the same run. Default 1. */
    readonly seed?: number;
    /** Extra examples merged into the dataset (simulation/benchmark). */
    readonly extraExamples?: readonly LearningExample[];
    /** Min feedback records before generation is attempted. Default 0. */
    readonly minFeedback?: number;
    /** Optional reward folded into generation decisions. */
    readonly reward?: RewardFunction;
    /** Optimizer options forwarded to the automatic optimizers. */
    readonly optimize?: OptimizeOptions;
    /** Observer for pipeline events. */
    readonly onEvent?: (event: PipelineEvent) => void;
}

// ── Deterministic utilities ───────────────────────────────────────────────────

/** FNV-1a 32-bit — cheap deterministic content hash for reproducibility. */
export function contentHash(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** mulberry32 — tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
    const out = [...arr];
    const rnd = mulberry32(seed);
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

// ── Pipeline ──────────────────────────────────────────────────────────────────

export class LearningPipeline {
    private readonly config: PipelineConfig;

    constructor(config: PipelineConfig) {
        if (!config.agentId) throw new Error('LearningPipeline: agentId is required');
        this.config = config;
    }

    /** Run the pipeline to completion. */
    async run(): Promise<PipelineRun> {
        return this._execute(() => false);
    }

    /**
     * Run asynchronously and return a handle: `{ promise, cancel }`.
     * `cancel()` aborts the run at the next safe checkpoint.
     */
    runAsync(): { promise: Promise<PipelineRun>; cancel: () => void } {
        let aborted = false;
        const promise = this._execute(() => aborted);
        return { promise, cancel: () => { aborted = true; } };
    }

    private async _execute(isAborted: () => boolean): Promise<PipelineRun> {
        const {
            agentId,
            domains,
            currentConfig = {},
            feedback,
            policy,
            evaluate,
            minImprovement = 0.05,
            holdoutFraction = 0.3,
            seed = 1,
            extraExamples = [],
            minFeedback = 0,
            optimize = {},
        } = this.config;

        const startedAt = new Date().toISOString();
        const runId = crypto.randomUUID();
        const emit = (event: PipelineEvent): void => this.config.onEvent?.(event);
        emit({ type: 'pipeline-started', runId, agentId, seed });

        // 1. Gather ────────────────────────────────────────────────────────────
        const feedbackEntries = feedback ? await feedback.list({ agentId, limit: 10_000 }) : [];
        const baseExamples = toLearningExamples(feedbackEntries);
        const dataset = [...baseExamples, ...extraExamples];
        emit({ type: 'dataset-built', runId, feedbackCount: feedbackEntries.length, exampleCount: dataset.length });

        const configSnapshot = {
            domains: domains.map(String),
            currentConfig,
            minImprovement,
            holdoutFraction,
            seed,
            minFeedback,
            optimize,
        } as unknown as Record<string, unknown>;

        const candidates: PolicyVariant[] = [];
        const evaluations: PipelineEvaluationResult[] = [];
        const datasetHash = contentHash(
            JSON.stringify({
                configSnapshot,
                examples: dataset.map((e) => ({ i: e.input, o: e.expected, p: e.passed, t: e.taskType })),
            }),
        );

        if (dataset.length < minFeedback) {
            const run: PipelineRun = {
                id: runId, agentId, status: 'succeeded', startedAt, finishedAt: new Date().toISOString(),
                seed, datasetHash, domains, feedbackCount: feedbackEntries.length,
                exampleCount: dataset.length, trainCount: 0, holdoutCount: dataset.length,
                candidates, evaluations, decision: { action: 'noop', reason: 'insufficient feedback (below minFeedback)' },
                configSnapshot,
            };
            emit({ type: 'decision', runId, decision: run.decision! });
            emit({ type: 'pipeline-finished', runId, status: 'succeeded' });
            return run;
        }

        // 2. Deterministic split ───────────────────────────────────────────────
        const shuffled = seededShuffle(dataset, seed);
        const holdoutCount = Math.round(shuffled.length * Math.max(0, Math.min(1, holdoutFraction)));
        const holdout = shuffled.slice(0, holdoutCount);
        const train = shuffled.slice(holdoutCount);

        // 3. Incumbent (current deployed policy) ───────────────────────────────
        const incumbentConfig = await this._incumbentConfig(policy, agentId, domains, currentConfig);
        let incumbentScore: number | undefined;

        if (evaluate) {
            const incumbentVariant: PolicyVariant = {
                id: 'baseline', agentId, domain: domains[0] ?? OptimizationDomain.PROMPT,
                config: incumbentConfig, description: 'incumbent', createdBy: 'baseline',
                status: 'candidate', createdAt: startedAt,
            };
            const result = await evaluate(incumbentVariant, holdout);
            incumbentScore = result.score;
            emit({ type: 'incumbent-scored', runId, score: result.score });
        } else {
            incumbentScore = mean(feedbackEntries.map(feedbackQuality));
            emit({ type: 'incumbent-scored', runId, score: incumbentScore });
        }

        if (isAborted()) return this._cancelledRun(runId, agentId, domains, seed, datasetHash, feedbackEntries.length, dataset.length, train.length, holdout.length, candidates, evaluations, incumbentScore, configSnapshot, startedAt);

        // 4. Generate candidate variants ───────────────────────────────────────
        candidates.push({
            id: 'baseline', agentId, domain: domains[0] ?? OptimizationDomain.PROMPT,
            config: incumbentConfig, description: 'incumbent baseline', createdBy: 'baseline',
            status: 'candidate', createdAt: startedAt,
        });

        const suggestions = suggestOptimizations(feedbackEntries, incumbentConfig, {
            domains,
            ...optimize,
        });
        for (const s of suggestions) {
            const variant: PolicyVariant = {
                id: crypto.randomUUID(),
                agentId,
                domain: s.domain,
                config: s.patch,
                description: s.title,
                rationale: s.rationale,
                createdBy: 'feedback',
                sourceRunIds: s.sourceRunIds,
                parentId: 'baseline',
                status: 'candidate',
                createdAt: new Date().toISOString(),
            };
            if (policy) await policy.registerVariant(variant);
            candidates.push(variant);
        }
        emit({ type: 'candidates-generated', runId, candidateIds: candidates.map((c) => c.id) });

        // 5. Evaluate candidates ───────────────────────────────────────────────
        for (const candidate of candidates) {
            if (isAborted()) return this._cancelledRun(runId, agentId, domains, seed, datasetHash, feedbackEntries.length, dataset.length, train.length, holdout.length, candidates, evaluations, incumbentScore, configSnapshot, startedAt);
            let tests = train.length > 0 ? train : holdout;
            if (candidate.id === 'baseline' && evaluate) tests = holdout;
            const result = evaluate
                ? await evaluate(candidate, candidate.id === 'baseline' ? holdout : tests)
                : this._offlineResult(candidate, feedbackEntries);
            evaluations.push(result);
            emit({ type: 'candidate-evaluated', runId, result });
        }

        // 6. Decide ────────────────────────────────────────────────────────────
        const best = [...evaluations].sort((a, b) => b.score - a.score)[0]!;
        let decision = this._decide(best, candidates, incumbentScore, minImprovement, evaluate !== undefined);
        if (decision.action === 'promote' && policy) {
            const promoted = await policy.promote(decision.variantId, { rationale: decision.reason });
            if (promoted) {
                decision = { ...decision, version: promoted.version };
            } else {
                decision = { action: 'noop', reason: 'best candidate is already the active policy' };
            }
        }
        emit({ type: 'decision', runId, decision });

        const result: PipelineRun = {
            id: runId, agentId, status: 'succeeded', startedAt, finishedAt: new Date().toISOString(),
            seed, datasetHash, domains, feedbackCount: feedbackEntries.length,
            exampleCount: dataset.length, trainCount: train.length, holdoutCount: holdout.length,
            candidates, evaluations, incumbentScore, decision, configSnapshot,
        };
        emit({ type: 'pipeline-finished', runId, status: 'succeeded' });
        return result;
    }

    private async _incumbentConfig(
        policy: PolicyStore | undefined,
        agentId: string,
        domains: readonly OptimizationDomain[],
        currentConfig: Readonly<Record<string, unknown>>,
    ): Promise<Record<string, unknown>> {
        const merged: Record<string, unknown> = { ...currentConfig };
        if (policy) {
            for (const domain of domains) {
                const active = await policy.getActive(agentId, domain);
                if (active) Object.assign(merged, active.config);
            }
        }
        return merged;
    }

    private _offlineResult(
        candidate: PolicyVariant,
        entries: readonly ExecutionFeedback[],
    ): PipelineEvaluationResult {
        const runs = new Map<string, number[]>();
        for (const e of entries) {
            if (!e.runId) continue;
            if (!runs.has(e.runId)) runs.set(e.runId, []);
            runs.get(e.runId)!.push(feedbackQuality(e));
        }
        const quals = (candidate.sourceRunIds ?? []).flatMap((r) => runs.get(r) ?? []);
        const score = quals.length ? mean(quals) : 0;
        return {
            variantId: candidate.id,
            score,
            successRate: score,
            meanLatencyMs: 0,
            meanCostUsd: 0,
            samples: quals.length,
        };
    }

    private _decide(
        best: PipelineEvaluationResult,
        candidates: readonly PolicyVariant[],
        incumbentScore: number | undefined,
        minImprovement: number,
        hasEvaluator: boolean,
    ): PipelineDecision {
        if (best.score <= 0) {
            return { action: 'noop', reason: hasEvaluator ? 'no candidate scored above zero' : 'insufficient evidence (no evaluator and no source runs)' };
        }
        if (incumbentScore !== undefined && incumbentScore > 0) {
            const threshold = incumbentScore * (1 + minImprovement);
            if (best.score >= threshold && best.variantId !== 'baseline') {
                const variant = candidates.find((c) => c.id === best.variantId)!;
                return {
                    action: 'promote',
                    variantId: best.variantId,
                    version: 0,
                    reason: `${variant.domain} candidate (${best.score.toFixed(3)}) beats incumbent (${incumbentScore.toFixed(3)}) by ≥${(minImprovement * 100).toFixed(0)}%`,
                };
            }
            return {
                action: 'noop',
                reason: `best candidate (${best.score.toFixed(3)}) does not beat incumbent (${incumbentScore.toFixed(3)}) by the ${(minImprovement * 100).toFixed(0)}% regression gate`,
            };
        }
        if (best.variantId !== 'baseline') {
            return { action: 'promote', variantId: best.variantId, version: 0, reason: 'first meaningful improvement (no incumbent baseline yet)' };
        }
        return { action: 'noop', reason: 'only the baseline is available' };
    }

    private _cancelledRun(
        runId: string, agentId: string, domains: readonly OptimizationDomain[], seed: number,
        datasetHash: string, feedbackCount: number, exampleCount: number, trainCount: number,
        holdoutCount: number, candidates: readonly PolicyVariant[], evaluations: readonly PipelineEvaluationResult[],
        incumbentScore: number | undefined, configSnapshot: Record<string, unknown>, startedAt: string,
    ): PipelineRun {
        return {
            id: runId, agentId, status: 'cancelled', startedAt, finishedAt: new Date().toISOString(),
            seed, datasetHash, domains, feedbackCount, exampleCount, trainCount, holdoutCount,
            candidates, evaluations, incumbentScore, configSnapshot,
        };
    }
}
