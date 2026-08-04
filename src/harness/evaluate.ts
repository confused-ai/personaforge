/**
 * `evaluate()` — the best-harness single command.
 *
 * Evaluate an agent, task, workflow, or function against a golden dataset in
 * one call: score every sample, capture cost/token/latency, and — when you
 * pass multiple subjects — compare them head-to-head (A/B, model comparison,
 * prompt variants) and emit a winner per metric.
 *
 * ```ts
 * import { evaluate, fromAgent } from 'personaforge/harness';
 * import { exactMatchScorer } from 'personaforge/eval';
 *
 * const report = await evaluate({
 *   name: 'classifier-ab',
 *   dataset: [
 *     { id: '1', input: 'what is 2+2?', expected: '4' },
 *     { id: '2', input: 'cap of france', expected: 'paris' },
 *   ],
 *   subject: {
 *     baseline: agentA,     // model A
 *     candidate: agentB,    // model B
 *   },
 *   scorers: [exactMatchScorer()],
 *   concurrency: 4,
 * });
 *
 * console.log(report.comparison);   // winner per metric
 * console.log(report.variants[0].benchmark.summary.passRate);
 * console.log(report.toJSON());     // JSON-serialisable
 * ```
 */

import { runBenchmark } from '../eval/benchmark.js';
import type { BenchmarkSample, BenchmarkSampleResult, BenchmarkReport, Scorer } from '../eval/benchmark.js';
import { toHarnessRunner, type HarnessSubject, type RunOutcome } from './subject.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** A single named subject variant under evaluation. */
export interface HarnessVariant {
    readonly name: string;
    readonly subject: HarnessSubject;
}

/** Options for {@link evaluate}. */
export interface EvaluateOptions {
    /** Human-readable name for this harness run. */
    readonly name: string;
    /** Golden dataset (inline or loaded via `personaforge/eval` loaders). */
    readonly dataset: BenchmarkSample[];
    /** A single subject, or a record of named variants (A/B / model comparison). */
    readonly subject: HarnessSubject | Record<string, HarnessSubject>;
    /** Scorers applied to every sample. */
    readonly scorers?: Scorer[];
    /** Max concurrent invocations per variant. Default: 1. */
    readonly concurrency?: number;
    /** A sample "passes" when avgScore >= this (0–1). Default: 0.7. */
    readonly passThreshold?: number;
    /** Session id forwarded to agent/task subjects. */
    readonly sessionId?: string;
    /** Extract a USD cost from a subject's raw result. */
    readonly costOf?: (raw: unknown) => number | undefined;
    /** Progress callback per sample. */
    readonly onSample?: (variant: string, result: BenchmarkSampleResult, index: number, total: number) => void;
    /** Restrict evaluation to these variants (by name). Default: all. */
    readonly only?: string[];
}

/** Cost + token summary for one variant. */
export interface HarnessUsageSummary {
    readonly totalTokens: number;
    readonly avgTokensPerSample: number;
    readonly totalCostUsd: number | undefined;
    readonly avgCostPerSample: number | undefined;
}

/** Result of evaluating one variant. */
export interface HarnessVariantResult {
    readonly variant: string;
    readonly benchmark: BenchmarkReport;
    readonly usage: HarnessUsageSummary;
}

/** One head-to-head metric. */
export interface HarnessMetricComparison {
    readonly metric: 'score' | 'latency_ms' | 'tokens' | 'cost_usd';
    readonly winner: string;
    readonly values: Record<string, number>;
}

/** The consolidated report from {@link evaluate}. */
export interface HarnessReport {
    readonly name: string;
    readonly timestamp: string;
    readonly durationMs: number;
    readonly variants: HarnessVariantResult[];
    readonly comparison: HarnessMetricComparison[];
    /** True when every evaluated variant meets the pass threshold. */
    readonly passes: boolean;
    /** JSON-serialisable snapshot (no functions). */
    toJSON(): HarnessReportJson;
    /** Human-readable markdown report. */
    formatMarkdown(): string;
}

/** JSON-serialisable shape of a {@link HarnessReport}. */
export interface HarnessReportJson {
    readonly name: string;
    readonly timestamp: string;
    readonly durationMs: number;
    readonly passes: boolean;
    readonly comparison: HarnessMetricComparison[];
    readonly variants: Array<{
        variant: string;
        summary: {
            total: number;
            passed: number;
            failed: number;
            passRate: number;
            avgScores: Record<string, number>;
            medianLatencyMs: number;
            p95LatencyMs: number;
        };
        usage: HarnessUsageSummary;
        samples: BenchmarkSampleResult[];
    }>;
}

// ── Evaluation ─────────────────────────────────────────────────────────────

function normalizeVariants(subject: HarnessSubject | Record<string, HarnessSubject>): HarnessVariant[] {
    if (isRecordOfSubjects(subject)) {
        return Object.entries(subject).map(([name, s]) => ({ name, subject: s }) as HarnessVariant);
    }
    return [{ name: 'default', subject }];
}

function isRecordOfSubjects(subject: HarnessSubject | Record<string, HarnessSubject>): subject is Record<string, HarnessSubject> {
    return !(typeof subject === 'function')
        && !(subject !== null && typeof subject === 'object'
            && (typeof (subject as Record<string, unknown>).run === 'function'
                || typeof (subject as Record<string, unknown>).execute === 'function'));
}

/**
 * Run the harness: score a dataset through one or many subject variants and
 * return a consolidated, JSON-serialisable report with cost/token/latency
 * accounting and head-to-head comparison.
 */
export async function evaluate(options: EvaluateOptions): Promise<HarnessReport> {
    const startedAt = Date.now();
    const {
        name,
        dataset,
        subject,
        scorers = [],
        concurrency = 1,
        passThreshold = 0.7,
        sessionId,
        costOf,
        onSample,
        only,
    } = options;

    const variants = normalizeVariants(subject).filter(
        (v) => only === undefined || only.includes(v.name),
    );
    if (variants.length === 0) {
        throw new Error('evaluate(): no variants selected. Check `subject` and `only`.');
    }

    const variantResults: HarnessVariantResult[] = [];

    for (const variant of variants) {
        const runner = toHarnessRunner(variant.subject, { sessionId, costOf });
        const outcomesBySample = new Map<string, RunOutcome>();
        let counter = 0;

        const report = await runBenchmark({
            name: `${name}::${variant.name}`,
            dataset,
            scorers,
            concurrency,
            passThreshold,
            onSample: onSample
                ? (result, index, total) => onSample(variant.name, result, index, total)
                : undefined,
            run: async (input, sample) => {
                const outcome = await runner(input);
                const key = sample.id ?? `${input}::${counter++}`;
                outcomesBySample.set(key, outcome);
                return outcome.output;
            },
        });

        const outcomes = [...outcomesBySample.values()];
        const totalTokens = outcomes.reduce((sum, o) => sum + (o.tokensUsed ?? 0), 0);
        const costValues = outcomes
            .map((o) => o.costUsd)
            .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
        const totalCost = costValues.length > 0 ? costValues.reduce((s, c) => s + c, 0) : undefined;

        variantResults.push({
            variant: variant.name,
            benchmark: report,
            usage: {
                totalTokens,
                avgTokensPerSample: dataset.length > 0 ? totalTokens / dataset.length : 0,
                ...(totalCost !== undefined
                    ? {
                        totalCostUsd: totalCost,
                        avgCostPerSample: dataset.length > 0 ? totalCost / dataset.length : 0,
                    }
                    : { totalCostUsd: undefined, avgCostPerSample: undefined }),
            },
        });
    }

    const durationMs = Date.now() - startedAt;
    const comparison = buildComparison(variantResults);
    const passes = variantResults.every((v) => v.benchmark.summary.passRate >= passThreshold);

    return {
        name,
        timestamp: new Date().toISOString(),
        durationMs,
        variants: variantResults,
        comparison,
        passes,
        toJSON() {
            return toJson(this as HarnessReport);
        },
        formatMarkdown() {
            return formatHarnessReport(this as HarnessReport);
        },
    };
}

// ── Comparison ─────────────────────────────────────────────────────────────

function aggScore(r: HarnessVariantResult): number {
    const overall = r.benchmark.summary.avgScores['overall'];
    return overall !== undefined ? overall : r.benchmark.summary.passRate;
}

function buildComparison(results: HarnessVariantResult[]): HarnessMetricComparison[] {
    if (results.length < 2) return [];

    const metrics: Array<{
        metric: HarnessMetricComparison['metric'];
        value: (r: HarnessVariantResult) => number | undefined;
        maxWins: boolean;
    }> = [
        { metric: 'score', value: (r) => aggScore(r), maxWins: true },
        { metric: 'latency_ms', value: (r) => r.benchmark.summary.medianLatencyMs, maxWins: false },
        { metric: 'tokens', value: (r) => r.usage.totalTokens, maxWins: false },
        { metric: 'cost_usd', value: (r) => r.usage.totalCostUsd, maxWins: false },
    ];

    const comparisons: HarnessMetricComparison[] = [];
    for (const { metric, value, maxWins } of metrics) {
        const values: Record<string, number> = {};
        let any = false;
        for (const r of results) {
            const v = value(r);
            if (v !== undefined && Number.isFinite(v)) {
                values[r.variant] = v;
                any = true;
            }
        }
        if (!any) continue;
        const entries = Object.entries(values);
        entries.sort((a, b) => (maxWins ? b[1] - a[1] : a[1] - b[1]));
        comparisons.push({ metric, winner: entries[0]![0], values });
    }
    return comparisons;
}

// ── JSON + Markdown ────────────────────────────────────────────────────────

function toJson(report: HarnessReport): HarnessReportJson {
    return {
        name: report.name,
        timestamp: report.timestamp,
        durationMs: report.durationMs,
        passes: report.passes,
        comparison: report.comparison,
        variants: report.variants.map((v) => ({
            variant: v.variant,
            summary: {
                total: v.benchmark.summary.total,
                passed: v.benchmark.summary.passed,
                failed: v.benchmark.summary.failed,
                passRate: v.benchmark.summary.passRate,
                avgScores: v.benchmark.summary.avgScores,
                medianLatencyMs: v.benchmark.summary.medianLatencyMs,
                p95LatencyMs: v.benchmark.summary.p95LatencyMs,
            },
            usage: v.usage,
            samples: v.benchmark.samples,
        })),
    };
}

/**
 * Format a {@link HarnessReport} as a human-readable markdown string.
 */
export function formatHarnessReport(report: HarnessReport): string {
    const lines: string[] = [
        `# Harness: ${report.name}`,
        `**Date:** ${report.timestamp}   **Duration:** ${(report.durationMs / 1000).toFixed(1)}s   **Pass:** ${report.passes ? '✅' : '❌'}`,
        '',
    ];

    if (report.comparison.length > 0) {
        lines.push('## Head-to-head', '| Metric | Winner | Values |', '|---|---|---|');
        for (const c of report.comparison) {
            const values = Object.entries(c.values)
                .map(([k, v]) => `${k}=${c.metric === 'score' ? (v * 100).toFixed(1) + '%' : v.toFixed(2)}`)
                .join(', ');
            lines.push(`| ${c.metric} | ${c.winner} | ${values} |`);
        }
        lines.push('');
    }

    for (const v of report.variants) {
        const s = v.benchmark.summary;
        const u = v.usage;
        lines.push(
            `## ${v.variant}`,
            `| Metric | Value |`,
            `|---|---|`,
            `| Pass rate | ${(s.passRate * 100).toFixed(1)}% (${s.passed}/${s.total}) |`,
            `| Scores | ${Object.entries(s.avgScores).map(([k, x]) => `${k}=${(x * 100).toFixed(1)}%`).join(', ')} |`,
            `| Median latency | ${s.medianLatencyMs.toFixed(0)}ms |`,
            `| p95 latency | ${s.p95LatencyMs.toFixed(0)}ms |`,
            `| Tokens | ${u.totalTokens} (${u.avgTokensPerSample.toFixed(0)}/sample) |`,
            `| Cost | ${u.totalCostUsd !== undefined ? `$${u.totalCostUsd.toFixed(4)} (${u.avgCostPerSample!.toFixed(4)}/sample)` : 'n/a'} |`,
        );
        lines.push('', '### Samples', '| ID | Input | Output | Avg | Latency | Error |', '|---|---|---|---|---|---|');
        for (const r of v.benchmark.samples) {
            lines.push(
                `| ${r.id} | ${truncate(r.input, 28)} | ${truncate(r.output, 40)} | ${(r.avgScore * 100).toFixed(0)}% | ${r.latencyMs.toFixed(0)}ms | ${r.error ?? ''} |`,
            );
        }
        lines.push('');
    }

    return lines.join('\n');
}

function truncate(s: string, max: number): string {
    const clean = s.replace(/\n/g, ' ').replace(/\|/g, '\\|');
    return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}
