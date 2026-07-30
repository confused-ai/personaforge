/**
 * Unified Lifecycle Hooks
 * =======================
 * A single hook interface that spans tools, agents, and workflows.
 * Provides consistent naming, composable hook chains, and merge utilities.
 *
 * Design principles (from OpenAI Agents SDK, LangChain callbacks, Temporal signals):
 *   - Consistent before/after/onError naming across all layers
 *   - Hooks compose: multiple handlers for the same event run in registration order
 *   - Hooks are isolated: per-run hooks never mutate agent-level hooks
 *   - Zero-cost when omitted: no overhead when no hooks are registered
 *
 * @example
 * ```ts
 * import { mergeHooks, createHookChain } from 'personaforge/hooks';
 *
 * const logging = createLifecycleHooks({
 *   beforeRun: async (ctx) => { console.log('Starting:', ctx.prompt); },
 *   afterRun: async (ctx) => { console.log('Done:', ctx.result?.text); },
 * });
 *
 * const metrics = createLifecycleHooks({
 *   beforeRun: async () => { performance.mark('start'); },
 *   afterRun: async () => { performance.measure('run', 'start'); },
 * });
 *
 * const combined = mergeHooks(logging, metrics);
 * ```
 */

import type { AgenticRunResult, AgenticLifecycleHooks } from '../agentic/types.js';
import type { ToolResult } from '../tools/core/types.js';

// ── Unified Hook Context Types ──────────────────────────────────────────────

export interface HookContext {
    readonly agentId?: string;
    readonly sessionId?: string;
    readonly runId?: string;
    readonly traceId?: string;
    readonly metadata: Record<string, unknown>;
}

export interface ToolHookContext extends HookContext {
    readonly toolName: string;
    readonly step?: number;
}

export interface WorkflowHookContext extends HookContext {
    readonly workflowName: string;
    readonly stageIndex: number;
    readonly stageName?: string;
}

export interface RunHookContext extends HookContext {
    readonly prompt: string;
    readonly result?: AgenticRunResult;
}

// ── Unified Lifecycle Hooks Interface ───────────────────────────────────────

export interface UnifiedLifecycleHooks {
    // ── Run-level hooks (agent runs, workflow executions) ──────────────────
    beforeRun?: (ctx: RunHookContext) => Promise<string | void> | string | void;
    afterRun?: (ctx: RunHookContext) => Promise<AgenticRunResult | void> | AgenticRunResult | void;

    // ── Step-level hooks (agentic loop steps, workflow stages) ─────────────
    beforeStep?: (step: number, ctx: HookContext) => Promise<void> | void;
    afterStep?: (step: number, ctx: HookContext) => Promise<void> | void;

    // ── Tool-level hooks ───────────────────────────────────────────────────
    beforeToolCall?: (ctx: ToolHookContext, args: Record<string, unknown>) =>
        Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
    afterToolCall?: (ctx: ToolHookContext, result: ToolResult | unknown, args: Record<string, unknown>) =>
        Promise<unknown> | unknown;

    // ── Workflow-level hooks ───────────────────────────────────────────────
    beforeWorkflow?: (ctx: WorkflowHookContext) => Promise<void> | void;
    afterWorkflow?: (ctx: WorkflowHookContext, result: AgenticRunResult) => Promise<void> | void;
    beforeStage?: (ctx: WorkflowHookContext) => Promise<string | void> | string | void;
    afterStage?: (ctx: WorkflowHookContext, result: AgenticRunResult) => Promise<void> | void;

    // ── Error hooks ────────────────────────────────────────────────────────
    onError?: (error: Error, ctx: HookContext & { step?: number; toolName?: string }) => Promise<void> | void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createLifecycleHooks(hooks: UnifiedLifecycleHooks): UnifiedLifecycleHooks {
    return { ...hooks };
}

// ── Merge Utilities ─────────────────────────────────────────────────────────

type HookFn = (...args: unknown[]) => unknown;

function mergeHookFns<T extends (...args: never[]) => unknown>(
    a: T | undefined,
    b: T | undefined,
): T | undefined {
    if (!a && !b) return undefined;
    if (!a) return b;
    if (!b) return a;
    return ((...args: Parameters<T>) => {
        const resultA = a(...args);
        const resultB = b(...args);
        if (resultA instanceof Promise && resultB instanceof Promise) {
            return Promise.all([resultA, resultB]).then(([ra, rb]) => (rb ?? ra) as Awaited<ReturnType<T>>);
        }
        if (resultA instanceof Promise) {
            return resultA.then((ra) => (resultB ?? ra) as Awaited<ReturnType<T>>);
        }
        if (resultB instanceof Promise) {
            return resultB.then((rb) => (rb ?? resultA) as Awaited<ReturnType<T>>);
        }
        return (resultB ?? resultA) as ReturnType<T>;
    }) as T;
}

export function mergeHooks(...hookSets: (UnifiedLifecycleHooks | undefined)[]): UnifiedLifecycleHooks {
    const valid = hookSets.filter((h): h is UnifiedLifecycleHooks => h !== undefined);
    if (valid.length === 0) return {};
    if (valid.length === 1) return valid[0]!;

    return valid.reduce<UnifiedLifecycleHooks>((acc, hooks) => ({
        beforeRun: mergeHookFns(acc.beforeRun, hooks.beforeRun),
        afterRun: mergeHookFns(acc.afterRun, hooks.afterRun),
        beforeStep: mergeHookFns(acc.beforeStep, hooks.beforeStep),
        afterStep: mergeHookFns(acc.afterStep, hooks.afterStep),
        beforeToolCall: mergeHookFns(acc.beforeToolCall, hooks.beforeToolCall),
        afterToolCall: mergeHookFns(acc.afterToolCall, hooks.afterToolCall),
        beforeWorkflow: mergeHookFns(acc.beforeWorkflow, hooks.beforeWorkflow),
        afterWorkflow: mergeHookFns(acc.afterWorkflow, hooks.afterWorkflow),
        beforeStage: mergeHookFns(acc.beforeStage, hooks.beforeStage),
        afterStage: mergeHookFns(acc.afterStage, hooks.afterStage),
        onError: mergeHookFns(acc.onError, hooks.onError),
    }), {});
}

// ── Hook Chain (ordered execution) ──────────────────────────────────────────

export interface HookChain<T extends HookFn> {
    add(fn: T): void;
    remove(fn: T): void;
    execute(...args: Parameters<T>): Promise<ReturnType<T> | undefined>;
    clear(): void;
}

export function createHookChain<T extends HookFn>(): HookChain<T> {
    const handlers: T[] = [];

    return {
        add(fn: T): void {
            handlers.push(fn);
        },
        remove(fn: T): void {
            const idx = handlers.indexOf(fn);
            if (idx >= 0) handlers.splice(idx, 1);
        },
        async execute(...args: Parameters<T>): Promise<ReturnType<T> | undefined> {
            let lastResult: ReturnType<T> | undefined;
            for (const fn of handlers) {
                lastResult = (await fn(...args)) as ReturnType<T>;
            }
            return lastResult;
        },
        clear(): void {
            handlers.length = 0;
        },
    };
}

// ── Adapter: Unified → AgenticLifecycleHooks ────────────────────────────────

export function toAgenticHooks(unified: UnifiedLifecycleHooks): AgenticLifecycleHooks {
    const ctx: HookContext = { metadata: {} };

    return {
        ...(unified.beforeRun ? {
            beforeRun: async (prompt: string) => {
                const result = await unified.beforeRun!({ ...ctx, prompt });
                return typeof result === 'string' ? result : prompt;
            },
        } : {}),
        ...(unified.afterRun ? {
            afterRun: async (result: AgenticRunResult) => {
                const out = await unified.afterRun!({ ...ctx, prompt: '', result });
                return (out as AgenticRunResult) ?? result;
            },
        } : {}),
        ...(unified.beforeStep ? {
            beforeStep: async (step: number, messages: unknown[]) => {
                await unified.beforeStep!(step, ctx);
                return messages as import('../core/index.js').Message[];
            },
        } : {}),
        ...(unified.afterStep ? {
            afterStep: async (step: number, _messages: unknown[], _text: string) => {
                await unified.afterStep!(step, ctx);
            },
        } : {}),
        ...(unified.beforeToolCall ? {
            beforeToolCall: async (name: string, args: Record<string, unknown>, step: number) => {
                const result = await unified.beforeToolCall!(
                    { ...ctx, toolName: name, step },
                    args,
                );
                return (result as Record<string, unknown>) ?? args;
            },
        } : {}),
        ...(unified.afterToolCall ? {
            afterToolCall: async (name: string, result: unknown, args: Record<string, unknown>, step: number) => {
                const out = await unified.afterToolCall!(
                    { ...ctx, toolName: name, step },
                    result,
                    args,
                );
                return out ?? result;
            },
        } : {}),
        ...(unified.onError ? {
            onError: async (error: Error, step: number) => {
                await unified.onError!(error, { ...ctx, step });
            },
        } : {}),
    };
}

// ── Adapter: AgenticLifecycleHooks → Unified ────────────────────────────────

export function fromAgenticHooks(agentic: AgenticLifecycleHooks): UnifiedLifecycleHooks {
    return {
        ...(agentic.beforeRun ? {
            beforeRun: async (ctx: RunHookContext) => agentic.beforeRun!(ctx.prompt, {} as never),
        } : {}),
        ...(agentic.afterRun ? {
            afterRun: async (ctx: RunHookContext) => agentic.afterRun!(ctx.result!),
        } : {}),
        ...(agentic.beforeStep ? {
            beforeStep: async (step: number) => {
                await agentic.beforeStep!(step, []);
            },
        } : {}),
        ...(agentic.afterStep ? {
            afterStep: async (step: number) => {
                await agentic.afterStep!(step, [], '');
            },
        } : {}),
        ...(agentic.beforeToolCall ? {
            beforeToolCall: async (ctx: ToolHookContext, args: Record<string, unknown>) =>
                agentic.beforeToolCall!(ctx.toolName, args, ctx.step ?? 0),
        } : {}),
        ...(agentic.afterToolCall ? {
            afterToolCall: async (ctx: ToolHookContext, result: unknown, args: Record<string, unknown>) =>
                agentic.afterToolCall!(ctx.toolName, result, args, ctx.step ?? 0),
        } : {}),
        ...(agentic.onError ? {
            onError: async (error: Error, ctx: HookContext & { step?: number }) =>
                agentic.onError!(error, ctx.step ?? 0),
        } : {}),
    };
}
