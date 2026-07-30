/**
 * Tool Composition Helpers
 * =========================
 * Higher-order functions that wrap or combine `Tool` instances into new ones.
 *
 * Primitives:
 *   composeTool   — chain tools sequentially (output of A feeds into B)
 *   parallelTools — run multiple tools concurrently, merge results
 *   fallbackTool  — try primary tool; use secondary on error/failure
 *   retryTool     — retry a tool N times with exponential back-off
 *   timeoutTool   — apply a per-execute deadline
 *   mapTool       — transform a tool's output without changing its interface
 *   filterTool    — only execute a tool when a predicate is true, else return empty
 *
 * All returned tools are fully `Tool<>`-compatible and can be registered in any
 * `ToolRegistry` or passed directly to `AgenticRunner`.
 *
 * Usage:
 *   import { composeTool, parallelTools, fallbackTool } from './compose.js';
 *
 *   const enriched = composeTool(fetchTool, summarizeTool, {
 *     id: 'fetch-and-summarize',
 *     name: 'fetch_and_summarize',
 *     description: 'Fetch a URL and return a summary.',
 *   });
 */

import { z } from 'zod';
import type { Tool, ToolResult, ToolContext, ToolPermissions } from '../agentic/index.js';
import { ToolCategory } from '../agentic/index.js';

// ── Internal factory helpers ──────────────────────────────────────────────────

const DEFAULT_PERMISSIONS: ToolPermissions = {
    allowNetwork:     false,
    allowFileSystem:  false,
    maxExecutionTimeMs: 30_000,
};

function _now(): Date { return new Date(); }

function _ok<T>(data: T, startTime: Date): ToolResult<T> {
    const endTime = _now();
    return {
        success: true, data,
        executionTimeMs: endTime.getTime() - startTime.getTime(),
        metadata: { startTime, endTime, retries: 0 },
    };
}

function _err(message: string, code: string, startTime: Date): ToolResult<never> {
    const endTime = _now();
    return {
        success: false,
        error: { code, message },
        executionTimeMs: endTime.getTime() - startTime.getTime(),
        metadata: { startTime, endTime, retries: 0 },
    };
}

// ── composeTool ───────────────────────────────────────────────────────────────

export interface ComposeToolOptions {
    id:          string;
    name:        string;
    description: string;
    /** Permissions for the composed tool. Defaults to union of both tools' permissions. */
    permissions?: Partial<ToolPermissions>;
    category?:   ToolCategory;
}

/**
 * Chain two tools: the output of `first` becomes the input to `second`.
 * The composed tool accepts the same parameters as `first`.
 * `second` is called with `{ input: <first output> }`.
 */
export function composeTool<
    P extends z.ZodObject<Record<string, z.ZodType>>,
    A,
    B,
>(
    first:   Tool<P, A>,
    second:  Tool<z.ZodObject<{ input: z.ZodType }>, B>,
    options: ComposeToolOptions,
): Tool<P, B> {
    const mergedPerms: ToolPermissions = {
        allowNetwork:     first.permissions.allowNetwork     || second.permissions.allowNetwork,
        allowFileSystem:  first.permissions.allowFileSystem  || second.permissions.allowFileSystem,
        maxExecutionTimeMs: Math.max(first.permissions.maxExecutionTimeMs, second.permissions.maxExecutionTimeMs),
        ...options.permissions,
    };

    return {
        id:          options.id,
        name:        options.name,
        description: options.description,
        parameters:  first.parameters,
        permissions: mergedPerms,
        category:    options.category ?? ToolCategory.CUSTOM,
        version:     '1.0.0',
        validate: (p): p is z.infer<P> => first.validate(p),

        async execute(params, ctx): Promise<ToolResult<B>> {
            const t0 = _now();
            const r1 = await first.execute(params, ctx);
            if (!r1.success) {
                return { ...r1, success: false, metadata: { ...r1.metadata, startTime: t0 } } as unknown as ToolResult<B>;
            }
            const r2 = await second.execute({ input: r1.data }, ctx);
            return r2;
        },
    };
}

// ── parallelTools ─────────────────────────────────────────────────────────────

export interface ParallelToolsOptions {
    id:          string;
    name:        string;
    description: string;
    /** If true (default), fail if ANY tool fails. If false, collect only successes. */
    failFast?:   boolean;
    permissions?: Partial<ToolPermissions>;
    category?:   ToolCategory;
}

/**
 * Run multiple tools with the SAME parameter schema concurrently.
 * Returns a combined result whose `data` is an array of each tool's output.
 */
export function parallelTools<
    P extends z.ZodObject<Record<string, z.ZodType>>,
    T,
>(
    tools:   Tool<P, T>[],
    options: ParallelToolsOptions,
): Tool<P, T[]> {
    if (tools.length === 0) throw new Error('parallelTools: at least one tool required');

    const failFast = options.failFast ?? true;

    const mergedPerms: ToolPermissions = tools.reduce<ToolPermissions>((acc, t) => ({
        allowNetwork:       acc.allowNetwork       || t.permissions.allowNetwork,
        allowFileSystem:    acc.allowFileSystem     || t.permissions.allowFileSystem,
        maxExecutionTimeMs: Math.max(acc.maxExecutionTimeMs, t.permissions.maxExecutionTimeMs),
    }), { ...DEFAULT_PERMISSIONS, ...options.permissions });

    return {
        id:          options.id,
        name:        options.name,
        description: options.description,

        parameters:  tools[0]!.parameters,
        permissions: mergedPerms,
        category:    options.category ?? ToolCategory.CUSTOM,
        version:     '1.0.0',


        validate: (p): p is z.infer<P> => tools[0]!.validate(p),

        async execute(params, ctx): Promise<ToolResult<T[]>> {
            const t0 = _now();
            const results = await Promise.all(tools.map((t) => t.execute(params, ctx)));
            const failures = results.filter((r) => !r.success);
            if (failFast && failures.length > 0) {
                return _err(
                    failures.map((f) => f.error?.message ?? 'unknown').join('; '),
                    'PARALLEL_TOOL_FAILURE',
                    t0,
                );
            }
            const data = results.filter((r) => r.success).map((r) => r.data as T);
            return _ok(data, t0);
        },
    };
}

// ── fallbackTool ──────────────────────────────────────────────────────────────

export interface FallbackToolOptions {
    id:          string;
    name:        string;
    description: string;
    permissions?: Partial<ToolPermissions>;
    category?:   ToolCategory;
}

/**
 * Try `primary`; if it fails (or `shouldFallback` returns true), run `secondary`.
 */
export function fallbackTool<
    P extends z.ZodObject<Record<string, z.ZodType>>,
    T,
>(
    primary:   Tool<P, T>,
    secondary: Tool<P, T>,
    options:   FallbackToolOptions & {
        /** Custom predicate — fallback when this returns true. Default: any failure. */
        shouldFallback?: (result: ToolResult<T>) => boolean;
    } = { id: '', name: '', description: '' },
): Tool<P, T> {
    const shouldFallback = options.shouldFallback ?? ((r: ToolResult<T>) => !r.success);
    const mergedPerms: ToolPermissions = {
        allowNetwork:       primary.permissions.allowNetwork       || secondary.permissions.allowNetwork,
        allowFileSystem:    primary.permissions.allowFileSystem     || secondary.permissions.allowFileSystem,
        maxExecutionTimeMs: Math.max(primary.permissions.maxExecutionTimeMs, secondary.permissions.maxExecutionTimeMs),
        ...options.permissions,
    };

    return {
        id:          options.id,
        name:        options.name,
        description: options.description,
        parameters:  primary.parameters,
        permissions: mergedPerms,
        category:    options.category ?? ToolCategory.CUSTOM,
        version:     '1.0.0',

        validate: (p): p is z.infer<P> => primary.validate(p),

        async execute(params, ctx): Promise<ToolResult<T>> {
            const r1 = await primary.execute(params, ctx);
            if (!shouldFallback(r1)) return r1;
            return secondary.execute(params, ctx);
        },
    };
}

// ── retryTool ─────────────────────────────────────────────────────────────────

export interface RetryToolOptions {
    /** Max total attempts (including first). Default: 3 */
    maxAttempts?:    number;
    /** Initial back-off in ms. Doubles each retry. Default: 200 */
    backoffMs?:      number;
    /** Custom predicate — retry when this returns true. Default: any failure. */
    shouldRetry?:    (result: ToolResult, attempt: number) => boolean;
}

/**
 * Wrap a tool with automatic retries and exponential back-off.
 */
export function retryTool<
    P extends z.ZodObject<Record<string, z.ZodType>>,
    T,
>(
    tool:    Tool<P, T>,
    options: RetryToolOptions = {},
): Tool<P, T> {
    const maxAttempts = options.maxAttempts ?? 3;
    const backoffMs   = options.backoffMs   ?? 200;
    const shouldRetry: (result: ToolResult, attempt: number) => boolean =
        options.shouldRetry ?? ((r: ToolResult) => !r.success);

    return {
        ...tool,
        id: `${tool.id}:retry`,

        async execute(params, ctx): Promise<ToolResult<T>> {
            let result: ToolResult<T> | null = null;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                result = await tool.execute(params, ctx);
                if (!shouldRetry(result, attempt)) return result;
                if (attempt < maxAttempts) {
                    await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt - 1)));
                }
            }

            return result!;
        },
    };
}

// ── timeoutTool ───────────────────────────────────────────────────────────────

/**
 * Enforce a per-execute wall-clock timeout (in ms).
 * Rejects with a structured error if the tool exceeds the limit.
 */
export function timeoutTool<
    P extends z.ZodObject<Record<string, z.ZodType>>,
    T,
>(
    tool:      Tool<P, T>,
    timeoutMs: number,
): Tool<P, T> {
    return {
        ...tool,
        id: `${tool.id}:timeout(${timeoutMs})`,
        permissions: { ...tool.permissions, maxExecutionTimeMs: timeoutMs },

        async execute(params, ctx): Promise<ToolResult<T>> {
            const t0 = _now();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const deadline = new Promise<ToolResult<T>>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`Tool "${tool.name}" timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            });
            try {
                return await Promise.race([tool.execute(params, ctx), deadline]);
            } catch (err) {
                return _err(err instanceof Error ? err.message : String(err), 'TOOL_TIMEOUT', t0);
            } finally {
                if (timer !== undefined) clearTimeout(timer);
            }
        },
    };
}

// ── mapTool ───────────────────────────────────────────────────────────────────

/**
 * Transform a tool's successful output without changing its interface.
 */
export function mapTool<
    P extends z.ZodObject<Record<string, z.ZodType>>,
    TIn,
    TOut,
>(
    tool:    Tool<P, TIn>,
    mapper:  (data: TIn) => TOut | Promise<TOut>,
    options: { id?: string; description?: string } = {},
): Tool<P, TOut> {
    return {
        ...tool,
        id:          options.id          ?? `${tool.id}:mapped`,
        description: options.description ?? tool.description,
        async execute(params, ctx): Promise<ToolResult<TOut>> {
            const result = await tool.execute(params, ctx);
            if (!result.success) return result as unknown as ToolResult<TOut>;
            try {
                const mapped = await mapper(result.data as TIn);
                return { ...result, data: mapped };
            } catch (err) {
                return _err(err instanceof Error ? err.message : String(err), 'MAP_ERROR', result.metadata.startTime);
            }
        },
    };
}

// ── filterTool ────────────────────────────────────────────────────────────────

/**
 * Only execute `tool` when `predicate` returns true.
 * When the predicate returns false, returns an empty successful result (null data).
 */
export function filterTool<
    P extends z.ZodObject<Record<string, z.ZodType>>,
    T,
>(
    tool:      Tool<P, T>,
    predicate: (params: z.infer<P>, ctx: ToolContext) => boolean | Promise<boolean>,
): Tool<P, T | null> {
    return {
        ...tool,
        id: `${tool.id}:filtered`,

        async execute(params, ctx): Promise<ToolResult<T | null>> {
            const t0 = _now();
            const run = await predicate(params, ctx);
            if (!run) return _ok(null, t0);
            return tool.execute(params, ctx);
        },
    };
}
