/**
 * Agentic loop (ReAct-style) types
 */

import type { Message, LLMToolDefinition, LLMProvider } from '../core/index.js';
import type { EntityId } from '../core/index.js';
import type { ToolRegistry, ToolMiddleware } from './_tool-types.js';
import type { ZodType } from 'zod';

/** Observability: optional tracer and metrics for production monitoring */
export interface RunObservability {
    readonly tracer?: {
        startSpan(name: string, attributes?: Record<string, string | number | boolean>): unknown;
    };
    readonly metrics?: {
        recordLatency(name: string, value: number, labels?: Record<string, string>): void;
        incrementCounter(name: string, labels?: Record<string, string>): void;
    };
}

export interface AgenticRunConfig {
    /** System prompt / instructions for the agent */
    readonly instructions: string;
    /** User prompt for this run */
    readonly prompt: string;
    /** Optional conversation history to continue */
    readonly messages?: Message[];
    /** Max reasoning steps (LLM + tool calls per step). Default 10 */
    readonly maxSteps?: number;
    /** Timeout for the entire run (ms). Default 60000 */
    readonly timeoutMs?: number;
    /** Optional run ID for tracing and logs */
    readonly runId?: string;
    /** Optional trace ID for distributed tracing */
    readonly traceId?: string;
    /** Optional user ID — used for per-user budget enforcement */
    readonly userId?: string;
    /** AbortSignal to cancel the run */
    readonly signal?: AbortSignal;
    /** Optional Zod schema to validate and structure the final response */
    readonly responseModel?: ZodType;
    /** Optional RAG context string for knowledge retrieval */
    readonly ragContext?: string;
    /**
     * Per-run lifecycle hooks override.
     * Merged with agent-level hooks at run time — agent-level hooks fire first.
     * Passed as a parameter (not mutation) so concurrent runs are fully isolated.
     */
    readonly hooks?: AgenticLifecycleHooks;
    /**
     * Tool allowlist for this run. When set, only tools whose `name` is in this
     * array will be executed. An empty array blocks all tool calls.
     * When `undefined` (default) all registered tools are permitted.
     */
    readonly allowedTools?: string[];
}

/** AbortSignal-compatible (subset for cancellation) */
export type AbortSignal = {
    aborted: boolean;
    addEventListener?: (type: 'abort', handler: () => void) => void;
    removeEventListener?: (type: 'abort', handler: () => void) => void;
};

export interface AgenticRunResult {
    /** Final assistant text response */
    readonly text: string;
    /**
     * The agent's response as a markdown artifact.
     */
    readonly markdown: {
        readonly name: string;
        readonly content: string;
        readonly mimeType: 'text/markdown';
        readonly type: 'markdown';
    };
    /** Parsed structured output if responseModel was provided */
    readonly structuredOutput?: unknown;
    /** All messages in the conversation (including tool calls/results) */
    readonly messages: Message[];
    /** Number of steps taken */
    readonly steps: number;
    /** Finish reason */
    readonly finishReason: 'stop' | 'max_steps' | 'timeout' | 'error' | 'human_rejected' | 'aborted';
    /** Optional usage stats */
    readonly usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    /** Run ID when provided in config */
    readonly runId?: string;
    /** Trace ID when provided in config */
    readonly traceId?: string;
}

/** Retry policy for LLM and tool calls in the agentic loop */
export interface AgenticRetryPolicy {
    readonly maxRetries?: number;
    readonly backoffMs?: number;
    readonly maxBackoffMs?: number;
}

/** Stream / progress hooks */
export interface AgenticStreamHooks {
    onChunk?: (text: string) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: unknown) => void;
    onStep?: (step: number) => void;
}

export interface AgenticLifecycleHooks {
    beforeRun?: (prompt: string, config: AgenticRunConfig) => Promise<string> | string;
    afterRun?: (result: AgenticRunResult) => Promise<AgenticRunResult> | AgenticRunResult;
    beforeStep?: (step: number, messages: Message[]) => Promise<Message[]> | Message[];
    afterStep?: (step: number, messages: Message[], text: string) => Promise<void> | void;
    beforeToolCall?: (
        name: string,
        args: Record<string, unknown>,
        step: number,
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
    afterToolCall?: (
        name: string,
        result: unknown,
        args: Record<string, unknown>,
        step: number,
    ) => Promise<unknown> | unknown;
    buildSystemPrompt?: (
        instructions: string,
        ragContext?: string,
    ) => Promise<string> | string;
    onError?: (error: Error, step: number) => Promise<void> | void;
}

/**
 * Wrap a void-returning lifecycle hook so it runs as a non-blocking background task.
 */
export function background<TArgs extends unknown[]>(
    fn: (...args: TArgs) => Promise<void> | void,
): (...args: TArgs) => void {
    return (...args: TArgs): void => {
        void Promise.resolve(fn(...args)).catch((err: unknown) => {
            console.error('[background hook error]', err);
        });
    };
}

export interface AgenticRunnerConfig {
    readonly llm: LLMProvider;
    readonly tools: ToolRegistry;
    readonly agentId?: EntityId;
    readonly sessionId?: string;
    readonly maxSteps?: number;
    readonly timeoutMs?: number;
    readonly retry?: AgenticRetryPolicy;
    /** Optional RAG engine for knowledge retrieval during runs */
    readonly knowledgebase?: import('../knowledge/index.js').RAGEngine;
    /** Optional tool middleware for cross-tool integration (logging, rate limit, etc.) */
    readonly toolMiddleware?: ToolMiddleware[];
    /** Optional observability for production (tracer + metrics) */
    readonly observability?: RunObservability;
    /** Full lifecycle hooks — intercept every stage of the loop */
    readonly hooks?: AgenticLifecycleHooks;
    /**
     * Optional durable event recorder — emits an append-only, replayable run
     * log (agentStart / llmResult / toolResult / agentEnd). Off by default;
     * zero cost when absent.
     */
    readonly recorder?: import('../core/runner/types.js').EventRecorder;
    /**
     * Durable checkpoint store — saves loop state after each step.
     */
    readonly checkpointStore?: import('../production/index.js').AgentCheckpointStore;
    /**
     * Budget enforcer — enforces per-run / per-user / monthly USD caps.
     */
    readonly budgetEnforcer?: import('../production/index.js').BudgetEnforcer;
    /** Model ID passed to the budget enforcer for cost estimation. Default: 'gpt-4o'. */
    readonly budgetModelId?: string;
    /** Default temperature for LLM calls. Defaults to 0.7. */
    readonly temperature?: number;
    /** Default max tokens for LLM calls. Defaults to 4096. */
    readonly maxTokens?: number;
    /**
     * Optional guardrail engine — checks the input prompt before the run starts
     * and tool calls / outputs during execution.
     */
    readonly guardrails?: import('../guardrails/index.js').GuardrailEngine;
    /**
     * Optional reasoning configuration.
     * When enabled, a pre-run CoT or ToT pass enriches the initial prompt with
     * structured reasoning steps before the ReAct loop begins.
     */
    readonly reasoning?: {
        /** Enable pre-run reasoning. Default: false */
        readonly enabled: boolean;
        /** Strategy to use. Default: 'cot' */
        readonly strategy?: 'cot' | 'tot' | 'react';
        /** Maximum reasoning steps (CoT) or tree depth (ToT). Default: 6 */
        readonly maxSteps?: number;
        /** ToT-only: number of branches to explore per level. Default: 3 */
        readonly beamWidth?: number;
    };
    /**
     * Optional auto context-compression configuration.
     * When enabled, tool results are compressed using an LLM after each step
     * if the message list grows beyond the configured threshold.
     */
    readonly compression?: {
        /** Enable automatic context compression. Default: false */
        readonly enabled: boolean;
        /** Minimum number of tool messages before triggering compression. Default: 3 */
        readonly toolResultsLimit?: number;
        /** Approximate character count per message above which to compress. Default: 2000 */
        readonly messageSizeThreshold?: number;
    };
    /**
     * Maximum number of tools to execute in parallel during each LLM step.
     * Default: 8. Set to 1 for sequential tool execution.
     * Note: Most LLMs support parallel tool calls; setting this high (e.g. 32)
     * can cause provider rate limiting or exceeded service quotas.
     */
    readonly toolConcurrency?: number;
    /**
     * Context window size in tokens for the configured LLM model.
     * When set alongside LLM usage reporting, `agent.context_window.utilization`
     * metric is recorded after each LLM call.
     * Example: 128_000 for gpt-4o, 200_000 for claude-3.5.
     */
    readonly contextWindowSize?: number;
}

/** Convert a framework Tool to LLM tool definition (name, description, parameters as JSON Schema) */
export function toolToLLMDefinition(
    name: string,
    description: string,
    parametersSchema: Record<string, unknown>,
): LLMToolDefinition {
    return { name, description, parameters: parametersSchema };
}
