/**
 * LLM provider abstraction — types, providers, utilities.
 *
 * This is the **canonical** provider stack for personaforge. It owns the single
 * implementation of every provider adapter, the model-string resolver, cost/cache/
 * router utilities, and vision helpers. Import providers from `personaforge/providers`.
 *
 * `personaforge/models` is a thin compatibility barrel that re-exports from here and
 * additionally ships the alternate multi-modal content builders and stream utilities.
 */

// Core types
export * from './types.js';

// ── Providers ──────────────────────────────────────────────────────────────

export { OpenAIProvider } from './openai-provider.js';
export type { OpenAIProviderConfig } from './openai-provider.js';

export { AnthropicProvider } from './anthropic-provider.js';
export type { AnthropicProviderConfig } from './anthropic-provider.js';

export { GoogleProvider } from './google-provider.js';
export type { GoogleProviderConfig } from './google-provider.js';

export { BedrockConverseProvider } from './bedrock-provider.js';
export type { BedrockConverseProviderConfig } from './bedrock-provider.js';

export type { OpenAIEmbeddingProviderConfig } from './openai-embedding-provider.js';

export type { EmbeddingProvider } from './types-embedding.js';
export { GoogleEmbeddingProvider } from './google-embedding-provider.js';
export type { GoogleEmbeddingProviderConfig } from './google-embedding-provider.js';
export { CohereEmbeddingProvider } from './cohere-embedding-provider.js';
export type { CohereEmbeddingProviderConfig } from './cohere-embedding-provider.js';

// OpenRouter (multi-model gateway)
export { createOpenRouterProvider } from './openrouter-provider.js';
export type { OpenRouterProviderConfig } from './openrouter-provider.js';

export { createAiSdkProvider } from './ai-sdk-provider.js';
export type { AiSdkProviderOptions } from './ai-sdk-provider.js';

// OpenAI-compatible provider factories
export {
    // Existing
    createGroqProvider,
    createXAIProvider,
    createTogetherProvider,
    createFireworksProvider,
    createDeepSeekProvider,
    createMistralProvider,
    createCohereProvider,
    createPerplexityProvider,
    createAzureOpenAIProvider,
    // Generic custom OpenAI-compatible
    createOpenAICompatibleProvider,
    // New providers
    createCerebrasProvider,
    createSambaNovaProvider,
    createNvidiaProvider,
    createAI21Provider,
    createHyperbolicProvider,
    createLambdaProvider,
    createMoonshotProvider,
    createDashScopeProvider,
    createZhipuProvider,
    createYiProvider,
    createUpstageProvider,
    createNovitaProvider,
    createCloudflareProvider,
    createWriterProvider,
    // Wave 2 providers
    createDeepInfraProvider,
    createHuggingFaceProvider,
    createLeptonProvider,
    createFeatherlessProvider,
    createSnowflakeProvider,
    createVllmProvider,
    createLmStudioProvider,
    // Wave 4 — Chinese frontier providers
    createHunyuanProvider,
    createVolcengineProvider,
    createMinimaxProvider,
    createBaichuanProvider,
    createStepfunProvider,
    createInternLMProvider,
    // Wave 4 — Global cloud providers
    createReplicateProvider,
    createRunPodProvider,
    createWatsonxProvider,
    // Wave 4 — Additional self-hosted / local
    createLocalAIProvider,
    createKoboldProvider,
    createTextGenWebUIProvider,
    createJanProvider,
    // Base URLs (existing)
    GROQ_BASE_URL,
    XAI_BASE_URL,
    TOGETHER_BASE_URL,
    FIREWORKS_BASE_URL,
    DEEPSEEK_BASE_URL,
    MISTRAL_BASE_URL,
    COHERE_BASE_URL,
    PERPLEXITY_BASE_URL,
    // Base URLs (new)
    CEREBRAS_BASE_URL,
    SAMBANOVA_BASE_URL,
    NVIDIA_BASE_URL,
    AI21_BASE_URL,
    HYPERBOLIC_BASE_URL,
    LAMBDA_BASE_URL,
    MOONSHOT_BASE_URL,
    DASHSCOPE_BASE_URL,
    ZHIPU_BASE_URL,
    YI_BASE_URL,
    UPSTAGE_BASE_URL,
    NOVITA_BASE_URL,
    WRITER_BASE_URL,
    DEEPINFRA_BASE_URL,
    HUGGINGFACE_INFERENCE_BASE_URL,
    LEPTON_BASE_URL,
    FEATHERLESS_BASE_URL,
    SNOWFLAKE_BASE_URL,
    // Wave 4 base URLs
    HUNYUAN_BASE_URL,
    VOLCENGINE_BASE_URL,
    MINIMAX_BASE_URL,
    BAICHUAN_BASE_URL,
    STEPFUN_BASE_URL,
    INTERNLM_BASE_URL,
    REPLICATE_BASE_URL,
    WATSONX_REGION_URLS,
} from './compat-providers.js';

export type {
    GroqProviderConfig,
    XAIProviderConfig,
    TogetherProviderConfig,
    FireworksProviderConfig,
    DeepSeekProviderConfig,
    MistralProviderConfig,
    CohereProviderConfig,
    PerplexityProviderConfig,
    AzureOpenAIProviderConfig,
    OpenAICompatibleProviderConfig,
    CerebrasProviderConfig,
    SambaNovaProviderConfig,
    NvidiaProviderConfig,
    AI21ProviderConfig,
    HyperbolicProviderConfig,
    LambdaProviderConfig,
    MoonshotProviderConfig,
    DashScopeProviderConfig,
    ZhipuProviderConfig,
    YiProviderConfig,
    UpstageProviderConfig,
    NovitaProviderConfig,
    CloudflareProviderConfig,
    WriterProviderConfig,
    DeepInfraProviderConfig,
    HuggingFaceProviderConfig,
    LeptonProviderConfig,
    FeatherlessProviderConfig,
    SnowflakeProviderConfig,
    VllmProviderConfig,
    LmStudioProviderConfig,
    // Wave 4 config types
    HunyuanProviderConfig,
    VolcengineProviderConfig,
    MinimaxProviderConfig,
    BaichuanProviderConfig,
    StepfunProviderConfig,
    InternLMProviderConfig,
    ReplicateProviderConfig,
    RunPodProviderConfig,
    WatsonxProviderConfig,
    LocalAIProviderConfig,
    KoboldProviderConfig,
    TextGenWebUIProviderConfig,
    JanProviderConfig,
} from './compat-providers.js';

// ── Model resolution ───────────────────────────────────────────────────────

export {
    resolveModelString,
    isModelString,
    getProviderFromModelString,
    PROVIDER as MODEL_PROVIDER,
    OPENROUTER_BASE_URL,
    OLLAMA_BASE_URL,
    LLAMABARN_BASE_URL,
    // Self-hosted base URLs (canonical home for the personaforge/models compatibility barrel)
    VLLM_BASE_URL,
    LMSTUDIO_BASE_URL,
    LOCALAI_BASE_URL,
    KOBOLD_BASE_URL,
    TEXTGENWEBUI_BASE_URL,
    JAN_BASE_URL,
} from './model-resolver.js';
export type { ResolvedModelConfig, ProviderName } from './model-resolver.js';

// ── Schema conversion ──────────────────────────────────────────────────────

export { toolToLLMDef } from './zod-to-schema.js';

// ── Structured output ──────────────────────────────────────────────────────

export {
    extractJson,
    validateStructuredOutput,
    buildStructuredOutputPrompt,
    CommonSchemas,
    collectStreamText,
    collectStreamThenValidate,
} from './structured-output.js';
export type { StructuredOutputConfig, StructuredOutputResult } from './structured-output.js';

// ── Context window management ──────────────────────────────────────────────

export {
    ContextWindowManager,
    estimateTokenCount,
    MODEL_CONTEXT_LIMITS,
    TOKEN_ESTIMATES,
    resolveModelKeyForContextLimit,
    getContextLimitForModel,
} from './context-window-manager.js';
export type { ContextWindowManagerConfig } from './context-window-manager.js';

// ── Cost tracking ──────────────────────────────────────────────────────────

export { CostTracker, estimateCost, MODEL_PRICING } from './cost-tracker.js';
export type { TokenUsage, CostCalculation } from './cost-tracker.js';

// ── Fallback chains ────────────────────────────────────────────────────────

export {
    FallbackChainProvider,
    FallbackStrategy,
    createCostOptimizedChain,
    createReliabilityChain,
} from './fallback-chain.js';
export type { FallbackChainConfig } from './fallback-chain.js';

// ── LLM caching ───────────────────────────────────────────────────────────

export { LLMCache, withLLMCache } from './cache.js';
export type { LLMCacheConfig, CacheKeyInput, CacheStats } from './cache.js';

// ── Intelligent LLM router ─────────────────────────────────────────────────

export {
    LLMRouter,
    createCostOptimizedRouter,
    createQualityFirstRouter,
    createSpeedOptimizedRouter,
    createBalancedRouter,
    createSmartRouter,
    scoreTaskTypesForRouting,
} from './router.js';
export type {
    RouterEntry,
    RouterRule,
    RouteContext,
    RouteDecision,
    RoutingStrategy,
    LLMRouterConfig,
    AdaptiveWeights,
    TaskType,
    Complexity,
    CostTier,
    SpeedTier,
} from './router.js';

// ── Vision / Multi-modal helpers ───────────────────────────────────────────

export {
    imageUrl,
    imageFile,
    imageBuffer,
    imageSourceToContentPart,
    multiModal,
    multiModalToMessage,
    isMultiModalInput,
} from './vision.js';
export type {
    ImageUrl,
    ImageFile,
    ImageBuffer,
    ImageSource,
    AudioSource,
    FileSource,
    MultiModalInput,
} from './vision.js';
