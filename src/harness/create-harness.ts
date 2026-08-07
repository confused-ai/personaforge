/**
 * createHarness — production-grade wrapper around a runnable agent.
 *
 * Provides, in a single call, the full set of harness capabilities:
 *   - Resilience: circuit breaker, rate limit, retry, per-call timeout,
 *     `AbortSignal` propagation.
 *   - Lifecycle hooks (composed **inside** resilience so hooks run on every
 *     underlying attempt, not once around the whole retry ladder).
 *   - Cost/budget enforcement per-run and per-user (opt-in).
 *   - Idempotency de-duplication by key (opt-in).
 *   - Audit logging (opt-in).
 *   - Deadlines, cancellation, and nested-agent-as-tool depth guards.
 *   - `asTool()` exposure with sensible defaults.
 */

import { agentAsTool, type AgentAsToolOptions, type RunnableAgent, toRunnableAgent } from '../tools/core/agent-as-tool.js';
import type { LightweightTool, ToolObjectSchemaLike, ToolSchemaLike } from '../tools/core/tool-helper.js';
import { withResilience, type ResilienceConfig, type HealthReport, type WrappableAgent, type ResilientRunOptions } from '../production/resilient-agent.js';
import type { UnifiedLifecycleHooks } from '../hooks/unified-hooks.js';
import { toAgenticHooks } from '../hooks/unified-hooks.js';
import { BudgetEnforcer, type BudgetConfig, BudgetExceededError } from '../production/budget.js';
import type { IdempotencyStore } from '../production/idempotency.js';
import { InMemoryIdempotencyStore } from '../production/idempotency.js';
import type { AuditStore } from '../production/audit-store.js';
import { TimeoutError, CancellationError } from '../shared/errors.js';

// ── Public types ───────────────────────────────────────────────────────────

export interface HarnessAsToolOptions<TOutput = unknown> {
    readonly name: string;
    readonly description: string;
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    readonly timeoutMs?: number;
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    readonly transformOutput?: AgentAsToolOptions<unknown, TOutput>['transformOutput'];
    readonly beforeExecute?: AgentAsToolOptions<unknown, TOutput>['beforeExecute'];
    readonly afterExecute?: AgentAsToolOptions<unknown, TOutput>['afterExecute'];
    readonly onError?: AgentAsToolOptions<unknown, TOutput>['onError'];
    readonly tags?: string[];
}

export interface HarnessRunOptions {
    readonly sessionId?: string;
    readonly signal?: AbortSignal;
    /** Hard deadline for the whole run in ms. Aborts underlying execution. */
    readonly deadlineMs?: number;
    /** Idempotency key: identical keys short-circuit to the cached result. */
    readonly idempotencyKey?: string;
    /** User id for per-user budget accounting. */
    readonly userId?: string;
    /** Additional run metadata attached to audit entries. */
    readonly metadata?: Record<string, unknown>;
    /** Per-run hooks merged with harness hooks. */
    readonly hooks?: UnifiedLifecycleHooks;
}

export interface HarnessConfig {
    /** Agent to harden. Accepts CreateAgentResult or any RunnableAgent. */
    readonly agent: RunnableAgent & { name?: string; instructions?: string };
    /** Resilience controls (circuit breaker, rate limit, retry, timeout). */
    readonly resilience?: ResilienceConfig | false;
    /** Nesting controls for agent-as-tool recursion. */
    readonly nesting?: { readonly maxDepth?: number };
    /** Default tool timeout when exposing via asTool(). */
    readonly defaultTimeoutMs?: number;
    /** Unified lifecycle hooks applied to every run when the agent supports them. */
    readonly hooks?: UnifiedLifecycleHooks;
    /** Enforce per-run / per-user / per-month budgets. */
    readonly budget?: BudgetConfig;
    /** Idempotency de-duplication. Provide a store or `true` for in-memory. */
    readonly idempotency?: IdempotencyStore | true;
    /** TTL for idempotency entries. Default: 24h. */
    readonly idempotencyTtlMs?: number;
    /** Append every run to an audit store (agent name, latency, error, cost). */
    readonly audit?: AuditStore;
}

export interface AgentHarness {
    readonly name: string;
    readonly agent: RunnableAgent;
    run(input: Record<string, unknown> | string, options?: HarnessRunOptions): Promise<unknown>;
    asTool<TOutput = unknown>(options: HarnessAsToolOptions<TOutput>): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput>;
    health(): HealthReport | undefined;
    readonly maxDepth: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizePrompt(input: unknown): string {
    if (typeof input === 'string') return input;
    if (
        input !== null &&
        typeof input === 'object' &&
        'prompt' in input &&
        typeof (input as { prompt: unknown }).prompt === 'string'
    ) {
        return (input as { prompt: string }).prompt;
    }
    return JSON.stringify(input);
}

function combineSignals(signals: Array<AbortSignal | undefined>): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const detachers: Array<() => void> = [];
    for (const s of signals) {
        if (!s) continue;
        if (s.aborted) {
            controller.abort(s.reason);
            break;
        }
        const onAbort = (): void => controller.abort(s.reason);
        s.addEventListener('abort', onAbort, { once: true });
        detachers.push(() => s.removeEventListener('abort', onAbort));
    }
    return {
        signal: controller.signal,
        dispose: () => { for (const d of detachers) d(); },
    };
}

function extractUsage(result: unknown): { promptTokens: number; completionTokens: number; model?: string } | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const r = result as Record<string, unknown>;
    const usage = r['usage'] as Record<string, unknown> | undefined;
    if (!usage) return undefined;
    const promptTokens = Number(usage['promptTokens'] ?? usage['prompt_tokens'] ?? 0);
    const completionTokens = Number(usage['completionTokens'] ?? usage['completion_tokens'] ?? 0);
    const model = typeof r['model'] === 'string' ? (r['model'] as string) : undefined;
    return { promptTokens, completionTokens, ...(model ? { model } : {}) };
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createHarness(config: HarnessConfig): AgentHarness {
    const {
        agent: rawAgent,
        resilience = {},
        nesting,
        defaultTimeoutMs = 120_000,
        hooks,
        budget,
        idempotency,
        idempotencyTtlMs = 24 * 60 * 60 * 1_000,
        audit,
    } = config;

    const maxDepth = nesting?.maxDepth ?? 5;
    const base = toRunnableAgent(rawAgent);
    const name =
        typeof rawAgent.name === 'string' && rawAgent.name.length > 0
            ? rawAgent.name
            : 'harness-agent';

    const looksLikeCreateAgent =
        typeof (rawAgent as { instructions?: unknown }).instructions === 'string' &&
        typeof (rawAgent as { createSession?: unknown }).createSession === 'function';

    const budgetEnforcer = budget ? new BudgetEnforcer(budget) : null;
    const idempotencyStore: IdempotencyStore | null =
        idempotency === true ? new InMemoryIdempotencyStore() : (idempotency ?? null);

    // Inner attempt: unified hooks + provider signal are attached HERE so they
    // execute on every retry / circuit-breaker attempt, not once around.
    const innerRun = (prompt: string, opts: HarnessRunOptions & { signal?: AbortSignal }): Promise<unknown> => {
        const mergedHooks: UnifiedLifecycleHooks = { ...(hooks ?? {}), ...(opts.hooks ?? {}) };
        const agenticHooks = Object.keys(mergedHooks).length > 0 ? toAgenticHooks(mergedHooks) : undefined;

        const runOptions: Record<string, unknown> = {};
        if (opts.sessionId !== undefined) runOptions['sessionId'] = opts.sessionId;
        if (opts.signal !== undefined) runOptions['signal'] = opts.signal;
        if (opts.userId !== undefined) runOptions['userId'] = opts.userId;
        if (agenticHooks && looksLikeCreateAgent) runOptions['hooks'] = agenticHooks;

        const agentWithRun = rawAgent as { run: (input: unknown, opts?: unknown) => Promise<unknown> };
        return looksLikeCreateAgent
            ? agentWithRun.run(prompt, runOptions)
            : base.run(prompt, runOptions as { sessionId?: string });
    };

    // Wrap innerRun with resilience (CB / RL / retry / per-call timeout).
    let resilientRun: (prompt: string, opts: HarnessRunOptions & { signal?: AbortSignal }) => Promise<unknown>;
    let healthFn: (() => HealthReport) | undefined;

    if (resilience !== false) {
        const wrappable: WrappableAgent = {
            name,
            instructions: typeof (rawAgent as { instructions?: unknown }).instructions === 'string'
                ? (rawAgent as { instructions: string }).instructions
                : '',
            run: async (prompt: string, options?: ResilientRunOptions) =>
                innerRun(prompt, (options ?? {}) as HarnessRunOptions & { signal?: AbortSignal }),
        };
        const resilient = withResilience(wrappable, resilience);
        resilientRun = (prompt, opts) => resilient.run(prompt, { ...opts });
        healthFn = () => resilient.health();
    } else {
        resilientRun = innerRun;
    }

    const runOne = async (input: Record<string, unknown> | string, options?: HarnessRunOptions): Promise<unknown> => {
        const prompt = normalizePrompt(input);

        // Compose signals: external + deadline
        const signals: Array<AbortSignal | undefined> = [options?.signal];
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        let deadlineController: AbortController | undefined;
        if (options?.deadlineMs && options.deadlineMs > 0) {
            deadlineController = new AbortController();
            deadlineTimer = setTimeout(() => {
                deadlineController?.abort(new TimeoutError(`harness deadline exceeded (${options.deadlineMs}ms)`, { timeoutMs: options.deadlineMs }));
            }, options.deadlineMs);
            deadlineTimer.unref?.();
            signals.push(deadlineController.signal);
        }
        const combined = combineSignals(signals);

        const startedAt = Date.now();
        budgetEnforcer?.resetRun();

        let outcome: 'success' | 'error' = 'success';
        let errorMessage: string | undefined;
        let result: unknown;
        try {
            result = await resilientRun(prompt, {
                ...(options ?? {}),
                signal: combined.signal,
            });

            if (budgetEnforcer) {
                const usage = extractUsage(result);
                if (usage) budgetEnforcer.addStepCost(usage.model ?? 'unknown', usage.promptTokens, usage.completionTokens);
                await budgetEnforcer.recordAndCheck(options?.userId);
            }
            return result;
        } catch (err) {
            outcome = 'error';
            errorMessage = err instanceof Error ? err.message : String(err);
            if (combined.signal.aborted && !(err instanceof TimeoutError) && !(err instanceof CancellationError) && !(err instanceof BudgetExceededError)) {
                throw new CancellationError(errorMessage, { context: { agent: name } });
            }
            throw err;
        } finally {
            if (deadlineTimer) clearTimeout(deadlineTimer);
            combined.dispose();
            if (audit) {
                const entry = {
                    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    timestamp: new Date().toISOString(),
                    agentName: name,
                    outcome,
                    latencyMs: Date.now() - startedAt,
                    ...(errorMessage !== undefined ? { error: errorMessage } : {}),
                    ...(options?.userId !== undefined ? { userId: options.userId } : {}),
                    ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}),
                } as unknown as Parameters<AuditStore['append']>[0];
                void audit.append(entry).catch(() => undefined);
            }
        }
    };

    const run = async (input: Record<string, unknown> | string, options?: HarnessRunOptions): Promise<unknown> => {
        if (!idempotencyStore || !options?.idempotencyKey) return runOne(input, options);
        const key = options.idempotencyKey;
        const reservation = await idempotencyStore.reserve(key, idempotencyTtlMs);
        if (!reservation.created && reservation.existing) {
            if (reservation.existing.state === 'completed') {
                try {
                    return JSON.parse(reservation.existing.responseBody);
                } catch {
                    return reservation.existing.responseBody;
                }
            }
            throw new Error(`Idempotent request already in progress for key "${key}"`);
        }
        try {
            const result = await runOne(input, options);
            await idempotencyStore.set(key, 200, JSON.stringify(result ?? null), idempotencyTtlMs);
            return result;
        } catch (err) {
            await idempotencyStore.release(key).catch(() => undefined);
            throw err;
        }
    };

    const agent: RunnableAgent = { run: (input, opts) => run(input, opts as HarnessRunOptions | undefined) };

    return {
        name,
        agent,
        maxDepth,
        run,
        health: () => healthFn?.(),
        asTool<TOutput = unknown>(options: HarnessAsToolOptions<TOutput>) {
            return agentAsTool({
                name: options.name,
                description: options.description,
                agent,
                ...(options.parameters !== undefined ? { parameters: options.parameters } : {}),
                ...(options.outputSchema !== undefined ? { outputSchema: options.outputSchema } : {}),
                timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
                maxDepth,
                ...(options.needsApproval !== undefined ? { needsApproval: options.needsApproval } : {}),
                ...(options.transformOutput !== undefined ? { transformOutput: options.transformOutput } : {}),
                ...(options.beforeExecute !== undefined ? { beforeExecute: options.beforeExecute } : {}),
                ...(options.afterExecute !== undefined ? { afterExecute: options.afterExecute } : {}),
                ...(options.onError !== undefined ? { onError: options.onError } : {}),
                tags: ['harness-tool', ...(options.tags ?? [])],
            });
        },
    };
}
