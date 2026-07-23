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
}

export interface ComposedAgent {
    /** Run the full pipeline on a prompt. Returns the last agent's result. */
    run(
        prompt: string,
        options?: { onChunk?: (text: string) => void; sessionId?: string },
    ): Promise<AgenticRunResult>;
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

    return {
        async run(
            initialPrompt: string,
            runOptions?: { onChunk?: (text: string) => void; sessionId?: string },
        ): Promise<AgenticRunResult> {
            let currentPrompt = initialPrompt;
            let currentResult: AgenticRunResult | null = null;

            for (let i = 0; i < agents.length; i++) {
                const agent = agents[i]!;

                // Check when predicate (skip for first agent)
                if (i > 0 && opts.when && currentResult) {
                    const proceed = await opts.when(currentResult, i - 1);
                    if (!proceed) {
                        return currentResult;
                    }
                }

                currentResult = await agent.run(currentPrompt, {
                    sessionId: runOptions?.sessionId ?? opts.sessionId,
                    onChunk: i === agents.length - 1 ? runOptions?.onChunk : undefined,
                });

                // Transform output for next agent
                if (i < agents.length - 1 && currentResult) {
                    if (opts.transform) {
                        currentPrompt = await opts.transform(currentResult, i);
                    } else {
                        currentPrompt = currentResult.text ?? '';
                    }
                }
            }

            return currentResult!;
        },
    };
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

    constructor(agents: CreateAgentResult[]) {
        this.agents = [...agents];
    }

    /**
     * Add next agent with optional per-step options.
     */
    then(agent: CreateAgentResult, options?: ComposeOptions): PipelineBuilder {
        const next = new PipelineBuilder([...this.agents, agent]);
        next.steps = [...this.steps, options ?? {}];
        return next;
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

        for (let i = 0; i < this.agents.length; i++) {
            const agent = this.agents[i]!;
            const stepOpts = this.steps[i - 1] ?? {};

            // Check step-level when predicate
            if (i > 0 && stepOpts.when && currentResult) {
                const proceed = await stepOpts.when(currentResult, i - 1);
                if (!proceed) return currentResult!;
            }

            currentResult = await agent.run(currentPrompt, {
                sessionId: options?.sessionId ?? stepOpts.sessionId,
                onChunk: i === this.agents.length - 1 ? options?.onChunk : undefined,
            });

            if (i < this.agents.length - 1 && currentResult) {
                const transform = stepOpts.transform;
                currentPrompt = transform
                    ? await transform(currentResult, i)
                    : (currentResult.text ?? '');
            }
        }

        return currentResult!;
    }
}
