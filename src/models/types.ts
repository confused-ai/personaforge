/**
 * @personaforge/models — shared config types.
 * Zero runtime code — type-only file.
 */

export interface ModelAdapterConfig {
  /** API key — falls back to env var specific to each provider. */
  apiKey?: string;
  /** Model name. Each adapter provides its default. */
  model?: string;
  /** Base URL override for self-hosted / proxy endpoints. */
  baseURL?: string;
  /** Max tokens in completion. */
  maxTokens?: number;
  /** Sampling temperature 0–2. */
  temperature?: number;
}

// ── Re-export canonical LLM types from @personaforge/core ────────────────────
// This avoids consumers needing to import from two packages.
export type {
    LLMProvider,
    Message,
    GenerateResult,
    GenerateOptions,
    LLMToolDefinition,
    ToolCall,
    StreamOptions,
    StreamDelta,
    TextStreamChunk,
    StreamToolCallChunk,
} from '../core/index.js';

