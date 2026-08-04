/**
 * Processor pipeline types — Mastra-style inspired input/output/error processors.
 *
 * Processors transform, validate, or control messages as they pass through an
 * agent. They run at specific points in the execution pipeline: before messages
 * reach the LLM (input), after the LLM responds (output), and when the provider
 * rejects a request (error / API errors).
 */

import type { Message } from '../core/index.js';

/**
 * Shared context for every processor stage. `state` is a per-run, per-processor
 * scratchpad (keyed by `processor.id`) that persists for the whole request so a
 * processor can coordinate between its own hooks (e.g. cache key written in
 * `processLLMRequest`, read in `processLLMResponse`).
 */
export interface ProcessorContext {
    readonly agentId?: string;
    readonly sessionId?: string;
    readonly runId?: string;
    readonly threadId?: string;
    readonly resourceId?: string;
    /** Current step in the agentic loop (1-based, 0 before the loop starts). */
    readonly step?: number;
    /** Number of processor-driven retries already performed this request. */
    readonly retryCount?: number;
    /** Arbitrary request-scoped values (memory options, tenant ids, …). */
    readonly requestContext?: Record<string, unknown>;
}

/** Payload delivered to `onViolation` when a processor blocks or warns. */
export interface ProcessorViolation {
    readonly processorId: string;
    readonly message: string;
    readonly detail?: unknown;
}

/** Options for `abort()`. */
export interface TripWireOptions {
    /** Ask the agent to retry the step instead of ending the request. */
    retry?: boolean;
    /** Structured metadata attached to the tripwire (e.g. detected PII types). */
    metadata?: unknown;
}

/** Thrown by `abort()` to stop (or retry) the current request/short-circuit the pipeline. */
export class TripWireError extends Error {
    readonly processorId: string;
    readonly options?: TripWireOptions;
    readonly metadata?: unknown;

    constructor(processorId: string, reason: string, options?: TripWireOptions) {
        super(reason);
        this.name = 'TripWireError';
        this.processorId = processorId;
        this.options = options;
        this.metadata = options?.metadata;
    }
}

/** A signal injected into the conversation as a system-reminder user message. */
export interface ProcessorSignal {
    readonly type: 'reactive';
    readonly contents: string;
    readonly attributes?: Record<string, unknown>;
}

/** Arguments for `processInput()` — runs once before the agentic loop starts. */
export interface ProcessInputArgs {
    /** Snapshot of all messages (system + conversation) about to reach the model. */
    readonly messages: Message[];
    readonly context: ProcessorContext;
    /** Per-processor scratchpad (keyed by `processor.id`). */
    readonly state: Record<string, unknown>;
    /** Stop the request immediately. Throw a tripwire. */
    abort(reason?: string, options?: TripWireOptions): never;
    /** Append a system-reminder message (reactive signal). */
    sendSignal?(signal: ProcessorSignal): Promise<void>;
}

/** Result of `processInput()` — return messages to replace the conversation. */
export type ProcessInputResult =
    | Message[]
    | { messages?: Message[]; systemMessages?: Message[] };

/** Arguments for `processInputStep()` — runs before every LLM call in the loop. */
export interface ProcessInputStepArgs {
    readonly stepNumber: number;
    readonly messages: Message[];
    readonly context: ProcessorContext;
    readonly state: Record<string, unknown>;
    abort(reason?: string, options?: TripWireOptions): never;
    sendSignal?(signal: ProcessorSignal): Promise<void>;
}

/** Per-step overrides returned by `processInputStep()` / `prepareStep()`. */
export interface ProcessInputStepResult {
    /** Runtime model switch — `provider/model` string or `{ provider }`-style. */
    model?: string;
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; name: string };
    /** Restrict the tools available for this step (by name). */
    tools?: string[];
    /** Replace the system messages for this step. */
    systemMessages?: Message[];
    /** Signals (system-reminder user messages) to append for this step. */
    signals?: Message[];
}

/** Arguments for `processLLMRequest()` — final prompt rewrite before the provider call. */
export interface ProcessLLMRequestArgs {
    readonly messages: Message[];
    readonly model: string;
    readonly stepNumber: number;
    readonly steps: number;
    readonly context: ProcessorContext;
    readonly state: Record<string, unknown>;
    abort(reason?: string, options?: TripWireOptions): never;
}

/** Result of `processLLMRequest()`. */
export interface ProcessLLMRequestResult {
    /** Rewritten prompt to send to the provider (transient — not persisted). */
    messages?: Message[];
    /** Short-circuit: provider call is skipped and this cached text is replayed. */
    cached?: { text: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
}

/** Arguments for `processLLMResponse()` — side effects after a provider call. */
export interface ProcessLLMResponseArgs {
    readonly chunks: string[];
    readonly text: string;
    readonly model: string;
    readonly stepNumber: number;
    readonly steps: number;
    readonly fromCache?: boolean;
    readonly context: ProcessorContext;
    readonly state: Record<string, unknown>;
}

/** Arguments for `processOutputStep()` — validate/retry one LLM step. */
export interface ProcessOutputStepArgs {
    readonly text: string;
    readonly messages: Message[];
    readonly context: ProcessorContext;
    readonly state: Record<string, unknown>;
    readonly retryCount: number;
    abort(reason?: string, options?: TripWireOptions): never;
}

/** Result of `processOutputStep()`. */
export interface ProcessOutputStepResult {
    /** Ask the agent to re-run the step with `reason` appended as feedback. */
    retry?: boolean;
    /** Extra feedback text injected when retrying. */
    feedback?: string;
}

/** Arguments for `processOutputResult()` — after the run completes. */
export interface ProcessOutputResultArgs {
    readonly messages: Message[];
    readonly result: {
        readonly text: string;
        readonly steps?: number;
        readonly finishReason?: string;
        readonly usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    };
    readonly context: ProcessorContext;
    readonly state: Record<string, unknown>;
}

/** Result of `processOutputResult()`. */
export type ProcessOutputResultResult = Message[] | { messages: Message[] } | void;

/** A stream part that output-stream processors can filter/rewrite. */
export interface StreamOutputPart {
    readonly type: 'text-delta' | 'data' | string;
    readonly text?: string;
    readonly data?: unknown;
    readonly [key: string]: unknown;
}

/** Arguments for `processOutputStream()` — filter/transform streamed chunks. */
export interface ProcessOutputStreamArgs {
    readonly part: StreamOutputPart;
    readonly context: ProcessorContext;
    readonly state: Record<string, unknown>;
}

/** Arguments for `processAPIError()` — recover from provider errors. */
export interface ProcessAPIErrorArgs {
    readonly error: unknown;
    readonly messages: Message[];
    readonly retryCount: number;
    readonly context: ProcessorContext;
    readonly state: Record<string, unknown>;
}

/** Result of `processAPIError()`. */
export interface ProcessAPIErrorResult {
    retry?: boolean;
    messages?: Message[];
}

/**
 * A processor — implement one or more hooks to transform/validate/control
 * messages. `id` must be unique per processor (used for state scoping).
 */
export interface Processor {
    readonly id: string;
    /** Process data-* stream parts too (default: only text-delta parts). */
    readonly processDataParts?: boolean;
    /** Fires whenever the processor blocks or warns. Errors are swallowed. */
    onViolation?(violation: ProcessorViolation): void;
    /** Runs once before the agentic loop starts. */
    processInput?(args: ProcessInputArgs): Promise<ProcessInputResult> | ProcessInputResult;
    /** Runs before each LLM call. */
    processInputStep?(args: ProcessInputStepArgs): Promise<ProcessInputStepResult | void> | ProcessInputStepResult | void;
    /** Final prompt rewrite immediately before the provider call (transient). */
    processLLMRequest?(args: ProcessLLMRequestArgs): Promise<ProcessLLMRequestResult | void> | ProcessLLMRequestResult | void;
    /** Side effects after the provider call finishes. */
    processLLMResponse?(args: ProcessLLMResponseArgs): Promise<void> | void;
    /** Validate the response after each LLM step; may request a retry. */
    processOutputStep?(args: ProcessOutputStepArgs): Promise<ProcessOutputStepResult | void> | ProcessOutputStepResult | void;
    /** Transform/filter streamed chunks before they reach the client. */
    processOutputStream?(args: ProcessOutputStreamArgs): Promise<StreamOutputPart | null | undefined> | StreamOutputPart | null | undefined;
    /** Transform the final result / attach metadata after the run completes. */
    processOutputResult?(args: ProcessOutputResultArgs): Promise<ProcessOutputResultResult> | ProcessOutputResultResult;
    /** Recover from provider API rejections (400/422 context-length, …). */
    processAPIError?(args: ProcessAPIErrorArgs): Promise<ProcessAPIErrorResult | void> | ProcessAPIErrorResult | void;
}

/** All processors configured on an agent/run. */
export interface ProcessorSet {
    readonly input?: Processor | Processor[];
    readonly output?: Processor | Processor[];
    readonly error?: Processor | Processor[];
}

/** Helper to emit a violation callback safely (errors are swallowed). */
export function emitViolation(processor: Processor, violation: ProcessorViolation): void {
    try {
        processor.onViolation?.(violation);
    } catch {
        /* callback errors must never break the pipeline */
    }
}
