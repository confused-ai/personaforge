/**
 * Tenant context + key-namespacing utilities.
 *
 * All data stores (session, budget, cache, audit) MUST namespace their keys
 * using `tenantScopedKey()` to enforce hard isolation between tenants.
 *
 * @module
 */

import type { CacheStore } from './adapters.js';
import { BudgetExceededError } from './errors.js';

// ── TenantContext ──────────────────────────────────────────────────────────

export interface TenantBudgetConfig {
  /** Maximum USD spend per user per billing window. */
  maxUsdPerUser?: number;
  /** Maximum USD spend across the entire tenant per billing window. */
  maxUsdPerTenant?: number;
  /** Billing window in seconds (default: 30 days). */
  windowSeconds?: number;
}

export interface TenantRateLimitConfig {
  /** Max requests per window per user. */
  maxRequestsPerUser?: number;
  /** Max requests per window across the entire tenant. */
  maxRequestsPerTenant?: number;
  /** Window duration in milliseconds. */
  windowMs?: number;
}

/**
 * Resolved tenant context — attached to every agent run / HTTP request.
 * Enforced by session stores, budget enforcers, and rate limiters.
 */
export interface TenantContext {
  /** Stable tenant identifier (e.g. workspace ID, org ID). */
  tenantId: string;
  /** Authenticated user identifier within the tenant. */
  userId: string;
  /** Roles assigned to this user (used by requireRole middleware). */
  roles: string[];
  /** Optional per-tenant budget override. */
  budget?: TenantBudgetConfig;
  /** Optional per-tenant rate-limit override. */
  rateLimit?: TenantRateLimitConfig;
  /**
   * Optional model override — tenants can be pinned to a specific LLM.
   * e.g. `'gpt-4o-mini'` for a free tier.
   */
  modelOverride?: string;
  /**
   * Explicit tool allowlist for this tenant.
   * When set, the agent will only execute tools whose `name` appears in this list.
   * An empty array blocks ALL tool execution.
   * When `undefined` (default), all registered tools are permitted.
   */
  allowedTools?: string[];
}

// ── Key namespacing ────────────────────────────────────────────────────────

/**
 * Build a tenant-scoped storage key.
 *
 * All keys produced for a given tenant share the same prefix, making it
 * impossible for Tenant A to accidentally (or maliciously) access Tenant B's
 * data when the store implementation uses this helper consistently.
 *
 * @throws {Error} if tenantId or any part contains the `:` separator character,
 *   which would corrupt the key namespace hierarchy.
 *
 * @example
 * ```ts
 * const key = tenantScopedKey('t_acme', 'session', sessionId);
 * // → 'tenant:t_acme:session:<sessionId>'
 *
 * const budgetKey = tenantScopedKey('t_acme', 'budget', 'user', userId);
 * // → 'tenant:t_acme:budget:user:<userId>'
 * ```
 */
export function tenantScopedKey(tenantId: string, ...parts: string[]): string {
  // Validate separator: `:` in any segment would corrupt namespace hierarchy.
  if (tenantId.includes(':')) {
    throw new Error(`tenantScopedKey: tenantId must not contain ':' (got: "${tenantId}")`);
  }
  for (const part of parts) {
    if (part.includes(':')) {
      throw new Error(`tenantScopedKey: key part must not contain ':' (got: "${part}")`);
    }
  }
  return `tenant:${tenantId}:${parts.join(':')}`;
}

/**
 * Build a user-scoped key nested inside a tenant namespace.
 * Shorthand for `tenantScopedKey(tenantId, 'user', userId, ...parts)`.
 */
export function userScopedKey(tenantId: string, userId: string, ...parts: string[]): string {
  return tenantScopedKey(tenantId, 'user', userId, ...parts);
}

// ── TenantBudgetEnforcer ───────────────────────────────────────────────────

/**
 * Tracks and enforces per-user and per-tenant spend within a rolling window.
 *
 * @example
 * ```ts
 * const enforcer = new TenantBudgetEnforcer(tenantCtx, cacheStore);
 * await enforcer.check(estimatedCost);  // throws BudgetExceededError if exceeded
 * // ... run the LLM call ...
 * await enforcer.record(actualCost);
 * ```
 */
export class TenantBudgetEnforcer {
  private readonly userKey: string;
  private readonly tenantKey: string;
  private readonly windowSeconds: number;

  constructor(
    private readonly ctx: TenantContext,
    private readonly store: CacheStore,
  ) {
    this.userKey = userScopedKey(ctx.tenantId, ctx.userId, 'budget');
    this.tenantKey = tenantScopedKey(ctx.tenantId, 'budget');
    this.windowSeconds = ctx.budget?.windowSeconds ?? 30 * 24 * 3_600; // 30 days
  }

  /** Check whether `estimatedCostUsd` would exceed any configured limit. */
  async check(estimatedCostUsd: number): Promise<void> {
    // Corrupt store values (non-numbers) coerce to 0 via `?? 0` and poison
    // the sum to NaN, and `NaN > limit` is false — budgets would never trip.
    const toAmount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const [userSpent, tenantSpent] = await Promise.all([
      this.store.get(this.userKey).then(toAmount),
      this.store.get(this.tenantKey).then(toAmount),
    ]);

    const userLimit = this.ctx.budget?.maxUsdPerUser ?? Infinity;
    if (userSpent + estimatedCostUsd > userLimit) {
      throw new BudgetExceededError({
        limitUsd: userLimit,
        spentUsd: userSpent,
        scope: `user:${this.ctx.userId}`,
      });
    }

    const tenantLimit = this.ctx.budget?.maxUsdPerTenant ?? Infinity;
    if (tenantSpent + estimatedCostUsd > tenantLimit) {
      throw new BudgetExceededError({
        limitUsd: tenantLimit,
        spentUsd: tenantSpent,
        scope: `tenant:${this.ctx.tenantId}`,
      });
    }
  }

  /** Record `actualCostUsd` after a successful LLM call. */
  async record(actualCostUsd: number): Promise<void> {
    const [userSpent, tenantSpent] = await Promise.all([
      this.store.get(this.userKey).then((v) => (v as number | null) ?? 0),
      this.store.get(this.tenantKey).then((v) => (v as number | null) ?? 0),
    ]);

    await Promise.all([
      this.store.set(this.userKey, userSpent + actualCostUsd, this.windowSeconds),
      this.store.set(this.tenantKey, tenantSpent + actualCostUsd, this.windowSeconds),
    ]);
  }
}
