---
title: 13 · Production Resilience
description: Wrap any agent with withResilience() to add circuit breakers, rate limits, retries, health checks, and budget controls without changing core agent logic.
outline: [2, 3]
---

# 13 · Production Resilience

Production agents need to degrade gracefully under load, recover from transient failures, and respect cost limits. `withResilience()` wraps any agent with these guarantees without touching your agent authoring code.

```ts
import { withResilience } from 'personaforge/production';
```

---

## What you'll learn

- How to wrap an agent with circuit breaker, rate limit, and retry policies
- How to check agent health status at runtime
- How to add budget controls and durable checkpoints
- How to configure approval gates and audit trails for HTTP-exposed agents

---

## Basic resilience wrapper

```ts
import { createAgent } from 'personaforge';
import { withResilience } from 'personaforge/production';

const baseAgent = createAgent({
  name: 'ops-bot',
  instructions: 'Summarize incidents and keep answers short.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  retry: {
    maxRetries: 2,
    backoffMs: 250,
    maxBackoffMs: 2_000,
  },
  timeoutMs: 20_000,
});

const resilientAgent = withResilience(baseAgent, {
  // Open the circuit after 3 consecutive failures; reset after 30 s
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeoutMs: 30_000,
  },
  // No more than 60 requests per minute
  rateLimit: {
    maxRpm: 60,
  },
  // Retry at the resilience layer too (on top of agent-level retries)
  retry: {
    maxRetries: 1,
    backoffMs: 250,
    maxBackoffMs: 1_000,
  },
  // Expose a health endpoint
  healthCheck: true,
});

const result = await resilientAgent.run('Summarize the last deployment incident.');
console.log(result.text);

// Inspect circuit breaker and rate limiter state
const health = resilientAgent.health();
console.log(health);
// → { status: 'healthy', circuitState: 'closed', requestsThisMinute: 1 }
```

---

## Budget controls

Add a `budget` to the underlying agent to hard-cap token or dollar spend.

```ts
import { createAgent } from 'personaforge';
import { withResilience } from 'personaforge/production';

const budgetedAgent = createAgent({
  name: 'budget-agent',
  instructions: 'Answer concisely to stay within budget.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  budget: {
    maxTokensPerRun: 2_000,     // hard cap per single run
    maxUsdPerDay: 5.00,         // $5/day across all runs
  },
});

const resilient = withResilience(budgetedAgent, {
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60_000 },
  rateLimit: { maxRpm: 30 },
});

try {
  const result = await resilient.run('Draft a long analysis report...');
  console.log(result.text);
} catch (err) {
  // BudgetExceededError is thrown when limits are hit
  console.error('Budget exceeded:', err);
}
```

---

## Durable checkpointing

Add `checkpointStore` to persist run state so long-running agents can resume after a process crash.

```ts
import { createAgent } from 'personaforge';
import { withResilience, SqliteCheckpointStore } from 'personaforge/production';

const durableAgent = createAgent({
  name: 'durable-ops',
  instructions: 'Process reports step by step.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  checkpointStore: new SqliteCheckpointStore('./agent.db'),
});

const resilient = withResilience(durableAgent, {
  circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 30_000 },
});

// On crash + restart, the agent picks up where it left off using the checkpoint
const result = await resilient.run('Analyse the 500 MB audit log...', {
  runId: 'audit-2026-05',  // deterministic runId enables resume
});
console.log(result.text);
```

---

## HTTP-level production controls

When you expose the agent through `createHttpService()`, layer in approval workflows and audit logging.

```ts
import { createAgent } from 'personaforge';
import { withResilience } from 'personaforge/production';
import { createHttpService, listenService } from 'personaforge/serve';
import {
  createSqliteApprovalStore,
  createSqliteAuditStore,
} from 'personaforge/production';

const agent = createAgent({
  name: 'ops-agent',
  instructions: 'Handle operational requests carefully.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const resilient = withResilience(agent, {
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60_000 },
  rateLimit: { maxRpm: 120 },
});

const service = createHttpService({
  agents: { ops: resilient },
  approvalStore: createSqliteApprovalStore('./agent.db'),
  auditStore: createSqliteAuditStore('./agent.db'),
  cors: '*',
});

await listenService(service, 3000);
// Approval requests: GET/POST /v1/approvals
// Audit log:        GET /v1/audit
```

---

## Resilience configuration reference

| Option | What it does |
|---|---|
| `circuitBreaker.failureThreshold` | Failures before the circuit opens |
| `circuitBreaker.resetTimeoutMs` | Time before a half-open retry is attempted |
| `rateLimit.maxRpm` | Max requests per minute |
| `retry.maxRetries` | Wrapper-level retry attempts |
| `retry.backoffMs` | Initial delay between retries |
| `retry.maxBackoffMs` | Maximum retry delay |
| `healthCheck` | Enable `agent.health()` status method |

---

## What's next?

- [03 · Tool with Approval](./03-approval-tool) — gate individual tool calls behind human review
- [15 · Full-Stack App](./15-full-stack) — production agent behind an HTTP service
- [Production guide](../guide/production) — full `withResilience()` API reference
