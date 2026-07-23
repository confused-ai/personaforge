---
title: Admin API
description: Mount operational endpoints for health, agent listing, audit logs, approvals, and stats via createHttpService({ adminApi }). Bearer-token secured. Seven read-only endpoints.
outline: [2, 3]
---

# Admin API

The Admin API is an operational overlay mounted inside `createHttpService`. It exposes read-only visibility into agent health, audit logs, active sessions, pending approvals, and throughput statistics.

```ts
import { createHttpService } from 'personaforge/serve';
import { createSqliteAuditStore, createSqliteCheckpointStore } from 'personaforge/production';
```

---

## Enable the Admin API

```ts
import { createHttpService } from 'personaforge/serve';
import { apiKeyAuth } from 'personaforge/serve';
import { createSqliteAuditStore, createSqliteCheckpointStore } from 'personaforge/production';

const svc = createHttpService({
  agents: { assistant },
  adminApi: {
    enabled: true,
    prefix: '/admin',               // default: /admin
    bearerToken: process.env.ADMIN_BEARER_TOKEN!,
    auditStore: createSqliteAuditStore('./agent.db'),
    checkpointStore: createSqliteCheckpointStore('./agent.db'),
  },
});

await listenService(svc, 8787);
// Admin endpoints now live at http://localhost:8787/admin/*
```

> **Warning:** If `bearerToken` is omitted the Admin API is unprotected. A warning is logged. Never deploy without `bearerToken` in production.

---

## Endpoints

All endpoints are under the configured prefix (default `/admin`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/health` | Deep health check — uptime, memory, process info |
| `GET` | `/admin/agents` | List registered agents + metadata |
| `GET` | `/admin/audit` | Paginated audit log (from `auditStore`) |
| `GET` | `/admin/sessions` | Active session listing |
| `GET` | `/admin/approvals` | Pending HITL approvals |
| `GET` | `/admin/checkpoints` | Active resumable run checkpoints |
| `GET` | `/admin/stats` | Aggregated request + error + token counts |

Authentication is `Authorization: Bearer <token>` on every request.

---

## Sample responses

```bash
# Health check
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/admin/health

# Audit log (last 20 entries)
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8787/admin/audit?limit=20"

# Pending approvals
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/admin/approvals

# Throughput stats
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/admin/stats
```

---

## `AdminApiOptions`

```ts
interface AdminApiOptions {
  /** Enable the admin API (default: false) */
  enabled?: boolean;
  /** URL prefix (default: /admin). Must start with /. */
  prefix?: string;
  /** Bearer token required for all admin requests. */
  bearerToken?: string;
  /** Durable audit store. Falls back to 500-entry in-memory ring buffer. */
  auditStore?: AuditStore;
  /** Checkpoint store for active resumable runs. */
  checkpointStore?: AgentCheckpointStore;
}
```

---

## `createHttpService` server options

| Option | Type | Default | Description |
|---|---|---|---|
| `requestTimeoutMs` | `number` | none | Abort agent execution and return HTTP 504 after this many milliseconds |
| `host` | `string` | `'0.0.0.0'` | Bind host. Set to `'127.0.0.1'` to restrict to loopback |
| `exposeErrors` | `boolean` | `false` | Include raw error messages in 500 responses. Enable only in development |

`close(drainTimeoutMs?)` — stops accepting new connections and waits up to `drainTimeoutMs` (default: 30 000 ms) for in-flight requests to finish before resolving.

---

## Full `createHttpService` example

```ts
import { createHttpService, listenService, apiKeyAuth } from 'personaforge/serve';
import {
  createSqliteAuditStore,
  createSqliteIdempotencyStore,
  createOpenAIRateLimiter,
} from 'personaforge/production';

const svc = createHttpService({
  agents: { assistant, coder },

  // CORS (allow local UI)
  cors: process.env.CORS_ORIGIN ?? '*',

  // Auth
  auth: { strategy: 'api-key', keys: [process.env.API_KEY!] },

  // Rate limiting
  rateLimit: createOpenAIRateLimiter('tier1'),

  // Idempotency
  idempotency: {
    store: createSqliteIdempotencyStore('./agent.db'),
    ttlMs: 24 * 60 * 60_000,
  },

  // Audit log
  auditStore: createSqliteAuditStore('./agent.db'),

  // WebSocket streaming
  websocket: true,

  // Per-request timeout — abort + 504 after 60 s
  requestTimeoutMs: 60_000,

  // Bind to loopback only (omit for 0.0.0.0)
  host: '127.0.0.1',

  // Expose raw error messages in responses (dev only — never set true in production)
  exposeErrors: false,

  // Admin API
  adminApi: {
    enabled: true,
    bearerToken: process.env.ADMIN_BEARER_TOKEN!,
    auditStore: createSqliteAuditStore('./agent.db'),
  },
});

await listenService(svc, 8787);

// Graceful shutdown — drain in-flight requests for up to 30 s
await svc.close(30_000);
```

---

## Where to go next

- [Production](./production) — circuit breakers, audit stores, graceful shutdown.
- [Observability](./observability) — OpenTelemetry traces for deeper inspection.
- [HITL](./hitl) — manage approvals exposed under `/admin/approvals`.
