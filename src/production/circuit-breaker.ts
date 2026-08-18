/**
 * Circuit breaker for failing dependencies (LLM, tools, external APIs)
 *
 * Prevents cascading failures by tracking error rates and temporarily
 * blocking calls to failing services. Supports:
 * - Configurable failure thresholds
 * - Automatic recovery with half-open state
 * - Metrics integration for observability
 * - Event callbacks for monitoring
 */

import type { MetricsCollector } from './_types.js';
import { AgentError, ErrorCode, type ErrorCodeType } from '../shared/index.js';

/** Circuit breaker states */
export enum CircuitState {
    /** Normal operation - requests pass through */
    CLOSED = 'CLOSED',
    /** Circuit tripped - requests are rejected immediately */
    OPEN = 'OPEN',
    /** Testing recovery - limited requests allowed */
    HALF_OPEN = 'HALF_OPEN',
}

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
    /** Unique name for this circuit (for metrics/logging) */
    readonly name: string;
    /** Number of failures before opening circuit (default: 5) */
    readonly failureThreshold?: number;
    /** Number of successes in half-open before closing (default: 2) */
    readonly successThreshold?: number;
    /**
     * Alias for `successThreshold`. Number of consecutive successes required
     * in the HALF_OPEN state before the circuit transitions back to CLOSED.
     * When both are set, `halfOpenSuccessThreshold` takes precedence.
     * Default: 2.
     */
    readonly halfOpenSuccessThreshold?: number;
    /** Time in ms before attempting recovery (default: 30000) */
    readonly resetTimeoutMs?: number;
    /** Time window in ms for counting failures (default: 60000) */
    readonly failureWindowMs?: number;
    /** Optional metrics collector for observability */
    readonly metrics?: MetricsCollector;
    /** Callback when state changes */
    readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/** Circuit breaker execution result */
export interface CircuitBreakerResult<T> {
    readonly success: boolean;
    readonly value?: T;
    readonly error?: Error;
    readonly state: CircuitState;
    readonly executionTimeMs: number;
}

/** Error thrown when circuit is open */
export class CircuitOpenError extends AgentError {
    readonly circuitName: string;
    readonly state: CircuitState;
    readonly resetAt: Date;

    constructor(name: string, resetAt: Date) {
        super(`Circuit '${name}' is OPEN. Retry after ${resetAt.toISOString()}`, {
            code: ErrorCode.CIRCUIT_OPEN as ErrorCodeType,
            retryable: true,
            context: { circuitName: name, resetAt: resetAt.toISOString() },
        });
        this.name = 'CircuitOpenError';
        this.circuitName = name;
        this.state = CircuitState.OPEN;
        this.resetAt = resetAt;
        Object.setPrototypeOf(this, CircuitOpenError.prototype);
    }
}

/** Failure record for sliding window */
/** Number of fixed time-buckets covering the failure window. */
const FAILURE_BUCKETS = 60;

/**
 * Circuit Breaker implementation with sliding window failure tracking.
 *
 * @example
 * const breaker = new CircuitBreaker({
 *   name: 'openai-api',
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30000,
 * });
 *
 * const result = await breaker.execute(() => openai.chat(...));
 * if (result.success) {
 *   console.log(result.value);
 * } else {
 *   console.error('Blocked or failed:', result.error);
 * }
 */
export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    // Fixed-size ring of failure counts — O(1) memory + O(1) amortised writes
    // and O(FAILURE_BUCKETS) reads, regardless of failure rate.
    // ponytail: stored `Error` objects are dropped (nothing read them); add a
    //           parallel ring of last-N errors only when a consumer needs it.
    private readonly failureBuckets: number[] = new Array<number>(FAILURE_BUCKETS).fill(0);
    private bucketStart = Date.now();   // ms timestamp aligned to failureBuckets[last]
    private bucketWidthMs = 0;          // lazily initialised from config.failureWindowMs
    private successCount = 0;
    private lastFailureTime = 0;
    private openedAt = 0;

    private readonly config: Required<
        Omit<CircuitBreakerConfig, 'metrics' | 'onStateChange'>
    > & Pick<CircuitBreakerConfig, 'metrics' | 'onStateChange'>;

    constructor(config: CircuitBreakerConfig) {
        this.config = {
            name: config.name,
            failureThreshold: config.failureThreshold ?? 5,
            successThreshold: config.halfOpenSuccessThreshold ?? config.successThreshold ?? 2,
            halfOpenSuccessThreshold: config.halfOpenSuccessThreshold ?? config.successThreshold ?? 2,
            resetTimeoutMs: config.resetTimeoutMs ?? 30_000,
            failureWindowMs: config.failureWindowMs ?? 60_000,
            metrics: config.metrics,
            onStateChange: config.onStateChange,
        };
    }

    /** Get current circuit state */
    getState(): CircuitState {
        return this.state;
    }

    /** Get circuit name */
    getName(): string {
        return this.config.name;
    }

    /** Check if circuit allows requests */
    isAllowed(): boolean {
        this.checkStateTransition();
        return this.state !== CircuitState.OPEN;
    }

    /** Get time until circuit resets (if open) */
    getResetTime(): Date | null {
        if (this.state !== CircuitState.OPEN) return null;
        return new Date(this.openedAt + this.config.resetTimeoutMs);
    }

    /**
     * Execute a function through the circuit breaker.
     * Tracks success/failure and manages state transitions.
     */
    async execute<T>(fn: () => Promise<T>): Promise<CircuitBreakerResult<T>> {
        const startTime = Date.now();

        // Check if we should allow this request
        this.checkStateTransition();

        if (this.state === CircuitState.OPEN) {
            const resetAt = this.getResetTime() ?? new Date(Date.now() + this.config.resetTimeoutMs);
            this.recordMetric('circuit_rejected', 1);
            return {
                success: false,
                error: new CircuitOpenError(this.config.name, resetAt),
                state: this.state,
                executionTimeMs: Date.now() - startTime,
            };
        }

        try {
            const value = await fn();
            this.recordSuccess();
            return {
                success: true,
                value,
                state: this.state,
                executionTimeMs: Date.now() - startTime,
            };
        } catch (error) {
            this.recordFailure(error as Error);
            return {
                success: false,
                error: error as Error,
                state: this.state,
                executionTimeMs: Date.now() - startTime,
            };
        }
    }

    /** Force reset the circuit to closed state */
    reset(): void {
        this.transitionTo(CircuitState.CLOSED);
        this.failureBuckets.fill(0);
        this.bucketStart = Date.now();
        this.successCount = 0;
        this.lastFailureTime = 0;
        this.openedAt = 0;
    }

    /** Get current failure count within window */
    getFailureCount(): number {
        this.advanceBuckets();
        let total = 0;
        for (let i = 0; i < FAILURE_BUCKETS; i++) total += this.failureBuckets[i]!;
        return total;
    }

    /** Get circuit statistics */
    getStats(): {
        state: CircuitState;
        failureCount: number;
        successCount: number;
        lastFailure: Date | null;
    } {
        return {
            state: this.state,
            failureCount: this.getFailureCount(),
            successCount: this.successCount,
            lastFailure: this.lastFailureTime > 0 ? new Date(this.lastFailureTime) : null,
        };
    }

    // --- Private methods ---

    private checkStateTransition(): void {
        const now = Date.now();

        if (this.state === CircuitState.OPEN) {
            // Check if reset timeout has passed
            if (now - this.openedAt >= this.config.resetTimeoutMs) {
                this.transitionTo(CircuitState.HALF_OPEN);
                this.successCount = 0;
            }
        }
    }

    private recordSuccess(): void {
        this.recordMetric('circuit_success', 1);

        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.config.successThreshold) {
                this.transitionTo(CircuitState.CLOSED);
                this.failureBuckets.fill(0);
                this.bucketStart = Date.now();
            }
        }
    }

    private recordFailure(error: Error): void {
        const now = Date.now();
        this.lastFailureTime = now;
        this.advanceBuckets(now);
        this.failureBuckets[FAILURE_BUCKETS - 1] = this.failureBuckets[FAILURE_BUCKETS - 1]! + 1;
        void error;                                     // metadata only — see class comment
        this.recordMetric('circuit_failure', 1);

        const failureCount = this.getFailureCount();

        if (this.state === CircuitState.HALF_OPEN) {
            // Any failure in half-open immediately opens
            this.transitionTo(CircuitState.OPEN);
            this.openedAt = now;
        } else if (this.state === CircuitState.CLOSED) {
            if (failureCount >= this.config.failureThreshold) {
                this.transitionTo(CircuitState.OPEN);
                this.openedAt = now;
            }
        }
    }

    /**
     * Slide the ring forward so the last bucket represents "now". Elapsed
     * buckets are zeroed. O(FAILURE_BUCKETS) worst-case (fixed → O(1)) and
     * O(1) on the hot path when no bucket boundary was crossed.
     */
    private advanceBuckets(now: number = Date.now()): void {
        if (this.bucketWidthMs === 0) {
            this.bucketWidthMs = Math.max(1, Math.floor(this.config.failureWindowMs / FAILURE_BUCKETS));
            this.bucketStart = now;
        }
        const elapsedBuckets = Math.floor((now - this.bucketStart) / this.bucketWidthMs);
        if (elapsedBuckets <= 0) return;
        if (elapsedBuckets >= FAILURE_BUCKETS) {
            this.failureBuckets.fill(0);
        } else {
            this.failureBuckets.copyWithin(0, elapsedBuckets);
            this.failureBuckets.fill(0, FAILURE_BUCKETS - elapsedBuckets);
        }
        this.bucketStart += elapsedBuckets * this.bucketWidthMs;
    }

    private transitionTo(newState: CircuitState): void {
        if (this.state === newState) return;

        const oldState = this.state;
        this.state = newState;

        this.recordMetric('circuit_state_change', 1, { from: oldState, to: newState });
        this.config.onStateChange?.(oldState, newState);
    }

    private recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
        this.config.metrics?.counter(`${this.config.name}.${name}`, value, {
            circuit: this.config.name,
            ...labels,
        });
    }
}

/**
 * Create a circuit breaker with common defaults for LLM providers.
 */
export function createLLMCircuitBreaker(
    name: string,
    options?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
    return new CircuitBreaker({
        name,
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeoutMs: 30_000,
        failureWindowMs: 60_000,
        ...options,
    });
}
