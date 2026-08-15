/**
 * ResilientAgent — production hardening wrapper.
 *
 * Composes shared CircuitBreaker + RateLimiter + retry policy + per-call
 * timeout + AbortSignal propagation into a single agent facade. Delegates
 * to the canonical implementations in `production/circuit-breaker.ts`,
 * `production/rate-limiter.ts`, and `guard/retry.ts` (no logic duplicated
 * here).
 */

import {
    CircuitBreaker,
    CircuitState,
    CircuitOpenError,
} from './circuit-breaker.js';
import { RateLimiter, RateLimitError } from './rate-limiter.js';
import { withRetry, isTransientLLMError, type RetryPolicy } from '../guard/retry.js';
import { TimeoutError } from '../shared/errors.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ResilienceConfig {
    /** Circuit breaker settings. Set `false` to disable. */
    readonly circuitBreaker?: CircuitBreakerConfig | false;
    /** Rate limiter settings. Set `false` to disable. */
    readonly rateLimit?: RateLimitConfig | false;
    /** Enable health tracking snapshot via {@link ResilientAgent.health}. Default: true. */
    readonly healthCheck?: boolean;
    /** Reserved. Wire graceful shutdown via {@link createGracefulShutdown}. */
    readonly gracefulShutdown?: boolean;
    /** Retry policy for transient failures. Set `false` to disable retries. */
    readonly retry?: RetryConfig | false;
}

export interface CircuitBreakerConfig {
    readonly failureThreshold?: number;
    readonly resetTimeoutMs?: number;
    /** Per-call timeout (aborts underlying agent via AbortController). Default: 60_000. */
    readonly callTimeoutMs?: number;
}

export interface RateLimitConfig {
    readonly maxRpm?: number;
}

export interface RetryConfig {
    readonly maxRetries?: number;
    readonly backoffMs?: number;
    readonly maxBackoffMs?: number;
    /** Custom predicate. Defaults to `isTransientLLMError`. */
    readonly retryOn?: (error: unknown) => boolean;
}

export interface HealthReport {
    readonly status: 'healthy' | 'degraded' | 'unhealthy';
    readonly circuitState: 'closed' | 'open' | 'half-open' | 'disabled';
    readonly totalRuns: number;
    readonly totalFailures: number;
    readonly averageLatencyMs: number;
    readonly uptime: number;
    readonly lastError?: string;
    readonly lastRunAt?: Date;
}

/**
 * Options the resilient agent understands.
 *
 * Deliberately a transparent passthrough rather than `AgentRunOptions`: the
 * resilient wrapper only reads `signal` and forwards everything else verbatim
 * to the wrapped agent, so callers can carry hooks/metadata of any shape
 * without this layer needing to know about them.
 */
export interface ResilientRunOptions {
    readonly signal?: AbortSignal;
    readonly sessionId?: string;
    readonly userId?: string;
    readonly [key: string]: unknown;
}

/** Any agent that accepts a prompt string. */
export interface WrappableAgent<TResult = unknown> {
    readonly name: string;
    readonly instructions: string;
    run(prompt: string, options?: ResilientRunOptions): Promise<TResult>;
    createSession?(userId?: string): Promise<string>;
    getSessionMessages?(sessionId: string): Promise<unknown>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const CB_TO_HEALTH: Record<CircuitState, 'closed' | 'open' | 'half-open'> = {
    [CircuitState.CLOSED]: 'closed',
    [CircuitState.OPEN]: 'open',
    [CircuitState.HALF_OPEN]: 'half-open',
};

/** Link an external AbortSignal into an owned AbortController. Returns detach. */
function linkSignal(external: AbortSignal | undefined, owned: AbortController): () => void {
    if (!external) return () => undefined;
    if (external.aborted) {
        owned.abort(external.reason);
        return () => undefined;
    }
    const onAbort = (): void => owned.abort(external.reason);
    external.addEventListener('abort', onAbort, { once: true });
    return () => external.removeEventListener('abort', onAbort);
}

/** Race `fn(signal)` against a timeout. Rejects with TimeoutError; aborts the inner signal. */
async function withCallTimeout<T>(
    timeoutMs: number,
    external: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    const detach = linkSignal(external, controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort(new Error(`call timed out after ${timeoutMs}ms`));
            reject(new TimeoutError(`call timed out after ${timeoutMs}ms`, { timeoutMs }));
        }, timeoutMs);
        timer.unref?.();
    });
    try {
        return await Promise.race([fn(controller.signal), timeout]);
    } finally {
        if (timer) clearTimeout(timer);
        detach();
    }
}

// ── Resilient Agent ────────────────────────────────────────────────────────

export class ResilientAgent<TResult = unknown> {
    readonly name: string;
    readonly instructions: string;

    private readonly agent: WrappableAgent<TResult>;
    private readonly circuitBreaker: CircuitBreaker | null;
    private readonly rateLimiter: RateLimiter | null;
    private readonly retryPolicy: Partial<RetryPolicy> | null;
    private readonly callTimeoutMs: number;
    private readonly startTime = Date.now();

    private totalRuns = 0;
    private totalFailures = 0;
    private totalLatencyMs = 0;
    private lastError?: string;
    private lastRunAt?: Date;

    constructor(agent: WrappableAgent<TResult>, config: ResilienceConfig = {}) {
        this.agent = agent;
        this.name = agent.name;
        this.instructions = agent.instructions;

        if (config.circuitBreaker !== false) {
            const cb = config.circuitBreaker ?? {};
            this.circuitBreaker = new CircuitBreaker({
                name: `resilient:${agent.name || 'agent'}`,
                failureThreshold: cb.failureThreshold ?? 5,
                resetTimeoutMs: cb.resetTimeoutMs ?? 30_000,
            });
            this.callTimeoutMs = cb.callTimeoutMs ?? 60_000;
        } else {
            this.circuitBreaker = null;
            this.callTimeoutMs = 60_000;
        }

        if (config.rateLimit !== false) {
            const rl = config.rateLimit ?? {};
            this.rateLimiter = new RateLimiter({
                name: `resilient:${agent.name || 'agent'}`,
                maxRequests: rl.maxRpm ?? 60,
                intervalMs: 60_000,
                // Strict RPM: no burst allowance, so `maxRpm` is a hard ceiling.
                burstCapacity: 0,
                overflowMode: 'reject',
            });
        } else {
            this.rateLimiter = null;
        }

        if (config.retry !== false) {
            const r = config.retry ?? {};
            this.retryPolicy = {
                maxAttempts: (r.maxRetries ?? 2) + 1,
                initialDelayMs: r.backoffMs ?? 500,
                maxDelayMs: r.maxBackoffMs ?? 5_000,
                multiplier: 2,
                jitter: true,
                retryOn: r.retryOn ?? isTransientLLMError,
            };
        } else {
            this.retryPolicy = null;
        }
    }

    /** Run with resilience: rate limit → circuit breaker → retry → per-call timeout → execute. */
    async run(prompt: string, options?: ResilientRunOptions): Promise<TResult> {
        const start = Date.now();
        this.totalRuns++;
        this.lastRunAt = new Date();

        // Pre-flight rate limit: consume a token up-front so a rejected call
        // never reaches the provider.
        if (this.rateLimiter && !this.rateLimiter.tryAcquire()) {
            this.totalFailures++;
            const retryAfterMs = this.rateLimiter.getTimeUntilAvailable();
            const err = new RateLimitError(this.name || 'agent', retryAfterMs);
            this.lastError = err.message;
            throw err;
        }

        const externalSignal = options?.signal;

        const executeOnce = (): Promise<TResult> =>
            withCallTimeout(this.callTimeoutMs, externalSignal, (signal) =>
                this.agent.run(prompt, { ...options, signal }),
            );

        const runInner = (): Promise<TResult> =>
            this.retryPolicy ? withRetry(executeOnce, this.retryPolicy) : executeOnce();

        try {
            let result: TResult;
            if (this.circuitBreaker) {
                const cbResult = await this.circuitBreaker.execute(runInner);
                if (!cbResult.success) throw cbResult.error ?? new Error('circuit breaker failed');
                result = cbResult.value as TResult;
            } else {
                result = await runInner();
            }
            this.totalLatencyMs += Date.now() - start;
            return result;
        } catch (error) {
            this.totalFailures++;
            this.totalLatencyMs += Date.now() - start;
            this.lastError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    async createSession(userId?: string): Promise<string> {
        if (this.agent.createSession) return this.agent.createSession(userId);
        throw new Error('Underlying agent does not support sessions');
    }

    async getSessionMessages(sessionId: string): Promise<unknown> {
        if (this.agent.getSessionMessages) return this.agent.getSessionMessages(sessionId);
        throw new Error('Underlying agent does not support sessions');
    }

    health(): HealthReport {
        const cbState = this.circuitBreaker?.getState();
        return {
            status: this.getHealthStatus(),
            circuitState: cbState ? CB_TO_HEALTH[cbState] : 'disabled',
            totalRuns: this.totalRuns,
            totalFailures: this.totalFailures,
            averageLatencyMs: this.totalRuns > 0 ? Math.round(this.totalLatencyMs / this.totalRuns) : 0,
            uptime: Date.now() - this.startTime,
            ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
            ...(this.lastRunAt !== undefined ? { lastRunAt: this.lastRunAt } : {}),
        };
    }

    private getHealthStatus(): 'healthy' | 'degraded' | 'unhealthy' {
        const state = this.circuitBreaker?.getState();
        if (state === CircuitState.OPEN) return 'unhealthy';
        if (state === CircuitState.HALF_OPEN) return 'degraded';
        if (this.totalRuns > 0 && this.totalFailures / this.totalRuns > 0.5) return 'degraded';
        return 'healthy';
    }
}

export function withResilience<TResult = unknown>(
    agent: WrappableAgent<TResult>,
    config?: ResilienceConfig,
): ResilientAgent<TResult> {
    return new ResilientAgent(agent, config);
}

export { CircuitOpenError, RateLimitError };
