/**
 * @personaforge/models — LLM provider adapters.
 *
 * SOLID:
 *   SRP  — each adapter file owns exactly one provider.
 *   OCP  — add new providers by adding new files; never edit existing ones.
 *   LSP  — every adapter returns LLMProvider, fully substitutable.
 *   ISP  — adapters expose only what the runner needs (generateText + optional streamText).
 *   DIP  — adapters depend on LLMProvider interface from @personaforge/core.
 *
 * All SDKs are lazy dynamic imports — zero bundle cost unless used.
 * Importing this barrel alone installs nothing.
 *
 * @deprecated `@personaforge/providers` (`src/providers/`) is the canonical provider stack.
 *   This barrel is retained because its `GenerateResult`/`LLMProvider` shapes are
 *   `contracts/interfaces`-compatible (consumed by `orchestration/multi-agent/swarm.ts`)
 *   and it exposes adapter/multimodal/stream surfaces not yet present in `providers/`.
 *   Prefer importing from `personaforge/providers` for new code.
 */

export { openai }    from './openai.js';
export { anthropic } from './anthropic.js';
export { google }    from './google.js';
export { ollama }    from './ollama.js';
export { bedrock }   from './bedrock.js';
export type { ModelAdapterConfig } from './types.js';

// Full provider implementations
export { OpenAIProvider }         from './openai-provider.js';
export { createOpenRouterProvider } from './openrouter-provider.js';
export type { OpenRouterProviderConfig } from './openrouter-provider.js';
export {
    resolveModelString,
    isModelString,
    PROVIDER,
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
} from './model-resolver.js';

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
