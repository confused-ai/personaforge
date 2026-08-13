/**
 * Enterprise Gateway — declarative, policy-enforced, multi-tenant HTTP gateway
 * for personaforge agents.
 *
 * One config turns on auth, RBAC, tenancy, budget, rate limiting, and durable
 * audit — plus a compliance dashboard that boards and auditors love.
 *
 * @example
 * ```ts
 * import { createEnterpriseGateway } from 'personaforge/gateway';
 * import { apiKeyAuth } from 'personaforge/runtime';
 * import { createSqliteAuditStore } from 'personaforge/production';
 *
 * const gateway = createEnterpriseGateway({
 *   agents: { support, billing },
 *   auth: apiKeyAuth(['sk-prod-abc']),
 *   tenants: [
 *     {
 *       id: 'acme',
 *       monthlyBudgetUsd: 500,
 *       maxRpm: 60,
 *       allowedAgents: ['support'],
 *       rbac: { support: ['role:admin'] },
 *     },
 *   ],
 *   policy: { monthlyBudgetUsd: 5000, requestTimeoutMs: 60_000 },
 *   auditStore: createSqliteAuditStore('./audit.db'),
 * });
 *
 * await gateway.start(8787);
 * ```
 */

import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CreateAgentResult } from '../create-agent.js';
import { createAuthMiddleware, sendForbidden, type AuthContext } from '../runtime/auth.js';
import { hasRole, type JwtPayload } from '../runtime/jwt-rbac.js';
import { InMemoryAuditStore, type AuditEntry, type AuditStore } from '../production/audit-store.js';
import { RateLimiter } from '../production/rate-limiter.js';
import { generateComplianceReport } from './compliance.js';
import type {
    ComplianceReport,
    EnterpriseGateway,
    EnterpriseGatewayConfig,
} from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeAgents(
    agents: EnterpriseGatewayConfig['agents'],
): Record<string, CreateAgentResult> {
    if (Array.isArray(agents)) {
        const out: Record<string, CreateAgentResult> = {};
        for (const { name, agent } of agents) out[name] = agent;
        return out;
    }
    return agents;
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on('data', (c: Buffer | string) => {
            const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
            total += chunk.byteLength;
            if (total > maxBytes) {
                req.destroy();
                reject(Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE' }));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function forwardedClientIp(req: IncomingMessage): string | undefined {
    const forwarded = firstHeaderValue(req.headers['x-forwarded-for']);
    return forwarded?.split(',')[0]?.trim() || undefined;
}

function getClientIp(req: IncomingMessage, trustProxy: boolean): string | undefined {
    return trustProxy
        ? (forwardedClientIp(req) || req.socket.remoteAddress || undefined)
        : (req.socket.remoteAddress || undefined);
}

function sendJson(res: ServerResponse, status: number, body: unknown, cors?: string): void {
    if (cors) res.setHeader('Access-Control-Allow-Origin', cors);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(status);
    res.end(JSON.stringify(body));
}

// ── Gateway factory ─────────────────────────────────────────────────────────

export function createEnterpriseGateway(config: EnterpriseGatewayConfig): EnterpriseGateway {
    const map = normalizeAgents(config.agents);
    const tenants = config.tenants ?? [];
    const tenantMap = new Map(tenants.map((t) => [t.id, t]));
    const policy = config.policy ?? {};
    const cors = config.cors;
    const trustProxy = policy.trustProxy ?? false;
    const maxBodyBytes = policy.maxBodyBytes ?? 1_048_576;
    const exposeErrors = policy.exposeErrors ?? false;
    const frameworks = config.complianceFrameworks ?? ['SOC2', 'HIPAA'];

    // Accept either a declarative AuthMiddlewareOptions config object or a
    // ready-made middleware from apiKeyAuth() / bearerAuth() / createAuthMiddleware().
    type AuthFn = (req: IncomingMessage, res: ServerResponse) => Promise<AuthContext | null>;
    const authMiddleware: AuthFn | null = config.auth
        ? (typeof config.auth === 'function'
            ? (config.auth as AuthFn)
            : createAuthMiddleware(config.auth))
        : null;
    const auditStore: AuditStore = config.auditStore ?? new InMemoryAuditStore();
    const tenantResolution = config.tenantResolution ?? { mode: 'auto' };

    // Global rate limiter (per-identity) — hard cap, no burst
    const globalLimiter = policy.maxRpm
        ? new RateLimiter({ name: 'gateway-global', maxRequests: policy.maxRpm, intervalMs: 60_000, burstCapacity: 0 })
        : null;

    // Per-tenant rate limiters — hard cap, no burst
    const tenantLimiters = new Map<string, RateLimiter>();
    const concurrencyLimiter = config.maxConcurrency ? new Semaphore(config.maxConcurrency) : null;
    for (const t of tenants) {
        if (t.maxRpm) {
            tenantLimiters.set(t.id, new RateLimiter({ name: `gateway-tenant-${t.id}`, maxRequests: t.maxRpm, intervalMs: 60_000, burstCapacity: 0 }));
        }
    }

    // Budget tracking (in-memory; extend with a durable store for production)
    const budgetSpend = new Map<string, { day: string; month: string; usd: number }>();
    let globalSpend = { day: '', month: '', usd: 0 };

    const today = () => new Date().toISOString().slice(0, 10);
    const thisMonth = () => new Date().toISOString().slice(0, 7);

    function recordSpend(tenantId: string | undefined, usd: number): void {
        const day = today();
        const month = thisMonth();
        if (tenantId) {
            const cur = budgetSpend.get(tenantId) ?? { day: '', month: '', usd: 0 };
            if (cur.day !== day) cur.day = day;
            if (cur.month !== month) cur.month = month;
            cur.usd += usd;
            budgetSpend.set(tenantId, cur);
        }
        if (globalSpend.day !== day) globalSpend.day = day;
        if (globalSpend.month !== month) globalSpend.month = month;
        globalSpend.usd += usd;
    }

    function getTenantSpend(tenantId: string): number {
        return budgetSpend.get(tenantId)?.usd ?? 0;
    }

    function checkBudget(tenantId: string | undefined): { allowed: boolean; reason?: string } {
        const day = today();
        const month = thisMonth();

        // Global caps
        if (policy.monthlyBudgetUsd && globalSpend.month === month && globalSpend.usd >= policy.monthlyBudgetUsd) {
            return { allowed: false, reason: 'Global monthly budget exceeded' };
        }
        if (policy.dailyBudgetUsd && globalSpend.day === day && globalSpend.usd >= policy.dailyBudgetUsd) {
            return { allowed: false, reason: 'Global daily budget exceeded' };
        }

        // Tenant caps
        if (tenantId) {
            const t = tenantMap.get(tenantId);
            if (t) {
                const spend = getTenantSpend(tenantId);
                if (t.monthlyBudgetUsd && spend >= t.monthlyBudgetUsd) {
                    return { allowed: false, reason: `Tenant '${tenantId}' monthly budget exceeded` };
                }
                if (t.dailyBudgetUsd && spend >= t.dailyBudgetUsd) {
                    return { allowed: false, reason: `Tenant '${tenantId}' daily budget exceeded` };
                }
            }
        }
        return { allowed: true };
    }

    // ── Tenant resolution ────────────────────────────────────────────────
    function resolveTenant(req: IncomingMessage, claims?: Record<string, unknown>): string | undefined {
        switch (tenantResolution.mode) {
            case 'header': {
                const header = tenantResolution.header ?? 'x-tenant-id';
                return firstHeaderValue(req.headers[header.toLowerCase()]);
            }
            case 'claim': {
                const claim = tenantResolution.claim ?? 'tenantId';
                const val = claims?.[claim];
                return typeof val === 'string' ? val : undefined;
            }
            case 'auto':
            default: {
                // Try header first, then claim
                const headerVal = firstHeaderValue(req.headers['x-tenant-id']);
                if (headerVal) return headerVal;
                const claimVal = claims?.['tenantId'] ?? claims?.['tenant_id'];
                return typeof claimVal === 'string' ? claimVal : undefined;
            }
        }
    }

    // ── Compliance report ─────────────────────────────────────────────────
    async function getComplianceReport(): Promise<ComplianceReport> {
        const auditCount = await auditStore.count().catch(() => 0);
        return generateComplianceReport(config, tenants, auditCount, globalSpend.usd, frameworks);
    }

    // ── Dashboard HTML ────────────────────────────────────────────────────
    function getDashboardHtml(report: ComplianceReport): string {
        const statusColor = report.overallStatus === 'pass' ? '#2d6a4f' : report.overallStatus === 'warn' ? '#b58900' : '#8b2c2c';
        const rows = report.controls.map((c) => `
            <tr>
                <td>${c.id}</td>
                <td>${c.name}</td>
                <td><span class="badge">${c.framework}</span></td>
                <td><span class="status ${c.status}">${c.status.toUpperCase()}</span></td>
                <td>${c.detail}</td>
            </tr>`).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>personaforge Enterprise Gateway — Compliance</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#0f1117;color:#e0e0e8;padding:32px}
h1{font-size:24px;margin-bottom:8px}
.sub{color:#888;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:32px}
.card{background:#1a1c2a;border-radius:8px;padding:20px}
.card .label{color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.card .value{font-size:28px;font-weight:700}
.card .value.pass{color:#2d6a4f}
.card .value.warn{color:#b58900}
.card .value.fail{color:#8b2c2c}
.overall{display:inline-block;padding:8px 20px;border-radius:6px;font-weight:700;font-size:16px;margin-bottom:24px;background:${statusColor};color:#fff}
table{width:100%;border-collapse:collapse;background:#1a1c2a;border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:12px 16px;border-bottom:1px solid #2a2d3a;font-size:13px}
th{color:#888;text-transform:uppercase;font-size:11px;letter-spacing:.05em}
.badge{background:#2a2d3a;padding:2px 8px;border-radius:4px;font-size:11px;color:#a0a4b8}
.status{font-weight:700;font-size:11px}
.status.pass{color:#2d6a4f}
.status.warn{color:#b58900}
.status.fail{color:#8b2c2c}
</style>
</head>
<body>
<h1>Enterprise Gateway — Compliance Dashboard</h1>
<div class="sub">Generated ${new Date(report.generatedAt).toLocaleString()}</div>
<div class="overall">${report.overallStatus.toUpperCase()}</div>
<div class="cards">
    <div class="card"><div class="label">Passing Controls</div><div class="value pass">${report.passCount}</div></div>
    <div class="card"><div class="label">Warnings</div><div class="value warn">${report.warnCount}</div></div>
    <div class="card"><div class="label">Failures</div><div class="value fail">${report.failCount}</div></div>
    <div class="card"><div class="label">Tenants</div><div class="value">${report.tenantCount}</div></div>
    <div class="card"><div class="label">Agents</div><div class="value">${report.agentCount}</div></div>
    <div class="card"><div class="label">Audit Entries</div><div class="value">${report.auditEntries}</div></div>
    <div class="card"><div class="label">Budget Used</div><div class="value">$${report.budgetUsageUsd.toFixed(2)}</div></div>
</div>
<table>
<tr><th>ID</th><th>Control</th><th>Framework</th><th>Status</th><th>Detail</th></tr>
${rows}
</table>
</body>
</html>`;
    }

    // ── HTTP server ──────────────────────────────────────────────────────
    let server: http.Server | null = null;
    let boundPort = 0;

    const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const path = url.pathname;
        const method = req.method ?? 'GET';
        const rid = firstHeaderValue(req.headers['x-request-id']) || randomUUID();
        res.setHeader('X-Request-ID', rid);

        // CORS preflight
        if (cors && method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', cors);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Tenant-Id, X-Request-Id, Authorization');
            res.writeHead(204);
            res.end();
            return;
        }

        // Auth
        let authIdentity: string | undefined;
        let authClaims: Record<string, unknown> | undefined;
        if (authMiddleware) {
            const ctx = await authMiddleware(req, res);
            if (!ctx) return;
            authIdentity = ctx.identity;
            authClaims = ctx.claims;
        }

        // Resolve tenant
        const tenantId = resolveTenant(req, authClaims);
        const tenant = tenantId ? tenantMap.get(tenantId) : undefined;

        // Rate limiting
        if (globalLimiter && !globalLimiter.tryAcquire()) {
            sendJson(res, 429, { error: 'Too many requests' }, cors);
            return;
        }
        if (tenantId && tenantLimiters.has(tenantId) && !tenantLimiters.get(tenantId)!.tryAcquire()) {
            sendJson(res, 429, { error: 'Tenant rate limit exceeded' }, cors);
            return;
        }

        // Budget check
        const budget = checkBudget(tenantId);
        if (!budget.allowed) {
            sendJson(res, 429, { error: budget.reason }, cors);
            return;
        }

        // ── Compliance endpoints ─────────────────────────────────────────
        if (path === '/compliance' || path === '/compliance/report') {
            const report = await getComplianceReport();
            if (path === '/compliance' && config.complianceDashboard !== false) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.writeHead(200);
                res.end(getDashboardHtml(report));
                return;
            }
            sendJson(res, 200, report, cors);
            return;
        }

        if (path === '/compliance/tenants') {
            sendJson(res, 200, { tenants }, cors);
            return;
        }

        // ── Health ───────────────────────────────────────────────────────
        if (method === 'GET' && (path === '/health' || path === '/v1/health')) {
            sendJson(res, 200, { status: 'ok', service: 'personaforge-gateway', time: new Date().toISOString() }, cors);
            return;
        }

        // ── Agent listing ────────────────────────────────────────────────
        if (method === 'GET' && (path === '/v1/agents' || path === '/agents')) {
            const list = Object.keys(map).map((name) => ({ name }));
            sendJson(res, 200, { agents: list }, cors);
            return;
        }

        // ── Chat ─────────────────────────────────────────────────────────
        if (method === 'POST' && (path === '/v1/chat' || path === '/chat')) {
            let raw: string;
            try { raw = await readBody(req, maxBodyBytes); }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code === 'BODY_TOO_LARGE') {
                    sendJson(res, 413, { error: 'Request body too large' }, cors);
                    return;
                }
                throw e;
            }
            let body: { message?: string; agent?: string; sessionId?: string; userId?: string; stream?: boolean };
            try { body = raw ? (JSON.parse(raw) as typeof body) : {}; }
            catch { sendJson(res, 400, { error: 'Invalid JSON' }, cors); return; }

            const agentName = body.agent ?? Object.keys(map)[0];
            if (!agentName || !map[agentName]) {
                sendJson(res, 400, { error: 'Unknown or missing agent' }, cors);
                return;
            }

            // Tenant agent allowlist
            if (tenant?.allowedAgents && !tenant.allowedAgents.includes(agentName)) {
                sendJson(res, 403, { error: `Agent '${agentName}' not allowed for tenant '${tenantId}'` }, cors);
                return;
            }

            // Tenant RBAC
            if (tenant?.rbac?.[agentName]) {
                const required = tenant.rbac[agentName]!;
                const jwtPayload = authClaims?.['jwtPayload'] as JwtPayload | undefined;
                if (!jwtPayload || !hasRole(jwtPayload, required)) {
                    sendForbidden(res, `Insufficient role for agent '${agentName}'. Required: ${required.join(' | ')}`);
                    return;
                }
            }

            if (!body.message || typeof body.message !== 'string') {
                sendJson(res, 400, { error: 'Missing "message" string' }, cors);
                return;
            }

            const agent = map[agentName]!;
            const sessionId = body.sessionId ?? (await agent.createSession(body.userId));
            const start = Date.now();

            try {
                const execFn = () => agent.run(body.message, { sessionId, userId: body.userId });
                const result = await (concurrencyLimiter
                    ? concurrencyLimiter.withLock(execFn)
                    : execFn()
                );
                const durationMs = Date.now() - start;
                const costUsd = (result.usage?.totalTokens ?? 0) * 0.00001; // rough estimate

                recordSpend(tenantId, costUsd);

                const entry: AuditEntry = {
                    id: rid,
                    timestamp: new Date().toISOString(),
                    method,
                    path,
                    status: 200,
                    agentName,
                    sessionId,
                    userId: body.userId ?? authIdentity,
                    tenantId,
                    promptHash: createHash('sha256').update(body.message).digest('hex'),
                    finishReason: result.finishReason,
                    durationMs,
                    costUsd,
                    ip: getClientIp(req, trustProxy),
                };
                await auditStore.append(entry).catch(() => {});

                if (config.runStore) {
                    trackRun(config.runStore, {
                        runId: rid,
                        agentId: agentName,
                        tenantId: body.tenantId ?? tenantId,
                        userId: body.userId,
                        sessionId,
                        model: result.model,
                    }, () => Promise.resolve(result)).catch(() => {});
                }
                sendJson(res, 200, {
                    id: rid,
                    agent: agentName,
                    sessionId,
                    text: result.text,
                    steps: result.steps,
                    finishReason: result.finishReason,
                }, cors);
            } catch (e) {
                const entry: AuditEntry = {
                    id: rid,
                    timestamp: new Date().toISOString(),
                    method,
                    path,
                    status: 500,
                    agentName,
                    sessionId,
                    userId: body.userId ?? authIdentity,
                    tenantId,
                    promptHash: createHash('sha256').update(body.message).digest('hex'),
                    durationMs: Date.now() - start,
                    ip: getClientIp(req, trustProxy),
                };
                await auditStore.append(entry).catch(() => {});
                if (config.runStore) {
                    config.runStore.save({
                        runId: rid,
                        agentId: agentName,
                        tenantId: body.tenantId ?? tenantId,
                        userId: body.userId,
                        sessionId,
                        status: 'failed',
                        startTime: new Date(start).toISOString(),
                        endTime: new Date().toISOString(),
                        durationMs: Date.now() - start,
                        error: e instanceof Error ? e.message : String(e),
                    }).catch(() => {});
                }
                sendJson(res, 500, { error: exposeErrors ? (e instanceof Error ? e.message : String(e)) : 'Agent run failed' }, cors);
            }
            return;
        }

        // ── Sessions ─────────────────────────────────────────────────────
        if (config.sessionStore && method === 'GET' && (path === '/v1/sessions' || path === '/sessions')) {
            const userId = url.searchParams.get('userId') ?? undefined;
            const store = config.sessionStore as unknown as { listByUser?: (id: string) => Promise<unknown[]> };
            const sessions = typeof store.listByUser === 'function' && userId ? await store.listByUser(userId) : [];
            sendJson(res, 200, { sessions }, cors);
            return;
        }

        sendJson(res, 404, { error: 'Not found' }, cors);
    };

    return {
        get server() { return server!; },
        get port() { return boundPort; },
        async start(port: number) {
            server = http.createServer((req, res) => { handler(req, res).catch(() => { if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' }); }); });
            await new Promise<void>((resolve) => server!.listen(port, resolve));
            boundPort = port;
        },
        async stop(drainTimeoutMs = 30_000) {
            if (!server) return;
            await new Promise<void>((resolve, reject) => {
                server!.close((err) => (err ? reject(err) : resolve()));
                setTimeout(resolve, drainTimeoutMs);
            });
            server = null;
        },
        getComplianceReport,
    };
}

export * from './types.js';
export { generateComplianceReport } from './compliance.js';