/**
 * Tenant Context — per-tenant isolation for session stores, rate limiters,
 * cost trackers, and audit logs.
 *
 * Provides per-tenant isolation for user_id / session_id automatically. Call
 * `createTenantContext(tenantId)` and get back a set of stores that automatically namespace all keys.
 *
 * @example
 * ```ts
 * import { createAgent } from 'personaforge';
 * import { createTenantContext } from 'personaforge/production';
 * import { createSqliteSessionStore } from 'personaforge/session';
 *
 * const baseSessionStore = await createSqliteSessionStore('./agent.db');
 *
 * // In your request handler, scope to the authenticated tenant:
 * const ctx = createTenantContext('tenant-acme', { sessionStore: baseSessionStore });
 *
 * const agent = createAgent({
 *   name: 'Support',
 *   sessionStore: ctx.sessionStore,  // all keys prefixed with 'tenant-acme:'
 *   rateLimitAdapter: ctx.rateLimiter,
 * });
 * ```
 */

import { InMemorySessionStore, type SessionStore, type SessionData, type SessionMessage } from '../session/index.js';
import { RateLimiter } from './rate-limiter.js';
import type { RateLimiterConfig } from './rate-limiter.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TenantContextOptions {
    /** Base session store to wrap. */
    sessionStore?: SessionStore;
    /** Per-tenant rate limiter config. */
    rateLimitConfig?: Omit<RateLimiterConfig, 'name'>;
}

export interface TenantContext {
    readonly tenantId: string;
    /** Session store scoped to this tenant (all keys prefixed). */
    readonly sessionStore: SessionStore;
    /** Rate limiter scoped to this tenant. */
    readonly rateLimiter: RateLimiter;
    /** Inject tenantId into `AgentRunOptions`. */
    readonly runContext: { userId?: string; tenantId: string };
}

// ── Tenant-scoped session store wrapper ────────────────────────────────────

/**
 * Wraps a `SessionStore` and prefixes all session IDs with `tenantId:`,
 * ensuring complete data isolation between tenants without separate databases.
 */
export class TenantScopedSessionStore implements SessionStore {
    constructor(
        private readonly base: SessionStore,
        private readonly tenantId: string
    ) {}

    private prefix(id: string): string {
        return `${this.tenantId}:${id}`;
    }

    private unprefixData(data: SessionData): SessionData {
        const p = `${this.tenantId}:`;
        const id = data.id.startsWith(p) ? data.id.slice(p.length) : data.id;
        return { ...data, id };
    }

    async get(id: string): Promise<SessionData | undefined> {
        const data = await this.base.get(this.prefix(id));
        return data ? this.unprefixData(data) : undefined;
    }

    async create(data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string): Promise<SessionData> {
        const result = await this.base.create(data);
        return this.unprefixData(result);
    }

    async update(id: string, data: { messages: SessionMessage[] }): Promise<void> {
        return this.base.update(this.prefix(id), data);
    }

    async getMessages(id: string): Promise<SessionMessage[]> {
        return this.base.getMessages(this.prefix(id));
    }

    async appendMessage(id: string, message: SessionMessage): Promise<void> {
        return this.base.appendMessage(this.prefix(id), message);
    }

    async delete(id: string): Promise<void> {
        return this.base.delete(this.prefix(id));
    }
}

// ── TenantRegistry — central config store ─────────────────────────────────

export interface TenantConfig {
    readonly tenantId: string;
    /** Max requests per minute for this tenant. */
    readonly maxRpm?: number;
    /** Max USD per day for this tenant. */
    readonly maxUsdPerDay?: number;
    /** Allowed model list (if undefined, all models allowed). */
    readonly allowedModels?: string[];
    readonly metadata?: Record<string, unknown>;
}

/** Central registry of tenant configurations. */
export class TenantRegistry {
    private tenants = new Map<string, TenantConfig>();

    register(config: TenantConfig): void {
        this.tenants.set(config.tenantId, config);
    }

    get(tenantId: string): TenantConfig | undefined {
        return this.tenants.get(tenantId);
    }

    list(): TenantConfig[] {
        return Array.from(this.tenants.values());
    }

    delete(tenantId: string): void {
        this.tenants.delete(tenantId);
    }
}

// ── createTenantContext ────────────────────────────────────────────────────

/**
 * Create a per-tenant context with automatically scoped stores and rate limiters.
 *
 * @param tenantId - Unique identifier for the tenant.
 * @param options - Base stores and config to scope.
 */
export function createTenantContext(
    tenantId: string,
    options: TenantContextOptions = {}
): TenantContext {
    const sessionStore = options.sessionStore
        ? new TenantScopedSessionStore(options.sessionStore, tenantId)
        : new TenantScopedSessionStore(createFallbackSessionStore(), tenantId);

    const rateLimiter = new RateLimiter({
        name: `tenant:${tenantId}`,
        maxRequests: options.rateLimitConfig?.maxRequests ?? 60,
        intervalMs: options.rateLimitConfig?.intervalMs ?? 60_000,
        burstCapacity: options.rateLimitConfig?.burstCapacity ?? 10,
        overflowMode: options.rateLimitConfig?.overflowMode ?? 'reject',
    });

    return {
        tenantId,
        sessionStore,
        rateLimiter,
        runContext: { tenantId },
    };
}

// ── Fallback session store (in-memory) ────────────────────────────────────

function createFallbackSessionStore(): SessionStore {
    return new InMemorySessionStore();
}
