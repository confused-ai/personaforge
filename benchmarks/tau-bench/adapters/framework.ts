/**
 * Framework-agnostic benchmark runner.
 *
 * Scores ANY framework that implements `benchmarks/tau-bench/PROTOCOL.md`
 * (a `POST /tau-bench/run` endpoint) using the SAME task verifiers as the
 * native personaforge harness — so `personaforge`, `agno`, `langgraph`,
 * `mastra`, `crewai`, … are directly comparable.
 *
 * A `Framework` is anything that, given a task, returns the ordered tool calls
 * it made plus the final text. The default implementation is an HTTP client for
 * the protocol; the in-process personaforge harness is also exposed as a
 * `Framework` so it can appear in the same comparison matrix.
 */

import type {
    AgentTask,
    RecordedCall,
    TaskResult,
    BenchmarkSummary,
} from '../harness.js';

/** A framework-under-test: turns a task into a recorded transcript. */
export interface Framework {
    readonly name: string;
    /** Optional version string for the results table. */
    readonly version?: string;
    /** Run one task and return the transcript. Must not throw for task-level
     *  failures — return a transcript with `error` set instead. */
    run(task: AgentTask): Promise<FrameworkRunResult>;
}

export interface FrameworkRunResult {
    readonly text: string;
    readonly toolCalls: RecordedCall[];
    readonly steps: number;
    readonly finishReason: string;
    readonly durationMs: number;
    readonly error?: string;
}

/** Serialise a task's tools to the protocol's JSON-schema form. */
function serialiseTools(task: AgentTask): Array<{ name: string; description: string; parameters: unknown }> {
    return task.tools.map((t) => ({
        name: t.name,
        description: t.description,
        // t.parameters is a zod schema; the protocol wants JSON schema. Servers
        // that need JSON schema should convert; here we pass a best-effort shape.
        parameters: (t as { parameters?: unknown }).parameters ?? { type: 'object', properties: {} },
    }));
}

export interface HttpFrameworkOptions {
    readonly name: string;
    readonly baseUrl: string;
    readonly version?: string;
    readonly timeoutMs?: number;
    /** Extra headers (auth, etc.). */
    readonly headers?: Record<string, string>;
}

/** HTTP adapter for any protocol-compliant framework server. */
export function httpFramework(opts: HttpFrameworkOptions): Framework {
    const timeoutMs = opts.timeoutMs ?? 90_000;
    return {
        name: opts.name,
        ...(opts.version ? { version: opts.version } : {}),
        async run(task: AgentTask): Promise<FrameworkRunResult> {
            const started = performance.now();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/tau-bench/run`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...opts.headers },
                    body: JSON.stringify({
                        instruction: task.instruction,
                        tools: serialiseTools(task),
                        maxSteps: task.maxSteps ?? 8,
                    }),
                    signal: controller.signal,
                });
                if (!res.ok) {
                    const body = await res.text().catch(() => '');
                    return {
                        text: '', toolCalls: [], steps: 0, finishReason: 'error',
                        durationMs: performance.now() - started,
                        error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
                    };
                }
                const data = (await res.json()) as {
                    text?: string;
                    toolCalls?: Array<{ name: string; arguments?: Record<string, unknown>; result?: unknown }>;
                    steps?: number;
                    finishReason?: string;
                };
                return {
                    text: data.text ?? '',
                    toolCalls: (data.toolCalls ?? []).map((c) => ({
                        name: c.name,
                        arguments: c.arguments ?? {},
                        result: c.result ?? null,
                    })),
                    steps: data.steps ?? 0,
                    finishReason: data.finishReason ?? 'stop',
                    durationMs: performance.now() - started,
                };
            } catch (err) {
                return {
                    text: '', toolCalls: [], steps: 0, finishReason: 'error',
                    durationMs: performance.now() - started,
                    error: err instanceof Error ? err.message : String(err),
                };
            } finally {
                clearTimeout(timer);
            }
        },
    };
}

/** Run a task set against one framework and score with the task verifiers. */
export async function runFrameworkBench(
    framework: Framework,
    tasks: readonly AgentTask[],
): Promise<BenchmarkSummary> {
    const results: TaskResult[] = [];
    for (const task of tasks) {
        const run = await framework.run(task);
        const verdict = run.error
            ? { passed: false, reason: `framework error: ${run.error}` }
            : task.verify(run.toolCalls, run.text);
        results.push({
            taskId: task.id,
            domain: task.domain,
            passed: verdict.passed,
            reason: verdict.reason,
            steps: run.steps,
            finishReason: run.finishReason,
            toolCallCount: run.toolCalls.length,
            durationMs: run.durationMs,
            finalText: run.text,
        });
    }
    const passed = results.filter((r) => r.passed).length;
    const byDomain: Record<string, { total: number; passed: number; passRate: number }> = {};
    for (const r of results) {
        const d = byDomain[r.domain] ?? { total: 0, passed: 0, passRate: 0 };
        d.total += 1;
        if (r.passed) d.passed += 1;
        d.passRate = d.passed / d.total;
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

/** Render a side-by-side comparison matrix across frameworks. */
export function formatComparison(
    rows: Array<{ framework: string; version?: string; summary: BenchmarkSummary }>,
): string {
    const lines: string[] = [];
    lines.push('| Framework | Version | Pass rate | Passed/Total | Avg steps | Avg s/task |');
    lines.push('|-----------|---------|-----------|--------------|-----------|------------|');
    for (const r of [...rows].sort((a, b) => b.summary.passRate - a.summary.passRate)) {
        lines.push(
            `| ${r.framework} | ${r.version ?? '—'} | ${(r.summary.passRate * 100).toFixed(1)}% | ` +
            `${r.summary.passed}/${r.summary.total} | ${r.summary.avgSteps.toFixed(1)} | ` +
            `${(r.summary.avgDurationMs / 1000).toFixed(2)} |`,
        );
    }
    return lines.join('\n');
}
