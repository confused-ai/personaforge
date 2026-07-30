/**
 * `tool()` helper — one-line tool definition.
 *
 * Provides a fluent, minimal API for defining tools with Zod schemas,
 * automatic validation, and type-safe execution.
 *
 * @example
 * ```ts
 * import { tool } from 'personaforge';
 * import { z } from 'zod';
 *
 * const weatherTool = tool({
 *   name: 'getWeather',
 *   description: 'Get current weather for a location',
 *   parameters: z.object({
 *     location: z.string().describe('City name'),
 *     unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
 *   }),
 *   execute: async ({ location, unit }) => {
 *     const weather = await fetchWeather(location, unit);
 *     return { temperature: weather.temp, condition: weather.condition };
 *   },
 * });
 *
 * // With needsApproval for human-in-the-loop:
 * const deployTool = tool({
 *   name: 'deploy',
 *   description: 'Deploy to production',
 *   parameters: z.object({ version: z.string() }),
 *   needsApproval: true,
 *   execute: async ({ version }) => { ... },
 * });
 * ```
 */

import type { ToolResult, ToolPermissions } from './types.js';
import { ToolCategory } from './types.js';

// ── Types ──────────────────────────────────────────────────────────────────

type SafeParseResult<TData> =
    | { success: true; data: TData }
    | { success: false; error: { message: string } };

interface SchemaDefLike {
    typeName?: string;
    type?: unknown;
    innerType?: unknown;
    values?: unknown;
    defaultValue?: unknown;
}

export interface ToolSchemaLike<TData = unknown> {
    readonly description?: string;
    readonly shape?: Record<string, ToolSchemaLike<unknown>>;
    readonly _def?: SchemaDefLike;
    safeParse(input: unknown): SafeParseResult<TData>;
    strict?(): ToolObjectSchemaLike<Record<string, unknown>>;
    isOptional?(): boolean;
    isNullable?(): boolean;
}

export interface ToolObjectSchemaLike<TData extends Record<string, unknown> = Record<string, unknown>>
    extends ToolSchemaLike<TData> {
    readonly shape?: Record<string, ToolSchemaLike<unknown>>;
}

type InferToolSchema<TSchema> =
    TSchema extends { _output: infer TOutput } ? TOutput :
        TSchema extends { _type: infer TType } ? TType :
            TSchema extends ToolSchemaLike<infer TData> ? TData : never;

/** Options for the `tool()` helper. */
export interface ToolHelperConfig<TSchema extends ToolObjectSchemaLike<Record<string, unknown>>, TOutput = unknown> {
    /** Unique tool name (used as ID). */
    readonly name: string;
    /** Human-readable description for the LLM. */
    readonly description: string;
    /** Zod schema for parameters. */
    readonly parameters: TSchema;
    /** Optional Zod schema for output validation. */
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    /** Execute function. */
    readonly execute: (params: InferToolSchema<TSchema>, context: SimpleToolContext) => Promise<TOutput> | TOutput;
    /** Require human approval before execution. Default: false. */
    readonly needsApproval?: boolean | ((params: InferToolSchema<TSchema>) => boolean | Promise<boolean>);
    /** Category for organization. Default: 'custom'. */
    readonly category?: ToolCategory;
    /** Tags for discoverability. */
    readonly tags?: string[];
    /** Maximum execution time in ms. Default: 30000. */
    readonly timeoutMs?: number;
    /** Whether to use strict schema mode (no extra properties). Default: true. */
    readonly strict?: boolean;
    /** Called when tool input starts arriving (streaming). */
    readonly onInputStart?: (toolName: string) => void;
    /** Called when tool input chunk arrives (streaming). */
    readonly onInputDelta?: (toolName: string, delta: string) => void;
    /** Called when full tool input is available. */
    readonly onInputAvailable?: (toolName: string, input: InferToolSchema<TSchema>) => void;
    /** Transform tool output before returning to model. */
    readonly toModelOutput?: (output: TOutput) => unknown;
    /** Run before the tool executes. Return false to cancel. */
    readonly beforeExecute?: (params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    /** Run after the tool executes. */
    readonly afterExecute?: (output: TOutput, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<void> | void;
    /** Handle errors thrown during execution. Return a fallback value, or re-throw. */
    readonly onError?: (error: Error, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
}

/** Simplified context available to tool execute functions. */
export interface SimpleToolContext {
    readonly agentId: string;
    readonly sessionId: string;
    readonly abortSignal?: AbortSignal;
}

/** A lightweight tool created by the `tool()` helper. */
export interface LightweightTool<
    TSchema extends ToolObjectSchemaLike<Record<string, unknown>> = ToolObjectSchemaLike<Record<string, unknown>>,
    TOutput = unknown,
> {
    readonly name: string;
    readonly description: string;
    readonly parameters: TSchema;
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    readonly category: ToolCategory;
    readonly tags: string[];
    readonly needsApproval: boolean | ((params: InferToolSchema<TSchema>) => boolean | Promise<boolean>);
    readonly strict: boolean;
    /** Execute with full validation. */
    execute(params: InferToolSchema<TSchema>, context?: Partial<SimpleToolContext>): Promise<ToolResult<TOutput>>;
    /** Validate params without executing. */
    validate(params: unknown): { success: true; data: InferToolSchema<TSchema> } | { success: false; error: unknown };
    /** Convert to the framework's full Tool interface. */
    toFrameworkTool(): import('../../core/index.js').Tool;
    /** Get JSON Schema representation for LLM function calling. */
    toJSONSchema(): Record<string, unknown>;
    /** Lifecycle hooks. */
    readonly hooks: {
        readonly onInputStart?: (toolName: string) => void;
        readonly onInputDelta?: (toolName: string, delta: string) => void;
        readonly onInputAvailable?: (toolName: string, input: InferToolSchema<TSchema>) => void;
        readonly beforeExecute?: (params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
        readonly afterExecute?: (output: TOutput, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<void> | void;
        readonly onError?: (error: Error, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
    };
    /** Transform output for model. */
    readonly toModelOutput?: (output: TOutput) => unknown;
}

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Create a tool with a fluent DX.
 *
 * One function, Zod parameters, auto-validation, type-safe execute.
 */
export function tool<TSchema extends ToolObjectSchemaLike<Record<string, unknown>>, TOutput = unknown>(
    config: ToolHelperConfig<TSchema, TOutput>,
): LightweightTool<TSchema, TOutput> {
    const {
        name,
        description,
        parameters,
        outputSchema,
        execute,
        needsApproval = false,
        category = ToolCategory.CUSTOM,
        tags = [],
        timeoutMs = 30_000,
        strict = true,
        onInputStart,
        onInputDelta,
        onInputAvailable,
        toModelOutput,
        beforeExecute,
        afterExecute,
        onError,
    } = config;

    const lightweight: LightweightTool<TSchema, TOutput> = {
        name,
        description,
        parameters,
        ...(outputSchema !== undefined ? { outputSchema } : {}),
        category,
        tags,
        needsApproval,
        strict,

        async execute(params, context) {
            const t0 = performance.now();
            const startTime = new Date();
            const ctx: SimpleToolContext = {
                agentId: context?.agentId ?? 'unknown',
                sessionId: context?.sessionId ?? 'unknown',
                ...(context?.abortSignal !== undefined ? { abortSignal: context.abortSignal } : {}),
            };

            // Validate input
            const parseResult = parameters.safeParse(params);

            if (!parseResult.success) {
                const executionTimeMs = performance.now() - t0;
                const endTime = new Date();
                return {
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: parseResult.error.message },
                    executionTimeMs,
                    metadata: { startTime, endTime, retries: 0 },
                };
            }

            const validatedParams = parseResult.data as InferToolSchema<TSchema>;

            // beforeExecute hook
            if (beforeExecute) {
                const cancel = await beforeExecute(validatedParams, ctx);
                if (cancel === false) {
                    const executionTimeMs = performance.now() - t0;
                    return {
                        success: false,
                        error: { code: 'CANCELLED', message: `Tool "${name}" execution cancelled by beforeExecute hook` },
                        executionTimeMs,
                        metadata: { startTime, endTime: new Date(), retries: 0 },
                    };
                }
            }

            // Notify streaming hooks
            onInputAvailable?.(name, validatedParams);

            try {
                // Execute with timeout — timer is always cleared to prevent GC leak
                let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
                const result = await Promise.race([
                    execute(validatedParams, ctx),
                    new Promise<never>((_, reject) => {
                        timeoutHandle = setTimeout(
                            () => { reject(new Error(`Tool '${name}' timed out after ${String(timeoutMs)}ms`)); },
                            timeoutMs,
                        );
                    }),
                ]).finally(() => { clearTimeout(timeoutHandle); });

                // Validate output if schema provided
                let validatedOutput = result as TOutput;
                if (outputSchema) {
                    const outputResult = outputSchema.safeParse(result);
                    if (!outputResult.success) {
                        const executionTimeMs = performance.now() - t0;
                        const endTime = new Date();
                        return {
                            success: false,
                            error: {
                                code: 'OUTPUT_VALIDATION_ERROR',
                                message: `output validation failed: ${outputResult.error.message}`,
                            },
                            executionTimeMs,
                            metadata: { startTime, endTime, retries: 0 },
                        };
                    }
                    validatedOutput = outputResult.data as TOutput;
                }

                const executionTimeMs = performance.now() - t0;
                const endTime = new Date();
                const finalResult = (toModelOutput ? await toModelOutput(validatedOutput) : validatedOutput) as TOutput;

                // afterExecute hook
                if (afterExecute) {
                    await afterExecute(finalResult, validatedParams, ctx);
                }

                return {
                    success: true,
                    data: finalResult,
                    executionTimeMs,
                    metadata: { startTime, endTime, retries: 0 },
                };
            } catch (error) {
                const executionTimeMs = performance.now() - t0;
                const endTime = new Date();

                if (onError) {
                    const fallback = await onError(
                        error instanceof Error ? error : new Error(String(error)),
                        validatedParams,
                        ctx,
                    );
                    return {
                        success: true,
                        data: fallback,
                        executionTimeMs,
                        metadata: { startTime, endTime, retries: 0 },
                    };
                }

                return {
                    success: false,
                    error: {
                        code: 'EXECUTION_ERROR',
                        message: error instanceof Error ? error.message : String(error),
                    },
                    executionTimeMs,
                    metadata: { startTime, endTime, retries: 0 },
                };
            }
        },

        validate(params) {
            const schema = strict && typeof parameters.strict === 'function'
                ? (parameters.strict() as TSchema)
                : parameters;
            const result = strict
                ? schema.safeParse(params)
                : parameters.safeParse(params);

            if (result.success) {
                return { success: true, data: result.data as InferToolSchema<TSchema> };
            }
            return { success: false, error: result.error };
        },

        toFrameworkTool() {
            const defaultPerms: ToolPermissions = {
                allowNetwork: true,
                allowFileSystem: false,
                maxExecutionTimeMs: timeoutMs,
            };

            return {
                id: name,
                name,
                description,
                parameters: parameters as unknown as Record<string, unknown>,
                permissions: defaultPerms,
                category,
                version: '1.0.0',
                tags,
                execute: async (input: Record<string, unknown>) => {
                    return lightweight.execute(input as InferToolSchema<TSchema>, {
                        agentId: (input['agentId'] as string | undefined) ?? 'unknown',
                        sessionId: (input['sessionId'] as string | undefined) ?? 'unknown',
                    });
                },
                validate: (params: unknown): params is InferToolSchema<TSchema> => {
                    return parameters.safeParse(params).success;
                },
            };
        },

        toJSONSchema() {
            return zodToJSONSchema(parameters, { name, description, strict });
        },

        hooks: {
            ...(onInputStart !== undefined ? { onInputStart } : {}),
            ...(onInputDelta !== undefined ? { onInputDelta } : {}),
            ...(onInputAvailable !== undefined ? { onInputAvailable } : {}),
            ...(beforeExecute !== undefined ? { beforeExecute } : {}),
            ...(afterExecute !== undefined ? { afterExecute } : {}),
            ...(onError !== undefined ? { onError } : {}),
        },
        ...(toModelOutput !== undefined ? { toModelOutput } : {}),
    };

    return lightweight;
}

// ── Utility: Zod → JSON Schema (minimal for tool calling) ──────────────────

function zodToJSONSchema(
    schema: ToolObjectSchemaLike<Record<string, unknown>>,
    opts: { name: string; description: string; strict: boolean },
): Record<string, unknown> {
    const shape = schema.shape ?? {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
        const zodType = value as ToolSchemaLike<unknown>;
        properties[key] = zodTypeToJSON(zodType);

        // Check if required (not optional, not with default)
        if (!zodType.isOptional?.() && !zodType.isNullable?.()) {
            required.push(key);
        }
    }

    return {
        type: 'function',
        function: {
            name: opts.name,
            description: opts.description,
            strict: opts.strict,
            parameters: {
                type: 'object',
                properties,
                required,
                additionalProperties: !opts.strict,
            },
        },
    };
}

function fallbackSchema(): ToolSchemaLike<unknown> {
    return {
        safeParse: (input) => ({ success: true, data: input }),
    };
}

function zodTypeToJSON(zodType: ToolSchemaLike<unknown>): Record<string, unknown> {
    const desc = zodType.description;
    const base: Record<string, unknown> = {};
    if (desc) base['description'] = desc;

    const def = zodType._def;
    if (!def) return { ...base, type: 'string' };

    const typeName = def.typeName;

    switch (typeName) {
        case 'ZodString':
            return { ...base, type: 'string' };
        case 'ZodNumber':
            return { ...base, type: 'number' };
        case 'ZodBoolean':
            return { ...base, type: 'boolean' };
        case 'ZodArray':
            return {
                ...base,
                type: 'array',
                items: zodTypeToJSON((def.type as ToolSchemaLike<unknown> | undefined) ?? fallbackSchema()),
            };
        case 'ZodEnum':
            return { ...base, type: 'string', enum: def.values };
        case 'ZodOptional':
            return zodTypeToJSON((def.innerType as ToolSchemaLike<unknown> | undefined) ?? fallbackSchema());
        case 'ZodDefault':
            return {
                ...zodTypeToJSON((def.innerType as ToolSchemaLike<unknown> | undefined) ?? fallbackSchema()),
                default: typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue,
            };
        case 'ZodObject': {
            const shape = zodType.shape ?? {};
            const props: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(shape)) {
                props[k] = zodTypeToJSON(v as ToolSchemaLike<unknown>);
            }
            return { ...base, type: 'object', properties: props };
        }
        default:
            return { ...base, type: 'string' };
    }
}

// ── Batch tool creation ────────────────────────────────────────────────────

/**
 * Create multiple tools at once.
 *
 * @example
 * ```ts
 * const tools = createTools({
 *   getWeather: { description: '...', parameters: z.object({...}), execute: ... },
 *   searchDocs: { description: '...', parameters: z.object({...}), execute: ... },
 * });
 *
 * // tools.getWeather — LightweightTool
 * // tools.searchDocs — LightweightTool
 * ```
 */
export function createTools<
    T extends Record<string, Omit<ToolHelperConfig<ToolObjectSchemaLike<Record<string, unknown>>>, 'name'>>,
>(
    defs: T,
): { [K in keyof T]: LightweightTool } {
    const result: Record<string, LightweightTool> = {};
    for (const [name, config] of Object.entries(defs)) {
        result[name] = tool({ ...config, name } as ToolHelperConfig<ToolObjectSchemaLike<Record<string, unknown>>>);
    }
    return result as { [K in keyof T]: LightweightTool };
}

/**
 * Alias for `tool()`.
 *
 * @example
 * ```ts
 * const weather = createTool({
 *   name: 'getWeather',
 *   description: 'Get weather for a city',
 *   parameters: z.object({ city: z.string() }),
 *   execute: async ({ city }) => fetchWeather(city),
 * });
 * ```
 */
export const createTool = tool;

/**
 * Type guard — returns `true` when `value` is a {@link LightweightTool}.
 *
 * Used internally by `createAgent` so you can pass `tool()` results directly
 * in the `tools` array without calling `.toFrameworkTool()`.
 */
export function isLightweightTool(value: unknown): value is LightweightTool {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as LightweightTool).name === 'string' &&
        typeof (value as LightweightTool).description === 'string' &&
        typeof (value as LightweightTool).toFrameworkTool === 'function' &&
        typeof (value as LightweightTool).execute === 'function' &&
        typeof (value as LightweightTool).validate === 'function'
    );
}

// ── Fluent ToolBuilder ─────────────────────────────────────────────────────

interface ToolBuilderState<TSchema extends ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
    name?: string;
    description?: string;
    parameters?: TSchema;
    outputSchema?: ToolSchemaLike<TOutput>;
    execute?: (params: InferToolSchema<TSchema>, context: SimpleToolContext) => Promise<TOutput> | TOutput;
    needsApproval?: boolean | ((params: InferToolSchema<TSchema>) => boolean | Promise<boolean>);
    category?: ToolCategory;
    tags?: string[];
    timeoutMs?: number;
    strict?: boolean;
    onInputStart?: (toolName: string) => void;
    onInputDelta?: (toolName: string, delta: string) => void;
    onInputAvailable?: (toolName: string, input: InferToolSchema<TSchema>) => void;
    toModelOutput?: (output: TOutput) => unknown;
    beforeExecute?: (params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    afterExecute?: (output: TOutput, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<void> | void;
    onError?: (error: Error, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
}

/**
 * Fluent builder for defining tools. Use `defineTool()` to start.
 *
 * @example
 * ```ts
 * import { defineTool } from 'personaforge';
 * import { z } from 'zod';
 *
 * const searchTool = defineTool()
 *   .name('searchDocs')
 *   .description('Search the documentation for a query')
 *   .parameters(z.object({
 *     query: z.string().describe('Search query'),
 *     limit: z.number().optional().default(5),
 *   }))
 *   .execute(async ({ query, limit }) => {
 *     const results = await mySearchFn(query, limit);
 *     return results;
 *   })
 *   .timeout(10_000)
 *   .tag('search')
 *   .build();
 *
 * // Use with createAgent:
 * const agent = createAgent({ instructions: '...', tools: [searchTool.toFrameworkTool()] });
 *
 * // Or with agent():
 * const myAgent = agent({ instructions: '...', tools: [searchTool.toFrameworkTool()] });
 * ```
 */
export class ToolBuilder<
    TSchema extends ToolObjectSchemaLike<Record<string, unknown>> = ToolObjectSchemaLike<Record<string, unknown>>,
    TOutput = unknown,
> {
    private state: ToolBuilderState<TSchema, TOutput> = {};

    /** Set tool name (used as function ID by LLM) */
    name(name: string): this {
        this.state.name = name;
        return this;
    }

    /** Set human-readable description for the LLM */
    description(description: string): this {
        this.state.description = description;
        return this;
    }

    /** Set Zod parameter schema — defines what the LLM passes to the tool */
    parameters<S extends ToolObjectSchemaLike<Record<string, unknown>>>(schema: S): ToolBuilder<S, TOutput> {
        (this as unknown as ToolBuilder<S, TOutput>).state.parameters = schema;
        return this as unknown as ToolBuilder<S, TOutput>;
    }

    /** Set optional Zod output validation schema */
    output<O>(schema: ToolSchemaLike<O>): ToolBuilder<TSchema, O> {
        (this as unknown as ToolBuilder<TSchema, O>).state.outputSchema = schema;
        return this as unknown as ToolBuilder<TSchema, O>;
    }

    /** Set the execute function */
    execute(fn: (params: InferToolSchema<TSchema>, context: SimpleToolContext) => Promise<TOutput> | TOutput): this {
        this.state.execute = fn;
        return this;
    }

    /** Require human approval before this tool runs */
    approval(condition: boolean | ((params: InferToolSchema<TSchema>) => boolean | Promise<boolean>) = true): this {
        this.state.needsApproval = condition;
        return this;
    }

    /** Set tool category for organization */
    category(category: ToolCategory): this {
        this.state.category = category;
        return this;
    }

    /** Add a tag for discoverability */
    tag(tag: string): this {
        this.state.tags = [...(this.state.tags ?? []), tag];
        return this;
    }

    /** Set tags all at once */
    tags(tags: string[]): this {
        this.state.tags = tags;
        return this;
    }

    /** Set execution timeout in ms (default: 30_000) */
    timeout(ms: number): this {
        this.state.timeoutMs = ms;
        return this;
    }

    /** Disable strict schema mode (allow extra properties) */
    loose(): this {
        this.state.strict = false;
        return this;
    }

    /** Hook called when streaming tool input starts */
    onStart(fn: (toolName: string) => void): this {
        this.state.onInputStart = fn;
        return this;
    }

    /** Hook called with each streaming input delta */
    onDelta(fn: (toolName: string, delta: string) => void): this {
        this.state.onInputDelta = fn;
        return this;
    }

    /** Hook called when full streaming input is available */
    onReady(fn: (toolName: string, input: InferToolSchema<TSchema>) => void): this {
        this.state.onInputAvailable = fn;
        return this;
    }

    /** Transform output before returning to the model */
    transform(fn: (output: TOutput) => unknown): this {
        this.state.toModelOutput = fn;
        return this;
    }

    /** Hook: run before the tool executes. Return false to cancel. */
    before(fn: (params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined): this {
        this.state.beforeExecute = fn;
        return this;
    }

    /** Hook: run after the tool executes. */
    after(fn: (output: TOutput, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<void> | void): this {
        this.state.afterExecute = fn;
        return this;
    }

    /** Hook: handle execution errors. Return a fallback value or re-throw. */
    onError(fn: (error: Error, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => TOutput | Promise<TOutput>): this {
        this.state.onError = fn;
        return this;
    }

    /** Build and return a LightweightTool */
    build(): LightweightTool<TSchema, TOutput> {
        if (!this.state.name) throw new Error('defineTool().name("...") is required before .build()');
        if (!this.state.description) throw new Error('defineTool().description("...") is required before .build()');
        if (!this.state.parameters) throw new Error('defineTool().parameters(z.object({...})) is required before .build()');
        if (!this.state.execute) throw new Error('defineTool().execute(async (params) => ...) is required before .build()');

        return tool({
            name: this.state.name,
            description: this.state.description,
            parameters: this.state.parameters,
            outputSchema: this.state.outputSchema,
            execute: this.state.execute,
            needsApproval: this.state.needsApproval,
            category: this.state.category,
            tags: this.state.tags,
            timeoutMs: this.state.timeoutMs,
            strict: this.state.strict,
            onInputStart: this.state.onInputStart,
            onInputDelta: this.state.onInputDelta,
            onInputAvailable: this.state.onInputAvailable,
            toModelOutput: this.state.toModelOutput,
            beforeExecute: this.state.beforeExecute,
            afterExecute: this.state.afterExecute,
            onError: this.state.onError,
        } as ToolHelperConfig<TSchema, TOutput>);
    }
}

/**
 * Start building a tool with a fluent API.
 *
 * @example
 * ```ts
 * import { defineTool } from 'personaforge';
 * import { z } from 'zod';
 *
 * const myTool = defineTool()
 *   .name('fetchPrice')
 *   .description('Get current price for a stock ticker')
 *   .parameters(z.object({ ticker: z.string().describe('Stock symbol e.g. AAPL') }))
 *   .execute(async ({ ticker }) => {
 *     const price = await stockApi.getPrice(ticker);
 *     return { ticker, price };
 *   })
 *   .timeout(5_000)
 *   .build();
 *
 * const myAgent = agent({
 *   instructions: 'You are a financial assistant.',
 *   tools: [myTool.toFrameworkTool()],
 * });
 * ```
 */
/**
 * Fluent tool builder — create a tool step by step.
 *
 * @deprecated Prefer `tool()` for a terser, one-call API with the same
 * features. `defineTool()` will be removed in v2.0.
 *
 * Migration:
 * ```ts
 * // Before:
 * const myTool = defineTool().name('my_tool').description('...').parameters(MySchema).execute(fn).build();
 *
 * // After:
 * import { tool } from '../index.js';
 * const myTool = tool({ name: 'my_tool', description: '...', parameters: MySchema, execute: fn });
 * ```
 */
export function defineTool(): ToolBuilder {
    return new ToolBuilder();
}

// ── Tool Extension / Composition ───────────────────────────────────────────

/**
 * Middleware function signature for tool wrapping.
 * Receives (params, ctx, next) and can transform input/output or add side-effects.
 */
export type ToolWrapMiddleware<TIn = unknown, TOut = unknown> = (
    params: TIn,
    context: SimpleToolContext,
    next: (params: TIn, context: SimpleToolContext) => Promise<TOut>
) => Promise<TOut>;

/**
 * Options for `extendTool()`.
 */
export interface ExtendToolOptions<TSchema extends ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
    /** Override or append to the tool description. */
    description?: string;
    /** Override tool name. */
    name?: string;
    /** Additional tags to add. */
    tags?: string[];
    /** Override category. */
    category?: ToolCategory;
    /**
     * Transform parameters BEFORE the original execute runs.
     * Useful for injecting defaults, normalizing input, or adding context.
     */
    transformInput?: (params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => InferToolSchema<TSchema> | Promise<InferToolSchema<TSchema>>;
    /**
     * Transform the output AFTER the original execute runs.
     * Useful for formatting, enriching, or filtering results.
     */
    transformOutput?: (output: TOutput, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
    /**
     * Run before the tool executes. Return false to cancel execution.
     * Perfect for rate limiting, logging, auth checks.
     */
    beforeExecute?: (params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    /**
     * Run after the tool executes.
     * Perfect for logging results, caching, analytics.
     */
    afterExecute?: (output: TOutput, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<void> | void;
    /**
     * Handle errors thrown during execution.
     * Return a fallback value, or re-throw to propagate.
     */
    onError?: (error: Error, params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
    /** Override the approval requirement. */
    needsApproval?: boolean | ((params: InferToolSchema<TSchema>) => boolean | Promise<boolean>);
    /** Override timeout in ms. */
    timeoutMs?: number;
}

/**
 * Extend any existing `LightweightTool` with new behaviour without modifying the original.
 * Think of it as middleware for a single tool.
 *
 * @example
 * ```ts
 * import { extendTool } from 'personaforge';
 * import { webSearchTool } from 'personaforge/tools';
 *
 * // Add logging + result trimming to the built-in web search tool
 * const cachedSearch = extendTool(webSearchTool, {
 *   name: 'cachedWebSearch',
 *   description: 'Web search — top 3 results only',
 *   beforeExecute: async (params) => {
 *     console.log('Searching for:', params.query);
 *   },
 *   transformOutput: (output) =>
 *     Array.isArray(output) ? output.slice(0, 3) : output,
 * });
 * ```
 */
export function extendTool<TSchema extends ToolObjectSchemaLike<Record<string, unknown>>, TOutput>(
    base: LightweightTool<TSchema, TOutput>,
    options: ExtendToolOptions<TSchema, TOutput>
): LightweightTool<TSchema, TOutput> {
    const wrappedExecute = async (params: InferToolSchema<TSchema>, context: SimpleToolContext): Promise<TOutput> => {
        if (options.beforeExecute) {
            const result = await options.beforeExecute(params, context);
            if (result === false) {
                throw new Error(`Tool "${options.name ?? base.name}" execution cancelled by beforeExecute`);
            }
        }

        const finalParams = options.transformInput
            ? await options.transformInput(params, context)
            : params;

        let output: TOutput;
        try {
            const toolResult = await base.execute(finalParams, context);
            if (!toolResult.success) {
                throw new Error(toolResult.error?.message ?? 'Tool execution failed');
            }
            output = toolResult.data as TOutput;
        } catch (err) {
            if (options.onError) {
                output = await options.onError(
                    err instanceof Error ? err : new Error(String(err)),
                    finalParams,
                    context
                );
            } else {
                throw err;
            }
        }

        if (options.transformOutput) {
            output = await options.transformOutput(output, finalParams, context);
        }

        if (options.afterExecute) {
            await options.afterExecute(output, finalParams, context);
        }

        return output;
    };

    return tool({
        name: options.name ?? base.name,
        description: options.description ?? base.description,
        parameters: base.parameters,
        execute: wrappedExecute,
        needsApproval: options.needsApproval,
        category: options.category,
        tags: [...base.tags, ...(options.tags ?? [])],
        timeoutMs: options.timeoutMs,
        ...(base.outputSchema !== undefined ? { outputSchema: base.outputSchema } : {}),
    } as ToolHelperConfig<TSchema, TOutput>);
}

/**
 * Apply a middleware pipeline to a tool (onion model: first wraps outermost).
 *
 * @example
 * ```ts
 * import { wrapTool } from 'personaforge';
 *
 * const safeTool = wrapTool(myTool, [
 *   // Auth check
 *   async (params, ctx, next) => {
 *     if (!ctx.metadata?.userId) throw new Error('Unauthorized');
 *     return next(params, ctx);
 *   },
 *   // Cache layer
 *   async (params, ctx, next) => {
 *     const key = JSON.stringify(params);
 *     const hit = await cache.get(key);
 *     if (hit) return hit;
 *     const result = await next(params, ctx);
 *     await cache.set(key, result, 300);
 *     return result;
 *   },
 * ]);
 * ```
 */
export function wrapTool<TSchema extends ToolObjectSchemaLike<Record<string, unknown>>, TOutput>(
    base: LightweightTool<TSchema, TOutput>,
    middlewares: ToolWrapMiddleware<InferToolSchema<TSchema>, TOutput>[],
    overrides: { name?: string; description?: string; tags?: string[] } = {}
): LightweightTool<TSchema, TOutput> {
    if (middlewares.length === 0) return base;

    // Unwrap ToolResult so middlewares work with plain TOutput
    const baseExecute = async (params: InferToolSchema<TSchema>, ctx: SimpleToolContext): Promise<TOutput> => {
        const result = await base.execute(params, ctx);
        if (!result.success) throw new Error(result.error?.message ?? 'Tool execution failed');
        return result.data as TOutput;
    };
    const chain = middlewares.reduceRight<(params: InferToolSchema<TSchema>, ctx: SimpleToolContext) => Promise<TOutput>>(
        (next, mw) => (params, ctx) => mw(params, ctx, next),
        baseExecute
    );

    return tool({
        name: overrides.name ?? base.name,
        description: overrides.description ?? base.description,
        parameters: base.parameters,
        execute: chain,
        tags: [...base.tags, ...(overrides.tags ?? [])],
        ...(base.outputSchema !== undefined ? { outputSchema: base.outputSchema } : {}),
    });
}

/**
 * Pipe two tools together — output of the first becomes input of the second.
 *
 * @example
 * ```ts
 * import { pipeTools, fetchUrlTool, myParserTool } from 'personaforge';
 *
 * const fetchAndParse = pipeTools(fetchUrlTool, myParserTool, {
 *   name: 'fetchAndParse',
 *   description: 'Fetch URL then parse the HTML',
 *   adapter: (fetchResult) => ({ html: fetchResult.body }),
 * });
 * ```
 */
export function pipeTools<
    TSchema extends ToolObjectSchemaLike<Record<string, unknown>>,
    TMid,
    TOutput,
>(
    first: LightweightTool<TSchema, TMid>,
    second: LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput>,
    options: {
        name: string;
        description: string;
        adapter: (firstOutput: TMid, originalParams: InferToolSchema<TSchema>) => Record<string, unknown>;
        tags?: string[];
    }
): LightweightTool<TSchema, TOutput> {
    return tool({
        name: options.name,
        description: options.description,
        parameters: first.parameters,
        tags: options.tags,
        ...(second.outputSchema !== undefined ? { outputSchema: second.outputSchema } : {}),
        execute: async (params, ctx) => {
            const firstResult = await first.execute(params, ctx);
            if (!firstResult.success) throw new Error(firstResult.error?.message ?? 'First tool failed');
            const secondParams = options.adapter(firstResult.data as TMid, params);
            const secondResult = await second.execute(secondParams, ctx);
            if (!secondResult.success) throw new Error(secondResult.error?.message ?? 'Second tool failed');
            return secondResult.data as TOutput;
        },
    } as ToolHelperConfig<TSchema, TOutput>);
}

/**
 * Tag a tool with a version string (non-breaking wrapper).
 *
 * @example
 * ```ts
 * const searchV2 = versionTool(searchTool, '2.0', {
 *   changelog: 'Returns structured results with source URLs',
 * });
 * ```
 */
export function versionTool<TSchema extends ToolObjectSchemaLike<Record<string, unknown>>, TOutput>(
    base: LightweightTool<TSchema, TOutput>,
    version: string,
    options: { changelog?: string; deprecated?: boolean; replacedBy?: string } = {}
): LightweightTool<TSchema, TOutput> {
    const deprecationNote = options.deprecated
        ? ` [DEPRECATED${options.replacedBy ? ` — use ${options.replacedBy} instead` : ''}]`
        : '';
    const changelogNote = options.changelog ? ` v${version}: ${options.changelog}` : '';
    return extendTool(base, {
        name: `${base.name}_v${version.replace(/\./g, '_')}`,
        description: `${base.description}${deprecationNote}${changelogNote}`,
        tags: [`v${version}`, ...(options.deprecated ? ['deprecated'] : [])],
    });
}

