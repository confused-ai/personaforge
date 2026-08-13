/**
 * Run tracking — persist execution metadata to a durable `RunStore`.
 *
 * `trackRun()` wraps a single agent call and records start/stop
 * timestamps, status, cost, token usage, and errors to a `RunStore`.
 * Enables crash recovery, billing, audit, and observability without
 * coupling to any specific agent implementation.
 *
 * @example
 * ```ts
 * import { trackRun, createSqliteRunStore } from 'personaforge/production';
 * const store = createSqliteRunStore('./runs.db');
 *
 * const result = await trackRun(store, {
 *   agentId: 'support',
 *   tenantId: 'acme',
 *   userId: 'usr_1',
 * }, () => agent.run('hi'));
 * ```
 */

import type { RunStore, RunRecord, RunStatus } from './run-store.js';

export interface TrackRunContext {
    runId?: string;
    tenantId?: string;
    userId?: string;
    agentId?: string;
    agentVersion?: string;
    sessionId?: string;
    parentRunId?: string;
    traceId?: string;
    model?: string;
    provider?: string;
}

export interface TrackRunResult<T> {
    value: T;
    record: RunRecord;
}

/** Map a generic result to a run status. */
export function toRunStatus(finishReason?: string, error?: unknown): RunStatus {
    if (error) return 'failed';
    switch (finishReason) {
        case 'stop':
        case 'max_steps':
            return 'completed';
        case 'timeout':
            return 'timed_out';
        case 'human_rejected':
        case 'aborted':
            return 'cancelled';
        case 'error':
            return 'failed';
        default:
            return 'completed';
    }
}

/**
 * Wrap an agent execution and persist the run record.
 * The wrapped function is called exactly once; on success or failure
 * the record is saved to the store. Errors are re-thrown to the caller.
 */
export async function trackRun<T>(
    store: RunStore,
    ctx: TrackRunContext,
    fn: () => Promise<T>,
): Promise<TrackRunResult<T>> {
    const runId = ctx.runId ?? crypto.randomUUID();
    const startTime = new Date().toISOString();

    const base: RunRecord = {
        runId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        agentId: ctx.agentId,
        agentVersion: ctx.agentVersion,
        sessionId: ctx.sessionId,
        parentRunId: ctx.parentRunId,
        status: 'running',
        startTime,
        model: ctx.model,
        provider: ctx.provider,
        traceId: ctx.traceId,
    };

    try {
        // Initial "running" record — enables crash recovery detection
        await store.save(base);
        const value = await fn();
        const endTime = new Date().toISOString();
        const record: RunRecord = {
            ...base,
            status: toRunStatus(
                // Extract finishReason from result if it looks like an AgentRunResult
                isAgentRunResult(value) ? value.finishReason : undefined,
            ),
            output: isAgentRunResult(value) ? value.text : undefined,
            endTime,
            durationMs: Date.now() - new Date(startTime).getTime(),
            promptTokens: isAgentRunResult(value) ? value.usage?.promptTokens : undefined,
            completionTokens: isAgentRunResult(value) ? value.usage?.completionTokens : undefined,
            totalTokens: isAgentRunResult(value) ? value.usage?.totalTokens : undefined,
            costUsd: isAgentRunResult(value) ? value.costUsd : undefined,
            model: ctx.model ?? (isAgentRunResult(value) ? value.model : undefined),
            finishReason: isAgentRunResult(value) ? value.finishReason : undefined,
        };
        await store.save(record);
        return { value, record };
    } catch (error) {
        const endTime = new Date().toISOString();
        const record: RunRecord = {
            ...base,
            status: 'failed',
            endTime,
            durationMs: Date.now() - new Date(startTime).getTime(),
            error: error instanceof Error ? error.message : String(error),
            errorCode: isFrameworkErrish(error) ? error.code : undefined,
        };
        await store.save(record);
        throw error;
    }
}

function isAgentRunResult(v: unknown): v is {
    finishReason?: string;
    text?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    costUsd?: number;
    model?: string;
} {
    return (
        typeof v === 'object' &&
        v !== null &&
        'finishReason' in v &&
        (v as Record<string, unknown>).finishReason !== undefined
    );
}

function isFrameworkErrish(v: unknown): v is { code?: string } & Error {
    return typeof v === 'object' && v !== null && 'code' in v;
}
