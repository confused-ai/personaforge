/**
 * Mastermind — types
 * ==================
 * Shared interfaces for the context compression pipeline.
 */

// ── Message shape ─────────────────────────────────────────────────────────────

export interface MastermindMessage {
    role: string;
    content?: string | null;
    /** tool call id (OpenAI / Anthropic tool-use) */
    tool_call_id?: string;
    /** tool calls emitted by the assistant */
    tool_calls?: unknown[];
    /** tool name */
    name?: string;
    /** set after compression; used instead of content for LLM calls */
    compressedContent?: string;
    /** CCR: originals are stashed here, referenced by handle */
    _ccrHandle?: string;
    [key: string]: unknown;
}

// ── Content types recognised by the router ───────────────────────────────────

export type ContentType =
    | 'json'
    | 'code'
    | 'markdown'
    | 'log'
    | 'xml'
    | 'csv'
    | 'text'
    | 'binary';

// ── Compression algorithm names ───────────────────────────────────────────────

export type CompressionAlgorithm =
    | 'smart-crusher'   // JSON / structured data
    | 'code-compressor' // Source code (AST-aware truncation)
    | 'log-crusher'     // Log / trace lines
    | 'xml-crusher'     // XML / HTML
    | 'csv-crusher'     // CSV / TSV
    | 'summary-llm'     // LLM-powered prose summary
    | 'sliding-window'  // Deterministic token-budget drop
    | 'passthrough';    // No compression

// ── Per-algorithm compression result ─────────────────────────────────────────

export interface CompressionResult {
    compressed: string;
    algorithm: CompressionAlgorithm;
    originalTokens: number;
    compressedTokens: number;
    /** Fraction removed: 0.9 means 90% fewer tokens */
    ratio: number;
}

// ── CCR (Compressed-Content Retrieval) store entry ───────────────────────────

export interface CCREntry {
    handle: string;
    original: string;
    compressed: string;
    algorithm: CompressionAlgorithm;
    contentType: ContentType;
    createdAt: number;
}

// ── Mastermind configuration ──────────────────────────────────────────────────

export interface MastermindConfig {
    /**
     * LLM callable for prose / summary compression.
     * Required only when algorithm 'summary-llm' is used.
     */
    generate?: (messages: Array<{ role: string; content: string }>) => Promise<string>;

    /**
     * Token budget for the full message list.
     * When exceeded, Mastermind compresses oldest non-system messages.
     * Default: 12_000
     */
    contextTokenBudget?: number;

    /**
     * Tokens above which a single message is compressed immediately.
     * Default: 2_000
     */
    messageTokenThreshold?: number;

    /**
     * Always keep this many recent messages verbatim (never compress them).
     * Default: 4
     */
    recentMessagesWindow?: number;

    /**
     * Enable CCR (Compressed-Content Retrieval).
     * Originals are stored locally; a `mastermind_retrieve` tool is injected
     * so the LLM can request them on demand.
     * Default: true
     */
    enableCCR?: boolean;

    /**
     * Maximum CCR entries to keep in memory.
     * Oldest are evicted when limit is reached.
     * Default: 200
     */
    ccrMaxEntries?: number;

    /**
     * Enable CacheAligner prefix stabilisation.
     * Normalises the system + first few messages to improve KV-cache hit rate.
     * Default: true
     */
    enableCacheAligner?: boolean;

    /**
     * Compress tool/function call results (tool role messages).
     * Default: true
     */
    compressToolResults?: boolean;

    /**
     * Compress LLM assistant messages that exceed messageTokenThreshold.
     * Default: true
     */
    compressAssistantMessages?: boolean;

    /**
     * Minimum compression ratio to accept a result; below this, keep original.
     * Value between 0–1. Default: 0.15 (must save at least 15%).
     */
    minRatio?: number;

    /**
     * Blended USD price per 1K tokens, used only to estimate cost saved in
     * `stats()`. Default: 0.003.
     * ponytail: single blended rate, not per-model input/output split — good
     * enough for a savings dashboard; pass your model's rate to sharpen it.
     */
    costPer1kTokens?: number;

    debug?: boolean;
}

// ── Run-time stats ────────────────────────────────────────────────────────────

export interface MastermindStats {
    totalTokensBefore: number;
    totalTokensAfter: number;
    messagesCompressed: number;
    ccrEntries: number;
    algorithms: Partial<Record<CompressionAlgorithm, number>>;
}

// ── Session-lifetime stats (headroom_stats parity) ───────────────────────────

/** One compress() call that saved tokens; newest-last ring-buffer entry. */
export interface RecentCompressionEvent {
    /** ms epoch when this compress() call completed */
    at: number;
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
    messagesCompressed: number;
    algorithms: Partial<Record<CompressionAlgorithm, number>>;
}

/**
 * Cumulative savings across every compress() call on a Mastermind instance —
 * the session dashboard returned by `Mastermind.stats()`.
 */
export interface MastermindLifetimeStats {
    /** Number of compress() calls that saved tokens. */
    compressions: number;
    /** Total messages compressed across the session. */
    messagesCompressed: number;
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
    /** tokensSaved / 1000 * costPer1kTokens. */
    costSavedUsd: number;
    /** Compressions per algorithm across the session. */
    algorithms: Partial<Record<CompressionAlgorithm, number>>;
    /** Most recent events, newest last (bounded). */
    recent: RecentCompressionEvent[];
}
