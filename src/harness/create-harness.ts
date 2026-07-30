/**
 * createHarness — production-grade wrapper around a runnable agent.
 */

import { agentAsTool, type AgentAsToolOptions, type RunnableAgent, toRunnableAgent } from '../tools/core/agent-as-tool.js';
import type { LightweightTool, ToolObjectSchemaLike, ToolSchemaLike } from '../tools/core/tool-helper.js';
import { withResilience, type ResilienceConfig, type HealthReport, type WrappableAgent } from '../production/resilient-agent.js';
import type { UnifiedLifecycleHooks } from '../hooks/unified-hooks.js';
import { toAgenticHooks } from '../hooks/unified-hooks.js';

export interface HarnessAsToolOptions<TOutput = unknown> {
    readonly name: string;
    readonly description: string;
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    readonly timeoutMs?: number;
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    readonly transformOutput?: AgentAsToolOptions<unknown, TOutput>['transformOutput'];
    readonly beforeExecute?: AgentAsToolOptions<unknown, TOutput>['beforeExecute'];
    readonly afterExecute?: AgentAsToolOptions<unknown, TOutput>['afterExecute'];
    readonly onError?: AgentAsToolOptions<unknown, TOutput>['onError'];
    readonly tags?: string[];
}

export interface HarnessConfig {
    /** Agent to harden. Accepts CreateAgentResult or any RunnableAgent. */
    readonly agent: RunnableAgent & { name?: string; instructions?: string };
    /** Resilience controls (circuit breaker, rate limit, health). */
    readonly resilience?: ResilienceConfig | false;
    /** Nesting controls for agent-as-tool recursion. */
    readonly nesting?: {
        readonly maxDepth?: number;
    };
    /** Default tool timeout when exposing via asTool(). */
    readonly defaultTimeoutMs?: number;
    /** Unified lifecycle hooks applied to runs when the agent supports hooks. */
    readonly hooks?: UnifiedLifecycleHooks;
}

export interface AgentHarness {
    readonly name: string;
    readonly agent: RunnableAgent;
    /** Run the (optionally resilient) agent. */
    run(input: Record<string, unknown> | string, options?: { sessionId?: string }): Promise<unknown>;
    /** Expose this harness as a tool for a parent orchestrator agent. */
    asTool<TOutput = unknown>(options: HarnessAsToolOptions<TOutput>): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput>;
    /** Health report when resilience is enabled. */
    health(): HealthReport | undefined;
    /** Underlying max nesting depth for asTool(). */
    readonly maxDepth: number;
}

export function createHarness(config: HarnessConfig): AgentHarness {
    const {
        agent: rawAgent,
        resilience = {},
        nesting,
        defaultTimeoutMs = 120_000,
        hooks,
    } = config;

    const maxDepth = nesting?.maxDepth ?? 5;
    const base = toRunnableAgent(rawAgent);
    const name =
        (typeof rawAgent.name === 'string' && rawAgent.name.length > 0
            ? rawAgent.name
            : 'harness-agent');

    let runImpl: RunnableAgent['run'] = (input, options) => base.run(input, options);
    let healthFn: (() => HealthReport) | undefined;

    if (resilience !== false) {
        const wrappable: WrappableAgent = {
            name,
            instructions: typeof rawAgent.instructions === 'string' ? rawAgent.instructions : '',
            run: async (prompt, options) => {
                const result = await base.run(prompt, options as { sessionId?: string } | undefined);
                return result;
            },
        };
        const resilient = withResilience(wrappable, resilience);
        runImpl = async (input, options) => {
            const prompt =
                typeof input === 'string'
                    ? input
                    : input !== null &&
                        typeof input === 'object' &&
                        'prompt' in input &&
                        typeof (input as { prompt: unknown }).prompt === 'string'
                      ? (input as { prompt: string }).prompt
                      : JSON.stringify(input);
            return resilient.run(prompt, options as never);
        };
        healthFn = () => resilient.health();
    }

    // Attach unified hooks when agent supports AgentRunOptions.hooks
    const agenticHooks = hooks ? toAgenticHooks(hooks) : undefined;
    if (agenticHooks) {
        const inner = runImpl;
        runImpl = async (input, options) => {
            const agentWithHooks = rawAgent as RunnableAgent & {
                run: (input: unknown, opts?: Record<string, unknown>) => Promise<unknown>;
            };
            // Prefer calling through CreateAgentResult when available so hooks merge works
            if (
                typeof (rawAgent as { instructions?: unknown }).instructions === 'string' &&
                typeof (rawAgent as { createSession?: unknown }).createSession === 'function'
            ) {
                const prompt =
                    typeof input === 'string'
                        ? input
                        : input !== null &&
                            typeof input === 'object' &&
                            'prompt' in input &&
                            typeof (input as { prompt: unknown }).prompt === 'string'
                          ? (input as { prompt: string }).prompt
                          : JSON.stringify(input);
                return agentWithHooks.run(prompt, {
                    ...options,
                    hooks: agenticHooks,
                });
            }
            return inner(input, options);
        };
    }

    const agent: RunnableAgent = { run: runImpl };

    return {
        name,
        agent,
        maxDepth,
        run: (input, options) => agent.run(input, options),
        health: () => healthFn?.(),
        asTool<TOutput = unknown>(options: HarnessAsToolOptions<TOutput>) {
            return agentAsTool({
                name: options.name,
                description: options.description,
                agent,
                ...(options.parameters !== undefined ? { parameters: options.parameters } : {}),
                ...(options.outputSchema !== undefined ? { outputSchema: options.outputSchema } : {}),
                timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
                maxDepth,
                ...(options.needsApproval !== undefined ? { needsApproval: options.needsApproval } : {}),
                ...(options.transformOutput !== undefined ? { transformOutput: options.transformOutput } : {}),
                ...(options.beforeExecute !== undefined ? { beforeExecute: options.beforeExecute } : {}),
                ...(options.afterExecute !== undefined ? { afterExecute: options.afterExecute } : {}),
                ...(options.onError !== undefined ? { onError: options.onError } : {}),
                tags: ['harness-tool', ...(options.tags ?? [])],
            });
        },
    };
}
