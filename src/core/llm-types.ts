/**
 * @personaforge/core — canonical LLM provider type definitions.
 *
 * These types are the single source of truth for the LLM provider interface.
 * All src/providers/types.ts consumers should migrate to re-exporting these.
 *
 * Design:
 *  - ToolCall (flat) lives in runner/types.ts — returned by generateText/streamText
 *  - OpenAIToolCall lives in types.ts — used inside Message.tool_calls (conversation history)
 *  - Everything else (streaming, multimodal) lives here
 */

export type { ToolCall } from './runner/types.js';

// ── Roles ────────────────────────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

// ── Multimodal content parts ─────────────────────────────────────────────────

export type ContentPart =
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'image_url'; readonly image_url: { readonly url: string; readonly detail?: 'low' | 'high' | 'auto' } }
    | { readonly type: 'file'; readonly file: { readonly url: string; readonly filename?: string } }
    | { readonly type: 'audio'; readonly audio: { readonly url: string } }
    | { readonly type: 'video'; readonly video: { readonly url: string } };

// ── Extended message types ────────────────────────────────────────────────────

/** A Message with an optional tool call id (for role: 'tool' messages). */
export interface MessageWithToolId {
    readonly role: MessageRole;
    readonly content: string | ContentPart[];
    readonly toolCallId?: string;
}

/** Assistant message that may carry pending tool calls. */
export interface AssistantMessage {
    role: 'assistant';
    content: string;
    toolCalls?: import('./runner/types.js').ToolCall[];
}

/** Result message sent back to LLM after tool execution. */
export interface ToolResultMessage {
    readonly toolCallId: string;
    readonly content: string;
}

// ── Tool definition ───────────────────────────────────────────────────────────

export type { LLMToolDefinition } from './runner/types.js';

// ── Streaming ─────────────────────────────────────────────────────────────────

/** A text delta chunk from a streaming LLM response (low-level provider layer). */
export interface TextStreamChunk {
    readonly type: 'text';
    readonly text: string;
}

/** @deprecated Use TextStreamChunk */
export type StreamChunk = TextStreamChunk;

/** A tool-call delta chunk from a streaming LLM response. */
export interface StreamToolCallChunk {
    readonly type: 'tool_call';
    readonly id: string;
    readonly name: string;
    readonly argsDelta: string;
}

/** Union of all streaming delta types from an LLM provider. */
export type StreamDelta = TextStreamChunk | StreamToolCallChunk;

// ── Stream options ────────────────────────────────────────────────────────────


export type { GenerateOptions, GenerateResult, LLMProvider, ToolCallResult } from './runner/types.js';

export interface StreamOptions {
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly tools?: import('./runner/types.js').LLMToolDefinition[];
    readonly toolChoice?: 'auto' | 'none' | { type: 'tool'; name: string };
    readonly stop?: string[];
    readonly onChunk?: (delta: StreamDelta) => void;
}
