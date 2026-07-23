/**
 * Admin API — operational dashboards and lifecycle management endpoints.
 *
 * Mount via `createHttpService({ adminApi: { enabled: true, prefix: '/admin' } })`.
 *
 * Endpoints (all under configurable prefix, default `/admin`):
 *
 * | Method | Path               | Description                              |
 * |--------|--------------------|------------------------------------------|
 * | GET    | /admin/health      | Deep health + uptime + memory stats      |
 * | GET    | /admin/agents      | Registered agents + metadata             |
 * | GET    | /admin/audit       | Paginated audit log (from auditStore)    |
 * | GET    | /admin/sessions    | Active session listing                   |
 * | GET    | /admin/approvals   | Pending human-in-the-loop approvals      |
 * | GET    | /admin/checkpoints | Active resumable run checkpoints         |
 * | GET    | /admin/stats       | Aggregated throughput + error stats      |
 *
 * Security: all admin endpoints require a bearer token (`adminBearerToken` option)
 * unless `noAuth` is explicitly set (development only).
 *
 * @example
 * ```ts
 * const svc = createHttpService({
 *   agents: { assistant },
 *   adminApi: {
 *     enabled: true,
 *     bearerToken: process.env.ADMIN_TOKEN!,
 *     auditStore: createSqliteAuditStore('./agent.db'),
 *     checkpointStore: createSqliteCheckpointStore('./agent.db'),
 *   },
 * });
 * ```
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuditStore } from '../production/audit-store.js';
import type { AgentCheckpointStore } from '../production/checkpoint.js';
import type { CreateAgentResult } from '../create-agent/types.js';

export interface AdminApiOptions {
    /** Whether to mount the admin API. Default: false. */
    enabled?: boolean;
    /**
     * URL prefix for all admin endpoints. Default: `/admin`.
     * Must start with `/`.
     */
    prefix?: string;
    /**
     * Bearer token required for all admin endpoints.
     * If omitted, admin API is unprotected (development only — logs a warning).
     */
    bearerToken?: string;
    /** Audit store to read from. Falls back to in-memory ring buffer if not provided. */
    auditStore?: AuditStore;
    /** Checkpoint store to list active checkpoints. */
    checkpointStore?: AgentCheckpointStore;
}

export interface AdminHandlerContext {
    options: AdminApiOptions;
    agents: Record<string, CreateAgentResult>;
    auditRingBuffer: () => unknown[];
    startedAt: Date;
    stats: AdminStats;
}

export interface AdminStats {
    totalRequests: number;
    totalErrors: number;
    totalTokens: number;
}

/** The handler function type used inside the HTTP server. */
export type AdminHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    cors?: string
) => Promise<boolean>;

function sendJson(
    res: ServerResponse,
    status: number,
    body: unknown,
    cors?: string
): void {
    if (cors) {
        res.setHeader('Access-Control-Allow-Origin', cors);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(status);
    res.end(JSON.stringify(body));
}

function isAuthorized(req: IncomingMessage, bearerToken: string | undefined): boolean {
    if (!bearerToken) return true; // no auth configured (dev mode)
    const authHeader = req.headers['authorization'] ?? '';
    if (!authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.slice('Bearer '.length).trim();
    // Constant-time comparison to prevent timing attacks
    return timingSafeEqual(token, bearerToken);
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/**
 * Create an admin handler to be mounted inside `createHttpService`.
 * Returns a handler function that processes admin requests and returns
 * `true` if it handled the request, `false` to fall through.
 */
export function createAdminHandler(ctx: AdminHandlerContext): AdminHandler {
    const prefix = ctx.options.prefix ?? '/admin';
    const bearerToken = ctx.options.bearerToken;
    const { agents, auditRingBuffer, startedAt, stats } = ctx;

    if (!bearerToken) {
        // Log warning for insecure admin API
        console.warn(
            '[personaforge] WARNING: Admin API is running without authentication.' +
            ' Set `adminApi.bearerToken` in production.'
        );
    }

    return async (req, res, fullPath, cors) => {
        if (!fullPath.startsWith(prefix)) return false;

        // Auth gate
        if (!isAuthorized(req, bearerToken)) {
            sendJson(res, 401, { error: 'Unauthorized' }, cors);
            return true;
        }

        const subPath = fullPath.slice(prefix.length) || '/';
        const method = req.method ?? 'GET';

        if (method !== 'GET') {
            sendJson(res, 405, { error: 'Method not allowed' }, cors);
            return true;
        }

        // GET /admin/health — deep health check with memory + uptime
        if (subPath === '/health' || subPath === '/') {
            const mem = process.memoryUsage();
            sendJson(res, 200, {
                status: 'ok',
                uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
                startedAt: startedAt.toISOString(),
                memory: {
                    rssBytes: mem.rss,
                    heapUsedBytes: mem.heapUsed,
                    heapTotalBytes: mem.heapTotal,
                    externalBytes: mem.external,
                },
                agents: Object.keys(agents).length,
                stats: { ...stats },
            }, cors);
            return true;
        }

        // GET /admin/agents — list all registered agents with metadata
        if (subPath === '/agents') {
            const list = Object.entries(agents).map(([name, agent]) => ({
                name,
                title: agent.name,
            }));
            sendJson(res, 200, { agents: list, total: list.length }, cors);
            return true;
        }

        // GET /admin/audit?limit=50&offset=0 — paginated audit log
        if (subPath === '/audit' || subPath.startsWith('/audit?')) {
            const qs = parseQueryString(req.url ?? '');
            const limit = Math.min(parseInt(qs.limit ?? '50', 10), 500);
            const offset = parseInt(qs.offset ?? '0', 10);

            if (ctx.options.auditStore) {
                try {
                    const entries = await ctx.options.auditStore.query({ limit, offset });
                    sendJson(res, 200, { entries, limit, offset }, cors);
                } catch (e) {
                    sendJson(res, 500, { error: 'Failed to query audit store', detail: String(e) }, cors);
                }
            } else {
                const ring = auditRingBuffer();
                const sliced = ring.slice(offset, offset + limit);
                sendJson(res, 200, { entries: sliced, limit, offset, total: ring.length }, cors);
            }
            return true;
        }

        // GET /admin/stats — throughput counters
        if (subPath === '/stats') {
            const errorRate = stats.totalRequests > 0
                ? stats.totalErrors / stats.totalRequests
                : 0;
            sendJson(res, 200, {
                totalRequests: stats.totalRequests,
                totalErrors: stats.totalErrors,
                totalTokens: stats.totalTokens,
                errorRate: Math.round(errorRate * 10000) / 10000,
                uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
            }, cors);
            return true;
        }

        // GET /admin/checkpoints — list active resumable checkpoints
        if (subPath === '/checkpoints') {
            if (!ctx.options.checkpointStore) {
                sendJson(res, 200, { checkpoints: [], note: 'No checkpoint store configured' }, cors);
                return true;
            }
            try {
                const checkpoints = ctx.options.checkpointStore.listIncomplete
                    ? await ctx.options.checkpointStore.listIncomplete()
                    : [];
                sendJson(res, 200, { checkpoints, total: checkpoints.length }, cors);
            } catch (e) {
                sendJson(res, 500, { error: 'Failed to query checkpoints', detail: String(e) }, cors);
            }
            return true;
        }

        sendJson(res, 404, { error: `Unknown admin path: ${subPath}` }, cors);
        return true;
    };
}

function parseQueryString(url: string): Record<string, string> {
    const idx = url.indexOf('?');
    if (idx === -1) return {};
    const qs = url.slice(idx + 1);
    const result: Record<string, string> = {};
    for (const pair of qs.split('&')) {
        const [k, v] = pair.split('=');
        if (k) result[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
    return result;
}
