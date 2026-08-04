/**
 * Durable agent event + output types.
 */

import type { AgentRunResult, AgentRunOptions, StreamChunk } from '../create-agent/types.js';

/** A durable run event — a StreamChunk stamped with a sequence + timestamp. */
export interface DurableRunEvent extends StreamChunk {
    /** Monotonic sequence within the run (ordering across reconnect). */
    seq: number;
    /** ISO timestamp when the event was published. */
    at: string;
}

/** Output of a durable stream — replayed + live event feeds. */
export interface DurableAgentOutput {
    /** All events (text, tool, approval, goal, object, run-finish) in order. */
    readonly fullStream: AsyncIterable<DurableRunEvent>;
    /** Text deltas only. */
    readonly textStream: AsyncIterable<string>;
    /** Resolves to the final structured output object (`run.object`). */
    readonly object: Promise<unknown>;
    /** Resolves to the final run result. */
    readonly runResult: Promise<AgentRunResult>;
    /** Rejections from the run surface here. */
    readonly streamError?: Promise<unknown>;
}

/** Stream + lifecycle handle for a durable agent invocation. */
export interface DurableStreamResult {
    readonly runId: string;
    readonly output: DurableAgentOutput;
    /**
     * Release the run's subscriptions and stop the auto-cleanup timer.
     * Safe to call more than once.
     */
    cleanup(): void;
}

export type DurableAgentExecution = 'blocking' | 'evented';

export interface DurableAgentConfig {
    /**
     * Server cache backing resumable streams. In-memory by default; pass
     * `InMemoryServerCache.fromRedis(...)` (or any ServerCache) in production
     * so cached events survive process restarts / scale across replicas.
     */
    cache?: import('./registry.js').ServerCache;
    /** 'blocking' (createDurableAgent) or 'evented' (createEventedAgent). */
    execution?: DurableAgentExecution;
    /** Generate a fresh runId. Default: random. */
    getRunId?: () => string;
    /** Optional agent id for suspended-run records. */
    agentId?: string;
    /** Suspended-run store for approval/suspend recovery across restarts. */
    suspendedStore?: import('../approval/index.js').SuspendedRunStore;
    /** Max ms for untilIdle streams to stay open past completion. Default 5min. */
    maxIdleMs?: number;
}

export type { StreamChunk, AgentRunResult, AgentRunOptions };
