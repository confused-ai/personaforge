import type { CreateAgentResult } from '../create-agent.js';
import type { AuthMiddlewareOptions } from './auth.js';

export type RegisteredAgent = CreateAgentResult;

export interface CreateHttpServiceOptions {
    /** One or more named agents to expose. */
    agents: Record<string, RegisteredAgent> | Array<{ name: string; agent: RegisteredAgent }>;
    /** Collect basic request/audit events when true (in-memory, process-local). */
    tracing?: boolean;
    /** CORS: Access-Control-Allow-Origin. Use `*` for local UI dev. */
    cors?: string;
    /**
     * Authentication strategy for all non-public endpoints.
     * If omitted, the server runs without authentication (dev mode).
     * Use `apiKeyAuth([...])` or `bearerAuth(fn)` for production.
     *
     * @example
     * ```ts
     * import { apiKeyAuth } from 'personaforge/runtime';
     * createHttpService({ agents, auth: { strategy: 'api-key', keys: ['sk-prod-abc'] } });
     * ```
     */
    auth?: AuthMiddlewareOptions;
    /**
     * Per-agent RBAC enforced in the request handler **after** the agent is
     * resolved from the request body. Maps agent name → allowed role strings;
     * the caller's roles are read from the JWT payload in the auth context
     * (`claims.jwtPayload.role`). This closes the gap where body-based agent
     * selection (`POST /v1/chat { "agent": "billing" }`) bypassed URL-regex RBAC.
     *
     * @example
     * ```ts
     * createHttpService({
     *   agents: { billing, support },
     *   auth: jwtAuth({ secret, claimsToContext: ['role'] }),
     *   rbac: { billing: ['role:admin'], support: ['role:support', 'role:admin'] },
     * });
     * ```
     */
    rbac?: Record<string, string[]>;
    /**
     * Checkpoint/snapshot hook invoked by `close()` after in-flight requests
     * drain (or the drain timeout elapses). Use it to persist agent/checkpoint
     * state so a graceful shutdown does not abandon work. Pairs with
     * `GracefulShutdown.onDrain(svc.close)` from `personaforge/production`.
     */
    onShutdown?: () => Promise<void> | void;
    /**
     * Trust `X-Forwarded-For` as the client IP.
     * Default: `false`.
     *
     * Leave this disabled unless the service is behind a trusted reverse proxy
     * that strips any client-supplied forwarding headers and rewrites them.
     */
    trustProxy?: boolean;
    /**
     * Maximum allowed request body size in bytes.
     * Requests exceeding this are rejected with 413.
     * Default: 1 MB (1_048_576 bytes).
     */
    maxBodyBytes?: number;
    /**
     * Idempotency: deduplicate retried chat requests via `X-Idempotency-Key` header.
    * When a client retries with the same key and the same request scope within
    * the TTL window, the cached response is returned without re-executing the agent.
    * The request scope includes method, path, agent, session/user identifiers,
    * streaming mode, caller context, and request message content.
     *
     * @example
     * ```ts
     * import { createSqliteIdempotencyStore } from 'personaforge/production';
     * createHttpService({
     *   agents: { assistant },
     *   idempotency: { store: createSqliteIdempotencyStore('./agent.db'), ttlMs: 24 * 60 * 60 * 1000 },
     * });
     * ```
     */
    idempotency?: import('../production/idempotency.js').IdempotencyOptions;
    /**
     * Persistent audit log store. Replaces the default 500-entry in-memory array
     * with a durable store (SQLite or your own adapter). Satisfies SOC 2 / HIPAA audit trail requirements.
     *
     * @example
     * ```ts
     * import { createSqliteAuditStore } from 'personaforge/production';
     * createHttpService({
     *   agents: { assistant },
     *   auditStore: createSqliteAuditStore('./agent.db'),
     * });
     * ```
     */
    auditStore?: import('../production/audit-store.js').AuditStore;
    /**
     * WebSocket transport: enable real-time bidirectional agent streaming.
     * When enabled, clients can connect to `ws://host/v1/ws` to stream
     * agent responses token-by-token without SSE polling.
     *
     * @example
     * ```ts
     * createHttpService({ agents: { assistant }, websocket: true });
     * ```
     */
    websocket?: boolean;
    /**
     * Admin API: operational dashboard endpoints for sessions, audit, checkpoints, and stats.
     * All admin endpoints are protected by `bearerToken` (required in production).
     *
     * @example
     * ```ts
     * import { createSqliteAuditStore, createSqliteCheckpointStore } from 'personaforge/production';
     * createHttpService({
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
    adminApi?: import('./admin.js').AdminApiOptions;
    /**
     * Human-in-the-loop approval store. When provided, exposes:
     *   - `GET  /v1/approvals` — list pending approvals
     *   - `POST /v1/approvals/:id` — submit a decision `{ approved, comment, decidedBy }`
     *
     * @example
     * ```ts
     * import { createSqliteApprovalStore } from 'personaforge/production';
     * createHttpService({
     *   agents: { assistant },
     *   approvalStore: createSqliteApprovalStore('./agent.db'),
     * });
     * ```
     */
    approvalStore?: import('../production/approval-store.js').ApprovalStore;
    /**
     * HTTP-level rate limiting — applied to every incoming request before agent execution.
        * Keyed by: `identity` from auth context, then client IP.
        * When `trustProxy` is `true`, client IP is sourced from `x-forwarded-for`.
        * Otherwise it uses the direct socket remote address.
     *
     * @example
     * ```ts
     * import { RateLimiter } from 'personaforge/production';
     * createHttpService({
     *   agents: { assistant },
     *   rateLimit: new RateLimiter({ name: 'http', maxRequests: 100, intervalMs: 60_000 }),
     * });
     * ```
     */
    rateLimit?: {
        check(key: string): Promise<void> | void;
    };
    /**
     * Optional AgentDb instance. When provided, the `/health` endpoint includes
     * a live database connectivity check (`db.health()`). If the DB is unreachable,
     * the health endpoint returns HTTP 503 with `{ status: 'degraded', db: { ok: false } }`.
     *
     * @example
     * ```ts
     * import { SqliteAgentDb } from '../db/index.js';
     * createHttpService({
     *   agents: { assistant },
     *   db: new SqliteAgentDb({ path: './agent.db' }),
     * });
     * ```
     */
    db?: import('../db/index.js').AgentDb;
    /**
     * Session store — when provided, exposes session CRUD endpoints:
     *   GET    /v1/sessions              → list sessions (by userId)
     *   GET    /v1/sessions/:id          → get session + messages
     *   DELETE /v1/sessions/:id          → delete session
     */
    sessionStore?: import('../session/types.js').SessionStore;
    /**
     * Memory store — when provided, exposes memory CRUD endpoints:
     *   GET    /v1/memory                → list memories (by userId)
     *   POST   /v1/memory                → create a memory entry
     *   DELETE /v1/memory/:id            → delete a memory entry
     */
    memoryStore?: import('../memory/types.js').MemoryStore;
    /**
     * Knowledge engine — when provided, exposes knowledge endpoints:
     *   POST   /v1/knowledge/text        → ingest text
     *   POST   /v1/knowledge/url         → ingest URL
     *   GET    /v1/knowledge/search      → search (query param: q)
     */
    knowledgeEngine?: import('../knowledge/knowledge-engine.js').KnowledgeEngine;
    /**
     * Background job store — tracks async (background=true) run jobs.
     * Exposed via GET /v1/runs/:runId and DELETE /v1/runs/:runId (cancel).
     * Defaults to an in-memory store if background jobs are used.
     */
    backgroundJobStore?: import('./background-jobs.js').InMemoryBackgroundJobStore;
    /**
     * Component registry — exposes agent versioning endpoints:
     *   GET    /v1/components            → list components
     *   POST   /v1/components            → register component
     *   GET    /v1/components/:id        → get component
     *   POST   /v1/components/:id/publish → publish draft
     *   POST   /v1/components/:id/rollback → rollback to version
     *   DELETE /v1/components/:id        → delete component
     */
    componentRegistry?: import('../production/component-registry.js').ComponentRegistry;
    /**
     * Messaging + protocol surface interfaces (Slack, Telegram, A2A, AG-UI).
     * Each interface registers its own HTTP routes on the server.
     *
     * @example
     * ```ts
     * import { SlackInterface, TelegramInterface } from 'personaforge/interfaces';
     * createHttpService({
     *   agents: { assistant },
     *   interfaces: [
     *     new SlackInterface({ agent: assistant, token: '...', signingSecret: '...' }),
     *     new TelegramInterface({ agent: assistant, token: '...' }),
     *   ],
     * });
     * ```
     */
    interfaces?: import('../interfaces/base.js').BaseInterface[];
    /**
     * Per-request timeout in milliseconds. Applies to agent execution (both streaming
     * and non-streaming). When exceeded the request is aborted and a 504 is returned.
     * Default: no timeout.
     *
     * @example
     * ```ts
     * createHttpService({ agents: { assistant }, requestTimeoutMs: 60_000 });
     * ```
     */
    requestTimeoutMs?: number;
    /**
     * Bind host for `listenService`. Default: `'0.0.0.0'` (all interfaces).
     * Set to `'127.0.0.1'` to restrict to loopback only.
     */
    host?: string;
    /**
     * Whether to expose raw error messages in 500 responses.
     * Default: `false` — returns `'Internal server error'` to avoid leaking internals.
     * Set to `true` in development for easier debugging.
     */
    exposeErrors?: boolean;
    /** Maximum concurrent agent executions. Default: no limit (0 = unlimited). */
    maxConcurrency?: number;
    /** Persistent run store — records every agent execution metadata. */
    runStore?: import('../production/run-store.js').RunStore;
}

export interface RequestAuditEntry {
    id: string;
    at: string;
    method: string;
    path: string;
    status: number;
    agent?: string;
    sessionId?: string;
}

export interface HttpService {
    port: number;
    /** Node HTTP server instance */
    server: import('node:http').Server;
    /**
     * Stop the server. Stops accepting new connections, then waits up to
     * `drainTimeoutMs` (default: 30 s) for in-flight requests to complete
     * before resolving. Useful for zero-downtime graceful shutdown on SIGTERM.
     */
    close(drainTimeoutMs?: number): Promise<void>;
    /** When tracing is on, last N audit entries (default cap 500). */
    getAuditLog(): ReadonlyArray<RequestAuditEntry>;
}
