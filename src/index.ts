/**
 * personaforge — root entry point.
 *
 * @packageDocumentation
 *
 * The fastest path to a working agent is the one-call `agent()` factory:
 *
 * ```ts
 * import { agent } from 'personaforge';
 *
 * // 1. Create an agent from a system prompt (model/provider resolved from env).
 * const bot = agent('You are a helpful assistant.');
 *
 * // 2. Run it and read the reply.
 * const { text } = await bot.run('Say hello in one short sentence.');
 * console.log(text);
 * ```
 *
 * Stream tokens as they arrive instead of awaiting the full reply:
 *
 * ```ts
 * for await (const chunk of bot.stream('Tell me a short story.')) {
 *   process.stdout.write(chunk);
 * }
 * ```
 *
 * For fine-grained control, import directly from focused modules:
 *
 * ```ts
 * import { createAgent }          from './core/index.js';
 * import { InMemorySessionStore } from './session/index.js';
 * import { httpClient }           from './tools/index.js';
 * import { createSwarm }          from './orchestration/multi-agent/index.js';
 * ```
 *
 * Prefer the smallest possible import surface? Use the `personaforge/lite`
 * entry point and pull optional capabilities from focused subpaths on demand.
 */

// ── Headline API ───────────────────────────────────────────────────────────────
// `agent()` is the one-call entry point. Use it for all new code.
export { agent, bare, compose, pipe, definePersona, buildPersonaInstructions, createDevLogger, createDevToolMiddleware } from './dx/index.js';
export type { AgentMinimalOptions, BareAgentOptions, ComposeOptions, ComposedAgent, AgentPersona } from './dx/index.js';

// ── DX primitives: pipeline / task / guard / model / router ───────────────────
export { pipeline, task, guard, GuardError, model, router } from './dx/index.js';
export type {
    TaskOptions, TaskHandle,
    Guard, GuardOptions, GuardResult, GuardPredicate, GuardedRunnable,
    RouterOptions,
} from './dx/index.js';

// ── Typed event bus + core event vocabulary ───────────────────────────────────
export { eventBus, createAgentEventBus, AGENT_EVENT, AgentEventBusTimeoutError } from './events/index.js';
export type {
    CoreEventMap, EventMap, EventHandler, WildcardHandler, EventSubscription,
    AgentEventBus, AgentEventBusMetrics, AgentEventBusOptions,
} from './events/index.js';

// ── Agent registry — registration, discovery, and delegation tools ────────────
export { AgentRegistry, createAgentRegistry } from './registry/index.js';
export type { AgentRecord, AgentRegistryEntry } from './registry/index.js';

// ── Agent (new DX) — zero-config, fluent, progressively powerful ──────────────
// `Agent` is the only class-based entry point. Legacy and fluent APIs unified.
export { Agent } from './agent.js';
export type { AgentOptions } from './agent.js';

// ── createAgent (legacy) — use agent() instead ─────────────────────────────────
export { createAgent } from './create-agent.js';
export type { CreateAgentOptions, AgentRunOptions, AgentRunResult, CreateAgentResult } from './create-agent.js';

// ── Core framework ─────────────────────────────────────────────────────────────
export * from './core/index.js';

// ── Validation (Standard Schema V1 — Zod, Valibot, ArkType, …) ────────────────
export {
    fromSafeParseSchema,
    isSafeParseSchema,
    isStandardSchema,
    normalizeSchema,
    parse,
    parseAsync,
    safeValidate,
    safeValidateAsync,
    schemaToJsonSchema,
    validate,
} from './validation/index.js';
export type {
    AnySchema,
    InferInput,
    InferOutput,
    InferSchemaOutput,
    SafeParseSchemaLike,
    SafeValidateFailure,
    SafeValidateResult,
    SafeValidateSuccess,
    SchemaInput,
    SchemaIssue,
    StandardSchemaV1,
} from './validation/index.js';

// ── Prompt management & versioning ─────────────────────────────────────────────
export { PromptRegistry, renderTemplate } from './prompts/index.js';
export type { PromptVersion, RegisterOptions, VersionSelector } from './prompts/index.js';

// ── Prompt optimization (DSPy-style bootstrap few-shot) ────────────────────────
export { bootstrapFewShot, renderFewShot } from './optimize/index.js';
export type { OptimizeExample, Demo, OptimizeScorer, GenerateFn, BootstrapConfig, OptimizedPrompt } from './optimize/index.js';

// ── Memory ─────────────────────────────────────────────────────────────────────
export { InMemoryStore, VectorMemoryStore, InMemoryVectorStore, OpenAIEmbeddingProvider, MemoryType, TieredMemory, createTieredMemoryTools, DEFAULT_BLOCK_LIMIT, GraphMemory, createGraphMemoryTools } from './memory/index.js';
export type { VectorMemoryStoreConfig, EmbeddingProvider, MemoryStore, MemoryEntry, MemoryQuery, MemoryBlock, TieredMemoryConfig, TieredMemoryTools, GraphEntity, GraphRelation, GraphMemoryTools } from './memory/index.js';

// ── Mastra-style inspired memory layer ───────────────────────────────────────────────────
export {
    Memory,
    Mem0Memory,
    InMemoryMem0Store,
    createMem0MemoryTools,
    Extractor,
    ObservationalMemoryManager,
    WorkingMemoryManager,
    resolveWorkingMemory,
    DEFAULT_WORKING_MEMORY_TEMPLATE,
    deepMerge,
    mergeWorkingMemory,
    createThreadStore,
    InMemoryThreadStore,
    LibSqlThreadStore,
    SHARED_MEMORY_URL,
    SqliteThreadStore,
    MessageHistoryProcessor,
    SemanticRecallProcessor,
    WorkingMemoryProcessor,
    TokenLimiterProcessor,
    ObservationalMemoryProcessor,
    Mem0ExtractionProcessor,
    messageToStorage,
    storageToMessage,
    newMessagesFromRun,
    insertBeforeLastUser,
    injectSystemBlock,
    estimateMessageTokens,
    estimateConversationTokens,
    HashingEmbedder,
    isHashingEmbedder,
    textOfContent,
    textOfMessage,
    mergeMessagesByTimestamp,
    dedupeMessages,
    filterSystemMessages,
} from './memory/index.js';
export type {
    MemoryConfig,
    MemoryOptions,
    SemanticRecallConfig,
    Mem0MemoryOption,
    Thread,
    ThreadState,
    ThreadMetadata,
    StorageMessage,
    ThreadStore,
    ListThreadsOptions,
    GetMessagesOptions,
    CreateThreadStoreConfig,
    LibSqlThreadStoreConfig,
    SqliteThreadStoreConfig,
    WorkingMemoryConfig,
    WorkingMemoryScope,
    WorkingMemoryKind,
    ObservationalMemoryConfig,
    ObservationalObservationConfig,
    ObservationalReflectionConfig,
    ObservationEvent,
    ReflectionEvent,
    ExtractorConfig,
    TokenEstimator,
} from './memory/index.js';

// ── Tools ─────────────────────────────────────────────────────────────────────
// Note: Tool, ToolRegistry already exported from ./core/index.js
export { ToolNameTrie, NGramIndex, BaseTool, ToolRegistryImpl, tool, wrapTool,
    createTools, extendTool, pipeTools, versionTool,
    ToolCache, ToolCompressor, handleToolGatewayRequest,
    zodToJsonSchema,
    defineTool, httpClient, fileSystem, createShellTool, browserTool,
    composeTool, parallelTools, fallbackTool, retryTool, timeoutTool, mapTool, filterTool,
} from './tools/index.js';
export type { LegacyTool, ToolInput, ComposeToolOptions, ParallelToolsOptions, FallbackToolOptions, RetryToolOptions } from './tools/index.js';
export * from './tools/mcp/index.js';
export type { MCPClient, MCPServerAdapter } from './tools/mcp/_mcp-types.js';
export * from './tools/utils/http.js';
export * from './tools/utils/file.js';
export * from './tools/utils/browser.js';
export * from './tools/utils/calculator.js';

// ── Agent / workflow / pipeline as tools + harness ───────────────────────────
export {
    agentAsTool, multiAgentTool, toRunnableAgent, getAgentToolDepth,
    workflowAsTool, pipelineAsTool,
    memoryAsTool, knowledgeAsTool, promptAsTool,
    asTool, toTool,
} from './tools/index.js';
export type {
    AgentAsToolOptions, RunnableAgent, MultiAgentToolOptions,
    WorkflowAsToolOptions, RunnableWorkflow, WorkflowToolResult,
    PipelineAsToolOptions, RunnablePipeline,
    MemoryAsToolOptions, MemoryStoreLike,
    KnowledgeAsToolOptions, KnowledgeBaseLike,
    PromptAsToolOptions, PromptRegistryLike,
    AsToolConfig, AsToolKind, ToolTarget,
} from './tools/index.js';
export { createHarness, createOrchestrator } from './harness/index.js';
export {
    evaluate, formatHarnessReport,
    toHarnessRunner, fromAgent, fromTask, fromWorkflow, fromFn,
} from './harness/index.js';
export type {
    AgentHarness, HarnessConfig, HarnessAsToolOptions,
    Orchestrator, OrchestratorConfig, OrchestratorSpecialist,
    EvaluateOptions, HarnessVariant, HarnessUsageSummary, HarnessVariantResult,
    HarnessMetricComparison, HarnessReport, HarnessReportJson,
    HarnessSubject, HarnessRunnerOptions, RunOutcome,
} from './harness/index.js';
export {
    createLifecycleHooks, mergeHooks, createHookChain, toAgenticHooks, fromAgenticHooks,
} from './hooks/index.js';

// ── Production system registry (Mastra/Agno AgentOS edge) ────────────────────
export { createSystem, System } from './system/index.js';
export type {
    PersonaForgeSystem, SystemConfig, SystemAgentRegistration,
    SystemWorkflowRegistration, SystemPipelineRegistration, SupervisorOptions, SupervisorHandle,
    SystemServeOptions, SystemStreamOptions,
} from './system/index.js';
export {
    streamAgentEvents, streamAgentText, bridgeChunkToBus, DEFAULT_SYSTEM_STREAM_MODES,
} from './system/index.js';
export {
    fromOpenAITool, fromOpenAITools, jsonSchemaToZodObject,
    fromHttpTool, fromForeignTool, fromForeignTools,
} from './adapters/universal/index.js';
export type {
    OpenAIFunctionTool, OpenAIToolAdapterOptions, HttpToolOptions, ForeignTool,
} from './adapters/universal/index.js';
export type {
    UnifiedLifecycleHooks, HookContext, ToolHookContext, WorkflowHookContext, RunHookContext, HookChain,
} from './hooks/index.js';

// ── Planner ───────────────────────────────────────────────────────────────────
// Note: RetryPolicy already exported from ./core/index.js
export { LLMPlanner, ClassicalPlanner, PlanValidator, PlanningAlgorithm } from './planner/index.js';
export type { Plan, PlannerConfig, Planner } from './planner/index.js';

// ── Execution ─────────────────────────────────────────────────────────────────
export * from './execution/index.js';

// ── Orchestration ─────────────────────────────────────────────────────────────
export type {
    OrchestrableAgent, AgentRole, AgentRegistration, AgentMessage, MessageHandler,
    MCPToolDescriptor, MCPAgentMessage, MCPAgentClient,
    A2ATask, A2ATaskState, A2AAgentCard, A2AMessage, IA2AClient, A2AStreamEvent,
    TraceContext, LoadBalancer,
    MoAConfig, ActorCriticConfig, SocraticConfig,
    ChainStep, PromptChainConfig, ProgramOfThoughtConfig,
    SkeletonOfThoughtConfig, StepBackConfig, RejectionSamplingConfig,
    SelfCorrectionConfig, AnyAgent,
} from './orchestration/index.js';
export {
    CoordinationType,
    MessageBusImpl, OrchestratorImpl,
    Team, SwarmOrchestrator,
    createSupervisor, createConsensus, createPipeline,
    createHandoff, createAgentRouter,
    createRunnableAgent,
    createMixtureOfAgents, createActorCritic, createSocraticAgent,
    createPromptChain, createProgramOfThought, createSkeletonOfThought,
    createStepBackAgent, createRejectionSampling, createSelfCorrection,
    RoundRobinLoadBalancer, LeastConnectionsLoadBalancer, WeightedResponseTimeLoadBalancer,
    createHttpA2AClient, A2AServer,
    createToolkit, toolkitsToRegistry,
    extractTraceContext, generateTraceparent, injectTraceHeaders,
} from './orchestration/index.js';

// ── Graph workflows ─────────────────────────────────────────────────────────
export { createGraph, SqliteEventStore } from './graph/index.js';

// ── Observability ─────────────────────────────────────────────────────────────
export * from './observability/index.js';

// ── LLM Providers ─────────────────────────────────────────────────────────────
// Explicit exports to avoid conflicts with ./core/index.js (GenerateResult, LLMProvider,
// MultiModalInput, StreamChunk, StreamOptions are already exported from core)
export { OpenAIProvider, AnthropicProvider, GoogleProvider, BedrockConverseProvider,
    createOpenRouterProvider, createGroqProvider, createXAIProvider, createTogetherProvider,
    createFireworksProvider, createDeepSeekProvider, createMistralProvider, createCohereProvider,
    createPerplexityProvider, createAzureOpenAIProvider, createOpenAICompatibleProvider,
    createCerebrasProvider, createSambaNovaProvider, createNvidiaProvider, createAI21Provider,
    createHyperbolicProvider, createLambdaProvider, createMoonshotProvider, createDashScopeProvider,
    createZhipuProvider, createYiProvider, createUpstageProvider, createNovitaProvider,
    createCloudflareProvider, createWriterProvider, createDeepInfraProvider, createHuggingFaceProvider,
    createLeptonProvider, createFeatherlessProvider, createSnowflakeProvider, createVllmProvider,
    createLmStudioProvider, createHunyuanProvider, createVolcengineProvider, createMinimaxProvider,
    createBaichuanProvider, createStepfunProvider, createInternLMProvider, createReplicateProvider,
    createRunPodProvider, createWatsonxProvider, createLocalAIProvider, createKoboldProvider,
    createTextGenWebUIProvider, createJanProvider,
    GROQ_BASE_URL, XAI_BASE_URL, TOGETHER_BASE_URL, FIREWORKS_BASE_URL, DEEPSEEK_BASE_URL,
    MISTRAL_BASE_URL, COHERE_BASE_URL, PERPLEXITY_BASE_URL, CEREBRAS_BASE_URL, SAMBANOVA_BASE_URL,
    NVIDIA_BASE_URL, AI21_BASE_URL, HYPERBOLIC_BASE_URL, LAMBDA_BASE_URL, MOONSHOT_BASE_URL,
    DASHSCOPE_BASE_URL, ZHIPU_BASE_URL, YI_BASE_URL, UPSTAGE_BASE_URL, NOVITA_BASE_URL,
    WRITER_BASE_URL, DEEPINFRA_BASE_URL, HUGGINGFACE_INFERENCE_BASE_URL, LEPTON_BASE_URL,
    FEATHERLESS_BASE_URL, SNOWFLAKE_BASE_URL, HUNYUAN_BASE_URL, VOLCENGINE_BASE_URL,
    MINIMAX_BASE_URL, BAICHUAN_BASE_URL, STEPFUN_BASE_URL, INTERNLM_BASE_URL, REPLICATE_BASE_URL,
    WATSONX_REGION_URLS,
    resolveModelString, isModelString, getProviderFromModelString, MODEL_PROVIDER, OPENROUTER_BASE_URL, OLLAMA_BASE_URL, LLAMABARN_BASE_URL,
    toolToLLMDef,
    extractJson, validateStructuredOutput, buildStructuredOutputPrompt, CommonSchemas, collectStreamText, collectStreamThenValidate,
    ContextWindowManager, estimateTokenCount, MODEL_CONTEXT_LIMITS, TOKEN_ESTIMATES, resolveModelKeyForContextLimit, getContextLimitForModel,
    CostTracker, estimateCost, MODEL_PRICING,
    FallbackChainProvider, FallbackStrategy, createCostOptimizedChain, createReliabilityChain,
    LLMCache, withLLMCache,
    LLMRouter, createCostOptimizedRouter, createQualityFirstRouter, createSpeedOptimizedRouter, createBalancedRouter, createSmartRouter, scoreTaskTypesForRouting,
    imageUrl, imageFile, imageBuffer, imageSourceToContentPart, multiModal, multiModalToMessage, isMultiModalInput,
} from './providers/index.js';
export type {
    OpenAIProviderConfig, AnthropicProviderConfig, GoogleProviderConfig, BedrockConverseProviderConfig, OpenAIEmbeddingProviderConfig,
    OpenRouterProviderConfig, GroqProviderConfig, XAIProviderConfig, TogetherProviderConfig, FireworksProviderConfig, DeepSeekProviderConfig,
    MistralProviderConfig, CohereProviderConfig, PerplexityProviderConfig, AzureOpenAIProviderConfig, OpenAICompatibleProviderConfig,
    CerebrasProviderConfig, SambaNovaProviderConfig, NvidiaProviderConfig, AI21ProviderConfig, HyperbolicProviderConfig, LambdaProviderConfig,
    MoonshotProviderConfig, DashScopeProviderConfig, ZhipuProviderConfig, YiProviderConfig, UpstageProviderConfig, NovitaProviderConfig,
    CloudflareProviderConfig, WriterProviderConfig, DeepInfraProviderConfig, HuggingFaceProviderConfig, LeptonProviderConfig,
    FeatherlessProviderConfig, SnowflakeProviderConfig, VllmProviderConfig, LmStudioProviderConfig, HunyuanProviderConfig,
    VolcengineProviderConfig, MinimaxProviderConfig, BaichuanProviderConfig, StepfunProviderConfig, InternLMProviderConfig,
    ReplicateProviderConfig, RunPodProviderConfig, WatsonxProviderConfig, LocalAIProviderConfig, KoboldProviderConfig,
    TextGenWebUIProviderConfig, JanProviderConfig,
    ResolvedModelConfig, ProviderName,
    StructuredOutputConfig, StructuredOutputResult,
    ContextWindowManagerConfig,
    TokenUsage, CostCalculation,
    FallbackChainConfig,
    LLMCacheConfig, CacheKeyInput, CacheStats,
    RouterEntry, RouterRule, RouteContext, RouteDecision, RoutingStrategy, LLMRouterConfig, AdaptiveWeights, TaskType, Complexity, CostTier, SpeedTier,
    ImageUrl, ImageFile, ImageBuffer, ImageSource, AudioSource, FileSource,
} from './providers/index.js';

// ── Agentic runner ────────────────────────────────────────────────────────────
export { AgenticRunner, createAgenticAgent } from './agentic/index.js';
export type { AgenticRunnerConfig, AgenticLifecycleHooks, AgenticRunResult, AgenticStreamHooks } from './agentic/index.js';

// ── Production runtime helpers ──────────────────────────────────────────────
export { ResumableStreamManager, formatSSE } from './production/resumable-stream.js';
export type { StreamCheckpoint, ResumableStreamConfig, StreamChunkSSE } from './production/resumable-stream.js';

// ── Agent data-stream protocol (SSE in / out for streamEvents) ──────────────
export { toDataStream, toSSEResponse, readDataStream, encodeSSE } from './serve/data-stream.js';
export type { DataStreamEvent } from './serve/data-stream.js';

// ── SDK ───────────────────────────────────────────────────────────────────────
export { defineAgent, DefinedAgent, createWorkflow, WorkflowBuilder, Workflow, asOrchestratorAgent, isSuspended } from './sdk/index.js';
export type { AgentDefinitionConfig, AgentRunConfig, WorkflowResult, WorkflowStep, WorkflowSuspension, WorkflowCompletion, WorkflowExecuteResult } from './sdk/index.js';

// ── Session ───────────────────────────────────────────────────────────────────
// Note: SessionStore type already exported from ./core/index.js
export { InMemorySessionStore, createInMemoryStore, createSqliteStore, createRedisStore, FallbackSessionStore, createFallbackSessionStore, DbSessionStore, createDbSessionStore, SessionState } from './session/index.js';
export type { InMemorySessionStoreOptions, SqliteSessionStoreOptions, RedisClient, RedisSessionStoreOptions, FallbackSessionStoreOptions, SessionData, SessionMessage, SessionId, Session, SessionRun, SessionQuery, SessionMetadata } from './session/index.js';

// ── Guardrails ────────────────────────────────────────────────────────────────
export * from './guardrails/index.js';

// ── Learning ──────────────────────────────────────────────────────────────────
export * from './learning/index.js';

// ── Knowledge ─────────────────────────────────────────────────────────────────
export * from './knowledge/index.js';

// ── Shared utilities ──────────────────────────────────────────────────────────
export { VERSION, isTelemetryEnabled, recordFrameworkStartup, checkVersion } from './shared/index.js';
export type { CheckVersionOptions, CheckVersionResult } from './shared/index.js';

// ── Redis Adapter ──────────────────────────────────────────────────────────────
export { RedisEventStore } from './adapter-redis/event-store.js';
export type { RedisEventStoreConfig } from './adapter-redis/event-store.js';

// ── Mastermind — context compression ─────────────────────────────────────────
export { Mastermind, CCRStore, CacheAligner, createRetrieveTool,
    detectContentType, routeContent,
    smartCrush, crushJsonText,
    compressCode, compressCodeBlocks,
    crushLog, crushXml, crushCsv,
} from './compression/mastermind/index.js';
export type {
    MastermindConfig,
    MastermindStats,
    MastermindMessage,
    MastermindRetrieveTool,
    ContentType,
    CompressionAlgorithm,
    CCREntry,
} from './compression/mastermind/index.js';

// ── Voice and video ─────────────────────────────────────────────────────────
export {
    OpenAIVoiceProvider,
    ElevenLabsVoiceProvider,
    createVoiceProvider,
    VoiceStreamSession,
} from './voice/index.js';
export type {
    VoiceConfig,
    VoiceProvider,
    TTSResult,
    STTResult,
    OpenAIVoice,
    VoiceStreamConfig,
    VoiceStreamEvent,
    VoiceStreamEventType,
} from './voice/index.js';
export { VideoOrchestrator } from './video/index.js';

// ── Processors (Mastra-style input/output/error pipeline + guardrails) ────────
export * from './processors/index.js';

// ── Durable agents — long-running, resumable streams with approval ────────────
export {
    createDurableAgent,
    createEventedAgent,
    DurableAgent,
    DurableRunRegistry,
    InMemoryServerCache,
    durableRunId,
    registryOutput,
} from './durable/index.js';
export type {
    DurableAgentConfig,
    DurableAgentOutput,
    DurableRunEvent,
    DurableStreamResult,
    DurableAgentExecution,
    DurableRunHandle,
} from './durable/index.js';

// ── Goals — durable, thread-scoped objectives with LLM judges ─────────────────
export * from './goals/index.js';

// ── Code mode — sandboxed multi-tool computation ───────────────────────────────
export { createCodeMode, LocalSandbox, VMSandbox, createSandbox } from './code-mode/index.js';
export type { CodeModeOptions, CodeModeResult, Sandbox, SandboxRunResult, ExternalCall } from './code-mode/index.js';

// ── Agent approval — human-in-the-loop tool approval / suspension ─────────────
export * from './approval/index.js';
