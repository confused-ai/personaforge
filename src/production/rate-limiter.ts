/**
 * Token-bucket rate limiting for external APIs
 *
 * Token bucket algorithm for controlling request rates to external APIs.
 * Supports:
 * - Per-agent and per-tool rate limits
 * - Configurable burst capacity
 * - Backpressure modes (queue or reject)
 * - Metrics integration
 */

import type { MetricsCollector } from './_types.js';
import { AgentError, ErrorCode, type ErrorCodeType } from '../shared/index.js';

/** Rate limiter configuration */
export interface RateLimiterConfig {
    /** Unique name for this limiter (for metrics/logging) */
    readonly name: string;
    /** Maximum requests per interval (default: 60) */
    readonly maxRequests: number;
    /** Interval in milliseconds (default: 60000 = 1 minute) */
    readonly intervalMs?: number;
    /** Burst capacity beyond maxRequests (default: 10) */
    readonly burstCapacity?: number;
    /** Action when limit reached: 'reject' throws, 'queue' waits (default: 'reject') */
    readonly overflowMode?: 'reject' | 'queue';
    /** Max queue size when mode is 'queue' (default: 100) */
    readonly maxQueueSize?: number;
    /** Max wait time in queue before rejection in ms (default: 30000) */
    readonly maxQueueWaitMs?: number;
    /** Optional metrics collector */
    readonly metrics?: MetricsCollector;
}

/** Rate limit exceeded error */
export class RateLimitError extends AgentError {
    readonly limiterName: string;
    readonly retryAfterMs: number;

    constructor(name: string, retryAfterMs: number) {
        super(`Rate limit exceeded for '${name}'. Retry after ${retryAfterMs}ms`, {
            code: ErrorCode.RATE_LIMITED as ErrorCodeType,
            retryable: true,
            context: { limiterName: name, retryAfterMs },
        });
        this.name = 'RateLimitError';
        this.limiterName = name;
        this.retryAfterMs = retryAfterMs;
        Object.setPrototypeOf(this, RateLimitError.prototype);
    }
}

/** Queued request */
interface QueuedRequest<T> {
    readonly fn: () => Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (error: Error) => void;
    readonly enqueuedAt: number;
}

/**
 * Token bucket rate limiter with optional request queuing.
 *
 * @example
 * const limiter = new RateLimiter({
 *   name: 'openai-api',
 *   maxRequests: 100,
 *   intervalMs: 60000, // 100 requests per minute
 *   overflowMode: 'queue',
 * });
 *
 * const result = await limiter.execute(() => openai.chat(...));
 */
export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private queue: QueuedRequest<unknown>[] = [];
    private processing = false;

    private readonly config: Required<Omit<RateLimiterConfig, 'metrics'>> &
        Pick<RateLimiterConfig, 'metrics'>;

    constructor(config: RateLimiterConfig) {
        this.config = {
            name: config.name,
            maxRequests: config.maxRequests,
            intervalMs: config.intervalMs ?? 60_000,
            burstCapacity: config.burstCapacity ?? Math.ceil(config.maxRequests * 0.1),
            overflowMode: config.overflowMode ?? 'reject',
            maxQueueSize: config.maxQueueSize ?? 100,
            maxQueueWaitMs: config.maxQueueWaitMs ?? 30_000,
            metrics: config.metrics,
        };

        this.tokens = this.config.maxRequests + this.config.burstCapacity;
        this.lastRefill = Date.now();
    }

    /** Get current available tokens (floored to an integer count). */
    getAvailableTokens(): number {
        this.refillTokens();
        return Math.floor(this.tokens);
    }

    /** Get current queue size */
    getQueueSize(): number {
        return this.queue.length;
    }

    /** Check if a request can be made immediately */
    canProceed(): boolean {
        this.refillTokens();
        return this.tokens >= 1;
    }

    /** Get time until next token available in ms */
    getTimeUntilAvailable(): number {
        if (this.tokens >= 1) return 0;

        const tokenRefillRate = this.config.intervalMs / this.config.maxRequests;
        const timeSinceLastRefill = Date.now() - this.lastRefill;
        return Math.max(0, tokenRefillRate - timeSinceLastRefill);
    }

    /**
     * Execute a function through the rate limiter.
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        this.refillTokens();

        if (this.tokens >= 1) {
            this.tokens--;
            this.recordMetric('rate_limiter_allowed', 1);
            return fn();
        }

        if (this.config.overflowMode === 'queue') {
            return this.enqueue(fn);
        }

        const retryAfterMs = this.getTimeUntilAvailable();
        this.recordMetric('rate_limiter_rejected', 1);
        throw new RateLimitError(this.config.name, retryAfterMs);
    }

    /**
     * Try to acquire a token without executing anything.
     * Returns true if token acquired, false otherwise.
     */
    tryAcquire(): boolean {
        this.refillTokens();
        if (this.tokens >= 1) {
            this.tokens--;
            return true;
        }
        return false;
    }

    /** Get rate limiter statistics */
    getStats(): {
        availableTokens: number;
        queueSize: number;
        maxRequests: number;
        intervalMs: number;
    } {
        return {
            availableTokens: this.getAvailableTokens(),
            queueSize: this.queue.length,
            maxRequests: this.config.maxRequests,
            intervalMs: this.config.intervalMs,
        };
    }

    // --- Private methods ---

    private refillTokens(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const maxTokens = this.config.maxRequests + this.config.burstCapacity;

        // Token refill rate: tokens per ms
        const refillRate = this.config.maxRequests / this.config.intervalMs;
        const tokensToAdd = elapsed * refillRate;

        this.tokens = Math.min(maxTokens, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }

    private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
        if (this.queue.length >= this.config.maxQueueSize) {
            this.recordMetric('rate_limiter_queue_full', 1);
            throw new RateLimitError(
                this.config.name,
                this.getTimeUntilAvailable()
            );
        }

        this.recordMetric('rate_limiter_queued', 1);

        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                fn: fn as () => Promise<unknown>,
                resolve: resolve as (value: unknown) => void,
                reject,
                enqueuedAt: Date.now(),
            });

            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            this.refillTokens();

            if (this.tokens < 1) {
                // Wait for a token
                await this.waitForToken();
                continue;
            }

            const request = this.queue.shift()!;
            const waitTime = Date.now() - request.enqueuedAt;

            if (waitTime > this.config.maxQueueWaitMs) {
                request.reject(
                    new RateLimitError(this.config.name, this.getTimeUntilAvailable())
                );
                this.recordMetric('rate_limiter_queue_timeout', 1);
                continue;
            }

            this.tokens--;
            this.recordMetric('rate_limiter_dequeued', 1, {
                wait_time_ms: String(waitTime),
            });

            try {
                const result = await request.fn();
                request.resolve(result);
            } catch (error) {
                request.reject(error as Error);
            }
        }

        this.processing = false;
    }

    private async waitForToken(): Promise<void> {
        const waitTime = this.getTimeUntilAvailable();
        await new Promise(resolve => setTimeout(resolve, Math.max(waitTime, 10)));
    }

    private recordMetric(
        name: string,
        value: number,
        labels: Record<string, string> = {}
    ): void {
        this.config.metrics?.counter(`${this.config.name}.${name}`, value, {
            limiter: this.config.name,
            ...labels,
        });
    }
}

/**
 * Create a rate limiter with defaults for OpenAI API (RPM limits).
 */
export function createOpenAIRateLimiter(
    tier: 'free' | 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'tier5' = 'tier1',
    options?: Partial<RateLimiterConfig>
): RateLimiter {
    const tierLimits: Record<string, number> = {
        free: 3,
        tier1: 60,
        tier2: 100,
        tier3: 500,
        tier4: 5000,
        tier5: 10000,
    };

    return new RateLimiter({
        name: 'openai-api',
        maxRequests: tierLimits[tier] ?? 60,
        intervalMs: 60_000,
        overflowMode: 'queue',
        ...options,
    });
}
