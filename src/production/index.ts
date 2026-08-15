/**
 * @personaforge/production — Production-grade runtime, resilience, and control-plane
 * utilities for personaforge agents.
 */

// ── Primitive types ──────────────────────────────────────────────────────────
export * from './types.js';

// ── Resilience patterns ──────────────────────────────────────────────────────
export {
    CircuitBreaker,
    CircuitState,
    CircuitOpenError,
    createLLMCircuitBreaker,
} from './circuit-breaker.js';
export type { CircuitBreakerConfig, CircuitBreakerResult } from './circuit-breaker.js';

export {
    RateLimiter,
    RateLimitError,
    createOpenAIRateLimiter,
} from './rate-limiter.js';
export type { RateLimiterConfig } from './rate-limiter.js';

export { RedisRateLimiter } from './redis-rate-limiter.js';
export type { RedisRateLimiterConfig } from './redis-rate-limiter.js';

// ── Health checks ────────────────────────────────────────────────────────────
export {
    HealthCheckManager,
    HealthStatus,
    createLLMHealthCheck,
    createSessionStoreHealthCheck,
    createCustomHealthCheck,
    createHttpHealthCheck,
} from './health.js';
export type {
    HealthCheckConfig,
    HealthCheckResult,
    HealthComponent,
    ComponentHealth,
} from './health.js';

// ── Graceful shutdown ────────────────────────────────────────────────────────
export {
    GracefulShutdown,
    createGracefulShutdown,
    withShutdownGuard,
} from './graceful-shutdown.js';
export type { GracefulShutdownConfig, CleanupHandler, ShutdownEvent } from './graceful-shutdown.js';

// ── Resumable streaming ──────────────────────────────────────────────────────
export {
    ResumableStreamManager,
    formatSSE,
    createResumableStream,
} from './resumable-stream.js';
export type {
    StreamCheckpoint,
    ResumableStreamConfig,
    StreamChunkSSE,
} from './resumable-stream.js';

// ── Budget enforcement ───────────────────────────────────────────────────────
export {
    BudgetEnforcer,
    BudgetExceededError,
    InMemoryBudgetStore,
    estimateCostUsd,
} from './budget.js';
export type { BudgetConfig, BudgetStore } from './budget.js';

// ── Checkpointing ────────────────────────────────────────────────────────────
export {
    InMemoryCheckpointStore,
    SqliteCheckpointStore,
    createSqliteCheckpointStore,
} from './checkpoint.js';
export type { AgentCheckpointStore } from './checkpoint.js';

// ── Idempotency ──────────────────────────────────────────────────────────────
export {
    InMemoryIdempotencyStore,
    SqliteIdempotencyStore,
    createSqliteIdempotencyStore,
} from './idempotency.js';
export type {
    IdempotencyStore,
    IdempotencyOptions,
    IdempotencyEntry,
    IdempotencyState,
    IdempotencyReservation,
} from './idempotency.js';

// ── Audit store ──────────────────────────────────────────────────────────────
export {
    InMemoryAuditStore,
    SqliteAuditStore,
    createSqliteAuditStore,
} from './audit-store.js';
export type { AuditStore, AuditEntry, AuditFilter } from './audit-store.js';

// ── Feedback store ───────────────────────────────────────────────────────────
export {
    InMemoryFeedbackStore,
    FeedbackEntrySchema,
} from './feedback-store.js';
export type { FeedbackEntry, FeedbackFilter, FeedbackStore } from './feedback-store.js';

// ── Postgres stores ──────────────────────────────────────────────────────────
export {
    PostgresAuditStore,
    PostgresCheckpointStore,
    createPostgresAuditStore,
    createPostgresCheckpointStore,
} from './postgres-stores.js';
export type { PgQueryable } from './postgres-stores.js';

// ── Cascade delete ───────────────────────────────────────────────────────────
export { deleteSession } from './cascade-delete.js';
export type { CascadeDeleteDeps, CascadeDeleteResult } from './cascade-delete.js';

// ── Approval store ───────────────────────────────────────────────────────────
export {
    InMemoryApprovalStore,
    SqliteApprovalStore,
    createSqliteApprovalStore,
    waitForApproval,
    requireApprovalTool,
    ApprovalRejectedError,
} from './approval-store.js';
export type {
    ApprovalStore,
    HitlRequest,
    ApprovalDecision,
    ApprovalStatus,
    RequireApprovalToolOptions,
} from './approval-store.js';

// ── Resilient agent wrapper ──────────────────────────────────────────────────
export { ResilientAgent, withResilience } from './resilient-agent.js';
export type { ResilienceConfig, HealthReport } from './resilient-agent.js';

// ── Per-tenant isolation ─────────────────────────────────────────────────────
export {
    TenantScopedSessionStore,
    TenantRegistry,
    createTenantContext,
} from './tenant.js';
export type { TenantConfig, TenantContext, TenantContextOptions } from './tenant.js';
export {
    InMemoryRunStore,
    SqliteRunStore,
} from './run-store.js';
export type { RunStore, RunRecord, RunStatus, RunFilter } from './run-store.js';
export { createSqliteRunStore } from './run-store.js';
export { PostgresRunStore, createPostgresRunStore } from './postgres-stores.js';

// ── Component versioning ─────────────────────────────────────────────────────
export {
    ComponentRegistry,
    defaultComponentRegistry,
} from './component-registry.js';
export type { Component, ComponentVersion, ComponentType, ComponentStatus, RegisterComponentInput } from './component-registry.js';

// -- Concurrency ----------------------------------------------------------------
export { Semaphore, ConcurrencyLimiter } from './concurrency.js';

// -- Run tracking ---------------------------------------------------------------
export { trackRun, toRunStatus } from './run-tracking.js';
export type { TrackRunContext, TrackRunResult } from './run-tracking.js';

export {
    FrameworkError,
    TransientError,
    PermanentError,
    TimeoutError,
    NetworkError,
    AuthError,
    ValidationError,
    NotFoundError,
    ConfigError,
    TenantError,
    TenantQuotaExceededError,
    TenantBudgetExceededError,
    GuardrailError,
    InternalError,
    ErrorCode,
} from './errors.js';
export type { ErrorSeverity } from './errors.js';
