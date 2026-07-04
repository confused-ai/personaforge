/**
 * @confused-ai/core — internal runner types.
 *
 * Not exported from the package barrel — internal use only.
 */

import type { Message, AgentLifecycleHooks, AgentRunResult } from '../types.js';
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
    /** Abort signal; threaded into LLM SDK calls and tool execution for true cancellation. */
    readonly signal?: AbortSignal;
}

// ── Retry policy ─────────────────────────────────────────────────────────────

export interface RetryPolicy {
    readonly maxRetries?: number;
    readonly backoffMs?: number;
    readonly maxBackoffMs?: number;
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
    /** Optional durable event recorder. Off by default — zero cost when absent. */
    readonly recorder?: EventRecorder;
}

// ── Event recorder (durable-log seam; core stays decoupled from the graph engine) ──

/**
 * Narrow seam the runner calls to record a run as a durable event log.
 * The concrete implementation (RunRecorder) lives in the graph layer and owns
 * the GraphEvent schema + EventStore; the core runner only knows this interface.
 */
export interface EventRecorder {
    agentStart(data: { agent: string; prompt: string }): void | Promise<void>;
    llmResult(data: { step: number; text: string; toolCalls?: readonly { name: string }[]; usage?: unknown }): void | Promise<void>;
    toolResult(data: { step: number; name: string; args: unknown; output: unknown; error?: boolean }): void | Promise<void>;
    agentEnd(data: { text: string; steps: number; finishReason: string }): void | Promise<void>;
}

// ── Internal run result (aliased to public AgentRunResult) ───────────────────

export type { AgentRunResult };
