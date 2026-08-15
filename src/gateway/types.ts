/**
 * Enterprise Gateway — declarative, policy-enforced, multi-tenant HTTP gateway
 * for personaforge agents.
 *
 * Turns the framework's scattered production primitives (auth, RBAC, tenancy,
 * budget, rate limiting, audit) into a single declarative configuration with a
 * built-in compliance dashboard.
 *
 * @packageDocumentation
 */

import type { CreateAgentResult } from '../create-agent.js';
import type { AuthMiddlewareOptions, AuthContext } from '../runtime/auth.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuditStore } from '../production/audit-store.js';
import type { SessionStore } from '../session/types.js';

// ── Tenant ──────────────────────────────────────────────────────────────────

/** A tenant registered with the gateway. */
export interface GatewayTenant {
    /** Unique tenant identifier. */
    readonly id: string;
    /** Human-readable display name. */
    readonly name?: string;
    /** Per-tenant monthly budget cap in USD. */
    readonly monthlyBudgetUsd?: number;
    /** Per-tenant daily budget cap in USD. */
    readonly dailyBudgetUsd?: number;
    /** Per-tenant request rate limit (requests per minute). */
    readonly maxRpm?: number;
    /** Allowed model list (if undefined, all models allowed). */
    readonly allowedModels?: string[];
    /** Allowed agent names (if undefined, all agents allowed). */
    readonly allowedAgents?: string[];
    /** RBAC: agent name → required roles. */
    readonly rbac?: Record<string, string[]>;
    /** Arbitrary metadata. */
    readonly metadata?: Record<string, unknown>;
}

// ── Policy ──────────────────────────────────────────────────────────────────

/** Global gateway policy applied to all tenants. */
export interface GatewayPolicy {
    /** Global monthly budget cap in USD across all tenants. */
    readonly monthlyBudgetUsd?: number;
    /** Global daily budget cap in USD across all tenants. */
    readonly dailyBudgetUsd?: number;
    /** Global request rate limit (requests per minute). */
    readonly maxRpm?: number;
    /** Maximum request body size in bytes. Default: 1 MB. */
    readonly maxBodyBytes?: number;
    /** Per-request timeout in milliseconds. */
    readonly requestTimeoutMs?: number;
    /** Whether to expose raw error messages. Default: false. */
    readonly exposeErrors?: boolean;
    /** Whether to trust X-Forwarded-For. Default: false. */
    readonly trustProxy?: boolean;
}

// ── Compliance ──────────────────────────────────────────────────────────────

/** Compliance framework identifiers. */
export type ComplianceFramework = 'SOC2' | 'HIPAA' | 'GDPR' | 'ISO27001';

/** A single compliance control check result. */
export interface ComplianceControl {
    readonly id: string;
    readonly name: string;
    readonly framework: ComplianceFramework;
    readonly status: 'pass' | 'fail' | 'warn';
    readonly detail: string;
}

/** Compliance report snapshot. */
export interface ComplianceReport {
    readonly generatedAt: string;
    readonly overallStatus: 'pass' | 'fail' | 'warn';
    readonly passCount: number;
    readonly failCount: number;
    readonly warnCount: number;
    readonly controls: ComplianceControl[];
    readonly tenantCount: number;
    readonly agentCount: number;
    readonly auditEntries: number;
    readonly budgetUsageUsd: number;
}

// ── Gateway config ──────────────────────────────────────────────────────────

/** How to resolve the tenant for a request. */
export type TenantResolution =
    | { mode: 'header'; header?: string }
    | { mode: 'claim'; claim?: string }
    | { mode: 'auto' };

/** Auth middleware signature produced by `apiKeyAuth()` / `bearerAuth()` / `createAuthMiddleware()`. */
export type GatewayAuthMiddleware = (req: IncomingMessage, res: ServerResponse) => Promise<AuthContext | null>;

export interface EnterpriseGatewayConfig {
    /** One or more named agents to expose. */
    agents: Record<string, CreateAgentResult> | Array<{ name: string; agent: CreateAgentResult }>;
    /**
     * Authentication for all non-public endpoints.
     * Pass either an `AuthMiddlewareOptions` config object (declarative) or a
     * ready-made middleware from `apiKeyAuth()` / `bearerAuth()` / `createAuthMiddleware()`.
     */
    auth?: AuthMiddlewareOptions | GatewayAuthMiddleware;
    /** Registered tenants. */
    tenants?: GatewayTenant[];
    /** Global policy applied to all tenants. */
    policy?: GatewayPolicy;
    /** How to resolve the tenant for a request. */
    tenantResolution?: TenantResolution;
    /** Durable audit store. Defaults to in-memory. */
    auditStore?: AuditStore;
    /** Session store for session CRUD endpoints. */
    sessionStore?: SessionStore;
    /** CORS origin. */
    cors?: string;
    /** Bind host. Default: '0.0.0.0'. */
    host?: string;
    /** Compliance frameworks to report against. Default: ['SOC2', 'HIPAA']. */
    complianceFrameworks?: ComplianceFramework[];
    /** Enable the compliance dashboard at `/compliance`. Default: true. */
    complianceDashboard?: boolean;
    /** Enable the admin API. */
    adminApi?: import('../runtime/admin.js').AdminApiOptions;
    /** WebSocket transport. */
    websocket?: boolean;
    /** Maximum concurrent agent executions. Default: no limit (0 = unlimited). */
    maxConcurrency?: number;
    /** Persistent run store — records every agent execution metadata. */
    runStore?: import('../production/run-store.js').RunStore;
}

// ── Gateway runtime ─────────────────────────────────────────────────────────

export interface EnterpriseGateway {
    /** Start the gateway on the given port. */
    start(port: number): Promise<void>;
    /** Stop the gateway, draining in-flight requests. */
    stop(drainTimeoutMs?: number): Promise<void>;
    /** Get the latest compliance report. */
    getComplianceReport(): Promise<ComplianceReport>;
    /** Get the underlying Node HTTP server. */
    readonly server: import('node:http').Server;
    /** The port the gateway is bound to. */
    readonly port: number;
}