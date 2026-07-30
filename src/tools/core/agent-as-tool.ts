/**
 * `agentAsTool()` — wrap any runnable agent as a callable tool.
 *
 * This is the primary mechanism for **agent-as-tool** delegation: a parent
 * agent can invoke a specialist agent through the standard tool-calling
 * interface. Input/output schemas, lifecycle hooks, timeouts, and nesting
 * depth limits are enforced by the tool runtime.
 *
 * @example
 * ```ts
 * import { agent, agentAsTool } from 'personaforge';
 * import { z } from 'zod';
 *
 * const translator = agent('Translate to French. Return only the translation.');
 *
 * const translateTool = agentAsTool({
 *   name: 'translate_to_french',
 *   description: 'Translate English text to French',
 *   agent: translator,
 *   parameters: z.object({ prompt: z.string() }),
 *   outputSchema: z.object({ text: z.string() }),
 *   transformOutput: (result) => ({ text: (result as { text: string }).text }),
 * });
 *
 * const orchestrator = agent({
 *   instructions: 'Use the translate tool when needed.',
 *   tools: [translateTool],
 * });
 * ```
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { ToolCategory } from './types.js';
import type { ToolObjectSchemaLike, SimpleToolContext, LightweightTool, ToolSchemaLike } from './tool-helper.js';
import { tool } from './tool-helper.js';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal duck-type for any agent that has a `run` method.
 * Compatible with `CreateAgentResult`, harness agents, and test doubles.
 */
export interface RunnableAgent {
    run(
        input: Record<string, unknown> | string,
        options?: { sessionId?: string },
    ): Promise<unknown>;
}

/**
 * Configuration for `agentAsTool()`.
 */
export interface AgentAsToolOptions<
    TInput = unknown,
    TOutput = unknown,
> {
    /** Tool name (used as function ID by the LLM). */
    readonly name: string;
    /** Human-readable description for the LLM. */
    readonly description: string;
    /** The agent to wrap. Must have a `run(input, options?)` method. */
    readonly agent: RunnableAgent;
    /** Zod schema for tool parameters. Defaults to `{ prompt: string }`. */
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    /** Zod schema for tool output validation. */
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    /** Category for organization. */
    readonly category?: ToolCategory;
    /** Tags for discoverability. */
    readonly tags?: string[];
    /** Maximum execution time in ms. Default: 120_000. */
    readonly timeoutMs?: number;
    /** Require human approval before execution. */
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    /** Called before the agent runs. Return false to cancel. */
    readonly beforeExecute?: (params: TInput, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    /** Called after the agent completes. */
    readonly afterExecute?: (output: TOutput, params: TInput, ctx: SimpleToolContext) => Promise<void> | void;
    /** Handle errors during agent execution. Return a fallback value or re-throw. */
    readonly onError?: (error: Error, params: TInput, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
    /** Transform the agent's output before returning to the caller / schema validation. */
    readonly transformOutput?: (output: TOutput, params: TInput, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
    /**
     * Max nesting depth for agent-as-tool recursion.
     * Prevents infinite loops when agents call each other as tools.
     * Default: 5.
     */
    readonly maxDepth?: number;
}

const DEFAULT_PARAMETERS = z.object({
    prompt: z.string().describe('The prompt to send to the agent'),
}) as ToolObjectSchemaLike<{ prompt: string }>;

const DEFAULT_MAX_DEPTH = 5;

/** Cross-async nesting depth for agent-as-tool recursion guards. */
const agentToolDepth = new AsyncLocalStorage<number>();

function getCurrentDepth(): number {
    return agentToolDepth.getStore() ?? 0;
}

export function getAgentToolDepth(): number {
    return getCurrentDepth();
}

/**
 * Wrap a CreateAgentResult-like agent (`.run(string)`) as a RunnableAgent that
 * accepts tool params objects. Duck-typed RunnableAgents are returned as-is.
 */
export function toRunnableAgent(agent: RunnableAgent): RunnableAgent {
    const candidate = agent as RunnableAgent & {
        instructions?: unknown;
        createSession?: unknown;
        run: (input: unknown, options?: { sessionId?: string }) => Promise<unknown>;
    };

    const looksLikeCreateAgent =
        typeof candidate.instructions === 'string' &&
        typeof candidate.createSession === 'function';

    if (!looksLikeCreateAgent) {
        return agent;
    }

    return {
        run: async (input, options) => {
            const prompt =
                typeof input === 'string'
                    ? input
                    : input !== null &&
                        typeof input === 'object' &&
                        'prompt' in input &&
                        typeof (input as { prompt: unknown }).prompt === 'string'
                      ? (input as { prompt: string }).prompt
                      : JSON.stringify(input);
            return candidate.run(prompt, options);
        },
    };
}

/**
 * Wrap an agent as a tool so other agents can invoke it via function calling.
 */
export function agentAsTool<TInput = unknown, TOutput = unknown>(
    config: AgentAsToolOptions<TInput, TOutput>,
): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
    const {
        name,
        description,
        agent: rawAgent,
        parameters = DEFAULT_PARAMETERS,
        outputSchema,
        category = ToolCategory.AGENT,
        tags = ['agent-tool'],
        timeoutMs = 120_000,
        needsApproval = false,
        beforeExecute,
        afterExecute,
        onError,
        transformOutput,
        maxDepth = DEFAULT_MAX_DEPTH,
    } = config;

    const agent = toRunnableAgent(rawAgent);

    const execute = async (params: Record<string, unknown>, ctx: SimpleToolContext): Promise<TOutput> => {
        const depth = getCurrentDepth();
        if (depth >= maxDepth) {
            throw new Error(
                `Agent tool "${name}" exceeded maximum nesting depth (${String(maxDepth)}). ` +
                    'This likely indicates a recursive agent-as-tool loop.',
            );
        }

        return agentToolDepth.run(depth + 1, async () => {
            let output = (await agent.run(params, {
                sessionId: ctx.sessionId,
            })) as TOutput;

            if (transformOutput) {
                output = await transformOutput(output, params as TInput, ctx);
            }

            return output;
        });
    };

    return tool({
        name,
        description,
        parameters,
        ...(outputSchema !== undefined ? { outputSchema } : {}),
        execute,
        needsApproval,
        category,
        tags,
        timeoutMs,
        ...(beforeExecute !== undefined
            ? { beforeExecute: beforeExecute as AgentAsToolOptions['beforeExecute'] }
            : {}),
        ...(afterExecute !== undefined
            ? { afterExecute: afterExecute as AgentAsToolOptions['afterExecute'] }
            : {}),
        ...(onError !== undefined
            ? { onError: onError as AgentAsToolOptions['onError'] }
            : {}),
    } as import('./tool-helper.js').ToolHelperConfig<ToolObjectSchemaLike<Record<string, unknown>>, TOutput>);
}

/**
 * Wrap multiple named agents as a tool array for an orchestrator agent.
 */
export interface MultiAgentToolOptions {
    readonly agents: Record<string, RunnableAgent>;
    readonly descriptions: Record<string, string>;
    readonly outputSchemas?: Record<string, ToolSchemaLike<unknown>>;
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    readonly maxDepth?: number;
}

export function multiAgentTool(options: MultiAgentToolOptions): LightweightTool[] {
    return Object.entries(options.agents).map(([key, agentInstance]) =>
        agentAsTool({
            name: key,
            description: options.descriptions[key] ?? `Delegate to ${key} agent`,
            agent: agentInstance,
            ...(options.parameters !== undefined ? { parameters: options.parameters } : {}),
            ...(options.outputSchemas?.[key] !== undefined
                ? { outputSchema: options.outputSchemas[key] }
                : {}),
            ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
        }),
    );
}
