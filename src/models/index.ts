/**
 * @personaforge/models — compatibility barrel.
 *
 * The canonical implementation of every LLM provider lives in `personaforge/providers`.
 * This module re-exports the provider classes and model-string resolver from there,
 * and additionally ships:
 *   - alternate multi-modal content builders (`image()`, `audio()`, `video()`,
 *     `buildMessage()`, `contentToText()`)
 *   - stream utilities (`streamToSSE`, `streamToText`, `streamMap`, ...)
 *   - retry / fallback helpers (`withRetry`, `withFallbacks`)
 *   - thin lazy adapters (`openai`, `anthropic`, `google`, `ollama`, `bedrock`) that
 *     return an `LLMProvider` without pre-loading any SDK.
 *
 * Prefer importing providers themselves from `personaforge/providers`.
 * Use this barrel when you need the extra content/stream helpers listed above.
 */

export { openai }    from './openai.js';
export { anthropic } from './anthropic.js';
export { google }    from './google.js';
export { ollama }    from './ollama.js';
export { bedrock }   from './bedrock.js';
export type { ModelAdapterConfig } from './types.js';

// Full provider implementations — re-exported from the canonical `providers/` stack.
// These previously lived in duplicate files under `models/`; consolidated 2026-07 so
// there is exactly one OpenAIProvider / OpenRouter / model-resolver implementation.
export { OpenAIProvider }          from '../providers/index.js';
export { createOpenRouterProvider } from '../providers/index.js';
export type { OpenRouterProviderConfig } from '../providers/index.js';
export {
    resolveModelString,
    isModelString,
    MODEL_PROVIDER as PROVIDER,
    LLAMABARN_BASE_URL,
    // Wave 2 base URLs
    DEEPINFRA_BASE_URL,
    HUGGINGFACE_INFERENCE_BASE_URL,
    LEPTON_BASE_URL,
    FEATHERLESS_BASE_URL,
    SNOWFLAKE_BASE_URL,
    // Wave 4 Chinese base URLs
    HUNYUAN_BASE_URL,
    VOLCENGINE_BASE_URL,
    MINIMAX_BASE_URL,
    BAICHUAN_BASE_URL,
    STEPFUN_BASE_URL,
    INTERNLM_BASE_URL,
    // Wave 4 global base URLs
    REPLICATE_BASE_URL,
    // Self-hosted base URLs
    VLLM_BASE_URL,
    LMSTUDIO_BASE_URL,
    LOCALAI_BASE_URL,
    KOBOLD_BASE_URL,
    TEXTGENWEBUI_BASE_URL,
    JAN_BASE_URL,
} from '../providers/index.js';

// Multi-modal content builders
export {
    text,
    image,
    audio,
    video,
    file,
    buildMessage,
    contentToText,
    isVisionCapable,
    isAudioCapable,
} from './multimodal.js';
export type { ContentPart, AudioContent, VideoContent, FileContent } from './multimodal.js';

// Streaming consumer utilities
export {
    streamToText,
    streamToChunks,
    streamToSSE,
    streamWithBudget,
    streamTee,
    streamMap,
    streamFilter,
    streamMerge,
    streamToNodeCallback,
} from './stream-utils.js';
export type { StreamToSSEOptions, StreamBudgetOptions } from './stream-utils.js';

// ── Model fallback + retry ────────────────────────────────────────────────────
export { withFallbacks, withRetry } from './fallback.js';
export type { RetryOptions } from './fallback.js';
