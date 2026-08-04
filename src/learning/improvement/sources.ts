/**
 * Data source adapters — turn external artifacts into learning material.
 *
 * The improvement subsystem learns from every place executions happen:
 *   1. production feedback (existing `FeedbackStore`),
 *   2. simulation outcomes (`SimReport`),
 *   3. offline evaluation / benchmarks (`EvalSummary`),
 *   4. AI critique post-hoc enrichment.
 *
 * These adapters convert each into the canonical `LearningExample` /
 * `ExecutionFeedback` shapes so downstream scoring and pipelines stay
 * storage-agnostic. All imports are type-only — no runtime coupling.
 */

import type { FeedbackEntry } from '../../production/feedback-store.js';
import type { SimReport } from '../../simulation/index.js';
import type { EvalSummary } from '../../eval/llm-judge.js';
import type { ExecutionFeedback, LearningExample } from './types.js';

// ── Production feedback → execution feedback ─────────────────────────────────

/** Adapt existing production FeedbackStore entries into improvement feedback. */
export function fromProductionFeedback(
    entries: readonly FeedbackEntry[],
    agentId?: string,
): ExecutionFeedback[] {
    return entries.map((e) => ({
        id: e.id,
        runId: e.runId,
        agentId,
        sessionId: e.sessionId,
        source: 'human',
        rating: e.rating,
        comment: e.comment,
        createdAt: e.timestamp,
        metadata: e.metadata ? { ...e.metadata } : undefined,
    }));
}

// ── Feedback → labelled examples ──────────────────────────────────────────────

/** Flatten feedback (and their signals) into labelled examples for pipelines. */
export function toLearningExamples(entries: readonly ExecutionFeedback[]): LearningExample[] {
    const out: LearningExample[] = [];
    for (const e of entries) {
        const s = e.signal;
        if (!s?.prompt && !s?.output) continue;
        out.push({
            id: s.id ?? e.id,
            input: s.prompt ?? '',
            expected: s.expected,
            actual: s.output,
            passed: s.passed,
            taskType: s.taskType,
            model: s.model,
            latencyMs: s.latencyMs,
            costUsd: s.costUsd,
            steps: s.steps,
            source: 'production',
        });
    }
    return out;
}

/**
 * Compose a fine-tuning-ready JSONL dataset (OpenAI chat format) from labelled
 * examples. One line per example: `{ "messages": [user, assistant] }`. Feed the
 * result to any SFT pipeline for actual model fine-tuning.
 */
export function toFineTuneJsonl(examples: readonly LearningExample[]): string {
    return examples
        .filter((e) => e.input && e.expected)
        .map((e) => JSON.stringify({
            messages: [
                { role: 'user', content: e.input },
                { role: 'assistant', content: e.expected },
            ],
        }))
        .join('\n');
}

// ── Simulation → examples ─────────────────────────────────────────────────────

/** Turn a simulation report into labelled examples (one per outcome). */
export function examplesFromSimulation(report: SimReport): LearningExample[] {
    return report.outcomes.map((o) => ({
        id: o.executionId,
        input: o.prompt,
        actual: o.text,
        passed: o.passed,
        steps: o.steps,
        source: 'simulation',
        metadata: { finishReason: o.finishReason },
    }));
}

// ── Benchmark / eval → examples ───────────────────────────────────────────────

/** Turn an offline evaluation summary into labelled examples. */
export function examplesFromEval(summary: EvalSummary): LearningExample[] {
    return summary.results.map((r) => ({
        id: r.id,
        input: r.id,
        passed: r.result !== null && r.error === undefined,
        metadata: {
            overallScore: r.result?.overallScore ?? 0,
            durationMs: r.durationMs,
            error: r.error,
        },
        source: 'benchmark',
    }));
}

// ── AI critique enrichment ────────────────────────────────────────────────────

/** Post-hoc critique scorer; `score` is normalised to [0, 1]. */
export interface CritiqueFn {
    (candidate: string, reference?: string): Promise<{ score: number; rationale?: string }>;
}

/**
 * Enrich runs that lack an AI critique with one. The returned feedback records
 * carry `source: 'ai-critique'` and reference the same `runId`, so scoring can
 * later weight or down-weight them independently of human ratings.
 */
export async function enrichWithAiCritique(
    entries: readonly ExecutionFeedback[],
    critique: CritiqueFn,
    opts: { concurrency?: number } = {},
): Promise<ExecutionFeedback[]> {
    const concurrency = Math.max(1, opts.concurrency ?? 4);
    const pending = entries.filter(
        (e) => e.source !== 'ai-critique' && e.signal?.output,
    );
    const enriched: ExecutionFeedback[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < pending.length) {
            const e = pending[next++]!;
            const signal = e.signal!;
            let score = 0;
            let rationale: string | undefined;
            try {
                const r = await critique(signal.output ?? '', signal.expected);
                score = Math.max(0, Math.min(1, r.score));
                rationale = r.rationale;
            } catch {
                score = 0.5; // critique failure → neutral, never penalise the run
            }
            enriched.push({
                id: crypto.randomUUID(),
                agentId: e.agentId,
                runId: e.runId,
                sessionId: e.sessionId,
                source: 'ai-critique',
                score,
                comment: rationale,
                signalId: e.signalId ?? signal.id,
                createdAt: new Date().toISOString(),
                metadata: { of: e.id },
            });
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return enriched;
}
