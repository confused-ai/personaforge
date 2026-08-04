/**
 * Durable agents — long-running, resumable agent execution.
 *
 * Wraps a regular agent so its agentic loop runs in the background, streaming
 * events through a per-runId topic with replay. A client can disconnect and
 * reconnect (`observe(runId)`) without missing chunks, and the run state is
 * persisted so it survives process restarts (when a checkpoint store is wired).
 *
 * ```ts
 * import { createDurableAgent } from 'personaforge/durable';
 *
 * const durable = createDurableAgent({ agent: researcher });
 * const { output, runId, cleanup } = await durable.stream('Research X');
 * for await (const chunk of output.fullStream) { ... }
 * cleanup();
 *
 * // From another client:
 * const { output } = await durable.observe(runId);
 * ```
 */

import type { AgentRunResult, AgentRunOptions, CreateAgentResult, StreamChunk } from '../create-agent/types.js';
import type { MultiModalInput } from '../providers/vision.js';
import { DurableRunRegistry, InMemoryServerCache } from './registry.js';
import type { DurableRunHandle, ServerCache } from './registry.js';
import type { DurableAgentConfig, DurableAgentOutput, DurableRunEvent, DurableStreamResult } from './types.js';
import type { SuspendedRun, SuspendedRunStore } from '../approval/index.js';
import { InMemorySuspendedRunStore } from '../approval/index.js';

const RANDOM_RUN_ID = () => `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

/** Build a live output that replays cached/registered events then follows live ones. */
async function* eventIterator(registry: DurableRunRegistry, runId: string): AsyncIterable<DurableRunEvent> {
    const handle = registry.get(runId);
    if (!handle) {
        const cached = await registry.cachedEvents(runId);
        yield* cached;
        return;
    }
    let index = 0;
    while (true) {
        while (index < handle.events.length) {
            yield handle.events[index++];
        }
        if (handle.closed) {
            while (index < handle.events.length) {
                yield handle.events[index++];
            }
            return;
        }
        await new Promise((r) => setTimeout(r, 15));
    }
}

async function* textIterator(events: AsyncIterable<DurableRunEvent>): AsyncIterable<string> {
    for await (const e of events) {
        if (e.type === 'text-delta' && e.delta) yield e.delta;
    }
}

interface CapturedRun {
    readonly input: string | MultiModalInput;
    readonly options: AgentRunOptions;
}

export class DurableAgent {
    private readonly agent: CreateAgentResult;
    private readonly registry: DurableRunRegistry;
    private readonly suspended: SuspendedRunStore;
    private readonly getRunId: () => string;
    private readonly evented: boolean;
    private readonly maxIdleMs: number;
    private readonly continuations = new Map<string, Array<{ resolve: (r: AgentRunResult) => void; reject: (e: unknown) => void }>>();
    private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly captured = new Map<string, CapturedRun>();
    private readonly pending = new Map<string, SuspendedRun>();

    constructor(private readonly config: DurableAgentConfig & { agent: CreateAgentResult }) {
        this.agent = config.agent;
        this.registry = new DurableRunRegistry(config.cache);
        this.suspended = config.suspendedStore ?? new InMemorySuspendedRunStore();
        this.getRunId = config.getRunId ?? RANDOM_RUN_ID;
        this.evented = (config.execution ?? 'blocking') === 'evented';
        this.maxIdleMs = config.maxIdleMs ?? 60 * 5_000;
    }

    get name(): string {
        return this.agent.name;
    }

    /** Start a durable run — the agentic loop runs in the background. */
    async stream(input: string | MultiModalInput, options: AgentRunOptions & { runId?: string } = {}): Promise<DurableStreamResult> {
        const runId = options.runId ?? this.getRunId();
        this.captured.set(runId, { input, options });
        const handle = this.registry.create({ runId, input, options, agentId: this.config.agentId });
        void this._consume(input, options, runId, handle);

        const output = this._buildOutput(runId, undefined);
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            handle.closed = true;
            handle.notify();
            const timer = this.cleanupTimers.get(runId);
            if (timer) clearTimeout(timer);
            this.cleanupTimers.delete(runId);
        };
        this._scheduleAutoCleanup(runId, cleanup);
        return { runId, output, cleanup };
    }

    /** Reconnect to a run — replay cached events, then follow live ones. */
    async observe(runId: string): Promise<DurableStreamResult> {
        const handle = this.registry.get(runId);
        const output = this._buildOutput(runId, undefined);
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            if (handle) {
                handle.closed = true;
                handle.notify();
            }
        };
        return { runId, output, cleanup };
    }

    async approveToolCall(options: { runId: string; toolCallId?: string }): Promise<DurableStreamResult> {
        return this._answerApproval(options.runId, options.toolCallId, true);
    }

    async declineToolCall(options: { runId: string; toolCallId?: string }): Promise<DurableStreamResult> {
        return this._answerApproval(options.runId, options.toolCallId, false);
    }

    async approveToolCallGenerate(options: { runId: string; toolCallId?: string }): Promise<AgentRunResult> {
        const { output } = await this.approveToolCall(options);
        return output.runResult;
    }

    async declineToolCallGenerate(options: { runId: string; toolCallId?: string }): Promise<AgentRunResult> {
        const { output } = await this.declineToolCall(options);
        return output.runResult;
    }

    /** Resume a `suspend()`-suspended tool with resume data. */
    async resumeStream(resumeData: unknown, options: { runId?: string; toolCallId?: string } = {}): Promise<DurableStreamResult> {
        if (!options.runId) throw new Error('resumeStream requires a runId (use listSuspendedRuns to find one).');
        const rec = await this._getSuspended(options.runId);
        const toolCall = rec?.toolCalls.find((t) => t.toolCallId === options.toolCallId) ?? rec?.toolCalls[0];
        if (!rec || !toolCall) throw new Error(`No suspended run found for "${options.runId}".`);
        await this.suspended.markResolved(options.runId).catch(() => undefined);
        this.pending.delete(options.runId);
        return this._replay(options.runId, {
            resumeData,
            resumePendingTool: {
                toolCall: { id: toolCall.toolCallId, name: toolCall.toolName, arguments: toolCall.args },
                approved: true,
                step: 0,
                threadId: rec.threadId,
                resourceId: rec.resourceId,
            },
        });
    }

    /** Rediscover pending approval/suspend runs for a conversation from storage. */
    async listSuspendedRuns(options: { threadId?: string; resourceId?: string } = {}): Promise<{ runs: SuspendedRun[] }> {
        const stored = await this.suspended.list({
            agentId: this.config.agentId ?? this.agent.name,
            threadId: options.threadId,
            resourceId: options.resourceId,
        });
        const local = Array.from(this.pending.values()).filter((r) => {
            if (options.threadId && r.threadId !== options.threadId) return false;
            if (options.resourceId && r.resourceId !== options.resourceId) return false;
            return true;
        });
        const byRun = new Map<string, SuspendedRun>();
        for (const r of [...stored, ...local]) byRun.set(r.runId, r);
        return { runs: Array.from(byRun.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    }

    /**
     * Re-drive durable runs stuck in `running` status after a crash. Re-issues
     * LLM + tool calls from the last snapshot — ensure tools are idempotent.
     */
    async recoverActiveRuns(options: { runId?: string } = {}): Promise<{ recovered: number; succeeded: number; failed: number }> {
        let candidates: string[];
        if (options.runId) {
            candidates = [options.runId];
        } else {
            candidates = new Set([
                ...Array.from(this.captured.keys()),
                ...(await this.registry.listCachedRunIds()),
            ]) as unknown as string[];
        }
        let recovered = 0;
        let succeeded = 0;
        let failed = 0;
        for (const runId of candidates) {
            const handle = this.registry.get(runId);
            if (handle?.status && handle.status !== 'running' && handle.status !== 'suspended') continue;
            recovered++;
            try {
                await this._replay(runId, {});
                succeeded++;
            } catch {
                failed++;
            }
        }
        return { recovered, succeeded, failed };
    }

    /** Stop all in-process run handles / timers. */
    async destroy(): Promise<void> {
        for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
        this.cleanupTimers.clear();
        this.pending.clear();
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private _buildOutput(runId: string, continuationResult: Promise<AgentRunResult> | undefined): DurableAgentOutput {
        const handle = this.registry.get(runId);
        const runResult = continuationResult ?? (handle ? handle.result : this._cachedResult(runId));
        return {
            // Two independent iterators — async generators are single-consumer,
            // so fullStream and textStream must not share one.
            fullStream: eventIterator(this.registry, runId),
            textStream: textIterator(eventIterator(this.registry, runId)),
            object: runResult.then((r) => r?.object).catch(() => undefined),
            runResult,
        };
    }

    private async _cachedResult(runId: string): Promise<AgentRunResult> {
        const cached = await this.registry.cachedEvents(runId);
        const finish = [...cached].reverse().find((e) => e.type === 'run-finish');
        if (finish?.type === 'run-finish' && finish.run) return finish.run;
        throw new Error(`No run result cached for "${runId}".`);
    }

    private async _consume(
        input: string | MultiModalInput,
        options: AgentRunOptions,
        runId: string,
        handle: DurableRunHandle,
    ): Promise<void> {
        try {
            const iterator = this.agent.streamEvents(input, { ...options, runId });
            for await (const chunk of iterator) {
                await this.registry.publish(runId, chunk as StreamChunk);
                if (chunk.type === 'run-finish' && chunk.run) {
                    if (chunk.run.finishReason === 'suspended') {
                        // Persist the suspension FIRST, then resolve the run
                        // result — callers awaiting `output.runResult` must be
                        // able to discover the suspension via listSuspendedRuns
                        // immediately after it resolves.
                        await this.registry.markStatus(runId, 'suspended');
                        await this._storeSuspended(runId, chunk.run, options);
                        handle.resultResolve(chunk.run);
                    } else {
                        handle.resultResolve(chunk.run);
                        this._resolveContinuations(runId, chunk.run);
                        await this.registry.markStatus(runId, 'done').catch(() => undefined);
                        // Terminal — close the topic so consumers finish their streams
                        // (cached events remain readable for later observe()).
                        handle.closed = true;
                        handle.notify();
                    }
                } else if (chunk.type === 'error') {
                    handle.resultReject(chunk.error);
                    this._rejectContinuations(runId, chunk.error);
                    await this.registry.markStatus(runId, 'error').catch(() => undefined);
                    handle.closed = true;
                    handle.notify();
                }
            }
        } catch (e) {
            handle.resultReject(e);
            this._rejectContinuations(runId, e);
            await this.registry.markStatus(runId, 'error').catch(() => undefined);
        }
    }

    private _resolveContinuations(runId: string, result: AgentRunResult): void {
        if (result.finishReason === 'suspended') return;
        const list = this.continuations.get(runId);
        if (list) {
            for (const c of list) c.resolve(result);
            this.continuations.delete(runId);
        }
    }

    private _rejectContinuations(runId: string, error: unknown): void {
        const list = this.continuations.get(runId);
        if (list) {
            for (const c of list) c.reject(error);
            this.continuations.delete(runId);
        }
    }

    private async _storeSuspended(
        runId: string,
        result: AgentRunResult,
        options: AgentRunOptions,
    ): Promise<void> {
        const sp = result.suspendPayload;
        if (!sp) return;
        const threadId = options.threadId ?? (options.memory?.thread as string | undefined);
        const resourceId = options.resourceId ?? (options.memory?.resource as string | undefined);
        const record: SuspendedRun = {
            runId,
            agentId: this.config.agentId ?? this.agent.name,
            threadId,
            resourceId,
            status: sp.requiresApproval ? 'approval' : 'suspended',
            toolCalls: [{
                toolCallId: sp.toolCallId,
                toolName: sp.toolName,
                args: sp.args as Record<string, unknown>,
                requiresApproval: !!sp.requiresApproval,
                suspendPayload: sp.suspendPayload,
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.pending.set(runId, record);
        try {
            await this.suspended.save(record);
        } catch {
            /* in-memory fallback already set */
        }
    }

    private async _getSuspended(runId: string): Promise<SuspendedRun | undefined> {
        const local = this.pending.get(runId);
        if (local) return local;
        try {
            return (await this.suspended.getByRunId(runId)) ?? undefined;
        } catch {
            return undefined;
        }
    }

    private async _answerApproval(runId: string, toolCallId: string | undefined, approved: boolean): Promise<DurableStreamResult> {
        const rec = await this._getSuspended(runId);
        if (!rec) throw new Error(`No suspended run found for "${runId}".`);
        const toolCall = rec.toolCalls.find((t) => t.toolCallId === toolCallId) ?? rec.toolCalls[0];
        if (!toolCall) throw new Error('Suspended run has no tool calls to answer.');
        await this.suspended.markResolved(runId).catch(() => undefined);
        this.pending.delete(runId);
        return this._replay(runId, {
            approvedToolCalls: [toolCall.toolCallId],
            resumePendingTool: {
                toolCall: { id: toolCall.toolCallId, name: toolCall.toolName, arguments: toolCall.args },
                approved,
                step: 0,
                threadId: rec.threadId,
                resourceId: rec.resourceId,
            },
        });
    }

    private async _replay(runId: string, extra: Partial<AgentRunOptions>): Promise<DurableStreamResult> {
        const capturedRun = this.captured.get(runId);
        if (!capturedRun) throw new Error(`No captured input for durable run "${runId}".`);
        const merged: AgentRunOptions = {
            ...capturedRun.options,
            ...extra,
            runId,
            ...(extra.resumePendingTool ? { resumePendingTool: extra.resumePendingTool } : {}),
        };
        const handle = this.registry.get(runId) ?? this.registry.create({ runId, input: capturedRun.input, options: merged, agentId: this.config.agentId });
        const continuation = new Promise<AgentRunResult>((resolve, reject) => {
            const list = this.continuations.get(runId) ?? [];
            list.push({ resolve, reject });
            this.continuations.set(runId, list);
        });
        void this._consume(capturedRun.input, merged, runId, handle);

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            handle.closed = true;
            handle.notify();
        };
        await this.registry.markStatus(runId, 'running').catch(() => undefined);
        return { runId, output: this._buildOutput(runId, continuation), cleanup };
    }

    private _scheduleAutoCleanup(runId: string, cleanup: () => void): void {
        const timer = setTimeout(() => {
            this.cleanupTimers.delete(runId);
            cleanup();
        }, this.evented ? 0 : this.maxIdleMs);
        timer.unref?.();
        this.cleanupTimers.set(runId, timer);
    }
}

/** Wrap a regular agent in a durable, resumable stream. */
export function createDurableAgent(config: DurableAgentConfig & { agent: CreateAgentResult }): DurableAgent {
    return new DurableAgent({ ...config, execution: config.execution ?? 'blocking' });
}

/** Fire-and-forget durable agent — consumes chunks through the run topic. */
export function createEventedAgent(config: DurableAgentConfig & { agent: CreateAgentResult }): DurableAgent {
    return new DurableAgent({ ...config, execution: config.execution ?? 'evented' });
}

export function durableRunId(): string {
    return RANDOM_RUN_ID();
}

/**
 * Build a DurableAgentOutput directly from a registry — used by
 * durable-by-default agents to expose observe/approval streams.
 */
export function registryOutput(
    registry: DurableRunRegistry,
    runId: string,
    runResult?: Promise<AgentRunResult>,
): DurableAgentOutput {
    const handle = registry.get(runId);
    const result = runResult ?? (handle ? handle.result : undefined);
    const finalResult: Promise<AgentRunResult> = result ?? Promise.reject(new Error(`No run result for "${runId}".`));
    return {
        // Independent iterators — fullStream and textStream must not share one.
        fullStream: eventIterator(registry, runId),
        textStream: textIterator(eventIterator(registry, runId)),
        object: finalResult.then((r) => r?.object).catch(() => undefined),
        runResult: finalResult,
    };
}

export { DurableRunRegistry, InMemoryServerCache };
export type { ServerCache, DurableAgentConfig, DurableStreamResult, DurableAgentOutput, DurableRunEvent };
