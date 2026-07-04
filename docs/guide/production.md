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
} from 'confused-ai/production';
```

---

## `ResilientAgent` — all-in-one wrapper

The fastest way to get production resilience — wraps a `createAgent()` agent with circuit breaker, rate limiter, budget enforcement, checkpointing, and idempotency:

```ts
import { createAgent } from 'confused-ai';
import { withResilience } from 'confused-ai/production';

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
import { CircuitBreaker, CircuitState, createLLMCircuitBreaker } from 'confused-ai/production';

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
import { RateLimiter, createOpenAIRateLimiter, RateLimitError } from 'confused-ai/production';

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
import { RedisRateLimiter } from 'confused-ai/production';

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
import { BudgetEnforcer, InMemoryBudgetStore, BudgetExceededError, estimateCostUsd } from 'confused-ai/production';

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
} from 'confused-ai/production';

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
import { createGracefulShutdown, withShutdownGuard } from 'confused-ai/production';

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
import { SqliteAuditStore, createSqliteAuditStore } from 'confused-ai/production';

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
import { createSqliteIdempotencyStore } from 'confused-ai/production';

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
import { deleteSession } from 'confused-ai/production';

await deleteSession({
  sessionId: 'session-1',
  sessionStore,
  memoryStore,
  checkpointStore,
  auditStore,
});
```

---

## Where to go next

- [HITL](./hitl) — human approval gates.
- [Observability](./observability) — tracing, metrics, Langfuse.
- [Multi-tenancy](./multi-tenancy) — per-tenant isolation.
- [Example 13: Production](../examples/13-production) — full production setup example.
