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
