import { z } from 'zod';
import { parse } from '../validation/index.js';
import type { SchemaInput } from '../validation/index.js';
import { MemoryStore, InMemoryStore } from '../memory/index.js';
import { ToolRegistry, ToolRegistryImpl, Tool } from '../tools/index.js';
import { ClassicalPlanner, PlanningAlgorithm } from '../planner/index.js';
import type { Planner } from '../planner/index.js';
import { ExecutionEngine, ExecutionEngineImpl } from '../execution/index.js';
import type { Skill } from '../contracts/index.js';
import type { SessionStore } from '../session/index.js';
import type { AgentDefinitionConfig, AgentRunConfig } from './types.js';
import { generateEntityId } from '../core/index.js';

// ---------------------------------------------------------------------------
// AgentStreamEvent
// ---------------------------------------------------------------------------

/**
 * A discrete event emitted by {@link TypedAgent.stream} during an agent run.
 *
 * Events arrive in-order and together form a complete picture of a single run:
 *
 * ```
 * text          — narrative text chunk produced by the model
 * tool_call     — the agent is about to invoke a tool
 * tool_result   — the tool returned a result
 * done          — the run completed successfully (final event)
 * error         — an unrecoverable error occurred (final event)
 * ```
 *
 * @example
 * ```ts
 * for await (const event of agent.stream(input)) {
 *   switch (event.type) {
 *     case 'text':       process.stdout.write(event.content ?? ''); break;
 *     case 'tool_call':  console.log('calling', event.toolName);    break;
 *     case 'tool_result':console.log('result', event.toolOutput);   break;
 *     case 'done':       console.log('finished');                    break;
 *     case 'error':      console.error(event.error);                 break;
 *   }
 * }
 * ```
 */
export interface AgentStreamEvent {
    /** Discriminant that identifies the kind of event. */
    type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
    /**
     * Human-readable text produced by the model.
     * Present on `text` events; absent on all others.
     */
    content?: string;
    /**
     * Name of the tool being invoked.
     * Present on `tool_call` and `tool_result` events.
     */
    toolName?: string;
    /**
     * Parsed arguments passed to the tool.
     * Present on `tool_call` events.
     */
    toolInput?: unknown;
    /**
     * Value returned by the tool after execution.
     * Present on `tool_result` events.
     */
    toolOutput?: unknown;
    /**
     * The caught error value.
     * Present only on `error` events.
     */
    error?: unknown;
}

// ---------------------------------------------------------------------------
// TypedAgentResult
// ---------------------------------------------------------------------------

/**
 * The value returned by {@link TypedAgent.run} and {@link TypedAgent.resume}.
 *
 * It is a strict superset of the typed output `TOut` — every key from your
 * output schema is present — augmented with two correlation identifiers:
 *
 * - **`sessionId`** — groups multiple runs belonging to the same conversation.
 * - **`runId`** — uniquely identifies this specific execution; use it to
 *   {@link TypedAgent.resume | resume} the run after a crash or checkpoint.
 *
 * @template TOut The output type inferred from the agent's output schema.
 */
export type TypedAgentResult<TOut> = TOut & { sessionId: string; runId: string };

// ---------------------------------------------------------------------------
// TypedAgent
// ---------------------------------------------------------------------------

/**
 * A schema-typed, runnable agent produced by the fluent {@link defineAgent} builder.
 *
 * `TypedAgent<TIn, TOut>` is the public surface returned by
 * {@link AgentBuilder.build}. Both type parameters are inferred automatically
 * from the schemas you pass to {@link AgentBuilder.input} and
 * {@link AgentBuilder.output}.
 *
 * **Lifecycle overview:**
 * ```
 * defineAgent(name)
 *   .model(...)
 *   .input(schema)      ← narrows TIn
 *   .output(schema)     ← narrows TOut
 *   .instructions(...)
 *   .tools([...])
 *   .build()            ← returns TypedAgent<TIn, TOut>
 *
 * agent.run(input)      ← single blocking call
 * agent.stream(input)   ← async-iterable of AgentStreamEvents
 * agent.resume(runId)   ← re-run from last checkpoint
 * agent.plan(goal)      ← standalone planning without executing
 * agent.getConfig()     ← read-only snapshot of the builder config
 * ```
 *
 * @template TIn  Input type, inferred from the Zod input schema.
 * @template TOut Output type, inferred from the Zod output schema.
 *
 * @see {@link defineAgent} for the recommended entry point.
 * @see {@link AgentBuilder} for all chainable configuration options.
 */
export interface TypedAgent<TIn, TOut> {
    /**
     * Execute the agent synchronously and return the validated output.
     *
     * The input is validated against the agent's input schema before
     * execution. The output is validated against the output schema before
     * being returned. Both `sessionId` and `runId` are appended to the
     * result for correlation and resumability.
     *
     * A checkpoint is automatically saved so the run can be
     * {@link resume | resumed} with the same `runId`.
     *
     * @param input   The typed input value (must satisfy `TIn`).
     * @param opts.sessionId  Optional session identifier to group related runs.
     *                        Auto-generated when omitted.
     * @param opts.context    Arbitrary key/value pairs forwarded to the handler
     *                        via the internal context object.
     * @returns The validated `TOut` value merged with `{ sessionId, runId }`.
     *
     * @example
     * ```ts
     * const result = await agent.run({ question: 'What is 2 + 2?' });
     * console.log(result.answer);   // "4"
     * console.log(result.runId);    // "run_abc123"
     * ```
     */
    run(input: TIn, opts?: { sessionId?: string; context?: Record<string, unknown> }): Promise<TypedAgentResult<TOut>>;

    /**
     * Stream incremental {@link AgentStreamEvent} objects as the agent runs.
     *
     * Use this instead of {@link run} when you want to display intermediate
     * text, observe tool calls, or surface progress to an end-user in
     * real-time. The async iterable always ends with either a `done` or an
     * `error` event.
     *
     * @param input         The typed input value (must satisfy `TIn`).
     * @param opts.sessionId Optional session identifier. Auto-generated when omitted.
     * @yields {@link AgentStreamEvent} objects in chronological order.
     *
     * @example
     * ```ts
     * for await (const event of agent.stream({ question: 'Explain quantum computing' })) {
     *   if (event.type === 'text') process.stdout.write(event.content ?? '');
     *   if (event.type === 'done') console.log('\nDone!');
     * }
     * ```
     */
    stream(input: TIn, opts?: { sessionId?: string }): AsyncIterable<AgentStreamEvent>;

    /**
     * Resume a previously started run from its last saved checkpoint.
     *
     * Every call to {@link run} stores a checkpoint keyed by the returned
     * `runId`. Pass that `runId` here to re-execute the agent with the
     * original input and session context — useful after a crash, a
     * long-running pause, or an external interrupt.
     *
     * The resumed run receives a `__resumed: true` flag in its context, which
     * handlers can inspect to alter behaviour (e.g. skip already-completed
     * steps).
     *
     * @param runId       The `runId` from a previous {@link run} result.
     * @param opts.context Extra context to merge with the original checkpoint context.
     * @returns The same {@link TypedAgentResult} shape with the original `sessionId`.
     * @throws `Error` if no checkpoint exists for the given `runId`.
     *
     * @example
     * ```ts
     * const { runId } = await agent.run(input);
     * // ... later, after a restart ...
     * const result = await agent.resume(runId);
     * ```
     */
    resume(runId: string, opts?: { context?: Record<string, unknown> }): Promise<TypedAgentResult<TOut>>;

    /**
     * Generate a multi-step plan for a goal string without executing it.
     *
     * Delegates to the agent's internal {@link ClassicalPlanner} using the
     * `HIERARCHICAL` algorithm. The returned `Plan` lists ordered steps and
     * the tool names required for each step, given the tools currently
     * registered with this agent.
     *
     * @param goal A natural-language description of the objective to plan for.
     * @returns A resolved `Plan` object containing the ordered step list.
     *
     * @example
     * ```ts
     * const plan = await agent.plan('Research and summarise the top 5 AI papers from 2025');
     * console.log(plan.steps);
     * ```
     */
    plan(goal: string): Promise<import('../planner/index.js').Plan>;

    /**
     * Return a shallow copy of the internal builder configuration.
     *
     * Useful for introspection, debugging, or deriving a new agent from an
     * existing one without re-specifying every option.
     *
     * @returns A read-only snapshot of {@link AgentBuilderConfig}.
     *
     * @example
     * ```ts
     * const { name, modelRef, tools } = agent.getConfig();
     * ```
     */
    getConfig(): AgentBuilderConfig<TIn, TOut>;
}

// ---------------------------------------------------------------------------
// Internal builder config
// ---------------------------------------------------------------------------

/**
 * Internal configuration snapshot carried by {@link AgentBuilder}.
 *
 * Every builder method returns a **new** `AgentBuilder` holding a new copy of
 * this record — the builder is therefore immutable and safe to fork:
 *
 * ```ts
 * const base = defineAgent('base').model('openai:gpt-4o').instructions('...');
 * const agentA = base.tools([toolA]).build();
 * const agentB = base.tools([toolB]).build(); // base is unchanged
 * ```
 *
 * @internal Not part of the public API surface.
 */
interface AgentBuilderConfig<TIn, TOut> {
    /** Human-readable agent name used in logs and stream prefixes. */
    name: string;
    /** Base system instructions. Skill instructions are appended at run-time. */
    instructions: string;
    /** Provider-qualified model reference, e.g. `"openai:gpt-4o"`. */
    modelRef: string;
    /** Zod schema used to validate and infer the input type `TIn`. */
    inputSchema: SchemaInput<unknown, TIn>;
    /** Zod schema used to validate and infer the output type `TOut`. */
    outputSchema: SchemaInput<unknown, TOut>;
    /** Tools registered in the tool registry at construction time. */
    tools: Tool[];
    /** Skills whose instructions are prepended and whose tools are registered. */
    skills: Skill[];
    /** Optional persistent memory store. Falls back to `InMemoryStore`. */
    memory: MemoryStore | null;
    /** Optional session store for conversation history. */
    session: SessionStore | null;
    /**
     * Optional custom execution handler.
     * When omitted the agent passes `validatedInput` through the output schema.
     */
    handler?: (input: TIn, context?: Record<string, unknown>) => Promise<TOut> | TOut;
    /** Maximum reasoning loop iterations before the run is forcibly aborted. */
    maxIterations: number;
    /** Wall-clock timeout in milliseconds for the entire run. */
    timeoutMs: number;
}

// ---------------------------------------------------------------------------
// AgentBuilder
// ---------------------------------------------------------------------------

/**
 * Immutable, fluent builder for constructing a {@link TypedAgent}.
 *
 * Each method returns a **new** `AgentBuilder` instance so the original is
 * never mutated — you can safely branch from a shared base:
 *
 * ```ts
 * const base = defineAgent('assistant')
 *   .model('openai:gpt-4o')
 *   .instructions('You are a helpful assistant.');
 *
 * // Two independent agents derived from the same base:
 * const chatAgent    = base.tools([searchTool]).build();
 * const summaryAgent = base.output(z.object({ summary: z.string() })).build();
 * ```
 *
 * Call {@link build} at the end of the chain to obtain the runnable
 * {@link TypedAgent}.
 *
 * @template TIn  Current input type (updated by {@link input}).
 * @template TOut Current output type (updated by {@link output}).
 *
 * @see {@link defineAgent} — the recommended way to start a new builder.
 */
export class AgentBuilder<TIn, TOut> {
    private cfg: AgentBuilderConfig<TIn, TOut>;

    constructor(cfg: AgentBuilderConfig<TIn, TOut>) {
        this.cfg = { ...cfg };
    }

    /**
     * Set the LLM backend using a provider-qualified reference.
     *
     * The format is `"<provider>:<model-id>"`, where `provider` is the
     * registered provider name and `model-id` is any model identifier
     * that provider supports.
     *
     * @param ref Provider-qualified model string, e.g. `"openai:gpt-4o"`,
     *            `"anthropic:claude-3-5-sonnet"`, or `"azure:gpt-4"`.
     * @returns A new builder with the updated model reference.
     *
     * @example
     * ```ts
     * defineAgent('my-agent').model('openai:gpt-4o')
     * ```
     */
    model(ref: `${string}:${string}`): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, modelRef: ref });
    }

    /**
     * Replace the input schema, narrowing the builder's `TIn` type parameter.
     *
     * The provided Zod schema is used to:
     * 1. Validate the `input` argument on every {@link TypedAgentImpl.run} call.
     * 2. Infer the TypeScript type `TIn` at compile time.
     *
     * @param schema Any Zod schema whose inferred type becomes the new `TIn`.
     * @returns A new builder typed as `AgentBuilder<T, TOut>`.
     *
     * @example
     * ```ts
     * defineAgent('qa')
     *   .input(z.object({ question: z.string(), language: z.string().optional() }))
     * ```
     */
    input<T>(schema: SchemaInput<unknown, T>): AgentBuilder<T, TOut> {
        return new AgentBuilder<T, TOut>({ ...(this.cfg as unknown as AgentBuilderConfig<T, TOut>), inputSchema: schema });
    }

    /**
     * Replace the output schema, narrowing the builder's `TOut` type parameter.
     *
     * The provided Zod schema is used to:
     * 1. Validate the value returned by the handler (or the passthrough).
     * 2. Infer the TypeScript type `TOut` at compile time.
     *
     * @param schema Any Zod schema whose inferred type becomes the new `TOut`.
     * @returns A new builder typed as `AgentBuilder<TIn, T>`.
     *
     * @example
     * ```ts
     * defineAgent('qa')
     *   .output(z.object({ answer: z.string(), confidence: z.number().min(0).max(1) }))
     * ```
     */
    output<T>(schema: SchemaInput<unknown, T>): AgentBuilder<TIn, T> {
        return new AgentBuilder<TIn, T>({ ...(this.cfg as unknown as AgentBuilderConfig<TIn, T>), outputSchema: schema });
    }

    /**
     * Set the base system instructions sent to the model on every run.
     *
     * Skill instructions (from {@link skills}) are appended **after** these
     * base instructions at run-time, so keep this text focused on the core
     * persona and task definition.
     *
     * @param text The system prompt text.
     * @returns A new builder with the updated instructions.
     *
     * @example
     * ```ts
     * defineAgent('assistant')
     *   .instructions('You are a concise coding assistant. Reply in plain text.')
     * ```
     */
    instructions(text: string): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, instructions: text });
    }

    /**
     * Attach tools that the agent may invoke during a run.
     *
     * All provided tools are registered in the internal {@link ToolRegistry}
     * when {@link build} is called. The agent can call any registered tool
     * by name during its reasoning loop.
     *
     * @param tools An array of {@link Tool} objects to make available.
     * @returns A new builder with the updated tool list (replaces, not appends).
     *
     * @example
     * ```ts
     * import { webSearchTool, calculatorTool } from './tools';
     *
     * defineAgent('researcher').tools([webSearchTool, calculatorTool])
     * ```
     */
    tools(tools: Tool[]): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, tools });
    }

    /**
     * Attach skills that augment the agent's instructions and tool set.
     *
     * A {@link Skill} is a reusable capability bundle containing:
     * - **`instructions`** — text appended to the system prompt at run-time.
     * - **`tools`** *(optional)* — additional tools registered at build-time.
     *
     * Skills are composable: attach multiple skills and their instructions are
     * joined in order.
     *
     * @param skills An array of {@link Skill} objects.
     * @returns A new builder with the updated skill list (replaces, not appends).
     *
     * @example
     * ```ts
     * import { safetySkill, citationSkill } from './skills';
     *
     * defineAgent('writer').skills([safetySkill, citationSkill])
     * ```
     */
    skills(skills: Skill[]): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, skills });
    }

    /**
     * Attach a persistent memory store for cross-turn recall.
     *
     * The store is passed into the handler context as `__memoryStore` so
     * handlers can read and write memories across separate runs. When omitted,
     * an {@link InMemoryStore} is used (in-process, non-persistent).
     *
     * @param store Any {@link MemoryStore} implementation.
     * @returns A new builder with the updated memory store.
     *
     * @example
     * ```ts
     * import { RedisMemoryStore } from '../memory-redis/index.js';
     *
     * defineAgent('assistant').memory(new RedisMemoryStore({ url: process.env.REDIS_URL }))
     * ```
     */
    memory(store: MemoryStore): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, memory: store });
    }

    /**
     * Attach a session store to persist conversation history.
     *
     * The store is passed into the handler context as part of the internal
     * context object, allowing handlers to read prior turns and maintain
     * multi-turn dialogue state.
     *
     * @param store Any {@link SessionStore} implementation.
     * @returns A new builder with the updated session store.
     *
     * @example
     * ```ts
     * import { SqliteSessionStore } from '../session-sqlite/index.js';
     *
     * defineAgent('chat').session(new SqliteSessionStore('./chat.db'))
     * ```
     */
    session(store: SessionStore): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, session: store });
    }

    /**
     * Override the default execution handler with a custom function.
     *
     * The handler receives the **validated** input and the full internal
     * context object (which includes `__memoryStore`, `__toolRegistry`,
     * `__planner`, `__instructions`, etc.). It must return a value that
     * satisfies the output schema.
     *
     * When no handler is set the agent performs a schema-passthrough: the
     * validated input is fed directly into the output schema.
     *
     * @param fn An async or sync function `(input, context) => TOut`.
     * @returns A new builder with the updated handler.
     *
     * @example
     * ```ts
     * defineAgent('echo')
     *   .input(z.object({ text: z.string() }))
     *   .output(z.object({ text: z.string() }))
     *   .handler(async ({ text }, ctx) => {
     *     const memory = ctx?.__memoryStore as MemoryStore;
     *     await memory.set('last', text);
     *     return { text: text.toUpperCase() };
     *   })
     * ```
     */
    handler(fn: (input: TIn, context?: Record<string, unknown>) => Promise<TOut> | TOut): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, handler: fn });
    }

    /**
     * Cap the number of reasoning iterations the agent may perform in one run.
     *
     * If the agent's internal loop has not produced a final answer after `n`
     * iterations the run is aborted with an error. Defaults to `10`.
     *
     * @param n A positive integer iteration limit.
     * @returns A new builder with the updated limit.
     *
     * @example
     * ```ts
     * defineAgent('deep-researcher').maxIterations(25)
     * ```
     */
    maxIterations(n: number): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, maxIterations: n });
    }

    /**
     * Set a wall-clock timeout for the entire run in milliseconds.
     *
     * If the run has not completed within `ms` milliseconds it is aborted.
     * Defaults to `60_000` (60 seconds).
     *
     * @param ms Timeout in milliseconds (must be > 0).
     * @returns A new builder with the updated timeout.
     *
     * @example
     * ```ts
     * // Allow up to 5 minutes for a long-running analysis agent
     * defineAgent('analyser').timeout(5 * 60 * 1000)
     * ```
     */
    timeout(ms: number): AgentBuilder<TIn, TOut> {
        return new AgentBuilder({ ...this.cfg, timeoutMs: ms });
    }

    /**
     * Finalise the builder and construct the runnable {@link TypedAgent}.
     *
     * This is the terminal step of the fluent chain. After calling `build()`:
     * - All tools (including skill tools) are registered in the tool registry.
     * - The memory store is initialised (defaults to `InMemoryStore`).
     * - The planner is initialised with the `HIERARCHICAL` algorithm.
     *
     * The returned agent is immutable and safe to share across concurrent
     * invocations.
     *
     * @returns A fully initialised `TypedAgent<TIn, TOut>`.
     *
     * @example
     * ```ts
     * const agent = defineAgent('assistant')
     *   .model('openai:gpt-4o')
     *   .input(z.object({ q: z.string() }))
     *   .output(z.object({ a: z.string() }))
     *   .instructions('Answer concisely.')
     *   .build();
     * ```
     */
    build(): TypedAgent<TIn, TOut> {
        return new TypedAgentImpl<TIn, TOut>(this.cfg);
    }
}

// ---------------------------------------------------------------------------
// TypedAgentImpl — concrete runnable agent (internal)
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of {@link TypedAgent} produced by {@link AgentBuilder.build}.
 *
 * ### Initialisation (constructor)
 * - Registers all `tools` from the config into an internal {@link ToolRegistry}.
 * - Registers tools exposed by each `skill` (if any).
 * - Falls back to {@link InMemoryStore} when no memory store is provided.
 * - Creates a {@link ClassicalPlanner} with the `HIERARCHICAL` algorithm.
 *
 * ### Checkpoint map
 * Every call to {@link run} saves a checkpoint entry keyed by `runId`.
 * This allows {@link resume} to re-execute the run using the original
 * validated input and session context without the caller having to store it.
 *
 * @internal Consumers should always depend on the {@link TypedAgent} interface.
 */
class TypedAgentImpl<TIn, TOut> implements TypedAgent<TIn, TOut> {
    private readonly cfg: AgentBuilderConfig<TIn, TOut>;
    private readonly toolRegistry: ToolRegistry;
    private readonly memoryStore: MemoryStore;
    private readonly plannerInstance: Planner;
    /** runId → checkpoint storage for resume() */
    private readonly checkpoints = new Map<string, { input: TIn; sessionId: string; context?: Record<string, unknown> }>();

    constructor(cfg: AgentBuilderConfig<TIn, TOut>) {
        this.cfg = cfg;
        this.toolRegistry = new ToolRegistryImpl();
        this.memoryStore = cfg.memory ?? new InMemoryStore();
        this.plannerInstance = new ClassicalPlanner({ algorithm: PlanningAlgorithm.HIERARCHICAL });

        for (const tool of cfg.tools) {
            this.toolRegistry.register(tool);
        }

        // Skills: register their tools if any, and their instructions are prepended at run-time
        for (const skill of cfg.skills) {
            const maybeWithTools = skill as unknown as { tools?: Tool[] };
            if (Array.isArray(maybeWithTools.tools)) {
                for (const t of maybeWithTools.tools) {
                    this.toolRegistry.register(t);
                }
            }
        }
    }

    /**
     * Execute the agent and return the validated, schema-typed output.
     *
     * **Execution flow:**
     * 1. Generate or reuse `sessionId`; always generate a fresh `runId`.
     * 2. Validate `input` against the input schema (throws on invalid input).
     * 3. Build effective instructions by joining base + skill instruction fragments.
     * 4. Assemble the internal context object with all runtime services.
     * 5. Persist a checkpoint so {@link resume} can replay this run.
     * 6. Invoke the custom `handler`, or fall through to the schema passthrough.
     * 7. Validate the output against the output schema.
     * 8. Return the output merged with `{ sessionId, runId }`.
     *
     * @param input   Input value; validated against the input schema.
     * @param opts    Optional run options.
     * @returns Validated output augmented with correlation IDs.
     */
    async run(input: TIn, opts?: { sessionId?: string; context?: Record<string, unknown> }): Promise<TypedAgentResult<TOut>> {
        const sessionId = opts?.sessionId ?? generateEntityId();
        const runId = generateEntityId();

        const validatedInput = parse(this.cfg.inputSchema, input, 'agent input validation failed') as TIn;

        // Build effective instructions (base + skill fragments)
        const skillInstructions = this.cfg.skills
            .map(s => s.instructions ?? '')
            .filter(Boolean)
            .join('\n');
        const effectiveInstructions = [this.cfg.instructions, skillInstructions].filter(Boolean).join('\n');

        const context: Record<string, unknown> = {
            ...(opts?.context ?? {}),
            __sessionId: sessionId,
            __runId: runId,
            __instructions: effectiveInstructions,
            __modelRef: this.cfg.modelRef,
            __memoryStore: this.memoryStore,
            __toolRegistry: this.toolRegistry,
            __planner: this.plannerInstance,
        };

        // Save checkpoint for resume()
        this.checkpoints.set(runId, { input: validatedInput, sessionId, context: opts?.context });

        let output: TOut;
        if (this.cfg.handler) {
            output = await this.cfg.handler(validatedInput, context);
        } else {
            // No handler: return the validated input cast to TOut (schema must be compatible)
            output = parse(this.cfg.outputSchema, validatedInput as unknown, 'agent output validation failed') as TOut;
        }

        const validated = parse(this.cfg.outputSchema, output, 'agent output validation failed') as TOut;
        return Object.assign(
            typeof validated === 'object' && validated !== null ? { ...validated as object } : ({ __value: validated } as object),
            { sessionId, runId },
        ) as TypedAgentResult<TOut>;
    }

    /**
     * Stream incremental events while the agent processes the input.
     *
     * **Event sequence for a successful run:**
     * ```
     * { type: 'text',  content: '[<name>] starting…' }
     * { type: 'text',  content: '<serialised output>'  }
     * { type: 'done'                                    }
     * ```
     *
     * **Event sequence on error:**
     * ```
     * { type: 'text',  content: '[<name>] starting…' }
     * { type: 'error', error: <thrown value>           }
     * ```
     *
     * @param input  Input value passed to the underlying {@link run} call.
     * @param opts   Optional stream options.
     * @yields {@link AgentStreamEvent} objects in chronological order.
     */
    async *stream(input: TIn, opts?: { sessionId?: string }): AsyncIterable<AgentStreamEvent> {
        const sessionId = opts?.sessionId ?? generateEntityId();

        yield { type: 'text', content: `[${this.cfg.name}] starting…` };

        try {
            const result = await this.run(input, { sessionId, context: {} });
            const text = typeof result === 'object' && result !== null && 'text' in result
                ? String((result as { text: unknown }).text)
                : JSON.stringify(result);
            yield { type: 'text', content: text };
            yield { type: 'done' };
        } catch (err) {
            yield { type: 'error', error: err };
        }
    }

    /**
     * Re-execute a run from its saved checkpoint.
     *
     * Merges the caller-supplied `context` on top of the original checkpoint
     * context and injects `__resumed: true` so handlers can detect that this
     * is a replay.
     *
     * @param runId  A `runId` returned by a previous {@link run} call.
     * @param opts   Optional overrides merged into the checkpoint context.
     * @throws `Error` when no checkpoint exists for `runId`.
     */
    async resume(runId: string, opts?: { context?: Record<string, unknown> }): Promise<TypedAgentResult<TOut>> {
        const checkpoint = this.checkpoints.get(runId);
        if (!checkpoint) {
            throw new Error(`No checkpoint found for runId "${runId}". The agent may have already completed or the runId is invalid.`);
        }
        return this.run(checkpoint.input, {
            sessionId: checkpoint.sessionId,
            context: { ...(checkpoint.context ?? {}), ...(opts?.context ?? {}), __resumed: true },
        });
    }

    /**
     * Generate a multi-step plan for `goal` using registered tools.
     *
     * @param goal Natural-language description of the objective.
     * @returns A `Plan` with ordered steps and required tool names.
     */
    async plan(goal: string): Promise<import('../planner/index.js').Plan> {
        return this.plannerInstance.plan(goal, {
            availableTools: this.toolRegistry.list().map(t => t.name),
        });
    }

    /**
     * Return a shallow copy of the internal builder configuration.
     *
     * @returns A read-only snapshot; mutations do not affect the running agent.
     */
    getConfig(): AgentBuilderConfig<TIn, TOut> {
        return { ...this.cfg };
    }
}

// ---------------------------------------------------------------------------
// defineAgent() — primary entry point
// ---------------------------------------------------------------------------

/**
 * Create a new fluent {@link AgentBuilder} starting from sensible defaults.
 *
 * This is the **recommended entry point** for defining agents. Chain the
 * builder methods to configure every aspect of the agent, then call
 * {@link AgentBuilder.build | `.build()`} to obtain a runnable
 * {@link TypedAgent}.
 *
 * **Default configuration:**
 * | Setting        | Default             |
 * | -------------- | ------------------- |
 * | `model`        | `""` *(must be set)*|
 * | `inputSchema`  | `z.string()`        |
 * | `outputSchema` | `z.string()`        |
 * | `instructions` | `""` *(empty)*      |
 * | `tools`        | `[]`                |
 * | `skills`       | `[]`                |
 * | `memory`       | `InMemoryStore`     |
 * | `session`      | `null`              |
 * | `maxIterations`| `10`                |
 * | `timeout`      | `60 000 ms`         |
 *
 * @param name A human-readable agent name used in logs and stream prefixes.
 * @returns A fresh `AgentBuilder<string, string>` ready for further configuration.
 *
 * @example — Minimal Q&A agent
 * ```ts
 * import { z } from 'zod';
 * import { defineAgent } from './index.js';
 *
 * const agent = defineAgent('qa-bot')
 *   .model('openai:gpt-4o')
 *   .input(z.object({ question: z.string() }))
 *   .output(z.object({ answer: z.string() }))
 *   .instructions('You are a helpful assistant. Reply concisely.')
 *   .build();
 *
 * const { answer, runId } = await agent.run({ question: 'What is the capital of France?' });
 * console.log(answer); // "Paris"
 * ```
 *
 * @example — Agent with tools, skills, and streaming
 * ```ts
 * import { z } from 'zod';
 * import { defineAgent } from './index.js';
 * import { webSearchTool } from './tools/web-search';
 * import { citationSkill } from './skills/citation';
 *
 * const agent = defineAgent('researcher')
 *   .model('anthropic:claude-3-5-sonnet')
 *   .input(z.object({ topic: z.string() }))
 *   .output(z.object({ summary: z.string(), sources: z.array(z.string()) }))
 *   .instructions('Research the given topic and summarise your findings.')
 *   .tools([webSearchTool])
 *   .skills([citationSkill])
 *   .maxIterations(20)
 *   .timeout(120_000)
 *   .build();
 *
 * for await (const event of agent.stream({ topic: 'quantum computing breakthroughs 2025' })) {
 *   if (event.type === 'text') process.stdout.write(event.content ?? '');
 * }
 * ```
 *
 * @example — Resumable agent
 * ```ts
 * const { runId } = await agent.run(input);
 * // ... process crashes or is restarted ...
 * const result = await agent.resume(runId, { context: { retryCount: 1 } });
 * ```
 *
 * @example — Immutable builder branching
 * ```ts
 * const base = defineAgent('base').model('openai:gpt-4o').instructions('...');
 * const fastAgent = base.maxIterations(5).build();
 * const deepAgent = base.maxIterations(30).timeout(300_000).build();
 * // `base` is unmodified
 * ```
 */
export function defineAgent(name: string): AgentBuilder<string, string> {
    return new AgentBuilder<string, string>({
        name,
        instructions: '',
        modelRef: '',
        inputSchema: z.string(),
        outputSchema: z.string(),
        tools: [],
        skills: [],
        memory: null,
        session: null,
        maxIterations: 10,
        timeoutMs: 60_000,
    });
}

// ---------------------------------------------------------------------------
// Backwards-compatible overload: defineAgent(config) (Phase 6 API)
// ---------------------------------------------------------------------------

export function defineAgentFromConfig<TInput = string, TOutput = unknown>(
    config: AgentDefinitionConfig<TInput, TOutput>
): DefinedAgent<TInput, TOutput> {
    return new DefinedAgent(config);
}

/**
 * @deprecated Use `defineAgent(name).input(...).output(...).build()` instead.
 * Kept for backward compatibility with Phase 6 code.
 */
export class DefinedAgent<TInput, TOutput> {
    private config: AgentDefinitionConfig<TInput, TOutput>;
    private toolRegistry: ToolRegistry;
    private memoryStore: MemoryStore;
    private plannerInstance: Planner;
    private _executionEngine: ExecutionEngine;

    constructor(config: AgentDefinitionConfig<TInput, TOutput>) {
        this.config = config;
        this.toolRegistry = new ToolRegistryImpl();
        this.memoryStore = config.memory ?? new InMemoryStore();
        this.plannerInstance = config.planner ?? new ClassicalPlanner({ algorithm: PlanningAlgorithm.HIERARCHICAL });
        this._executionEngine = new ExecutionEngineImpl();

        if (config.tools) {
            for (const tool of config.tools) {
                this.toolRegistry.register(tool);
            }
        }
    }

    withTool(tool: Tool): this {
        this.toolRegistry.register(tool);
        return this;
    }

    withTools(tools: Tool[]): this {
        for (const tool of tools) {
            this.toolRegistry.register(tool);
        }
        return this;
    }

    withMemory(memory: MemoryStore): this {
        Object.assign(this, { memoryStore: memory });
        return this;
    }

    withPlanner(planner: Planner): this {
        Object.assign(this, { plannerInstance: planner });
        return this;
    }

    withExecutionEngine(engine: ExecutionEngine): this {
        this._executionEngine = engine;
        return this;
    }

    getExecutionEngine(): ExecutionEngine {
        return this._executionEngine;
    }

    async run(config: AgentRunConfig<TInput>): Promise<TOutput> {
        const validatedInput = parse(this.config.inputSchema, config.input, 'agent input validation failed') as TInput;
        const handlerContext = {
            ...(config.context ?? {}),
            __memoryStore: this.memoryStore,
            __toolRegistry: this.toolRegistry,
            __planner: this.plannerInstance,
        };

        if (this.config.handler) {
            const handled = await this.config.handler(validatedInput, handlerContext);
            return parse(this.config.outputSchema, handled, 'agent output validation failed') as TOutput;
        }

        return parse(this.config.outputSchema, validatedInput as unknown, 'agent output validation failed') as TOutput;
    }

    async plan(goal: string): Promise<import('../planner/index.js').Plan> {
        return this.plannerInstance.plan(goal, {
            availableTools: this.toolRegistry.list().map(t => t.name),
        });
    }

    getConfig(): AgentDefinitionConfig<TInput, TOutput> {
        return { ...this.config };
    }
}
