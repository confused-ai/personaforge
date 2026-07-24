/**
 * personaforge as a `Framework` for the cross-framework comparison matrix.
 *
 * Wraps the native in-process harness so personaforge appears alongside the
 * HTTP-driven frameworks (agno / langgraph / mastra / crewai) in a single
 * `formatComparison` table — no server round-trip needed for our own runtime.
 */

import { AgenticRunner } from '../../../src/agentic/runner.js';
import type { LLMProvider, Tool, ToolRegistry } from '../../../src/core/index.js';
import type { AgentTask } from '../harness.js';
import type { Framework, FrameworkRunResult } from './framework.js';
import type { RecordedCall } from '../harness.js';

function recordCalls(tools: readonly Tool[]): { instrumented: Tool[]; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const instrumented = tools.map((t) => {
        const orig = t.execute.bind(t);
        return {
            ...t,
            async execute(params: Record<string, unknown>, ctx: unknown) {
                const result = await orig(params, ctx as never);
                calls.push({ name: t.name, arguments: params, result });
                return result;
            },
        } as Tool;
    });
    return { instrumented, calls };
}

function registryFrom(tools: Tool[]): ToolRegistry {
    const map = new Map(tools.map((t) => [t.name, t]));
    return {
        register: () => undefined,
        unregister: () => undefined,
        get: (id: string) => map.get(id),
        getByName: (n: string) => map.get(n),
        list: () => tools,
        listByCategory: () => tools,
        search: () => tools,
        has: (id: string) => map.has(id),
    } as unknown as ToolRegistry;
}

export function personaforgeFramework(llm: LLMProvider, version = 'dev'): Framework {
    return {
        name: 'personaforge',
        version,
        async run(task: AgentTask): Promise<FrameworkRunResult> {
            const { instrumented, calls } = recordCalls(task.tools);
            const runner = new AgenticRunner({
                llm,
                tools: registryFrom(instrumented),
                maxSteps: task.maxSteps ?? 8,
                timeoutMs: 90_000,
                retry: { maxRetries: 0 },
            });
            const started = performance.now();
            try {
                const res = await runner.run({
                    instructions: task.instruction,
                    prompt: task.instruction,
                });
                return {
                    text: res.text,
                    toolCalls: calls,
                    steps: res.steps,
                    finishReason: res.finishReason,
                    durationMs: performance.now() - started,
                };
            } catch (err) {
                return {
                    text: '', toolCalls: calls, steps: 0, finishReason: 'error',
                    durationMs: performance.now() - started,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    };
}
