---
title: Multi-Tenancy
description: Isolate agent state per tenant with createTenantContext(). TenantScopedSessionStore auto-prefixes session keys. TenantRegistry for per-tenant rate limits and model restrictions.
outline: [2, 3]
---

# Multi-Tenancy

Use `createTenantContext()` to isolate sessions, rate limits, and run context per tenant — without separate databases. All stores are wrapped and all keys are automatically prefixed.

```ts
import { createTenantContext, TenantRegistry } from 'personaforge/production';
```

---

## Quick start

```ts
import { createAgent } from 'personaforge';
import { createTenantContext } from 'personaforge/production';
import { createSqliteStore } from 'personaforge/session';

// Single shared session store
const sessionStore = createSqliteStore({ path: './agent.db' });

// In your request handler, scope to the authenticated tenant:
async function handleRequest(req: Request) {
  const tenantId = req.headers.get('x-tenant-id')!;

  const ctx = createTenantContext(tenantId, { sessionStore });

  const agent = createAgent({
    name: 'support',
    instructions: 'Help users with support requests.',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
    sessionStore: ctx.sessionStore,  // all keys are prefixed with 'tenantId:'
  });

  return agent.run(req.body.message, ctx.runContext);
}
```

---

## `createTenantContext`

```ts
const ctx = createTenantContext('tenant-acme', {
  sessionStore: baseSessionStore,         // wrapped with 'tenant-acme:' prefix
  rateLimitConfig: { maxRequests: 100, intervalMs: 60_000 },  // per-tenant limiter
});

// ctx fields:
// ctx.tenantId        — 'tenant-acme'
// ctx.sessionStore    — TenantScopedSessionStore (auto-prefixes all keys)
// ctx.rateLimiter     — RateLimiter scoped to this tenant
// ctx.runContext       — { tenantId: 'tenant-acme' }  (pass to agent.run())
```

---

## Key isolation in practice

```ts
// Tenant A and Tenant B share the same Postgres session store,
// but their sessions never overlap:
const ctxA = createTenantContext('tenant-a', { sessionStore });
const ctxB = createTenantContext('tenant-b', { sessionStore });

// Session IDs stored as 'tenant-a:sess-123' vs 'tenant-b:sess-123'
const sessionId = await ctxA.sessionStore.create({ agentId: 'support' });
// → stored as 'tenant-a:<generated-id>'
```

---

## `TenantRegistry` — per-tenant configuration

Use `TenantRegistry` to define configuration for each tenant (rate limits, allowed models):

```ts
import { TenantRegistry } from 'personaforge/production';

const registry = new TenantRegistry();

registry.register({
  tenantId: 'tenant-acme',
  maxRpm: 100,                // max 100 requests per minute
  maxUsdPerDay: 5.00,         // max $5/day spend
  allowedModels: ['gpt-4o-mini', 'gpt-4o'],
});

registry.register({
  tenantId: 'tenant-enterprise',
  maxRpm: 1000,
  maxUsdPerDay: 50.00,
  allowedModels: ['gpt-4o', 'claude-3-5-sonnet'],
});

// Lookup in request handler
const config = registry.get(tenantId);
if (config?.allowedModels && !config.allowedModels.includes(requestedModel)) {
  return Response.json({ error: 'Model not available on your plan.' }, { status: 403 });
}
```

---

## Namespace each layer explicitly

For full tenant isolation, scope every stateful layer:

```ts
const ctx = createTenantContext(tenantId, { sessionStore: baseSessionStore });

const agent = createAgent({
  name: 'support',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,

  // Session: auto-namespaced by createTenantContext
  sessionStore: ctx.sessionStore,

  // Memory: namespace manually
  memoryStore: createDbMemoryStore({ db, namespace: tenantId }),

  // Storage: prefix keys manually
  storage: createStorage({ driver: 'file', basePath: `./data/${tenantId}` }),
});
```

---

## `TenantContext` interface

```ts
interface TenantContext {
  readonly tenantId: string;
  readonly sessionStore: SessionStore;    // TenantScopedSessionStore
  readonly rateLimiter: RateLimiter;
  readonly runContext: { tenantId: string; userId?: string };
}
```

---

## `tenantId` in AgentRunOptions

The `tenantId` and `traceId` fields now propagate through the entire run stack — from the request boundary to the runner, cost tracker, guardrails, and run store:

```ts
const agent = createAgent({ name: 'support', instructions: '...' });

const result = await agent.run('Help me', {
  tenantId: 'acme',
  traceId: 'trace-abc-123',
});

console.log(result.costUsd);   // run is scoped + billed to 'acme'
```

Using `ctx.runContext` from `createTenantContext` passes both automatically:

```ts
const ctx = createTenantContext('acme', { sessionStore });

const result = await agent.run('Help me', ctx.runContext);
// ctx.runContext === { tenantId: 'acme' }
```

When combined with a `RunStore`, every run is persisted with its `tenantId` field — enabling per-tenant billing, quota reporting, and crash recovery.

---

## Tenant-scoped knowledge

The `KnowledgeEngine` now supports per-tenant document isolation. Documents are tagged with a tenant at ingest time, and queries filter by tenant automatically:

```ts
import { createKnowledgeEngine } from 'personaforge/knowledge';

const engine = createKnowledgeEngine({ tenantId: 'acme' });

// Documents ingested via this engine are tagged with tenantId 'acme'
await engine.addDocuments([{ content: 'Only Acme data.' }]);

// Queries are scoped to 'acme'
const context = await engine.buildContext('What are our policies?');
```

You can also pass a tenant at query time to override:

```ts
const context = await engine.buildContext('Search', 5, 'acme');
```

The underlying `VectorStore.search(query, topK, filter?)` accepts a `filter` parameter. Tenant isolation is enforced by the store — documents tagged with a different `tenantId` are never returned.

---

## Run Store — per-tenant records

```ts
import { createSqliteRunStore } from 'personaforge/production';

const store = createSqliteRunStore('./runs.db');

// Query runs for a specific tenant
const acmeRuns = await store.list({ tenantId: 'acme', limit: 100 });

// Count runs per tenant (billing)
const count = await store.count({ tenantId: 'acme', status: 'completed' });

// Find tenant-scoped incomplete runs for recovery
const crashed = await store.list({ tenantId: 'acme' }).then(
  (runs) => runs.filter((r) => r.status === 'running'),
);
```

---

## Where to go next

- [Session](./session) — underlying session stores.
- [Production](./production) — `BudgetEnforcer` and `RateLimiter`.
- [Secret manager](./secret-manager) — per-tenant credential isolation.
