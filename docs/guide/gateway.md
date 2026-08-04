# Enterprise Gateway

> **One config. Tenants, policies, compliance — done.**

The Enterprise Gateway is the single entry point for production AI deployments.
It wraps the framework's scattered production primitives — authentication,
RBAC, multi-tenancy, budget enforcement, rate limiting, and durable audit —
into one declarative configuration with a board-ready **compliance dashboard**.

```ts
import { createEnterpriseGateway } from 'personaforge/gateway';
import { apiKeyAuth } from 'personaforge/runtime';
import { createSqliteAuditStore } from 'personaforge/production';
import { createAgent } from 'personaforge';
```

## Why a gateway?

Every framework can spin up an agent. The difference between a demo and an
enterprise deployment is:

| Concern | Without the gateway | With the gateway |
|---|---|---|
| Authentication | Wire auth middleware manually | Declare `auth` once |
| Multi-tenancy | Hand-scope every store | Declare tenants + resolution |
| Budget caps | Hand-roll counters | Declare `monthlyBudgetUsd` |
| Rate limiting | Plumb limiters per endpoint | Declare `maxRpm` |
| RBAC | Manually check roles per route | Declare per-agent roles per tenant |
| Audit trail | Hand-write audit calls | Automatic — hashed prompts, IPs, costs |
| Compliance | Manual evidence gathering | `/compliance` report + dashboard |

## Quick start

```ts
import { createEnterpriseGateway } from 'personaforge/gateway';
import { apiKeyAuth } from 'personaforge/runtime';
import { createSqliteAuditStore } from 'personaforge/production';
import { createAgent } from 'personaforge';

const support = createAgent({
  name: 'support',
  instructions: 'You are a helpful support agent.',
});

const gateway = createEnterpriseGateway({
  agents: { support },

  // Authentication for every non-health endpoint
  auth: apiKeyAuth([process.env.GATEWAY_API_KEY!]),

  // Registered tenants with isolated policies
  tenants: [
    {
      id: 'acme',
      name: 'Acme Corp',
      monthlyBudgetUsd: 500,
      dailyBudgetUsd: 50,
      maxRpm: 60,
      allowedAgents: ['support'],
      rbac: { support: ['role:support', 'role:admin'] },
    },
  ],

  // Global policy applied to all tenants
  policy: {
    monthlyBudgetUsd: 5_000,
    requestTimeoutMs: 60_000,
    maxBodyBytes: 1_048_576,
  },

  // Durable, SOC 2-ready audit trail
  auditStore: createSqliteAuditStore('./audit.db'),
});

await gateway.start(8787);
```

## Tenant resolution

How the gateway determines *which* tenant made a request:

```ts
// Via header (default header: x-tenant-id)
tenantResolution: { mode: 'header', header: 'x-tenant-id' }

// Via JWT claim (default claim: tenantId)
tenantResolution: { mode: 'claim', claim: 'tenantId' }

// Auto — try header, then claim
tenantResolution: { mode: 'auto' }
```

## Per-tenant isolation

Each tenant gets its own:

- **Budget caps** — `monthlyBudgetUsd`, `dailyBudgetUsd` (tracked from
  token usage; ~$0.00001/token).
- **Rate limits** — `maxRpm` enforced as a hard cap.
- **Agent allowlist** — `allowedAgents: ['support']` blocks access to other
  agents with HTTP 403.
- **RBAC** — `rbac: { support: ['role:admin'] }` requires the caller's JWT
  to carry `role:admin` before the request proceeds.

Requests are rejected with `429` before any agent runs when a budget or rate
cap is hit — no wasted LLM spend.

## Endpoints

| Path | Method | Description |
|---|---|---|
| `/health`, `/v1/health` | GET | Liveness probe |
| `/v1/agents` | GET | List exposed agents |
| `/v1/chat` | POST | Run agent `{ message, agent, sessionId, userId }` |
| `/compliance` | GET | **Human-readable compliance dashboard (HTML)** |
| `/compliance/report` | GET | Compliance report as JSON |
| `/compliance/tenants` | GET | Registered tenants |

The compliance dashboard is the board-ready artifact:

```
SOC2  ✅ Authentication enabled
SOC2  ✅ Multi-tenant isolation
SOC2  ⚠️ RBAC enforced (no rules defined)
SOC2  ✅ Durable audit trail
GDPR  ✅ Prompt hashing (never plaintext)
ISO27001 ✅ Error disclosure prevention
```

## Compliance report

```ts
const report = await gateway.getComplianceReport();
// {
//   overallStatus: 'warn',   // 'pass' | 'warn' | 'fail'
//   passCount: 8,
//   warnCount: 3,
//   failCount: 0,
//   controls: [
//     { id: 'AUTH-1', name: 'Authentication enabled', framework: 'SOC2', status: 'pass', detail: '...' },
//     ...
//   ],
//   tenantCount: 1,
//   agentCount: 2,
//   auditEntries: 152,
//   budgetUsageUsd: 12.4,
// }
```

Frameworks: **SOC 2**, **HIPAA**, **GDPR**, **ISO 27001**.

```ts
// Restrict the report to SOC 2 + ISO 27001 controls only
createEnterpriseGateway({
  agents,
  complianceFrameworks: ['SOC2', 'ISO27001'],
});
```

## Audit trail

Every request is recorded with:

- Request ID (echoed as `X-Request-ID`)
- Method, path, status
- Agent, session, user, tenant
- **SHA-256 prompt hash** — raw prompts are never stored
- Tools called, finish reason, duration, estimated cost, client IP

## Horizontal scaling

The gateway is stateless. Run multiple instances behind a load balancer —
share the `auditStore` (SQLite or Postgres) and you get a single audit trail
across all instances. Budget tracking is in-memory per instance; pair with
the framework's `BudgetEnforcer` + Redis for cross-instance caps.

## All options

See the full [`EnterpriseGatewayConfig` type](https://github.com/confused-ai/personaforge/blob/main/src/gateway/types.ts) for the complete surface.