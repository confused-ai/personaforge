/**
 * @personaforge/core — internal runner types.
 *
 * Not exported from the package barrel — internal use only.
 */

import type { Message, AgentLifecycleHooks, AgentRunResult } from '../types.js';
import type { GuardrailEngine } from '../../guardrails/types.js';
import type {
    LLMProvider, LLMToolDefinition, GenerateOptions, GenerateResult,
    ToolCall, Tool, ToolRegistry,
} from '../../contracts/index.js';
export type { LLMProvider, LLMToolDefinition, GenerateOptions, GenerateResult, ToolCall, Tool, ToolRegistry };

/** @deprecated renamed to ToolCall */
export type ToolCallResult = ToolCall;

// ── Stream hooks (internal) ──────────────────────────────────────────────────

/** Low-level streaming callbacks threaded through the runner. */
export interface RunnerStreamHooks {
    onChunk?: (text: string) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: unknown) => void;
    onStep?: (step: number) => void;
}

// ── Run config ───────────────────────────────────────────────────────────────

export interface RunnerRunConfig {
    readonly instructions: string;
    readonly prompt: string;
    readonly messages?: Message[];
    readonly maxSteps?: number;
    readonly timeoutMs?: number;
    readonly runId?: string;
    readonly userId?: string;
    readonly ragContext?: string;
    /**
     * W3C trace id (32 hex chars) for distributed tracing. When present, the
     * runner injects a `traceparent` header into provider LLM calls so the
     * provider request joins the caller's trace.
     */
    readonly traceId?: string;
    /** Abort signal; threaded into LLM SDK calls and tool execution for true cancellation. */
    readonly signal?: AbortSignal;
}

// ── Retry policy ─────────────────────────────────────────────────────────────

export interface RetryPolicy {
    readonly maxRetries?: number;
    readonly backoffMs?: number;
    readonly maxBackoffMs?: number;
    /**
     * Optional predicate deciding whether an error is retryable.
     * Full user control: return `true` to retry, `false` to fail fast.
     * Defaults to a conservative transient-only classifier (never retries 4xx/validation).
     */
    readonly retryOn?: (error: unknown) => boolean;
}

// ── ISP sub-interfaces (Interface Segregation Principle) ─────────────────────
//
// Code that only needs text generation can depend on ITextGenerator rather
// than the full LLMProvider union.  All existing LLMProvider implementations
// satisfy these interfaces automatically — no migration required.

/** Minimal interface: synchronous text generation only. */
export interface ITextGenerator {
    generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult>;
}

/** Providers that support server-sent streaming (SSE / ReadableStream). */
export interface IStreamingProvider extends ITextGenerator {
    streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult>;
}

/** Providers that accept tool definitions and return tool-call results. */
export interface IToolCallProvider extends ITextGenerator {
    /** True when the underlying model supports parallel tool calls. */
    readonly supportsTools: boolean;
}

/**
 * Providers that can produce embeddings.
 * Separated from text generation to avoid burdening chat-only providers.
 */
export interface IEmbeddingProvider {
    embed(text: string, options?: { model?: string }): Promise<number[]>;
    embedBatch(texts: string[], options?: { model?: string }): Promise<number[][]>;
}

/**
 * Full-capability provider (backward-compatible aggregate).
 * LLMProvider implementations are automatically assignable to any sub-interface.
 */
export type IFullLLMProvider = IStreamingProvider & IToolCallProvider;

// ── Runner config ─────────────────────────────────────────────────────────────

export interface RunnerConfig {
    readonly name: string;
    readonly instructions: string;
    readonly llm: LLMProvider;
    readonly tools: ToolRegistry;
    readonly maxSteps?: number;
    readonly timeoutMs?: number;
    readonly retry?: RetryPolicy;
    readonly hooks?: AgentLifecycleHooks;
    readonly toolTimeoutMs?: number;
    /** Optional guardrail engine — validates tool calls and output. */
    readonly guardrails?: GuardrailEngine;
    /** Optional durable event recorder. Off by default — zero cost when absent. */
    readonly recorder?: EventRecorder;
    /**
     * Model id used for cost estimation and the run's `model` field.
     * When omitted, cost falls back to the pricing table's default entry.
     * Set this to the provider model id (e.g. `gpt-4o`) for accurate accounting.
     */
    readonly model?: string;
    /**
     * Repeated-state loop detection. When the last-N-message signature repeats
     * `threshold` consecutive steps, the loop exits with `finishReason: 'loop_detected'`.
     * Set `enabled: false` to opt out entirely (full user control).
     * Defaults to enabled with `threshold: 3`, `window: 1`.
     */
    readonly loopDetection?: LoopDetectionConfig;
    /**
     * Sink for non-fatal ("soft") failures the runner must not throw on
     * (recorder calls). Defaults to a `console.warn` line — visible, low-overhead;
     * pass a logger to route elsewhere and gain full transparency into
     * degraded-but-not-failed paths. Failures are never silently swallowed.
     */
    readonly onSoftFailure?: (error: Error, ctx: { op: string; step?: number }) => void;
    /**
     * Pre-flight validation of tool-call arguments before execution. When enabled
     * (default), malformed arguments (non-object) or omitted fields declared
     * `required` in the tool's JSON-Schema `parameters` are rejected with a
     * precise, self-correctable tool result instead of an opaque execution error.
     * Set `false` to opt out (full user control).
     */
    readonly validateToolArgs?: boolean;
    /**
     * Max tool calls to execute in parallel within a single step. Independent
     * calls run concurrently (order in message history is always preserved);
     * set to `1` for fully sequential dispatch. Default: 8.
     */
    readonly toolConcurrency?: number;
    /**
     * Optional admission-control probe. Called before a run starts; return a
     * decision to shed load (e.g. when a downstream circuit is open or the
     * process is overloaded). When `admit === false` the runner rejects the run
     * up front instead of queuing unbounded work. Gateways can map the returned
     * `retryAfterMs`/`reason` to `HTTP 503 + Retry-After`.
     */
    readonly admissionControl?: () => LoadShedDecision | Promise<LoadShedDecision>;
    /**
     * Optional cache for non-streaming LLM responses. Identical requests
     * (same messages + tools) return the cached `GenerateResult` instead of
     * re-calling the provider. The runner additionally coalesces concurrent
     * identical in-flight requests into one provider call. Streaming turns are
     * never cached. Provide any `LLMResponseCache` implementation (in-memory,
     * Redis, etc.).
     */
    readonly responseCache?: LLMResponseCache;
}

/** Pluggable cache for LLM responses (item 13). */
export interface LLMResponseCache {
    get(key: string): GenerateResult | undefined | Promise<GenerateResult | undefined>;
    set(key: string, value: GenerateResult): void | Promise<void>;
}

/** Result of an admission-control probe. */
export interface LoadShedDecision {
    /** `true` to accept the run; `false` to shed it. */
    readonly admit: boolean;
    /** Human-readable reason when `admit === false`. */
    readonly reason?: string;
    /** Suggested client back-off in milliseconds (feeds `Retry-After`). */
    readonly retryAfterMs?: number;
}

/** Configuration for repeated-state loop detection. */
export interface LoopDetectionConfig {
    /** Master switch. Default: true. */
    readonly enabled?: boolean;
    /** Consecutive identical signatures before bailing. Default: 3. */
    readonly threshold?: number;
    /** Number of trailing messages hashed into each signature. Default: 1. */
    readonly window?: number;
}

// ── Event recorder (durable-log seam; core stays decoupled from the graph engine) ──

/**
 * Narrow seam the runner calls to record a run as a durable event log.
 * The concrete implementation (RunRecorder) lives in the graph layer and owns
 * the GraphEvent schema + EventStore; the core runner only knows this interface.
 */
export interface EventRecorder {
    agentStart(data: { agent: string; prompt: string }): void | Promise<void>;
    llmResult(data: { step: number; text: string; toolCalls?: readonly { name: string }[]; finishReason?: string; usage?: unknown }): void | Promise<void>;
    toolResult(data: { step: number; name: string; args: unknown; output: unknown; error?: boolean }): void | Promise<void>;
    agentEnd(data: { text: string; steps: number; finishReason: string }): void | Promise<void>;
}

// ── Internal run result (aliased to public AgentRunResult) ───────────────────

export type { AgentRunResult };
