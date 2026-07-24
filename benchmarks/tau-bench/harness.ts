/**
 * τ-bench harness for personaforge.
 *
 * A minimal, reusable evaluation framework that measures **tool-agent task
 * completion** — the same capability class as τ-bench (retail/airline) and
 * SWE-bench. Verifiers are pure functions over recorded tool calls, so scores
 * are stable across model versions and reproducible in CI.
 *
 * Two run modes:
 *   1. **Hermetic** — pass a scripted `MockLLMProvider`; runs in the default
 *      test suite. Proves the harness + verifiers work.
 *   2. **Live** — pass a real `LLMProvider`; produces publishable scores.
 *      Gated behind `bun run test:integration` (needs API keys).
 *
 * Usage:
 * ```ts
 * const summary = await runTauBench({ llm, tasks: RETAIL_TASKS });
 * console.log(formatSummary(summary));
 * ```
 */

import { z } from 'zod/v3';
import { AgenticRunner } from '../../src/agentic/runner.js';
import { tool } from '../../src/tools/core/tool-helper.js';
import type { LLMProvider, ToolCall } from '../../src/contracts/index.js';
import type { Tool, ToolRegistry } from '../../src/core/index.js';

/** A single benchmark task. */
export interface AgentTask {
    readonly id: string;
    readonly domain: string;
    /** Natural-language instruction the agent receives. */
    readonly instruction: string;
    /** Tool set (built with `tool()`) available to the agent. */
    readonly tools: readonly Tool[];
    /**
     * Pure verifier. Returns { passed, reason } given the ordered tool calls
     * the agent actually made and the final assistant text.
     */
    readonly verify: (calls: readonly RecordedCall[], finalText: string) => VerdictResult;
    /** Max ReAct steps (default 8). */
    readonly maxSteps?: number;
}

export interface RecordedCall {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly result: unknown;
}

export interface VerdictResult {
    readonly passed: boolean;
    readonly reason: string;
}

export interface TaskResult {
    readonly taskId: string;
    readonly domain: string;
    readonly passed: boolean;
    readonly reason: string;
    readonly steps: number;
    readonly finishReason: string;
    readonly toolCallCount: number;
    readonly durationMs: number;
    readonly finalText: string;
}

export interface BenchmarkSummary {
    readonly total: number;
    readonly passed: number;
    readonly passRate: number;
    readonly avgSteps: number;
    readonly avgDurationMs: number;
    readonly byDomain: Record<string, { total: number; passed: number; passRate: number }>;
    readonly results: readonly TaskResult[];
}

export interface RunTauBenchOptions {
    readonly llm: LLMProvider;
    readonly tasks: readonly AgentTask[];
    /** Instructions prepended to every task's system prompt. */
    readonly systemPreamble?: string;
    /** Per-task timeout in ms (default 60_000). */
    readonly timeoutMs?: number;
}

/**
 * Wrap a tool so every invocation is recorded. The recorded call carries the
 * validated input and the tool's return value — this is what verifiers see.
 */
function recordCalls(tools: readonly Tool[]): { instrumented: Tool[]; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const instrumented: Tool[] = tools.map((t) => {
        const originalExecute = t.execute.bind(t);
        const wrapped: Tool = {
            ...t,
            async execute(params: Record<string, unknown>, ctx: unknown) {
                const result = await originalExecute(params, ctx as never);
                calls.push({
                    name: t.name,
                    arguments: params,
                    // Successful tool results carry `.data`; failed ones carry `.error`.
                    // Verifiers usually care about arguments, not the return payload,
                    // but expose the payload so custom verifiers can assert both.
                    result: (result as { success?: boolean; data?: unknown }).success
                        ? (result as { data?: unknown }).data
                        : result,
                });
                return result;
            },
        };
        return wrapped;
    });
    return { instrumented, calls };
}

function makeRegistry(tools: Tool[]): ToolRegistry {
    const map = new Map(tools.map((t) => [t.name, t]));
    return {
        register: () => undefined,
        unregister: () => undefined,
        get: (id: string) => map.get(id),
        getByName: (name: string) => map.get(name),
        list: () => tools,
        listByCategory: () => tools,
        search: () => tools,
        has: (id: string) => map.has(id),
    } as unknown as ToolRegistry;
}

/** Run one task against a provider. */
async function runOneTask(
    llm: LLMProvider,
    task: AgentTask,
    systemPreamble: string,
    timeoutMs: number,
): Promise<TaskResult> {
    const { instrumented, calls } = recordCalls(task.tools);
    const registry = makeRegistry(instrumented);
    const runner = new AgenticRunner({
        llm,
        tools: registry,
        maxSteps: task.maxSteps ?? 8,
        timeoutMs,
        retry: { maxRetries: 0 },
    });
    const t0 = performance.now();
    let finalText = '';
    let steps = 0;
    let finishReason = 'error';
    try {
        const res = await runner.run({
            instructions: [systemPreamble, task.instruction].filter(Boolean).join('\n\n'),
            prompt: task.instruction,
        });
        finalText = res.text;
        steps = res.steps;
        finishReason = res.finishReason;
    } catch (err) {
        finalText = err instanceof Error ? err.message : String(err);
    }
    const verdict = task.verify(calls, finalText);
    return {
        taskId: task.id,
        domain: task.domain,
        passed: verdict.passed,
        reason: verdict.reason,
        steps,
        finishReason,
        toolCallCount: calls.length,
        durationMs: performance.now() - t0,
        finalText,
    };
}

/**
 * Run every task and return a full summary.
 *
 * Runs sequentially so failures do not race and so per-task LLM cost stays
 * predictable when hitting live APIs.
 */
export async function runTauBench(options: RunTauBenchOptions): Promise<BenchmarkSummary> {
    const preamble =
        options.systemPreamble ??
        'You are a task-completing agent. Use the tools provided to satisfy the user request. Call tools directly with their required arguments; do not ask clarifying questions unless a tool result requires it.';
    const timeoutMs = options.timeoutMs ?? 60_000;
    const results: TaskResult[] = [];
    for (const task of options.tasks) {
        results.push(await runOneTask(options.llm, task, preamble, timeoutMs));
    }
    const passed = results.filter((r) => r.passed).length;
    const byDomain: Record<string, { total: number; passed: number; passRate: number }> = {};
    for (const r of results) {
        const d = byDomain[r.domain] ?? { total: 0, passed: 0, passRate: 0 };
        d.total += 1;
        if (r.passed) d.passed += 1;
        d.passRate = d.total === 0 ? 0 : d.passed / d.total;
        byDomain[r.domain] = d;
    }
    return {
        total: results.length,
        passed,
        passRate: results.length === 0 ? 0 : passed / results.length,
        avgSteps: results.length === 0 ? 0 : results.reduce((s, r) => s + r.steps, 0) / results.length,
        avgDurationMs: results.length === 0 ? 0 : results.reduce((s, r) => s + r.durationMs, 0) / results.length,
        byDomain,
        results,
    };
}

/** Pretty-print a summary as a markdown table (suitable for CI logs / README). */
export function formatSummary(summary: BenchmarkSummary): string {
    const lines: string[] = [];
    lines.push(
        `**τ-bench** — ${summary.passed}/${summary.total} passed (${(summary.passRate * 100).toFixed(1)}%), ` +
            `avg ${summary.avgSteps.toFixed(1)} steps, ${(summary.avgDurationMs / 1000).toFixed(2)}s per task.`,
    );
    lines.push('');
    lines.push('| Domain | Passed | Total | Pass rate |');
    lines.push('|--------|--------|-------|-----------|');
    for (const [domain, s] of Object.entries(summary.byDomain)) {
        lines.push(`| ${domain} | ${s.passed} | ${s.total} | ${(s.passRate * 100).toFixed(1)}% |`);
    }
    lines.push('');
    lines.push('| Task | Passed | Reason | Steps | Duration |');
    lines.push('|------|--------|--------|-------|----------|');
    for (const r of summary.results) {
        lines.push(
            `| ${r.taskId} | ${r.passed ? '✅' : '❌'} | ${r.reason.replace(/\|/g, '\\|')} | ${r.steps} | ${(r.durationMs / 1000).toFixed(2)}s |`,
        );
    }
    return lines.join('\n');
}

// ── Convenience helper for task authors ─────────────────────────────────────
export const bench = { tool, z };
