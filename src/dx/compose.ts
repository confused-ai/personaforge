/**
 * compose() — Pipeline two or more agents together.
 *
 * The output of each agent is passed as the input to the next.
 * You control when to hand off via a predicate or always.
 *
 * ## When to use compose() vs graph engine
 *
 * - **compose() / pipe()** — Best for linear, sequential pipelines where each
 *   agent processes the previous agent's output. Lightweight, no extra deps.
 *
 * - **graph engine** (`personaforge/graph`) — Best for complex orchestration:
 *   supervisor patterns, consensus voting, competitive racing, DAG workflows
 *   with branching/joining, distributed execution, and durable checkpointing.
 *   See `MultiAgentOrchestrator` and `AgentRuntime` in `personaforge/graph`.
 *
 * @example
 * ```ts
 * import { agent, compose } from 'personaforge';
 *
 * const researcher = agent('You research topics and return raw findings.');
 * const writer     = agent('You turn research findings into polished reports.');
 *
 * // Simple pipeline: always pass output from researcher → writer
 * const pipeline = compose(researcher, writer);
 * const result = await pipeline.run('Write a report on TypeScript 5.5');
 *
 * // Conditional pipeline: only hand off when condition returns true
 * const conditional = compose(researcher, writer, {
 *   when: (result) => result.text.length > 100,
 *   transform: (result) => `Here is the research:\n\n${result.text}`,
 * });
 * ```
 *
 * For more complex multi-agent graphs, use the orchestration primitives:
 *   createAgentRouter, createHandoff, ConsensusProtocol.
 */

import type { CreateAgentResult } from '../create-agent/types.js';
import type { AgenticRunResult } from '../agentic/index.js';
import { pipelineAsTool } from '../tools/core/pipeline-as-tool.js';
import type { PipelineAsToolOptions } from '../tools/core/pipeline-as-tool.js';

export interface WorkflowHooks {
    beforeWorkflow?: (prompt: string) => Promise<string | void> | string | void;
    afterWorkflow?: (result: AgenticRunResult) => Promise<AgenticRunResult | void> | AgenticRunResult | void;
    beforeStage?: (stageIndex: number, agentName: string, prompt: string) => Promise<string | void> | string | void;
    afterStage?: (stageIndex: number, agentName: string, result: AgenticRunResult) => Promise<void> | void;
    onError?: (error: Error, stageIndex: number, agentName: string) => Promise<void> | void;
}

export interface ComposeOptions {
    /**
     * Predicate to decide whether to hand off to the next agent.
     * Return true to proceed, false to stop the pipeline.
     * Default: always hand off.
     */
    when?: (result: AgenticRunResult, stepIndex: number) => boolean | Promise<boolean>;

    /**
     * Transform the output of the current agent before passing it to the next.
     * Default: pass `result.text` as-is.
     */
    transform?: (result: AgenticRunResult, stepIndex: number) => string | Promise<string>;

    /** Session ID to use for all agents in the pipeline */
    sessionId?: string;

    /** Lifecycle hooks for the workflow pipeline */
    hooks?: WorkflowHooks;
}

export interface ComposedAgent {
    /** Run the full pipeline on a prompt. Returns the last agent's result. */
    run(
        prompt: string,
        options?: { onChunk?: (text: string) => void; sessionId?: string },
    ): Promise<AgenticRunResult>;
    /** Expose this pipeline as a tool for a parent agent. */
    asTool<TOutput = unknown>(
        options: Omit<PipelineAsToolOptions<unknown, TOutput>, 'pipeline'>,
    ): import('../tools/core/tool-helper.js').LightweightTool<
        import('../tools/core/tool-helper.js').ToolObjectSchemaLike<Record<string, unknown>>,
        TOutput
    >;
}

/** Type guard: is this value a CreateAgentResult from createAgent() / agent() / defineAgent()? */
function isCreateAgentResult(v: unknown): v is CreateAgentResult {
    return (
        v !== null &&
        typeof v === 'object' &&
        typeof (v as Record<string, unknown>).run === 'function' &&
        typeof (v as Record<string, unknown>).instructions === 'string' &&
        typeof (v as Record<string, unknown>).createSession === 'function'
    );
}

/**
 * Compose multiple agents into a sequential pipeline.
 * The output of each agent becomes the input of the next.
 */
export function compose(...args: CreateAgentResult[]): ComposedAgent;
export function compose(...args: [...CreateAgentResult[], ComposeOptions]): ComposedAgent;
export function compose(...args: unknown[]): ComposedAgent {
    // Separate agents from options using a reliable type guard
    const agents: CreateAgentResult[] = [];
    let opts: ComposeOptions = {};

    for (const arg of args) {
        if (isCreateAgentResult(arg)) {
            agents.push(arg);
        } else if (arg && typeof arg === 'object') {
            opts = arg as ComposeOptions;
        }
    }

    if (agents.length < 2) {
        throw new Error('compose() requires at least 2 agents.');
    }

    const composed: ComposedAgent = {
        asTool(options) {
            return pipelineAsTool({
                ...options,
                pipeline: composed,
            });
        },
        async run(
            initialPrompt: string,
            runOptions?: { onChunk?: (text: string) => void; sessionId?: string },
        ): Promise<AgenticRunResult> {
            let currentPrompt = initialPrompt;
            let currentResult: AgenticRunResult | null = null;
            const hooks = opts.hooks;

            if (hooks?.beforeWorkflow) {
                const transformed = await hooks.beforeWorkflow(currentPrompt);
                if (typeof transformed === 'string') currentPrompt = transformed;
            }

            try {
                for (let i = 0; i < agents.length; i++) {
                    const agent = agents[i]!;
                    const agentName = agent.name ?? `stage-${String(i)}`;

                    if (i > 0 && opts.when && currentResult) {
                        const proceed = await opts.when(currentResult, i - 1);
                        if (!proceed) {
                            if (hooks?.afterWorkflow) {
                                const transformed = await hooks.afterWorkflow(currentResult);
                                return (transformed as AgenticRunResult) ?? currentResult;
                            }
                            return currentResult;
                        }
                    }

                    if (hooks?.beforeStage) {
                        const transformed = await hooks.beforeStage(i, agentName, currentPrompt);
                        if (typeof transformed === 'string') currentPrompt = transformed;
                    }

                    currentResult = await agent.run(currentPrompt, {
                        sessionId: runOptions?.sessionId ?? opts.sessionId,
                        onChunk: i === agents.length - 1 ? runOptions?.onChunk : undefined,
                    });

                    if (hooks?.afterStage) {
                        await hooks.afterStage(i, agentName, currentResult);
                    }

                    if (i < agents.length - 1 && currentResult) {
                        if (opts.transform) {
                            currentPrompt = await opts.transform(currentResult, i);
                        } else {
                            currentPrompt = currentResult.text ?? '';
                        }
                    }
                }

                if (hooks?.afterWorkflow && currentResult) {
                    const transformed = await hooks.afterWorkflow(currentResult);
                    return (transformed as AgenticRunResult) ?? currentResult;
                }

                return currentResult!;
            } catch (error) {
                if (hooks?.onError) {
                    await hooks.onError(
                        error instanceof Error ? error : new Error(String(error)),
                        agents.indexOf(agents.find((_, idx) => idx === agents.length - 1)!),
                        'unknown',
                    );
                }
                throw error;
            }
        },
    };
    return composed;
}

/**
 * pipe() — Create a reusable single-step transform between two agents.
 *
 * @example
 * ```ts
 * const draft   = agent('Draft a blog post about the topic.');
 * const editor  = agent('Edit the blog post for clarity and conciseness.');
 * const publish = agent('Format the post for publication and add metadata.');
 *
 * // Build a sequential pipeline step-by-step
 * const pipeline = pipe(draft).then(editor).then(publish);
 * const result = await pipeline.run('TypeScript 5.5 features');
 * ```
 */
export function pipe(first: CreateAgentResult): PipelineBuilder {
    return new PipelineBuilder([first]);
}

class PipelineBuilder {
    private agents: CreateAgentResult[];
    private steps: ComposeOptions[] = [];
    private workflowHooks?: WorkflowHooks;

    constructor(agents: CreateAgentResult[]) {
        this.agents = [...agents];
    }

    /**
     * Add next agent with optional per-step options.
     */
    then(agent: CreateAgentResult, options?: ComposeOptions): PipelineBuilder {
        const next = new PipelineBuilder([...this.agents, agent]);
        next.steps = [...this.steps, options ?? {}];
        next.workflowHooks = this.workflowHooks;
        return next;
    }

    /**
     * Attach lifecycle hooks to the pipeline.
     */
    hooks(hooks: WorkflowHooks): PipelineBuilder {
        const next = new PipelineBuilder([...this.agents]);
        next.steps = [...this.steps];
        next.workflowHooks = hooks;
        return next;
    }

    /**
     * Expose this pipeline as a tool for a parent agent.
     */
    asTool<TOutput = unknown>(
        options: Omit<PipelineAsToolOptions<unknown, TOutput>, 'pipeline'>,
    ) {
        return pipelineAsTool({
            ...options,
            pipeline: this,
        });
    }

    /**
     * Run the full pipeline.
     */
    async run(
        prompt: string,
        options?: { onChunk?: (text: string) => void; sessionId?: string },
    ): Promise<AgenticRunResult> {
        let currentPrompt = prompt;
        let currentResult: AgenticRunResult | null = null;
        const hooks = this.workflowHooks;

        if (hooks?.beforeWorkflow) {
            const transformed = await hooks.beforeWorkflow(currentPrompt);
            if (typeof transformed === 'string') currentPrompt = transformed;
        }

        try {
            for (let i = 0; i < this.agents.length; i++) {
                const agent = this.agents[i]!;
                const stepOpts = this.steps[i - 1] ?? {};
                const agentName = agent.name ?? `stage-${String(i)}`;

                if (i > 0 && stepOpts.when && currentResult) {
                    const proceed = await stepOpts.when(currentResult, i - 1);
                    if (!proceed) {
                        if (hooks?.afterWorkflow) {
                            const transformed = await hooks.afterWorkflow(currentResult);
                            return (transformed as AgenticRunResult) ?? currentResult;
                        }
                        return currentResult!;
                    }
                }

                if (hooks?.beforeStage) {
                    const transformed = await hooks.beforeStage(i, agentName, currentPrompt);
                    if (typeof transformed === 'string') currentPrompt = transformed;
                }

                currentResult = await agent.run(currentPrompt, {
                    sessionId: options?.sessionId ?? stepOpts.sessionId,
                    onChunk: i === this.agents.length - 1 ? options?.onChunk : undefined,
                });

                if (hooks?.afterStage) {
                    await hooks.afterStage(i, agentName, currentResult);
                }

                if (i < this.agents.length - 1 && currentResult) {
                    const transform = stepOpts.transform;
                    currentPrompt = transform
                        ? await transform(currentResult, i)
                        : (currentResult.text ?? '');
                }
            }

            if (hooks?.afterWorkflow && currentResult) {
                const transformed = await hooks.afterWorkflow(currentResult);
                return (transformed as AgenticRunResult) ?? currentResult;
            }

            return currentResult!;
        } catch (error) {
            if (hooks?.onError) {
                await hooks.onError(
                    error instanceof Error ? error : new Error(String(error)),
                    this.agents.length - 1,
                    'unknown',
                );
            }
            throw error;
        }
    }
}
