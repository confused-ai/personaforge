/**
 * Automatic optimization across the seven agent axes.
 *
 * These pure, data-driven optimizers inspect the structured feedback reservoir
 * (via `ExecutionFeedback.signal` telemetry) and emit concrete
 * `OptimizationSuggestion`s — candidate config snapshots the learning pipeline
 * can register as versioned `PolicyVariant`s and evaluate before promoting.
 *
 * They are deliberately free of LLM calls and external deps so they run for
 * free inside every pipeline run. The heavy lifting (evaluating a candidate)
 * happens elsewhere, via the pipeline's injected evaluator.
 */

import { feedbackQuality } from './scoring.js';
import { OptimizationDomain } from './types.js';
import type {
    ExecutionFeedback,
    OptimizationSuggestion,
} from './types.js';

export const ALL_DOMAINS: readonly OptimizationDomain[] = [
    OptimizationDomain.PROMPT,
    OptimizationDomain.TOOL_SELECTION,
    OptimizationDomain.WORKFLOW,
    OptimizationDomain.MEMORY,
    OptimizationDomain.MODEL_ROUTING,
    OptimizationDomain.COST,
    OptimizationDomain.LATENCY,
];

export interface OptimizeOptions {
    /** Domains to consider. Defaults to all seven. */
    readonly domains?: readonly OptimizationDomain[];
    /** Min telemetry samples before a domain heuristic fires. Default 2. */
    readonly minSamples?: number;
    readonly costBudgetUsd?: number;
    readonly latencyBudgetMs?: number;
    readonly maxSteps?: number;
}

// ── Small statistics helpers ─────────────────────────────────────────────────

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

function taskTypeOf(e: ExecutionFeedback): string | undefined {
    return e.signal?.taskType ?? (e.metadata?.taskType as string | undefined);
}

function runIds(entries: readonly ExecutionFeedback[]): string[] {
    return [...new Set(entries.map((e) => e.runId).filter(Boolean))];
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

interface GroupedScore {
    samples: number;
    quality: number;
    latency: number;
    cost: number;
}

function summarize(entries: ExecutionFeedback[]): GroupedScore {
    const latencies = entries.map((e) => e.signal?.latencyMs).filter((v): v is number => v !== undefined);
    const costs = entries.map((e) => e.signal?.costUsd).filter((v): v is number => v !== undefined);
    return {
        samples: entries.length,
        quality: mean(entries.map(feedbackQuality)),
        latency: latencies.length ? mean(latencies) : Number.POSITIVE_INFINITY,
        cost: costs.length ? mean(costs) : Number.POSITIVE_INFINITY,
    };
}

// ── Per-domain heuristics ─────────────────────────────────────────────────────

function suggestPrompt(entries: readonly ExecutionFeedback[], current: Record<string, unknown>): OptimizationSuggestion[] {
    const failed = entries.filter((e) => e.signal?.passed === false || (e.score !== undefined && e.score < 0.5));
    const passed = entries.filter((e) => e.signal?.passed === true);
    const proposals: OptimizationSuggestion[] = [];

    const comments = failed.map((e) => e.comment).filter((c): c is string => !!c).slice(0, 4);
    if (comments.length > 0) {
        const base = (current.instruction ?? current.prompt ?? '') as string;
        const hint =
            'Learn from past mistakes. When answering, remember:\n' +
            comments.map((c) => `- ${c}`).join('\n');
        const instruction = base.trim() ? `${base.trim()}\n\n${hint}` : hint;
        proposals.push({
            domain: OptimizationDomain.PROMPT,
            title: 'Prompt refinement from past failures',
            description: `${failed.length} failing executions with corrective feedback`,
            patch: { ...current, instruction },
            rationale: `Reinforces ${Math.min(comments.length, 4)} corrective note(s) from failed runs.`,
            expectedImpact: 'quality',
            sourceRunIds: runIds(failed),
            confidence: clamp01(failed.length / 10),
        });
    }

    if (passed.length > 0) {
        const demos = passed
            .filter((e) => e.signal?.prompt && (e.signal?.output || e.signal?.expected))
            .slice(0, 3)
            .map((e) => ({
                input: e.signal!.prompt!,
                output: e.signal!.expected ?? e.signal!.output,
            }));
        if (demos.length > 0) {
            proposals.push({
                domain: OptimizationDomain.PROMPT,
                title: 'Bootstrap few-shot demos from passing runs',
                description: `Add ${demos.length} gold demo(s) to the prompt`,
                patch: { ...current, demos },
                rationale: 'Successful executions become few-shot examples (DSPy-style).',
                expectedImpact: 'quality',
                sourceRunIds: runIds(passed),
                confidence: clamp01(passed.length / 8),
            });
        }
    }
    return proposals.slice(0, 2);
}

interface ToolStat {
    calls: number;
    ok: number;
    totalLatency: number;
}

function suggestToolSelection(entries: readonly ExecutionFeedback[], current: Record<string, unknown>, minSamples: number): OptimizationSuggestion[] {
    const stats = new Map<string, ToolStat>();
    for (const e of entries) {
        for (const tc of e.signal?.toolCalls ?? []) {
            const s = stats.get(tc.name) ?? { calls: 0, ok: 0, totalLatency: 0 };
            s.calls++;
            if (tc.ok !== false) s.ok++;
            s.totalLatency += tc.durationMs ?? 0;
            stats.set(tc.name, s);
        }
    }
    const observed = [...stats.entries()].filter(([, s]) => s.calls >= minSamples);
    if (observed.length === 0) return [];

    const successRate = (s: ToolStat): number => s.ok / s.calls;
    const disabled = observed
        .filter(([, s]) => successRate(s) <= 0.4 && s.calls >= minSamples)
        .map(([name]) => name);
    const order = observed
        .sort((a, b) => successRate(b[1]) - successRate(a[1]) || a[1].totalLatency / a[1].calls - b[1].totalLatency / b[1].calls)
        .map(([name]) => name);

    if (disabled.length === 0 && order.length === 0) return [];
    const worstRate = Math.min(...observed.map(([, s]) => successRate(s)));
    return [{
        domain: OptimizationDomain.TOOL_SELECTION,
        title: 'Reorder and disable underperforming tools',
        description: disabled.length
            ? `Disable ${disabled.join(', ')}; prefer ${order.join(', ')}`
            : `Prefer tool order: ${order.join(', ')}`,
        patch: { ...current, toolOrder: order, disabledTools: disabled },
        rationale: 'Based on tool success rate and latency across executions.',
        expectedImpact: 'quality',
        sourceRunIds: runIds(entries),
        confidence: clamp01(worstRate <= 0.4 ? 0.7 : observed.length / 20),
    }];
}

function suggestWorkflow(entries: readonly ExecutionFeedback[], current: Record<string, unknown>, minSamples: number, maxSteps: number): OptimizationSuggestion[] {
    const steps = entries.map((e) => e.signal?.steps).filter((v): v is number => v !== undefined);
    if (steps.length < minSamples) return [];
    const meanSteps = mean(steps);
    const cappedFailures = entries.filter((e) =>
        e.signal?.passed === false && (e.signal.steps ?? 0) >= maxSteps);
    if (cappedFailures.length > 0) {
        return [{
            domain: OptimizationDomain.WORKFLOW,
            title: 'Raise step budget for blocked executions',
            description: `${cappedFailures.length} execution(s) hit the ${maxSteps}-step cap`,
            patch: { ...current, maxSteps: maxSteps + 2, retries: ((current.retries as number) ?? 0) + 0 },
            rationale: 'Failures at the step cap suggest premature termination.',
            expectedImpact: 'reliability',
            sourceRunIds: runIds(cappedFailures),
            confidence: clamp01(cappedFailures.length / 10),
        }];
    }
    if (meanSteps < maxSteps * 0.5 && steps.length >= minSamples * 3) {
        const newBudget = Math.max(2, Math.ceil(meanSteps));
        return [{
            domain: OptimizationDomain.WORKFLOW,
            title: 'Trim step budget to curb wasted steps',
            description: `Mean ${meanSteps.toFixed(1)} steps vs ${maxSteps} cap`,
            patch: { ...current, maxSteps: newBudget },
            rationale: 'Most executions finish well under the budget.',
            expectedImpact: 'latency',
            sourceRunIds: runIds(entries),
            confidence: 0.6,
        }];
    }
    return [];
}

function suggestMemory(entries: readonly ExecutionFeedback[], current: Record<string, unknown>, minSamples: number): OptimizationSuggestion[] {
    const memory = entries.map((e) => e.signal?.memoryUsed).filter((v): v is number => v !== undefined);
    const tokens = entries.map((e) => e.signal?.tokensIn).filter((v): v is number => v !== undefined);
    if (memory.length + tokens.length < minSamples) return [];
    const peakMemory = memory.length ? Math.max(...memory) : 0;
    const peakTokens = tokens.length ? Math.max(...tokens) : 0;
    if (peakMemory < 1 && peakTokens < 4_000) return [];
    return [{
        domain: OptimizationDomain.MEMORY,
        title: 'Constrain context to protect cost and latency',
        description: `Peak memory ${peakMemory.toFixed(1)}, peak input tokens ${peakTokens.toFixed(0)}`,
        patch: {
            ...current,
            blockLimit: Math.max(10, Math.round((current.blockLimit as number ?? 40) * 0.7)),
            retrievalTopK: Math.max(3, Math.round((current.retrievalTopK as number ?? 8) * 0.6)),
            consolidation: true,
        },
        rationale: 'High context usage correlates with cost/latency growth.',
        expectedImpact: 'cost',
        sourceRunIds: runIds(entries),
        confidence: clamp01((memory.length + tokens.length) / 30),
    }];
}

function suggestRouting(entries: readonly ExecutionFeedback[], current: Record<string, unknown>, minSamples: number): OptimizationSuggestion[] {
    const byTask = new Map<string, Map<string, ExecutionFeedback[]>>();
    for (const e of entries) {
        const task = taskTypeOf(e) ?? '__default__';
        const model = e.signal?.model;
        if (!model) continue;
        if (!byTask.has(task)) byTask.set(task, new Map());
        const models = byTask.get(task)!;
        if (!models.has(model)) models.set(model, []);
        models.get(model)!.push(e);
    }
    if (byTask.size === 0) return [];
    const routing: Record<string, string> = { ...(current.routing as Record<string, string> | undefined) };
    const changed: Array<{ task: string; model: string; reason: string }> = [];

    for (const [task, models] of byTask) {
        const rows = [...models.entries()].map(([model, list]) => ({ model, ...summarize(list) }));
        const totalSamples = rows.reduce((a, r) => a + r.samples, 0);
        if (totalSamples < minSamples || rows.length < 2) continue;
        const bestQuality = Math.max(...rows.map((r) => r.quality));
        const winner = [...rows]
            .filter((r) => r.quality >= bestQuality - 0.05)
            .sort((a, b) => a.cost - b.cost || a.latency - b.latency)[0]!;
        if (winner.model !== routing[task] && winner.model !== (current.model as string | undefined)) {
            changed.push({ task, model: winner.model, reason: `best quality ${winner.quality.toFixed(2)} at lowest cost` });
            routing[task] = winner.model;
        }
    }
    if (changed.length === 0) return [];
    return [{
        domain: OptimizationDomain.MODEL_ROUTING,
        title: 'Route each task type to its best-performing model',
        description: changed.map((c) => `${c.task} → ${c.model}`).join(', '),
        patch: { ...current, routing },
        rationale: 'Quality-frontier model with lowest cost per task type.',
        expectedImpact: 'quality',
        sourceRunIds: runIds(entries),
        confidence: clamp01(entries.length / 25),
    }];
}

function suggestCost(entries: readonly ExecutionFeedback[], current: Record<string, unknown>, minSamples: number, costBudgetUsd: number): OptimizationSuggestion[] {
    const byTask = new Map<string, Map<string, ExecutionFeedback[]>>();
    for (const e of entries) {
        const task = taskTypeOf(e) ?? '__default__';
        const model = e.signal?.model;
        if (!model) continue;
        if (!byTask.has(task)) byTask.set(task, new Map());
        const models = byTask.get(task)!;
        if (!models.has(model)) models.set(model, []);
        models.get(model)!.push(e);
    }
    const routing: Record<string, string> = { ...(current.routing as Record<string, string> | undefined) };
    const changed: string[] = [];
    for (const [task, models] of byTask) {
        const rows = [...models.entries()].map(([model, list]) => ({ model, ...summarize(list) }));
        if (rows.length < 2 || rows.reduce((a, r) => a + r.samples, 0) < minSamples) continue;
        const bestQuality = Math.max(...rows.map((r) => r.quality));
        const cheap = [...rows]
            .filter((r) => r.quality >= bestQuality - 0.1)
            .sort((a, b) => a.cost - b.cost)[0]!;
        if (cheap.model !== routing[task] && cheap.model !== (current.model as string | undefined)) {
            changed.push(`${task} → ${cheap.model}`);
            routing[task] = cheap.model;
        }
    }
    const overBudget = entries.some((e) => (e.signal?.costUsd ?? 0) > costBudgetUsd);
    const patch: Record<string, unknown> = { ...current };
    if (changed.length > 0) patch.routing = routing;
    if (overBudget) {
        patch.cache = current.cache ?? true;
        const cap = current.maxTokensCap as number | undefined;
        if (cap === undefined) patch.maxTokensCap = 1024;
    }
    if (changed.length === 0 && !overBudget) return [];
    return [{
        domain: OptimizationDomain.COST,
        title: 'Trim cost while preserving quality',
        description: changed.length ? `Cheaper routing: ${changed.join(', ')}` : 'Cap output tokens + enable cache',
        patch,
        rationale: overBudget ? 'Executions exceeded the cost budget.' : 'Quality-neutral cheaper models exist.',
        expectedImpact: 'cost',
        sourceRunIds: runIds(entries),
        confidence: clamp01((changed.length > 0 ? 0.8 : 0.5)),
    }];
}

function suggestLatency(entries: readonly ExecutionFeedback[], current: Record<string, unknown>, minSamples: number, latencyBudgetMs: number): OptimizationSuggestion[] {
    const byTask = new Map<string, { list: ExecutionFeedback[]; models: Map<string, ExecutionFeedback[]> }>();
    for (const e of entries) {
        const task = taskTypeOf(e) ?? '__default__';
        const model = e.signal?.model;
        if (!byTask.has(task)) byTask.set(task, { list: [e], models: new Map() });
        else byTask.get(task)!.list.push(e);
        if (model) {
            const row = byTask.get(task)!;
            if (!row.models.has(model)) row.models.set(model, []);
            row.models.get(model)!.push(e);
        }
    }
    const routing: Record<string, string> = { ...(current.routing as Record<string, string> | undefined) };
    let anySlow = false;
    const slowTasks: string[] = [];
    for (const [task, { list, models }] of byTask) {
        if (list.length < minSamples) continue;
        const stats = summarize(list);
        if (stats.latency > latencyBudgetMs) {
            anySlow = true;
            slowTasks.push(task);
            if (models.size >= 1) {
                const fastest = [...models.entries()]
                    .map(([model, l]) => ({ model, rel: summarize(l) }))
                    .sort((a, b) => a.rel.latency - b.rel.latency)[0]!;
                if (fastest.rel.latency < stats.latency) routing[task] = fastest.model;
            }
        }
    }
    if (!anySlow) return [];
    const patch: Record<string, unknown> = { ...current };
    if (Object.keys(routing).length) patch.routing = routing;
    patch.concurrency = (current.concurrency as number ?? 4) + 1;
    return [{
        domain: OptimizationDomain.LATENCY,
        title: 'Speed up slow task types',
        description: slowTasks.length ? `Slow: ${slowTasks.join(', ')}` : 'Raise concurrency',
        patch,
        rationale: `Mean latency exceeded ${latencyBudgetMs}ms budget.`,
        expectedImpact: 'latency',
        sourceRunIds: runIds(entries),
        confidence: clamp01(0.7),
    }];
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Analyze feedback and produce candidate configuration suggestions across the
 * configured domains. Deterministic and dependency-free.
 */
export function suggestOptimizations(
    entries: readonly ExecutionFeedback[],
    current: Readonly<Record<string, unknown>> = {},
    opts: OptimizeOptions = {},
): OptimizationSuggestion[] {
    const domains = new Set(opts.domains ?? ALL_DOMAINS);
    const minSamples = opts.minSamples ?? 2;
    const costBudgetUsd = opts.costBudgetUsd ?? 0.01;
    const latencyBudgetMs = opts.latencyBudgetMs ?? 5_000;
    const maxSteps = opts.maxSteps ?? ((current.maxSteps as number) ?? 8);
    const base = { ...current };

    const suggestions: OptimizationSuggestion[] = [];
    if (domains.has(OptimizationDomain.PROMPT)) suggestions.push(...suggestPrompt(entries, base));
    if (domains.has(OptimizationDomain.TOOL_SELECTION)) suggestions.push(...suggestToolSelection(entries, base, minSamples));
    if (domains.has(OptimizationDomain.WORKFLOW)) suggestions.push(...suggestWorkflow(entries, base, minSamples, maxSteps));
    if (domains.has(OptimizationDomain.MEMORY)) suggestions.push(...suggestMemory(entries, base, minSamples));
    if (domains.has(OptimizationDomain.MODEL_ROUTING)) suggestions.push(...suggestRouting(entries, base, minSamples));
    if (domains.has(OptimizationDomain.COST)) suggestions.push(...suggestCost(entries, base, minSamples, costBudgetUsd));
    if (domains.has(OptimizationDomain.LATENCY)) suggestions.push(...suggestLatency(entries, base, minSamples, latencyBudgetMs));
    return suggestions;
}

/** Signals referenced by the suggestions (convenience for callers). */
export function relevantRuns(suggestions: readonly OptimizationSuggestion[]): string[] {
    return [...new Set(suggestions.flatMap((s) => s.sourceRunIds))];
}
