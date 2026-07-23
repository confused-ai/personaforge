/**
 * personaforge/guard — Production safety: budget, rate-limiting, circuit breakers, HITL.
 *
 * ```ts
 * import { budget, rateLimiter, circuitBreaker, approval } from 'personaforge/guard'
 * ```
 */

// ── Budget ──────────────────────────────────────────────────────────────────
export {
    BudgetEnforcer,
    BudgetExceededError,
    type BudgetConfig,
    type BudgetStore,
} from './production/budget.js';

// ── Rate Limiting ───────────────────────────────────────────────────────────
export {
    RateLimiter,
    RateLimitError,
    type RateLimiterConfig,
} from './production/rate-limiter.js';

// ── Circuit Breaker ─────────────────────────────────────────────────────────
export {
    CircuitBreaker,
    CircuitOpenError,
    CircuitState,
    type CircuitBreakerConfig,
    type CircuitBreakerResult,
} from './production/circuit-breaker.js';

// ── Human-in-the-Loop (HITL) ────────────────────────────────────────────────
export {
    InMemoryApprovalStore,
    ApprovalRejectedError,
    type ApprovalStore,
    type HitlRequest,
    type ApprovalDecision,
    type ApprovalStatus,
} from './production/approval-store.js';

// ── Guardrails (content safety) ─────────────────────────────────────────────
export * from './guardrails/index.js';

// ── Health Checks ───────────────────────────────────────────────────────────
export {
    HealthCheckManager,
    createLLMHealthCheck,
    createSessionStoreHealthCheck,
    createCustomHealthCheck,
    createHttpHealthCheck,
    type HealthCheckResult,
    type HealthCheckConfig,
} from './production/health.js';

// ── Multi-Tenancy ───────────────────────────────────────────────────────────
export type {
    TenantContext,
    TenantConfig,
    TenantContextOptions,
} from './production/tenant.js';

// ── Idempotency ─────────────────────────────────────────────────────────────
export {
    InMemoryIdempotencyStore,
    type IdempotencyStore,
    type IdempotencyOptions,
} from './production/idempotency.js';

// ── Audit ───────────────────────────────────────────────────────────────────
export {
    InMemoryAuditStore,
    type AuditStore,
    type AuditEntry,
    type AuditFilter,
} from './production/audit-store.js';

// ── Checkpoint ──────────────────────────────────────────────────────────────
export {
    InMemoryCheckpointStore,
    type AgentCheckpointStore,
} from './production/checkpoint.js';
