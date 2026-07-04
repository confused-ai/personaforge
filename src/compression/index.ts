/**
 * Compression module: LLM-powered and Huffman-based compression.
 *
 * Techniques available:
 *
 *   CompressionManager      — LLM summarisation of tool results / long messages
 *   HuffmanCodec            — Lossless byte-level compression (no LLM)
 *   SummaryBufferMemory     — Rolling LLM summary + verbatim recent window
 *   SlidingWindow           — Deterministic token-budget / lastN truncation
 *   EntityExtractionMemory  — Named-entity fact-sheet to replace raw history
 *   createTokenCounter      — Model-aware token counting (tiktoken or built-in)
 *   countTokens             — Quick one-shot token estimate
 *   contextBudget           — Remaining token budget for a message list
 */

// ── LLM summarisation ─────────────────────────────────────────────────────────
export {
    CompressionManager,
    DEFAULT_COMPRESSION_PROMPT,
} from './manager.js';
export type {
    CompressionManagerConfig,
    CompressibleMessage,
} from './manager.js';

// ── Huffman lossless codec ────────────────────────────────────────────────────
export {
    HuffmanCodec,
    compressContext,
    decompressContext,
    serializeTable,
    deserializeTable,
    estimateCompressionRatio,
} from './huffman.js';
export type { HuffmanTable, HuffmanEncodeResult } from './huffman.js';

// ── Rolling summary + verbatim window (LangChain SummaryBufferMemory style) ───
export { SummaryBufferMemory } from './summary-buffer.js';
export type { SummaryBufferConfig, SBMMessage } from './summary-buffer.js';

// ── Sliding window (deterministic, no LLM) ────────────────────────────────────
export {
    createSlidingWindow,
    applyWindow,
} from './sliding-window.js';
export type {
    SlidingWindowConfig,
    SlidingWindowMessage,
    SlidingWindowResult,
    SlidingWindowStrategy,
    SlidingWindow,
} from './sliding-window.js';

// ── Entity extraction memory ──────────────────────────────────────────────────
export { EntityExtractionMemory } from './entity-memory.js';
export type {
    EntityExtractionConfig,
    Entity,
    EntityType,
} from './entity-memory.js';

// ── Mastermind — full-pipeline context compression ────────────────────────────
export { Mastermind, CCRStore, createRetrieveTool, CacheAligner } from './mastermind/index.js';
export {
    detectContentType,
    routeContent,
    estimateTokens as mastermindEstimateTokens,
} from './mastermind/index.js';
export { smartCrush, crushJsonText } from './mastermind/index.js';
export { compressCode, compressCodeBlocks } from './mastermind/index.js';
export { crushLog, crushXml, crushCsv } from './mastermind/index.js';
export type {
    MastermindMessage,
    MastermindConfig,
    MastermindStats,
    MastermindLifetimeStats,
    RecentCompressionEvent,
    MastermindRetrieveTool,
    ContentType,
    CompressionAlgorithm,
    CCREntry,
} from './mastermind/index.js';

// ── Token counting ────────────────────────────────────────────────────────────
export {
    createTokenCounter,
    countTokens,
    contextBudget,
    disposeTiktoken,
} from './token-counter.js';
export type { TokenCounter, TokenCounterMessage } from './token-counter.js';

