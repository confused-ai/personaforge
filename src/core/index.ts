/**
 * @confused-ai/core — package barrel.
 *
 * Public API surface — nothing else is exported.
 * Internal helpers (queue, loop, retry fallback) stay private (ISP).
 *
 * Import paths:
 *   import { createAgent }    from './index.js';
 *   import { AgentRunner }    from './runner/index.js';
 *   import type { Agent }     from './types.js';
 *   import { ConfigError }    from './errors.js';
 */

// ── Primary API ───────────────────────────────────────────────────────────────
// createAgent + CreateAgentOptions live in ../create-agent — the single factory
// wired with both Mastermind compression and the durable EventRecorder. The
// package root exports them explicitly; this barrel no longer duplicates them.
export type { SessionStore } from '../contracts/index.js';

// ── Database (AgentDb re-exported so users import from one place) ─────────────
export type { AgentDb } from '../db/index.js';

// ── Registry ──────────────────────────────────────────────────────────────────
export { MapToolRegistry, createToolRegistry } from './tool-registry.js';

// ── Public types ──────────────────────────────────────────────────────────────
export { generateEntityId } from './types.js';
// AgentState is an enum — must be a value export (not type-only)
export { AgentState } from './types.js';
export type {
    EntityId,
    Agent,
    AgentRunOptions,
    AgentRunResult,
    AgentLifecycleHooks,
    StreamChunk,
    Message,
    MultiModalInput,
    MessageContent,
    OpenAIToolCall,
    // Agent execution contracts (used by orchestration, plugins, contracts packages)
    AgentInput,
    AgentOutput,
    AgentContext,
    AgentIdentity,
    AgentHooks,
    AgentConfig,
    ExecutionMetadata,
} from './types.js';

// ── Canonical LLM provider types (single source of truth for providers) ──────
export type {
    ToolCall,
    /** @deprecated use ToolCall */
    ToolCallResult,
    MessageRole,
    ContentPart,
    MessageWithToolId,
    AssistantMessage,
    ToolResultMessage,
    LLMToolDefinition,
    TextStreamChunk,
    StreamToolCallChunk,
    StreamDelta,
    StreamOptions,
    GenerateOptions,
    GenerateResult,
    LLMProvider,
} from './llm-types.js';

// ── Errors ────────────────────────────────────────────────────────────────────
export { ConfusedAIError, ConfigError, LLMError, BudgetExceededError } from './errors.js';

// ── Runner (advanced usage) ───────────────────────────────────────────────────
export { AgentRunner } from './runner/agent-runner.js';
export type {
    RunnerConfig,
    RetryPolicy,
    Tool,
    ToolRegistry,
} from './runner/types.js';
// ISP sub-interfaces for fine-grained provider typing
export type {
    ITextGenerator,
    IStreamingProvider,
    IToolCallProvider,
    IEmbeddingProvider,
    IFullLLMProvider,
} from './runner/types.js';
