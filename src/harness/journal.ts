/**
 * Harness run journal — durable, tamper-evident log for `createHarness` runs.
 *
 * Every harness run appends `execution.started` + `execution.completed|failed`
 * events to the same `EventStore` substrate the graph engine uses, hash-chained
 * exactly like `RunRecorder` so `verifyChain` covers harness runs too. Read
 * back with `timeline()` (zero LLM calls) or `verify()`.
 *
 * Recording never breaks the run: store failures are routed to `onError`.
 */

import { createHash } from 'node:crypto';
import { verifyChain, type ChainVerification } from '../graph/audit.js';
import { InMemoryEventStore } from '../graph/event-store.js';
import { redactSecrets } from '../graph/run-recorder.js';
import {
    GraphEventType,
    executionId as makeExecutionId,
    graphId as makeGraphId,
    uid,
    type EventStore,
    type ExecutionId,
    type GraphEvent,
    type GraphId,
} from '../graph/types.js';

const SCOPE = 'harness-run';
const PREVIEW_LIMIT = 2000;

export interface JournalRecordInput {
    readonly harness: string;
    readonly input: unknown;
    readonly outcome: 'success' | 'error';
    readonly result?: unknown;
    readonly error?: string;
    readonly latencyMs: number;
    readonly sessionId?: string;
    readonly userId?: string;
    readonly metadata?: Record<string, unknown>;
}

export interface RunTimelineEvent {
    readonly sequence: number;
    readonly type: GraphEventType;
    readonly timestamp: number;
    readonly data: Record<string, unknown>;
}

export interface RunTimeline {
    readonly runId: ExecutionId;
    readonly harness: string;
    readonly outcome: 'success' | 'error';
    readonly latencyMs: number;
    readonly events: RunTimelineEvent[];
}

export interface RunJournalOptions {
    readonly store?: EventStore;
    readonly redact?: (data: Record<string, unknown>) => Record<string, unknown>;
    readonly onError?: (err: unknown) => void;
}

export interface RunJournal {
    readonly store: EventStore;
    /** Append a run's event pair. Never throws — failures go to `onError`. */
    record(run: JournalRecordInput): Promise<ExecutionId>;
    /** Ordered run history with zero LLM calls. */
    timeline(runId: ExecutionId): Promise<RunTimeline>;
    /** Recompute the hash chain for one run. */
    verify(runId: ExecutionId): Promise<ChainVerification>;
}

function preview(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text;
}

export function createRunJournal(options: RunJournalOptions = {}): RunJournal {
    const store = options.store ?? new InMemoryEventStore();
    const redact = options.redact ?? redactSecrets;
    const onError = options.onError;
    const graphId: GraphId = makeGraphId('harness-journal');

    const chain = (prev: string, type: GraphEventType, seq: number, base: Record<string, unknown>): Record<string, unknown> => {
        const hash = createHash('sha256')
            .update(`${prev}|${type}|${seq}|${JSON.stringify(base)}`)
            .digest('hex');
        return { ...base, __audit: { prev, hash } };
    };

    return {
        store,

        async record(run: JournalRecordInput): Promise<ExecutionId> {
            const runId = makeExecutionId();
            try {
                const startedBase = redact({
                    scope: SCOPE,
                    harness: run.harness,
                    input: preview(run.input),
                    ...(run.sessionId !== undefined ? { sessionId: run.sessionId } : {}),
                    ...(run.userId !== undefined ? { userId: run.userId } : {}),
                    ...(run.metadata !== undefined ? { metadata: run.metadata } : {}),
                });
                let prev = '';
                const startedData = chain(prev, GraphEventType.EXECUTION_STARTED, 0, startedBase);
                prev = (startedData.__audit as { hash: string }).hash;

                const endType =
                    run.outcome === 'success' ? GraphEventType.EXECUTION_COMPLETED : GraphEventType.EXECUTION_FAILED;
                const endBase = redact({
                    scope: SCOPE,
                    harness: run.harness,
                    latencyMs: run.latencyMs,
                    ...(run.outcome === 'success'
                        ? { result: preview(run.result) }
                        : { error: run.error ?? 'unknown error' }),
                });
                const endData = chain(prev, endType, 1, endBase);

                const now = Date.now();
                const events: GraphEvent[] = [
                    { id: uid('e'), type: GraphEventType.EXECUTION_STARTED, executionId: runId, graphId, timestamp: now, sequence: 0, data: startedData },
                    { id: uid('e'), type: endType, executionId: runId, graphId, timestamp: now, sequence: 1, data: endData },
                ];
                await store.append(events);
            } catch (err) {
                onError?.(err);
            }
            return runId;
        },

        async timeline(runId: ExecutionId): Promise<RunTimeline> {
            const events = await store.load(runId);
            if (events.length === 0) throw new Error(`RunJournal: no events for run "${runId}"`);
            const first = events[0]!.data as Record<string, unknown> | undefined;
            const last = events[events.length - 1]!;
            const lastData = (last.data as Record<string, unknown> | undefined) ?? {};
            return {
                runId,
                harness: typeof first?.['harness'] === 'string' ? (first['harness'] as string) : 'unknown',
                outcome: last.type === GraphEventType.EXECUTION_FAILED ? 'error' : 'success',
                latencyMs: typeof lastData['latencyMs'] === 'number' ? (lastData['latencyMs'] as number) : 0,
                events: events.map((e) => ({
                    sequence: e.sequence,
                    type: e.type,
                    timestamp: e.timestamp,
                    data: (e.data as Record<string, unknown> | undefined) ?? {},
                })),
            };
        },

        async verify(runId: ExecutionId): Promise<ChainVerification> {
            return verifyChain(await store.load(runId));
        },
    };
}
