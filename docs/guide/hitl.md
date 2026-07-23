---
title: Human In The Loop
description: Pause agent execution at high-risk tool calls and wait for a human approval decision using ApprovalStore, waitForApproval, and the built-in HTTP approval endpoint.
outline: [2, 3]
---

# Human In The Loop (HITL)

HITL lets an agent pause before performing a high-risk action (send an email, charge a card, delete a record) and wait for a human decision. The approval request is persisted durably so the agent can resume even after a restart.

```ts
import {
  InMemoryApprovalStore,
  SqliteApprovalStore,
  createSqliteApprovalStore,
  waitForApproval,
  ApprovalRejectedError,
} from 'personaforge/production';
```

---

## Quick start

```ts
import { createAgent, tool } from 'personaforge';
import { createSqliteApprovalStore, waitForApproval, ApprovalRejectedError } from 'personaforge/production';
import { z } from 'zod';

const approvalStore = createSqliteApprovalStore('./agent.db');

// Wrap a risky tool with an approval gate
const sendInvoice = tool({
  name: 'send_invoice',
  description: 'Send an invoice email to a customer.',
  parameters: z.object({ customerId: z.string(), amount: z.number() }),
  execute: async ({ customerId, amount }, ctx) => {
    // Gate: create a pending approval, then block until a human decides
    const req = await approvalStore.create({
      runId: ctx.runId!,
      agentName: 'billing-agent',
      toolName: 'send_invoice',
      toolArguments: { customerId, amount },
      riskLevel: 'high',
      description: `Send a $${amount} invoice to customer ${customerId}`,
      ttlMs: 24 * 60 * 60 * 1000,  // request expires after 24 hours
    });
    await waitForApproval(approvalStore, req.id, {
      timeoutMs: 24 * 60 * 60 * 1000,  // wait up to 24 hours
    });

    // Only runs after approval
    await emailService.sendInvoice(customerId, amount);
    return { sent: true };
  },
});

const agent = createAgent({
  name: 'billing-agent',
  instructions: 'Handle billing and invoicing tasks.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [sendInvoice],
});

try {
  const result = await agent.run('Send a $500 invoice to customer cust-123.');
} catch (err) {
  if (err instanceof ApprovalRejectedError) {
    console.log('Human rejected the action:', err.comment);
  }
}
```

---

## Approval stores

### InMemoryApprovalStore (testing)

```ts
import { InMemoryApprovalStore } from 'personaforge/production';

const store = new InMemoryApprovalStore();
```

### SqliteApprovalStore (production)

```ts
import { createSqliteApprovalStore } from 'personaforge/production';

const store = createSqliteApprovalStore('./agent.db');
```

---

## `ApprovalStore` interface

```ts
interface ApprovalStore {
  create(request: Omit<HitlRequest, 'id' | 'status' | 'createdAt' | 'expiresAt'> & { ttlMs?: number }): Promise<HitlRequest>;
  get(id: string): Promise<HitlRequest | null>;
  getByRunId(runId: string): Promise<HitlRequest | null>;
  decide(id: string, decision: ApprovalDecision): Promise<HitlRequest>;
  listPending(agentName?: string): Promise<HitlRequest[]>;
  expireStale?(): Promise<number>;
}
```

---

## `HitlRequest` shape

```ts
interface HitlRequest {
  readonly id: string;
  readonly runId: string;
  readonly agentName: string;
  readonly toolName: string;
  readonly toolArguments: Record<string, unknown>;
  readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
  readonly description?: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired';
  readonly comment?: string;          // reviewer comment
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
}
```

---

## HTTP approval endpoint

When you serve your agent with `createHttpService()`, pass an `approvalStore` to expose a built-in REST endpoint:

```ts
import { createHttpService } from 'personaforge/runtime';
import { createSqliteApprovalStore } from 'personaforge/production';

const approvalStore = createSqliteApprovalStore('./agent.db');

const app = createHttpService({ agents: { agent }, approvalStore });
app.listen(3000);
```

**List pending approvals:**
```
GET /v1/approvals?status=pending
```

**Submit a decision:**
```
POST /v1/approvals/:id
Content-Type: application/json
{ "approved": true, "comment": "Looks good to me" }
```

---

## Manual approval decision (testing)

```ts
// Simulate an approver submitting a decision
const pending = await approvalStore.listPending();
for (const req of pending) {
  await approvalStore.decide(req.id, {
    approved: true,
    comment: 'Reviewed and approved.',
  });
}
```

---

## Rejection handling

When a human rejects a request, `waitForApproval` throws `ApprovalRejectedError`:

```ts
import { ApprovalRejectedError } from 'personaforge/production';

try {
  const result = await agent.run(prompt, { runId: 'run-abc' });
} catch (err) {
  if (err instanceof ApprovalRejectedError) {
    console.log('Rejected because:', err.comment);
    // Notify user, log, update UI, etc.
  }
}
```

---

## Where to go next

- [Guardrails](./guardrails) — automatic policy-based blocking without human review.
- [Production](./production) — circuit breakers, audit logs, idempotency.
- [Example 03: Approval tool](../examples/03-approval-tool) — full HITL example.
