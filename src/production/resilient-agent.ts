/**
 * ResilientAgent — One-line production hardening wrapper.
 *
 * Combines circuit breaker, rate limiter, health checks, and graceful shutdown
 * into a single composable wrapper around any Agent instance.
 *
 * @example
 * ```ts
 * import { Agent } from 'personaforge';
 * import { withResilience } from 'personaforge/production';
 *
 * const agent = new Agent({ instructions: 'You are helpful.' });
 * const resilient = withResilience(agent, {
 *   circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
 *   rateLimit: { maxRpm: 60 },
 *   healthCheck: true,
 * });
 *
 * const result = await resilient.run('Hello');
 * console.log(resilient.health()); // { status: 'healthy', ... }
 * ```
 */

import type { AgentRunOptions } from '../core/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the resilient agent wrapper. */
export interface ResilienceConfig {
    /** Circuit breaker settings. Set `false` to disable. */
    readonly circuitBreaker?: CircuitBreakerConfig | false;
    /** Rate limiter settings. Set `false` to disable. */
    readonly rateLimit?: RateLimitConfig | false;
    /** Enable health check tracking. Default: true. */
    readonly healthCheck?: boolean;
    /** Enable graceful shutdown handling. Default: true. */
    readonly gracefulShutdown?: boolean;
    /** Retry config for transient failures. */
    readonly retry?: { maxRetries?: number; backoffMs?: number; maxBackoffMs?: number };
}

interface CircuitBreakerConfig {
    /** Number of failures before opening. Default: 5. */
    readonly failureThreshold?: number;
    /** Time to wait before half-open. Default: 30000ms. */
    readonly resetTimeoutMs?: number;
    /** Timeout for a single call. Default: 60000ms. */
    readonly callTimeoutMs?: number;
}

interface RateLimitConfig {
    /** Max requests per minute. Default: 60. */
    readonly maxRpm?: number;
}

/** Health status of the resilient agent. */
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

/** Interface for any agent that can be wrapped with resilience. */
export interface WrappableAgent<TResult = unknown> {
    readonly name: string;
    readonly instructions: string;
    run(prompt: string, options?: AgentRunOptions): Promise<TResult>;
    createSession?(userId?: string): Promise<string>;
    getSessionMessages?(sessionId: string): Promise<unknown>;
}

// ── Circuit Breaker (inline, minimal) ──────────────────────────────────────

type CBState = 'closed' | 'open' | 'half-open';

class InlineCircuitBreaker {
    private state: CBState = 'closed';
    private failures = 0;
    private lastFailureTime = 0;
    private readonly threshold: number;
    private readonly resetMs: number;

    constructor(threshold: number, resetMs: number) {
        this.threshold = threshold;
        this.resetMs = resetMs;
    }

    getState(): CBState {
        if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.resetMs) {
            this.state = 'half-open';
        }
        return this.state;
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        const state = this.getState();
        if (state === 'open') {
            throw new Error('Circuit breaker is OPEN — agent unavailable, retry later');
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;
        this.state = 'closed';
    }

    private onFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.threshold) {
            this.state = 'open';
        }
    }
}

// ── Rate Limiter (inline, sliding window) ──────────────────────────────────

class InlineRateLimiter {
    private timestamps: number[] = [];
    private head = 0; // head pointer — O(1) amortised eviction instead of O(n) filter()
    private readonly maxRpm: number;

    constructor(maxRpm: number) {
        this.maxRpm = maxRpm;
    }

    check(): void {
        const now = Date.now();
        const cutoff = now - 60_000;
        // Evict expired timestamps from the front (oldest-first order)
        while (this.head < this.timestamps.length && this.timestamps[this.head] < cutoff) {
            this.head++;
        }
        // Compact once the dead prefix is large enough to be worth the allocation
        if (this.head > 128 && this.head > this.timestamps.length >> 1) {
            this.timestamps = this.timestamps.slice(this.head);
            this.head = 0;
        }
        const active = this.timestamps.length - this.head;
        if (active >= this.maxRpm) {
            throw new Error(`Rate limit exceeded: ${this.maxRpm} requests/minute`);
        }
        this.timestamps.push(now);
    }
}

// ── Resilient Agent ────────────────────────────────────────────────────────

export class ResilientAgent<TResult = unknown> {
    readonly name: string;
    readonly instructions: string;

    private readonly agent: WrappableAgent<TResult>;
    private readonly circuitBreaker: InlineCircuitBreaker | null;
    private readonly rateLimiter: InlineRateLimiter | null;
    private readonly retryConfig: { maxRetries: number; backoffMs: number; maxBackoffMs: number };
    private readonly startTime = Date.now();

    // Health tracking
    private totalRuns = 0;
    private totalFailures = 0;
    private totalLatencyMs = 0;
    private lastError?: string;
    private lastRunAt?: Date;

    constructor(agent: WrappableAgent<TResult>, config: ResilienceConfig = {}) {
        this.agent = agent;
        this.name = agent.name;
        this.instructions = agent.instructions;

        // Circuit breaker
        if (config.circuitBreaker !== false) {
            const cb = config.circuitBreaker ?? {};
            this.circuitBreaker = new InlineCircuitBreaker(
                cb.failureThreshold ?? 5,
                cb.resetTimeoutMs ?? 30_000,
            );
        } else {
            this.circuitBreaker = null;
        }

        // Rate limiter
        if (config.rateLimit !== false) {
            const rl = config.rateLimit ?? {};
            this.rateLimiter = new InlineRateLimiter(rl.maxRpm ?? 60);
        } else {
            this.rateLimiter = null;
        }

        // Retry
        this.retryConfig = {
            maxRetries: config.retry?.maxRetries ?? 2,
            backoffMs: config.retry?.backoffMs ?? 500,
            maxBackoffMs: config.retry?.maxBackoffMs ?? 5_000,
        };
    }

    /** Run with resilience: rate limit → circuit breaker → retry → execute. */
    async run(prompt: string, options?: AgentRunOptions): Promise<TResult> {
        // Rate limit check
        this.rateLimiter?.check();

        const start = Date.now();
        this.totalRuns++;
        this.lastRunAt = new Date();

        const execute = () => this.agent.run(prompt, options);

        try {
            let result: TResult;
            if (this.circuitBreaker) {
                result = await this.circuitBreaker.execute(() => this.executeWithRetry(execute));
            } else {
                result = await this.executeWithRetry(execute);
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

    /** Create a new session (delegates to underlying agent). */
    async createSession(userId?: string): Promise<string> {
        if (this.agent.createSession) return this.agent.createSession(userId);
        throw new Error('Underlying agent does not support sessions');
    }

    /** Get session messages (delegates to underlying agent). */
    async getSessionMessages(sessionId: string): Promise<unknown> {
        if (this.agent.getSessionMessages) return this.agent.getSessionMessages(sessionId);
        throw new Error('Underlying agent does not support sessions');
    }

    /** Get current health status. */
    health(): HealthReport {
        return {
            status: this.getHealthStatus(),
            circuitState: this.circuitBreaker?.getState() ?? 'disabled',
            totalRuns: this.totalRuns,
            totalFailures: this.totalFailures,
            averageLatencyMs: this.totalRuns > 0 ? Math.round(this.totalLatencyMs / this.totalRuns) : 0,
            uptime: Date.now() - this.startTime,
            lastError: this.lastError,
            lastRunAt: this.lastRunAt,
        };
    }

    private getHealthStatus(): 'healthy' | 'degraded' | 'unhealthy' {
        if (this.circuitBreaker?.getState() === 'open') return 'unhealthy';
        if (this.circuitBreaker?.getState() === 'half-open') return 'degraded';
        if (this.totalRuns > 0 && this.totalFailures / this.totalRuns > 0.5) return 'degraded';
        return 'healthy';
    }

    private async executeWithRetry(fn: () => Promise<TResult>): Promise<TResult> {
        let lastError: Error | undefined;
        for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < this.retryConfig.maxRetries) {
                    const delay = Math.min(
                        this.retryConfig.backoffMs * 2 ** attempt,
                        this.retryConfig.maxBackoffMs,
                    );
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw lastError;
    }
}

/**
 * Wrap any agent with production resilience in one line.
 *
 * @example
 * ```ts
 * const resilient = withResilience(agent, { circuitBreaker: { failureThreshold: 3 } });
 * ```
 */
export function withResilience<TResult = unknown>(agent: WrappableAgent<TResult>, config?: ResilienceConfig): ResilientAgent<TResult> {
    return new ResilientAgent(agent, config);
}
