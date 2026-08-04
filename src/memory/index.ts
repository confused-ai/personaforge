/**
 * Memory module exports
 */

export * from './types.js';
export { InMemoryStore } from './in-memory-store.js';
export { VectorMemoryStore } from './vector-store.js';
export type { VectorMemoryStoreConfig } from './vector-store.js';
// Note: OpenAIEmbeddingProvider from this module conflicts with the one in 'personaforge/llm'.
// Use the llm subpath for the standard provider, or import directly from 'personaforge/memory'.
export { OpenAIEmbeddingProvider } from './openai-embeddings.js';
export type { OpenAIEmbeddingConfig } from './openai-embeddings.js';
export { InMemoryVectorStore } from './in-memory-vector-store.js';
export {
    PineconeVectorStore,
    QdrantVectorStore,
    PgVectorStore,
} from './vector-adapters.js';
export type {
    PgPool,
    PineconeVectorStoreConfig,
    QdrantVectorStoreConfig,
    PgVectorStoreConfig,
} from './vector-adapters.js';

// ── AgentDb-backed store ────────────────────────────────────────────────────
export { DbMemoryStore, createDbMemoryStore } from './db-store.js';
export type { DbMemoryStoreOptions } from './db-store.js';

// ── Memory distiller ────────────────────────────────────────────────────────
export { MemoryDistiller, summariseMemories, summariseConversation } from './distiller.js';
export type { MemoryDistillerConfig, DistillationResult } from './distiller.js';

// ── Agent-driven memory tools ────────────────────────────────────────────────
export { createAgentMemoryTools } from './agent-memory-tools.js';
export type { AgentMemoryTools, AgentMemoryToolsOptions } from './agent-memory-tools.js';

// ── Tiered self-editing memory (Letta / MemGPT-style) ─────────────────────────
export { TieredMemory, createTieredMemoryTools, DEFAULT_BLOCK_LIMIT } from './tiered-memory.js';
export type { MemoryBlock, TieredMemoryConfig, TieredMemoryTools } from './tiered-memory.js';

// ── Graph / entity memory (Zep / Mem0-style) ──────────────────────────────────
export { GraphMemory, createGraphMemoryTools } from './graph-memory.js';
export type { GraphEntity, GraphRelation, GraphMemoryTools } from './graph-memory.js';

// ── SummaryBufferMemory middleware ────────────────────────────────────────────
export { createSummaryBufferHook } from './summary-buffer.js';
export type { SummaryBufferOptions, SummaryBeforeStepHook } from './summary-buffer.js';

// ═════════════════════════════════════════════════════════════════════════════
// Mastra-style inspired memory layer (threads / working memory / semantic recall /
// observational memory / mem0-style memory + processors)
// ═════════════════════════════════════════════════════════════════════════════

// ── Unified Memory class ──────────────────────────────────────────────────────
export { Memory, Mem0Memory, InMemoryMem0Store, createMem0MemoryTools } from './memory.js';
export type {
    MemoryConfig,
    MemoryOptions,
    SemanticRecallConfig,
    Mem0MemoryOption,
    CreateThreadOptions,
    RecallOptions,
} from './memory.js';

// ── Thread & message model ───────────────────────────────────────────────────
export {
    textOfContent,
    textOfMessage,
    byTimestamp,
    dedupeMessages,
    mergeMessagesByTimestamp,
    filterSystemMessages,
} from './threads.js';
export type {
    Thread,
    ThreadState,
    ThreadMetadata,
    StorageMessage,
    MessageRole,
    StoredContent,
} from './threads.js';

// ── Thread stores ────────────────────────────────────────────────────────────
export { InMemoryThreadStore } from './in-memory-thread-store.js';
export { LibSqlThreadStore, SHARED_MEMORY_URL } from './libsql-thread-store.js';
export type { LibSqlThreadStoreConfig, LibSqlClient } from './libsql-thread-store.js';
export { SqliteThreadStore } from './sqlite-thread-store.js';
export type { SqliteThreadStoreConfig } from './sqlite-thread-store.js';
export { createThreadStore } from './thread-store-factory.js';
export type { CreateThreadStoreConfig, ThreadStoreDriver } from './thread-store-factory.js';
export type { ThreadStore, ListThreadsOptions, CreateThreadInput, UpdateThreadInput, GetMessagesOptions } from './thread-store.js';

// ── Working memory ───────────────────────────────────────────────────────────
export {
    WorkingMemoryManager,
    resolveWorkingMemory,
    DEFAULT_WORKING_MEMORY_TEMPLATE,
    deepMerge,
    mergeWorkingMemory,
    resourceThreadId,
} from './working-memory.js';
export type {
    WorkingMemoryConfig,
    WorkingMemoryScope,
    WorkingMemoryKind,
    ResolvedWorkingMemory,
    WorkingMemoryManager as WorkingMemoryManagerType,
} from './working-memory.js';

// ── Observational memory ─────────────────────────────────────────────────────
export { ObservationalMemoryManager, Extractor } from './observational-memory.js';
export type {
    ObservationalMemoryConfig,
    ObservationalObservationConfig,
    ObservationalReflectionConfig,
    ObservationalMemoryManagerOptions,
    ObservationEvent,
    ReflectionEvent,
    ObservationContextResult,
    ObservationActivationResult,
    ExtractorConfig,
} from './observational-memory.js';

// ── Memory processors (Mastra parity) ────────────────────────────────────────
export {
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
} from './memory-processors.js';
export type {
    MessageHistoryProcessorConfig,
    SemanticRecallProcessorConfig,
    WorkingMemoryProcessorConfig,
    TokenLimiterProcessorConfig,
    ObservationalMemoryProcessorConfig,
    Mem0ExtractionProcessorConfig,
} from './memory-processors.js';

// ── Token estimation + zero-config embedder ─────────────────────────────────
export {
    estimateTokenCount,
    estimateMessageTokens,
    estimateConversationTokens,
    estimateObservationTokens,
    HashingEmbedder,
    isHashingEmbedder,
    MESSAGE_OVERHEAD_TOKENS,
} from './token-estimator.js';
export type { TokenEstimator } from './token-estimator.js';
