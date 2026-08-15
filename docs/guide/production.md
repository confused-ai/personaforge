---
title: Production
description: CircuitBreaker, RateLimiter, BudgetEnforcer, HealthCheckManager, GracefulShutdown, checkpointing, idempotency, audit logs, and the ResilientAgent wrapper for production-grade agent deployments.
outline: [2, 3]
---

# Production

The production package wraps the agent runtime with resilience, observability, and control-plane primitives. Everything is pluggable and composable — add only what you need.

```ts
import {
  CircuitBreaker, createLLMCircuitBreaker,
  RateLimiter, createOpenAIRateLimiter,
  BudgetEnforcer, InMemoryBudgetStore,
  HealthCheckManager, createLLMHealthCheck,
  GracefulShutdown, createGracefulShutdown,
  ResilientAgent, withResilience,
  InMemoryAuditStore, SqliteAuditStore, createSqliteAuditStore,
  InMemoryIdempotencyStore, createSqliteIdempotencyStore,
  createSqliteCheckpointStore,
  // Run persistence
  InMemoryRunStore, SqliteRunStore, createSqliteRunStore,
  PostgresRunStore, createPostgresRunStore,
  // Error taxonomy
  FrameworkError, TransientError, AuthError, ValidationError,
  GuardrailError, ConfigError, ErrorCode,
  // Concurrency
  Semaphore, ConcurrencyLimiter,
  // Run tracking
  trackRun,
} from 'personaforge/production';
```

---

## `ResilientAgent` — all-in-one wrapper

The fastest way to get production resilience — wraps a `createAgent()` agent with circuit breaker, rate limiter, budget enforcement, checkpointing, and idempotency:

```ts
import { createAgent } from 'personaforge';
import { withResilience } from 'personaforge/production';

const agent = createAgent({
  name: 'production-agent',
  instructions: 'You are a customer service assistant.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const resilientAgent = withResilience(agent, {
  circuitBreaker: {
    failureThreshold: 5,      // open after 5 failures
    resetTimeoutMs: 30_000,   // retry after 30s
  },
  rateLimit: { maxRpm: 60 },  // max requests per minute
  healthCheck: true,
  gracefulShutdown: true,
  retry: { maxRetries: 2, backoffMs: 500 },
});

// Use exactly like a regular agent
const result = await resilientAgent.run('Help me with my order.', {
  sessionId: 'session-1',
  userId: 'user-42',
  runId: 'run-abc',       // used for idempotency
});
```

---

## Circuit breaker

Prevent cascading failures by temporarily stopping calls to a failing dependency:

```ts
import { CircuitBreaker, CircuitState, createLLMCircuitBreaker } from 'personaforge/production';

// Factory for LLM circuit breakers (pre-configured sensible defaults)
const cb = createLLMCircuitBreaker('openai', {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  onStateChange: (from, to) => {
    console.log(`Circuit: ${from} → ${to}`);
    if (to === CircuitState.OPEN) alert('OpenAI circuit opened!');
  },
});

// Wrap any async operation
const result = await cb.execute(async () => {
  return await openai.chat(messages);
});

console.log(cb.getState());  // CLOSED | OPEN | HALF_OPEN
console.log(cb.getMetrics()); // { totalCalls, failures, successes, lastFailure }
```

---

## Rate limiter

Token-bucket rate limiting for external APIs:

```ts
import { RateLimiter, createOpenAIRateLimiter, RateLimitError } from 'personaforge/production';

// Factory for OpenAI (Tier 1 defaults: 60 RPM + 10 burst)
const limiter = createOpenAIRateLimiter();

// Custom
const limiter2 = new RateLimiter({
  name: 'anthropic',
  maxRequests: 20,
  intervalMs: 60_000,
  burstCapacity: 5,
  overflowMode: 'queue',     // 'reject' (default) | 'queue'
  maxQueueSize: 100,
  maxQueueWaitMs: 30_000,
});

try {
  await limiter.acquire();
  const result = await callOpenAI();
  limiter.release();
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${err.retryAfterMs}ms`);
  }
}
```

## Redis rate limiter (distributed)

```ts
import { RedisRateLimiter } from 'personaforge/production';

const limiter = new RedisRateLimiter({
  redis: process.env.REDIS_URL!,
  name: 'openai',
  maxRequests: 60,
  intervalMs: 60_000,
});
```

---

## Budget enforcement

Hard stop on LLM spend per run, per user, and per month:

```ts
import { BudgetEnforcer, InMemoryBudgetStore, BudgetExceededError, estimateCostUsd } from 'personaforge/production';

const budget = new BudgetEnforcer({
  maxUsdPerRun: 0.50,
  maxUsdPerUser: 10.00,
  maxUsdPerMonth: 500.00,
  onExceeded: 'throw',   // 'throw' | 'warn' | 'truncate'
  store: new InMemoryBudgetStore(),
});

// Estimate before running
const estimatedCost = estimateCostUsd('gpt-4o-mini', { promptTokens: 1_000, completionTokens: 500 });

try {
  await budget.checkAndReserve({ userId: 'user-42', estimatedUsd: estimatedCost });
  const result = await agent.run(prompt);
  await budget.commit({ userId: 'user-42', actualUsd: result.usage?.totalCost ?? 0 });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    return { error: 'Monthly budget exceeded.' };
  }
}
```

---

## Health checks

```ts
import {
  HealthCheckManager, HealthStatus,
  createLLMHealthCheck,
  createSessionStoreHealthCheck,
  createHttpHealthCheck,
  createCustomHealthCheck,
} from 'personaforge/production';

const health = new HealthCheckManager({
  checks: [
    createLLMHealthCheck('openai', openaiProvider),
    createSessionStoreHealthCheck('redis', redisSessionStore),
    createHttpHealthCheck('db-api', 'https://api.internal/health'),
    createCustomHealthCheck('queue', async () => {
      const lag = await queue.getLag();
      return lag < 1000 ? { status: HealthStatus.HEALTHY } : { status: HealthStatus.DEGRADED };
    }),
  ],
  intervalMs: 30_000,
});

const report = await health.check();
console.log(report);
// { status: 'healthy', components: { openai: 'healthy', redis: 'healthy', ... } }

// Expose as HTTP endpoint
app.get('/health', async (req, res) => {
  const report = await health.check();
  res.status(report.status === 'healthy' ? 200 : 503).json(report);
});
```

---

## Graceful shutdown

```ts
import { createGracefulShutdown, withShutdownGuard } from 'personaforge/production';

const shutdown = createGracefulShutdown({
  timeoutMs: 30_000,
  onShutdown: (event) => logger.info('Shutting down', event),
});

// Register cleanup handlers
shutdown.register('session-store', () => sessionStore.flush());
shutdown.register('queue', () => queue.drain());
shutdown.register('http-server', () => server.close(30_000)); // drain up to 30 s

// Guard long-running operations against premature termination
const safeRun = withShutdownGuard(shutdown, async () => {
  return agent.run(prompt);
});
```

---

## Audit logs

```ts
import { SqliteAuditStore, createSqliteAuditStore } from 'personaforge/production';

const auditStore = createSqliteAuditStore('./agent.db');

// Log a run
await auditStore.append({
  runId: 'run-123',
  userId: 'user-42',
  agentName: 'billing-agent',
  prompt: userPrompt,
  response: result.text,
  toolCalls: result.toolCalls,
  durationMs: 420,
  tokens: result.usage?.totalTokens,
});

// Query audit trail
const entries = await auditStore.query({
  userId: 'user-42',
  from: new Date('2026-05-01'),
  to: new Date('2026-05-31'),
  limit: 100,
});
```

---

## Idempotency (exactly-once runs)

Prevent duplicate runs from retried HTTP requests:

```ts
import { createSqliteIdempotencyStore } from 'personaforge/production';

const idempotency = createSqliteIdempotencyStore('./agent.db');

// Pass as runId — the framework deduplicates automatically
const result = await agent.run(prompt, {
  runId: req.headers['idempotency-key'] as string,
  // If a run with this ID already completed, returns the cached result instantly
});
```

---

## Cascade delete

Clean up all data associated with a session:

```ts
import { deleteSession } from 'personaforge/production';

await deleteSession({
  sessionId: 'session-1',
  sessionStore,
  memoryStore,
  checkpointStore,
  auditStore,
});
```

---

## Run Store — durable execution records

Every agent run (success, failure, or in-flight) is persisted as a `RunRecord` to a `RunStore`.
Enables crash recovery, billing, observability, and audit — without changing your agent code.

```ts
import { createSqliteRunStore, InMemoryRunStore } from 'personaforge/production';

// SQLite — fast, zero-server, production durable
const store = createSqliteRunStore('./agent.db');

// In-memory — ephemeral, for testing
const memStore = new InMemoryRunStore();
```

### RunRecord schema

| Field | Type | Description |
|-------|------|-------------|
| `runId` | `string` | Unique execution ID |
| `tenantId` | `string?` | Tenant isolation key |
| `userId` | `string?` | End-user identifier |
| `agentId` | `string?` | Agent that executed |
| `agentVersion` | `string?` | Agent version tag |
| `sessionId` | `string?` | Session context |
| `parentRunId` | `string?` | Parent workflow run |
| `status` | `'running' \| 'paused' \| 'completed' \| 'failed' \| ...` | Execution status |
| `input` / `output` | `string?` | Prompt and response text |
| `startTime` / `endTime` | `string (ISO)` | Wall-clock timestamps |
| `durationMs` | `number?` | Elapsed wall time |
| `promptTokens` / `completionTokens` / `totalTokens` | `number?` | Token usage |
| `costUsd` | `number?` | Estimated USD cost |
| `model` | `string?` | Model used |
| `finishReason` | `string?` | `'stop' \| 'max_steps' \| 'error' \| 'timeout'` |
| `error` / `errorCode` | `string?` | Failure details |
| `traceId` | `string?` | Distributed trace correlation |
| `metadata` | `Record<string, unknown>?` | Arbitrary context |

### Query and filter

```ts
// List runs for a tenant, newest first
const runs = await store.list({ tenantId: 'acme', limit: 50 });

// Find incomplete runs (crash recovery)
const crashed = await store.listIncomplete();

// Filter by status, agent, date range
const failed = await store.list({
  agentId: 'billing',
  status: ['failed', 'timed_out'],
  startTime: '2026-08-01T00:00:00Z',
});
```

### Postgres (production scale)

```ts
import pg from 'pg';
import { createPostgresRunStore } from 'personaforge/production';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const store = await createPostgresRunStore(pool);
// DDL runs automatically. Table: `personaforge_runs` with indexes.
```

### Wire into the gateway

```ts
import { createEnterpriseGateway } from 'personaforge/gateway';

const gateway = createEnterpriseGateway({
  agents: { support, billing },
  runStore: createSqliteRunStore('./runs.db'),  // records every run
  auth: apiKeyAuth([process.env.GATEWAY_API_KEY!]),
});
```

Every `POST /v1/chat` call persists a `RunRecord` — success (with cost, tokens, model) or failure (with error, errorCode, duration).

---

## Run tracking — wrap any agent

Use `trackRun()` to persist execution metadata for any agent call — works with or without the gateway:

```ts
import { trackRun, createSqliteRunStore } from 'personaforge/production';

const store = createSqliteRunStore('./runs.db');

// Raw agent call
const { value, record } = await trackRun(store, {
  runId: 'custom-id',
  agentId: 'support',
  tenantId: 'acme',
  userId: 'usr_42',
  model: 'gpt-4o-mini',
}, () => agent.run('Hello!'));

console.log(record.status);     // 'completed'
console.log(record.costUsd);    // 0.00015
console.log(record.durationMs); // 1234
```

On failure, the record is saved with `status: 'failed'`, `error`, and `errorCode`.

---

## Error taxonomy — structured, machine-readable errors

Every framework error carries a stable error code, severity, and HTTP status mapping — no more guessing from message strings.

```ts
import {
  FrameworkError, AuthError, ValidationError, GuardrailError,
  RateLimitError, TimeoutError, ConfigError, ErrorCode,
} from 'personaforge/production';

// Catch and classify
try {
  await agent.run('...');
} catch (err) {
  if (err instanceof AuthError) {
    return 401;       // 'AUTH_FAILED'
  }
  if (err instanceof GuardrailError) {
    return 403;       // 'GUARDRAIL_VIOLATION'
  }
  if (err instanceof TimeoutError) {
    return 503;       // 'TIMEOUT'
  }
  if (err instanceof FrameworkError) {
    return err.statusCode;  // automatic HTTP mapping
  }
}
```

### Error hierarchy

```
FrameworkError (base)
  TransientError         — safe to retry          → 503
    RateLimitError       — rate capped             → 429
    TimeoutError         — deadline exceeded       → 503
    NetworkError         — connection failure      → 503
  PermanentError         — retry useless           → 500
    AuthError            — bad credentials         → 401
    ValidationError      — malformed input         → 400
    NotFoundError        — resource missing        → 404
    ConfigError          — framework misconfigured → 500 (critical)
  TenantError            — tenant-scoped           → 500
    TenantQuotaExceededError                       → 500
    TenantBudgetExceededError                      → 500
  GuardrailError         — policy violation        → 403
  InternalError          — framework bug           → 500 (critical)
```

### JSON serialization

```ts
const err = new RateLimitError('too fast', { context: { limit: 10 } });
console.log(err.toJSON());
// {
//   name: 'RateLimitError',
//   code: 'RATE_LIMITED',
//   message: 'too fast',
//   severity: 'warning',
//   isTransient: true,
//   statusCode: 429,
//   context: { limit: 10 }
// }
```

Use `toJSON()` in API error handlers for consistent, structured error responses.

---

## Concurrency limits — bounded parallel execution

Prevent resource exhaustion by capping concurrent agent executions with a `Semaphore` or `ConcurrencyLimiter`:

```ts
import { Semaphore, ConcurrencyLimiter } from 'personaforge/production';

// Semaphore — raw primitive
const sem = new Semaphore(10);          // max 10 concurrent
await sem.withLock(() => agent.run('Hi!'));

// ConcurrencyLimiter — adds FIFO queue with backpressure
const limiter = new ConcurrencyLimiter(10, 1000);  // capacity, queue depth
const result = await limiter.run(() => agent.run('Hello!'));
// Throws when queue is full — caller sheds load
```

### Wire into the gateway

```ts
const gateway = createEnterpriseGateway({
  agents: { support, billing },
  maxConcurrency: 25,     // at most 25 concurrent agent runs
});
```

Requests beyond the limit are queued (FIFO). When the queue reaches capacity, new requests are rejected with a 503-equivalent error, giving the caller a backpressure signal.

---

## Cost tracking — auto-estimated per run

The runner automatically tracks USD cost per LLM call and attaches it to the result:

```ts
const result = await agent.run('Explain quantum computing');
console.log(result.costUsd);  // 0.00015
console.log(result.model);    // 'gpt-4o-mini'
```

Costs are estimated from the provider pricing table in `cost-tracker.ts`. Supported: OpenAI, Anthropic, Google Gemini, AWS Bedrock, OpenRouter.

The `AgentRunResult` now includes:

| Field | Type | Example |
|-------|------|---------|
| `costUsd` | `number?` | `0.00015` |
| `model` | `string?` | `'gpt-4o-mini'` |
| `errorCode` | `string?` | `'RATE_LIMITED'` |

---

## AgentRunOptions — new fields

The `AgentRunOptions` type (passed to every agent run) now includes:

| Field | Type | Purpose |
|-------|------|---------|
| `tenantId` | `string?` | Tenant isolation, quotas, billing |
| `traceId` | `string?` | Distributed trace correlation |

```ts
const result = await agent.run('Help me', {
  tenantId: 'acme-org',
  traceId: 'trace-abc-123',
});
```

These fields propagate through the runner, cost tracker, guardrails, and run store.

---

## Guardrail integration in runner

Guardrails are now wired into the core `AgentRunner` — tool calls are validated before execution, and LLM output is validated after generation:

```ts
import { GuardrailValidator } from 'personaforge/guardrails';

const agent = createAgent({
  name: 'safe-agent',
  model: 'gpt-4o-mini',
  guardrails: new GuardrailValidator({
    rules: [
      createPiiDetectionRule({ action: 'block' }),
      createPromptInjectionRule(),
    ],
  }),
});
```

When a tool call violates a guardrail, the runner rejects it with a structured error message. When LLM output violates a guardrail, the result is blocked with `finishReason: 'error'`.

---

## What's new in v1.2

- **RunStore** — durable execution records (InMemory, SQLite, Postgres)
- **Run tracking** — `trackRun()` wraps any agent with persistence
- **Error taxonomy** — structured errors with codes, severity, HTTP mapping
- **Concurrency limits** — `Semaphore` / `ConcurrencyLimiter` with gateway integration
- **Cost tracking** — auto-estimated USD cost per run in `AgentRunResult.costUsd`
- **tenantId propagation** — `tenantId` and `traceId` in `AgentRunOptions`
- **Guardrail hooks** — guardrails wired into core agent runner
- **Knowledge tenant filter** — `tenantId` scoping in knowledge queries

---

## Where to go next

- [HITL](./hitl) — human approval gates.
- [Observability](./observability) — tracing, metrics, Langfuse.
- [Multi-tenancy](./multi-tenancy) — per-tenant isolation.
- [Example 13: Production](../examples/13-production) — full production setup example.
