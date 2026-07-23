/**
 * Internal inline type definitions for @personaforge/production.
 *
 * These are structural interfaces for external integrations (observability, Redis)
 * where we don't want to introduce a hard package dependency.
 * The production package is intentionally self-contained for these cross-cutting concerns.
 */

// ── Observability (structural — matches src/observability/types.ts) ──────────

export interface LogContext {
    readonly agentId?: string;
    readonly taskId?: string;
    readonly planId?: string;
    readonly executionId?: string;
    readonly sessionId?: string;
    readonly traceId?: string;
    readonly spanId?: string;
    readonly parentSpanId?: string;
}

export interface Logger {
    debug(message: string, context?: Partial<LogContext>, metadata?: Record<string, unknown>): void;
    info(message: string, context?: Partial<LogContext>, metadata?: Record<string, unknown>): void;
    warn(message: string, context?: Partial<LogContext>, metadata?: Record<string, unknown>): void;
    error(message: string, context?: Partial<LogContext>, metadata?: Record<string, unknown>): void;
    fatal(message: string, context?: Partial<LogContext>, metadata?: Record<string, unknown>): void;
    child(additionalContext: Partial<LogContext>): Logger;
}

export enum MetricType {
    COUNTER = 'counter',
    GAUGE = 'gauge',
    HISTOGRAM = 'histogram',
    SUMMARY = 'summary',
}

export interface MetricValue {
    readonly name: string;
    readonly type: MetricType;
    readonly value: number;
    readonly labels: Record<string, string>;
    readonly timestamp: Date;
}

export interface MetricsCollector {
    counter(name: string, value?: number, labels?: Record<string, string>): void;
    gauge(name: string, value: number, labels?: Record<string, string>): void;
    histogram(name: string, value: number, labels?: Record<string, string>): void;
    getMetrics(): MetricValue[];
    clear(): void;
}

// ── Redis (structural — minimal subset needed by redis-rate-limiter) ──────────

/** Minimal Redis client interface needed by RedisRateLimiter. */
export interface RedisRateLimitClient {
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    /**
     * Optional server-side script evaluation (ioredis `eval`). When present, the
     * limiter uses an atomic INCR+PEXPIRE Lua script; otherwise it falls back to
     * the (non-atomic) INCR-then-EXPIRE path.
     */
    eval?(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}
