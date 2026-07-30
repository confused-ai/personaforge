/**
 * @personaforge/contracts — Canonical interface definitions.
 *
 * This is the single source of truth for all core abstractions:
 * LLMProvider, Message, GenerateOptions, GenerateResult, Tool, ToolRegistry,
 * SessionStore, SessionData, SessionMessage, MemoryStore, MemoryEntry,
 * MemoryQuery, VectorStore, EmbeddingProvider, KVStore, Skill, SkillRegistry.
 *
 * Every other package imports these interfaces from here. No duplication.
 *
 * @module
 */

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * A single message in a conversation.
 * Role follows the LLM standard: system, user, assistant, or tool.
 *
 * `content` accepts both plain strings and structured multi-modal parts
 * (text, image, file, audio, video) so providers and core message builders
 * are assignable without extra casts.
 */
export interface Message {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | unknown[];
  readonly name?: string;
  readonly toolCallId?: string;
  readonly metadata?: Record<string, unknown>;
}

// ── LLM Provider Interface ───────────────────────────────────────────────────

/**
 * Tool definition as sent to the LLM.
 * Parameters follow JSON Schema format.
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Options for LLM generation.
 */
export interface GenerateOptions {
  tools?: LLMToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; name: string };
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  onChunk?: (chunk: string) => void;
  /** Abort signal forwarded to the provider SDK so in-flight calls cancel on run abort/timeout. */
  signal?: AbortSignal;
}

/**
 * Tool call result from LLM.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result from LLM generation.
 */
export interface GenerateResult {
  text: string;
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'tool_calls' | 'max_tokens' | 'error';
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * LLM provider interface — text generation and optional streaming.
 */
export interface LLMProvider {
  generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult>;
  streamText?(messages: Message[], options?: GenerateOptions): Promise<GenerateResult>;
}

// ── Tool Interface ───────────────────────────────────────────────────────────

/**
 * A tool that an agent can execute.
 */
export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    /**
     * Optional Zod schema for validating tool output.
     * When provided, tool results are validated against this schema before
     * being returned to the caller or fed back to the LLM.
     */
    outputSchema?: Record<string, unknown>;
    execute(input: Record<string, unknown>, ctx?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Tool registry — O(1) lookup by name.
 */
export interface ToolRegistry {
  list(): Tool[];
  get(name: string): Tool | undefined;
  has(name: string): boolean;
  register(tool: Tool): void;
  unregister(name: string): void;
  clear(): void;
}

// ── Session Management ───────────────────────────────────────────────────────

/**
 * A single message in a session.
 * Lighter than Message — primarily used for storage.
 */
export interface SessionMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly name?: string;
  readonly tool_call_id?: string;
}

/**
 * Session data — immutable snapshot.
 */
export interface SessionData {
  readonly id: string;
  readonly agentId?: string;
  readonly userId?: string;
  readonly messages: ReadonlyArray<SessionMessage>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Session store — persistence interface.
 * Supports multiple creation patterns for flexible adapter implementation.
 */
export interface SessionStore {
  /**
   * Get a session by ID.
   */
  get(id: string): Promise<SessionData | undefined | null>;

  /**
   * Create a new session.
   * Supports multiple patterns:
   * - Object pattern: { agentId, userId?, messages? } → auto-generate ID
   * - String pattern (legacy): use provided ID directly
   * - Legacy pattern (adapters): create(userId) → return ID
   */
  create(
    data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string,
  ): Promise<SessionData | string>;

  /**
   * Create a new session for a specific user (legacy adapter pattern).
   * Optional; adapters may implement `create(userId)` overload instead.
   */
  createForUser?(userId: string, metadata?: Record<string, unknown>): Promise<string>;

  /**
   * Update a session's messages.
   */
  update?(id: string, data: { messages: SessionMessage[] | readonly SessionMessage[] }): Promise<void>;

  /**
   * Append messages to a session (legacy adapter pattern).
   * Optional; new adapters use `update` instead.
   */
  append?(id: string, messages: readonly SessionMessage[]): Promise<void>;

  /**
   * Get all messages for a session.
   */
  getMessages?(id: string): Promise<SessionMessage[]>;

  /**
   * Append a single message to an existing session.
   */
  appendMessage?(id: string, message: SessionMessage): Promise<void>;

  /**
   * Delete a session.
   */
  delete(id: string): Promise<void>;

  /**
   * Optional: List sessions by agent or user.
   */
  listByAgent?(agentId: string): Promise<SessionData[]>;
  listByUser?(userId: string): Promise<SessionData[]>;

  /**
   * Optional: Touch a session to update TTL (useful for Redis, etc).
   */
  touch?(id: string, ttlSeconds?: number): Promise<void>;
}

// ── Memory Storage ───────────────────────────────────────────────────────────

/**
 * Semantic/vector memory entry.
 */
export interface MemoryEntry {
  readonly id: string;
  readonly type?: 'short_term' | 'long_term' | 'episodic' | 'semantic';
  readonly content: string;
  readonly embedding?: number[];
  readonly metadata: Record<string, unknown>;
  readonly createdAt: number;
  readonly expiresAt?: number;
}

/**
 * Query options for memory retrieval.
 */
export interface MemoryQuery {
  readonly query: string;
  readonly type?: string;
  readonly limit?: number;
  readonly threshold?: number;
  readonly filter?: Record<string, unknown>;
  readonly includeEmbeddings?: boolean;
}

/**
 * Result from memory search.
 */
export interface MemorySearchResult {
  readonly entry: MemoryEntry;
  readonly score: number;
}

/**
 * Semantic/vector memory store.
 */
export interface MemoryStore {
  /**
   * Store a new memory entry.
   */
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;

  /**
   * Retrieve memories by semantic query.
   */
  retrieve(query: MemoryQuery): Promise<MemorySearchResult[]>;

  /**
   * Get a specific memory by ID.
   */
  get(id: string): Promise<MemoryEntry | null>;

  /**
   * Update an existing memory.
   */
  update(id: string, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry>;

  /**
   * Delete a memory by ID.
   */
  delete(id: string): Promise<boolean>;

  /**
   * Clear all memories (optionally filtered by type).
   */
  clear(type?: string): Promise<void>;

  /**
   * Get recent memories.
   */
  getRecent(limit: number, type?: string): Promise<MemoryEntry[]>;
}

// ── Vector Storage ───────────────────────────────────────────────────────────

/**
 * Document for RAG/vector search.
 */
export interface Document {
  readonly id: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
}

/**
 * Search result from vector store.
 */
export interface SearchResult {
  readonly document: Document;
  readonly score: number;
}

/**
 * Vector store — minimal ISP interface for RAG.
 */
export interface VectorStore {
  /**
   * Add documents to the store.
   */
  add(documents: Document[]): Promise<void>;

  /**
   * Search for similar documents.
   */
  search(query: string, topK: number): Promise<SearchResult[]>;

  /**
   * Optional: Get documents by ID.
   */
  get?(ids: string[]): Promise<(Document | null)[]>;

  /**
   * Optional: Delete documents by ID.
   */
  delete?(ids: string[]): Promise<void>;
}

// ── Embedding Provider ───────────────────────────────────────────────────────

/**
 * Embedding provider — converts text to vectors.
 */
export interface EmbeddingProvider {
  /**
   * Generate embedding for a single text.
   */
  embed(text: string, options?: { model?: string }): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts.
   */
  embedBatch(texts: string[], options?: { model?: string }): Promise<number[][]>;

  /**
   * Get the dimension of embeddings produced by this provider.
   */
  getDimension(): number;
}

// ── Ephemeral Key-Value Store ────────────────────────────────────────────────

/**
 * KVStore — ephemeral per-execution state (used by graph engine).
 * Different from MemoryStore: no embeddings, no persistence semantics.
 */
export interface KVStore {
  /**
   * Get a value by key.
   */
  get(key: string): Promise<unknown>;

  /**
   * Set a value.
   */
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;

  /**
   * Delete a key.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if key exists.
   */
  has(key: string): Promise<boolean>;

  /**
   * List keys matching a prefix.
   */
  keys(prefix?: string): Promise<string[]>;

  /**
   * Clear all entries.
   */
  clear(): Promise<void>;
}

// ── Skill ─────────────────────────────────────────────────────────────────────

/**
 * A composable, reusable capability that can be attached to an agent.
 *
 * A `Skill` packages related tools + instructions together so the same
 * capability (e.g. "web research", "code execution", "email drafting") can be
 * plugged into any agent without reimplementing it each time.
 *
 * @example
 * ```ts
 * import type { Skill } from './index.js';
 *
 * export const webResearchSkill: Skill = {
 *   id:           'web-research',
 *   name:         'Web Research',
 *   description:  'Browse the web and retrieve information.',
 *   instructions: 'Use the web search tool to answer questions with up-to-date facts.',
 *   tools:        [new DuckDuckGoSearchTool(), new HttpClientTool()],
 *   metadata:     { version: '1.0.0', author: 'team-ai' },
 * };
 * ```
 */
export interface Skill {
  /** Unique identifier — kebab-case recommended (e.g. `"web-research"`). */
  readonly id: string;

  /** Human-readable display name. */
  readonly name: string;

  /** Short description of what this skill does. */
  readonly description?: string;

  /**
   * System-prompt fragment injected when this skill is active.
   * Prepended (or merged) into the agent's base instructions.
   */
  readonly instructions?: string;

  /**
   * Tools provided by this skill.
   * Compatible with `Tool[]` from `@personaforge/contracts` and
   * `LightweightTool[]` from `@personaforge/tools`.
   */
  readonly tools?: readonly unknown[];

  /**
   * Optional category tags for discovery and filtering.
   * Examples: `['research', 'web']`, `['code', 'execution']`
   */
  readonly tags?: readonly string[];

  /**
   * Arbitrary metadata: version, author, homepage, etc.
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * A registry for discovering skills by id or tag.
 */
export interface SkillRegistry {
  /** Register a skill. */
  register(skill: Skill): void;
  /** Look up a skill by its `id`. */
  get(id: string): Skill | undefined;
  /** List all registered skills. */
  list(): Skill[];
  /** Filter skills by tag. */
  listByTag(tag: string): Skill[];
}
