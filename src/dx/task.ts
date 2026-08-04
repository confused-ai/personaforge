/**
 * `task()` — wrap any function (or agent) as a named, reusable task unit.
 *
 * A task is the smallest composable unit of work: it has a name, a
 * description, a `run()` call, and an `.asTool()` projection so a parent
 * agent can invoke it via function calling.
 *
 * ```ts
 * import { task, agent } from 'personaforge';
 *
 * const summarize = task({
 *   name: 'summarize',
 *   description: 'Summarize a long document.',
 *   run: async ({ input }) => input.split(' ').slice(0, 20).join(' '),
 * });
 *
 * const out = await summarize.run({ input: '...long text...' });
 * const asTool = summarize.asTool({ name: 'summarize', description: 'Summarize text.' });
 * ```
 */

import { z } from 'zod';
import { tool } from '../tools/core/tool-helper.js';
import type {
    LightweightTool,
    SimpleToolContext,
    ToolObjectSchemaLike,
    ToolSchemaLike,
} from '../tools/core/tool-helper.js';
import type { ToolCategory } from '../tools/core/types.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** Configuration for {@link task}. */
export interface TaskOptions<TInput = unknown, TOutput = unknown> {
    /** Unique task name (used as tool function id). */
    readonly name: string;
    /** Human-readable description (used for delegation). */
    readonly description?: string;
    /** The task implementation : input → output. */
    readonly run: (input: TInput, context?: SimpleToolContext) => Promise<TOutput> | TOutput;
    /** Zod schema for tool parameters (defaults to `{ input: z.unknown() }`). */
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    /** Zod schema for tool output validation. */
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    /** Whether the task should delete its function parameters (strict mode). */
    readonly strict?: boolean;
    /** Maximum execution time in ms. Default: 30_000. */
    readonly timeoutMs?: number;
}

/** Overrides applied when projecting a {@link TaskHandle} to a tool. */
export interface TaskAsToolOptions {
    /** Override the tool name (defaults to the task name). */
    readonly name?: string;
    /** Override the tool description. */
    readonly description?: string;
    /** Tool category for organization. */
    readonly category?: ToolCategory;
    /** Tags for discoverability. */
    readonly tags?: string[];
    /** Maximum execution time in ms. */
    readonly timeoutMs?: number;
}

/** A named, reusable unit of work produced by {@link task}. */
export interface TaskHandle<TInput = unknown, TOutput = unknown> {
    readonly name: string;
    readonly description: string;
    /** Run the task with an input value (and optional tool context). */
    run(input: TInput, context?: SimpleToolContext): Promise<TOutput>;
    /** Alias of `run` — the task input is the tool-parameter object. */
    invoker(input: TInput, context?: SimpleToolContext): Promise<TOutput>;
    /** Expose this task as a tool so an agent can call it. */
    asTool<TOut = unknown>(
        options?: TaskAsToolOptions,
    ): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOut>;
}

const DEFAULT_TASK_PARAMETERS = z.object({
    input: z.unknown().describe('Task input'),
}) as ToolObjectSchemaLike<Record<string, unknown>>;

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Create a named, reusable task from a function.
 */
export function task<TInput = unknown, TOutput = unknown>(
    options: TaskOptions<TInput, TOutput>,
): TaskHandle<TInput, TOutput> {
    const {
        name,
        description = `Run the "${name}" task.`,
        run: runFn,
        parameters = DEFAULT_TASK_PARAMETERS,
        outputSchema,
        strict = true,
        timeoutMs = 30_000,
    } = options;

    const execute = async (params: Record<string, unknown>, ctx: SimpleToolContext): Promise<TOutput> => {
        return runFn(params as TInput, ctx);
    };

    const handle: TaskHandle<TInput, TOutput> = {
        name,
        description,
        async run(input, context) {
            return runFn(input, context);
        },
        /** Alias of `run` — the task input is the tool-parameter object. */
        async invoker(envelope, context) {
            return runFn(envelope, context);
        },
        asTool<TOut = unknown>(userOptions: TaskAsToolOptions = {}) {
            return tool({
                name: userOptions.name ?? name,
                description: userOptions.description ?? description,
                parameters,
                ...(outputSchema !== undefined ? { outputSchema } : {}),
                execute,
                ...(userOptions.timeoutMs !== undefined ? { timeoutMs: userOptions.timeoutMs } : {}),
                ...(userOptions.category !== undefined ? { category: userOptions.category } : {}),
                ...(userOptions.tags !== undefined ? { tags: userOptions.tags } : {}),
                strict,
                timeoutMs,
            } as import('../tools/core/tool-helper.js').ToolHelperConfig<
                ToolObjectSchemaLike<Record<string, unknown>>,
                TOutput
            >) as unknown as LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOut>;
        },
    };

    return handle;
}
