/**
 * LLM provider type definitions — canonical source moved to @personaforge/core.
 *
 * This file is now a compatibility re-export barrel.
 * Import from '../core/index.js' directly in new code.
 *
 * NOTE: LLMProvider and StreamOptions are kept local for backward compatibility —
 * the src/ legacy providers use StreamDelta-based onChunk. Once Wave 2 (provider
 * migration to @personaforge/models) is complete, these will be removed.
 */

// Re-export all canonical LLM types from the package
export type {
    MessageRole,
    ContentPart,
    Message,
    MessageWithToolId,
    AssistantMessage,
    ToolResultMessage,
    ToolCall,
    ToolCallResult,
    LLMToolDefinition,
    GenerateOptions,
    TextStreamChunk,
    StreamToolCallChunk,
    StreamDelta,
    // ISP sub-interfaces
    ITextGenerator,
    IStreamingProvider,
    IToolCallProvider,
    IEmbeddingProvider,
    IFullLLMProvider,
} from '../core/index.js';

// Backward compat alias: StreamChunk was the text-delta type (now TextStreamChunk)
export type { TextStreamChunk as StreamChunk } from '../core/index.js';

// ── LLMProvider / GenerateResult — unified with contracts/interfaces ──────────
//
// Historically `src/providers/types.ts` shipped a widened `GenerateResult` whose
// `finishReason` was `string`, while `contracts/interfaces` shipped the narrow
// `'stop' | 'tool_calls' | 'max_tokens' | 'error'` union. That split produced
// TS2322 errors at every boundary and forced casts (e.g. swarm.ts). Providers
// now share the canonical narrow type from `contracts/interfaces` and normalise
// raw SDK finish-reason strings via `normalizeFinishReason` at their emit sites.

import type { LLMToolDefinition, StreamDelta } from '../core/index.js';

/** Streaming options — legacy variant where onChunk receives typed StreamDelta objects. */
export interface StreamOptions {
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly tools?: LLMToolDefinition[];
    readonly toolChoice?: 'auto' | 'none' | { type: 'tool'; name: string };
    readonly stop?: string[];
    readonly onChunk?: (delta: StreamDelta) => void;
    /** Abort signal forwarded to the provider SDK so in-flight streams cancel on run abort/timeout. */
    readonly signal?: AbortSignal;
}

// GenerateResult and LLMProvider are canonical: single source of truth in
// `contracts/interfaces`. They are re-exported here so provider modules keep
// importing from `./types.js` (no churn) while every consumer — swarm, runner,
// tests — sees the same nominal type.
export type { GenerateResult, LLMProvider } from '../contracts/interfaces.js';
import type { GenerateResult } from '../contracts/interfaces.js';

/**
 * Normalise a raw SDK finish-reason string into the narrow canonical union.
 *
 * Each provider SDK uses its own vocabulary — OpenAI emits `stop | length |
 * tool_calls | content_filter | function_call`, Anthropic emits `end_turn |
 * max_tokens | stop_sequence | tool_use`, Google emits SCREAMING_SNAKE, Bedrock
 * mirrors the model's native value. We collapse all of that into the four
 * literals declared on `contracts/interfaces.GenerateResult.finishReason`.
 *
 * Unknown / empty / null inputs collapse to `undefined` so downstream code can
 * treat them the same as "the SDK did not tell us".
 */
export function normalizeFinishReason(raw: string | null | undefined): GenerateResult['finishReason'] {
    if (raw === null || raw === undefined) return undefined;
    const s = String(raw).toLowerCase();
    if (s === '') return undefined;
    // Direct matches on the canonical vocabulary.
    if (s === 'stop' || s === 'tool_calls' || s === 'max_tokens' || s === 'error') {
        return s as GenerateResult['finishReason'];
    }
    // OpenAI vocabulary.
    if (s === 'length') return 'max_tokens';
    if (s === 'function_call') return 'tool_calls';
    if (s === 'content_filter') return 'error';
    // Anthropic vocabulary.
    if (s === 'end_turn' || s === 'stop_sequence') return 'stop';
    if (s === 'tool_use') return 'tool_calls';
    // Google / Bedrock vocabulary (also handles arbitrary casing).
    if (s === 'complete' || s === 'finish' || s === 'end') return 'stop';
    if (s === 'max_output_tokens' || s === 'max_length') return 'max_tokens';
    if (s === 'safety' || s === 'recitation' || s === 'blocklist' || s === 'prohibited_content' || s === 'spii' || s === 'other') return 'error';
    if (s === 'unknown') return undefined;
    // Unknown value — do not silently claim `stop`.
    return undefined;
}

