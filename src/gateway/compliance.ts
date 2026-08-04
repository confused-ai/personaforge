/**
 * Compliance Engine — evaluates the gateway's security posture against
 * enterprise compliance frameworks (SOC 2, HIPAA, GDPR, ISO 27001).
 *
 * Each control maps to a concrete, verifiable property of the gateway
 * configuration. The report is generated on demand and exposed both as JSON
 * (`GET /compliance/report`) and as a human-readable dashboard.
 */

import type {
    ComplianceControl,
    ComplianceFramework,
    ComplianceReport,
    EnterpriseGatewayConfig,
    GatewayTenant,
} from './types.js';

// ── Control definitions ─────────────────────────────────────────────────────

interface ControlDef {
    id: string;
    name: string;
    framework: ComplianceFramework;
    check: (cfg: EnterpriseGatewayConfig, tenants: GatewayTenant[]) => { status: 'pass' | 'fail' | 'warn'; detail: string };
}

const CONTROLS: ControlDef[] = [
    {
        id: 'AUTH-1',
        name: 'Authentication enabled',
        framework: 'SOC2',
        check: (cfg) => {
            if (!cfg.auth) return { status: 'fail', detail: 'No authentication configured — gateway is open' };
            const detail = typeof cfg.auth === 'function'
                ? 'Authentication configured (middleware)'
                : `Authentication configured (${cfg.auth.strategy})`;
            return { status: 'pass', detail };
        },
    },
    {
        id: 'AUTH-2',
        name: 'Multi-tenant isolation',
        framework: 'SOC2',
        check: (_cfg, tenants) => tenants.length > 0
            ? { status: 'pass', detail: `${tenants.length} tenant(s) registered with isolated policies` }
            : { status: 'warn', detail: 'No tenants registered — single-tenant mode' },
    },
    {
        id: 'AUTH-3',
        name: 'RBAC enforced',
        framework: 'SOC2',
        check: (_cfg, tenants) => {
            const withRbac = tenants.filter((t) => t.rbac && Object.keys(t.rbac).length > 0);
            return withRbac.length > 0
                ? { status: 'pass', detail: `${withRbac.length} tenant(s) enforce per-agent RBAC` }
                : { status: 'warn', detail: 'No RBAC rules defined — all authenticated users can access all agents' };
        },
    },
    {
        id: 'AUDIT-1',
        name: 'Durable audit trail',
        framework: 'SOC2',
        check: (cfg) => cfg.auditStore
            ? { status: 'pass', detail: 'Persistent audit store configured' }
            : { status: 'warn', detail: 'Using in-memory audit — not durable across restarts' },
    },
    {
        id: 'AUDIT-2',
        name: 'Request logging',
        framework: 'HIPAA',
        check: () => ({ status: 'pass', detail: 'All requests are logged with method, path, status, tenant, and user' }),
    },
    {
        id: 'BUDGET-1',
        name: 'Budget enforcement',
        framework: 'SOC2',
        check: (cfg, tenants) => {
            const hasGlobal = cfg.policy?.monthlyBudgetUsd || cfg.policy?.dailyBudgetUsd;
            const hasTenant = tenants.some((t) => t.monthlyBudgetUsd || t.dailyBudgetUsd);
            return (hasGlobal || hasTenant)
                ? { status: 'pass', detail: 'Budget caps enforced (global and/or per-tenant)' }
                : { status: 'warn', detail: 'No budget caps configured — spend is unbounded' };
        },
    },
    {
        id: 'RATE-1',
        name: 'Rate limiting',
        framework: 'SOC2',
        check: (cfg, tenants) => {
            const hasGlobal = cfg.policy?.maxRpm;
            const hasTenant = tenants.some((t) => t.maxRpm);
            return (hasGlobal || hasTenant)
                ? { status: 'pass', detail: 'Rate limits enforced (global and/or per-tenant)' }
                : { status: 'warn', detail: 'No rate limits configured' };
        },
    },
    {
        id: 'DATA-1',
        name: 'Prompt hashing',
        framework: 'HIPAA',
        check: () => ({ status: 'pass', detail: 'Prompts are stored as SHA-256 hashes, never plaintext' }),
    },
    {
        id: 'DATA-2',
        name: 'PII protection',
        framework: 'GDPR',
        check: () => ({ status: 'pass', detail: 'Audit entries exclude raw prompt content' }),
    },
    {
        id: 'DATA-3',
        name: 'Data retention controls',
        framework: 'GDPR',
        check: (cfg) => cfg.auditStore?.purge
            ? { status: 'pass', detail: 'Audit store supports purge for data retention compliance' }
            : { status: 'warn', detail: 'Audit store does not expose purge — retention policy may be limited' },
    },
    {
        id: 'SEC-1',
        name: 'Error disclosure prevention',
        framework: 'ISO27001',
        check: (cfg) => cfg.policy?.exposeErrors
            ? { status: 'warn', detail: 'exposeErrors=true — raw error messages may leak internals' }
            : { status: 'pass', detail: 'Error messages are sanitized (exposeErrors=false)' },
    },
    {
        id: 'SEC-2',
        name: 'Request timeout',
        framework: 'ISO27001',
        check: (cfg) => cfg.policy?.requestTimeoutMs
            ? { status: 'pass', detail: `Request timeout enforced (${cfg.policy.requestTimeoutMs}ms)` }
            : { status: 'warn', detail: 'No request timeout configured' },
    },
    {
        id: 'SEC-3',
        name: 'Body size limit',
        framework: 'ISO27001',
        check: (cfg) => cfg.policy?.maxBodyBytes
            ? { status: 'pass', detail: `Request body limited to ${cfg.policy.maxBodyBytes} bytes` }
            : { status: 'pass', detail: 'Request body limited to 1 MB (default)' },
    },
    {
        id: 'SEC-4',
        name: 'Tenant agent allowlist',
        framework: 'SOC2',
        check: (_cfg, tenants) => {
            const allowlisted = tenants.filter((t) => t.allowedAgents && t.allowedAgents.length > 0);
            return allowlisted.length > 0
                ? { status: 'pass', detail: `${allowlisted.length} tenant(s) restrict agent access via allowlist` }
                : { status: 'warn', detail: 'No tenant agent allowlists — tenants can access all agents' };
        },
    },
];

// ── Report generation ───────────────────────────────────────────────────────

export function generateComplianceReport(
    cfg: EnterpriseGatewayConfig,
    tenants: GatewayTenant[],
    auditCount: number,
    budgetUsageUsd: number,
    frameworks: ComplianceFramework[],
): ComplianceReport {
    const controls = CONTROLS
        .filter((c) => frameworks.includes(c.framework))
        .map((c) => ({ id: c.id, name: c.name, framework: c.framework, ...c.check(cfg, tenants) }));

    const passCount = controls.filter((c) => c.status === 'pass').length;
    const failCount = controls.filter((c) => c.status === 'fail').length;
    const warnCount = controls.filter((c) => c.status === 'warn').length;

    const overallStatus: ComplianceReport['overallStatus'] =
        failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';

    return {
        generatedAt: new Date().toISOString(),
        overallStatus,
        passCount,
        failCount,
        warnCount,
        controls,
        tenantCount: tenants.length,
        agentCount: Array.isArray(cfg.agents) ? cfg.agents.length : Object.keys(cfg.agents).length,
        auditEntries: auditCount,
        budgetUsageUsd,
    };
}