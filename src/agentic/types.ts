/**
 * Agentic loop (ReAct-style) types
 */

import type { Message, LLMToolDefinition, LLMProvider } from '../core/index.js';
import type { EntityId } from '../core/index.js';
import type { ToolRegistry, ToolMiddleware } from './_tool-types.js';
import type { SchemaInput } from '../validation/index.js';
import type { ProcessorSet, Processor } from '../processors/types.js';
import type { ProcessorContext } from '../processors/types.js';

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
    /** Optional schema to validate and structure the final response (Standard Schema) */
    readonly responseModel?: SchemaInput;
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
    /**
     * Structured output — schema-validated JSON returned as `result.object`.
     * Mirrors Mastra's `structuredOutput` option: supports a separate
     * structuring model, error strategy, and json-prompt injection.
     */
    readonly structuredOutput?: StructuredOutputConfig;
    /**
     * Durable thread-scoped goal evaluated in-loop by a judge model.
     * The loop iterates until the judge passes, `maxRuns` is exhausted, or
     * `maxSteps` forces a stop.
     */
    readonly goal?: GoalRunConfig;
    /**
     * Mastra-style inspired input/output/error processors for this run. When provided,
     * per-call arrays REPLACE the agent-level arrays for this run only.
     */
    readonly processors?: ProcessorSet;
    /**
     * Require human approval for tool calls. Boolean → every tool call;
     * function → per-call decision (fails closed). Mirrors Mastra's
     * `requireToolApproval`.
     */
    readonly requireToolApproval?: boolean | ((input: { toolName: string; args: Record<string, unknown>; agentId?: string; sessionId?: string }) => boolean | Promise<boolean>);
    /** Automatically resume suspended tools from message history on the next message. */
    readonly autoResumeSuspendedTools?: boolean;
    /** Tool calls already approved for this run (by toolCallId). */
    readonly approvedToolCalls?: string[];
    /** Resume data passed to a `suspend()`-suspended tool. */
    readonly resumeData?: unknown;
    /** Pending tool call to execute first on resume (from a durable snapshot). */
    readonly resumePendingTool?: {
        readonly toolCall: import('../core/index.js').ToolCall;
        readonly approved: boolean;
        readonly resumeData?: unknown;
        readonly step: number;
        readonly threadId?: string;
        readonly resourceId?: string;
    };
    /** Thread identifier (for memory/approval/goal scoping). */
    readonly threadId?: string;
    /** Resource (user) identifier (for memory/approval/goal scoping). */
    readonly resourceId?: string;
    /** Arbitrary request-scoped values exposed to processors. */
    readonly requestContext?: Record<string, unknown>;
}

/** Structured output config for an agent/run (Mastra parity). */
export interface StructuredOutputConfig {
    /** Output schema (Standard Schema — Zod/Valibot/ArkType — or JSON Schema). */
    readonly schema: SchemaInput;
    /**
     * Use a separate model to structure the main agent's natural-language
     * output. `provider/model` string or a ready LLMProvider.
     */
    readonly model?: string | LLMProvider;
    /** 'strict' throws on final failure; 'warn' logs + continues; 'fallback' returns fallbackValue. */
    readonly errorStrategy?: 'strict' | 'warn' | 'fallback';
    /** Value returned by 'fallback' when validation fails. */
    readonly fallbackValue?: unknown;
    /** 'auto' → native where supported else inline prompt; 'inline'|'system'|true|false → explicit. */
    readonly jsonPromptInjection?: 'auto' | 'inline' | 'system' | boolean;
    /** Max correction iterations feeding errors back to the model. Default 3. */
    readonly maxRetries?: number;
    /** Optional schema description shown to the model. */
    readonly description?: string;
}

/** In-loop goal evaluation config (Mastra `goal` parity). */
export interface GoalRunConfig {
    readonly objective: string;
    /** Judge: `provider/model`, a TaskJudge, or an evaluate fn. Required to score. */
    readonly judge?: string | import('../goals/judge.js').TaskJudge | ((text: string) => Promise<import('../goals/judge.js').JudgeVerdict> | import('../goals/judge.js').JudgeVerdict);
    readonly maxRuns?: number;
    readonly runsUsed?: number;
    readonly threadId?: string;
    readonly resourceId?: string;
    /** Extra step budget beyond the configured maxRuns before pausing. */
    readonly budget?: number;
    readonly suppressFeedback?: boolean;
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
    /** Object form of structured output (Mastra parity — from `structuredOutput`). */
    readonly object?: unknown;
    /** Tripwire info when a processor blocked the request. */
    readonly tripwire?: { processorId?: string; reason?: string; metadata?: unknown };
    /** Suspension info when a tool call requires approval or self-suspended. */
    readonly suspendPayload?: {
        readonly toolCallId: string;
        readonly toolName: string;
        readonly args: Record<string, unknown>;
        readonly requiresApproval?: boolean;
        readonly suspendPayload?: unknown;
    };
    /** All messages in the conversation (including tool calls/results) */
    readonly messages: Message[];
    /** Number of steps taken */
    readonly steps: number;
    /** Finish reason */
    readonly finishReason: 'stop' | 'max_steps' | 'timeout' | 'error' | 'human_rejected' | 'aborted' | 'suspended' | 'max_runs';
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
    /** Emitted after each goal evaluation with the verdict/status. */
    onGoal?: (evaluation: import('../goals/store.js').GoalEvaluation) => void;
    /** Emitted when a tool call requires human approval. */
    onApproval?: (req: { toolCallId: string; toolName: string; args: Record<string, unknown>; requiresApproval: boolean }) => void;
    /** Emitted when a tool self-suspends during execute(). */
    onSuspended?: (req: { toolCallId?: string; toolName: string; args: Record<string, unknown>; suspendPayload: unknown }) => void;
    /** Emitted when a processor blocks the request (tripwire). */
    onTripwire?: (info: { processorId?: string; reason?: string; metadata?: unknown }) => void;
    /** Emitted with the final structured output object (object-result). */
    onObject?: (obj: unknown) => void;
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
    /**
     * Mastra-style inspired input/output/error processors (agent-level defaults).
     */
    readonly processors?: ProcessorSet;
    /**
     * Max processor-driven retries per request. When output/error processors
     * request a retry (`abort(..., { retry: true })`), the step is replayed up
     * to this many times. Default 0 (disabled unless error processors set).
     */
    readonly maxProcessorRetries?: number;
    /** Durable goal store for in-loop objective evaluation. */
    readonly goalStore?: import('../goals/index.js').GoalStore;
    /** Durable suspended-run store for approval/suspend recovery. */
    readonly suspendedRunStore?: import('../approval/index.js').SuspendedRunStore;
    /**
     * Resolve `provider/model` strings to providers at runtime
     * (per-step model switches, structuring models, goal judges).
     */
    readonly resolveExtraLlm?: (model: string) => LLMProvider | undefined;
}

/** Convert a framework Tool to LLM tool definition (name, description, parameters as JSON Schema) */
export function toolToLLMDefinition(
    name: string,
    description: string,
    parametersSchema: Record<string, unknown>,
): LLMToolDefinition {
    return { name, description, parameters: parametersSchema };
}
