---
title: "03 · Tool with Approval"
---

# 03 · Tool with Approval

Some tools should not run immediately. The current approval flow is built around `needsApproval` on the tool and an `approvalStore` on the HTTP runtime.

## What you'll learn

- How to mark a tool as approval-gated
- How to expose approval requests through the HTTP runtime
- How to keep risky actions out of the default fast path

## Current pattern

```ts
import { z } from 'zod/v3';
import { createAgent, tool } from 'personaforge';
import { createHttpService, listenService } from 'personaforge/serve';
import { createSqliteApprovalStore } from 'personaforge/production';

const sendEmail = tool({
  name: 'send_email',
  description: 'Send an email to a recipient.',
  parameters: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  needsApproval: true,
  execute: async ({ to, subject }) => {
    console.log(`sending email to ${to}: ${subject}`);
    return { success: true };
  },
});

const emailAgent = createAgent({
  name: 'email-agent',
  model: 'gpt-4o-mini',
  instructions: 'Draft helpful email responses and use send_email only when required.',
  tools: [sendEmail],
});

const approvalStore = createSqliteApprovalStore('./agent.db');

const service = createHttpService({
  agents: { email: emailAgent },
  approvalStore,
  cors: '*',
});

await listenService(service, 3000);
```

## What happens at runtime

1. The model decides it needs the `send_email` tool.
2. Because `needsApproval` is enabled, the runtime creates a pending approval request.
3. The request is stored in the configured `approvalStore`.
4. The HTTP runtime exposes approval endpoints so another process or UI can review and approve the action.

When `approvalStore` is enabled, the runtime exposes pending approvals under the built-in `/v1/approvals` routes.

## Dynamic approval rules

You can gate only certain calls:

```ts
needsApproval: ({ to }) => !to.endsWith('@mycompany.com'),
```

That pattern is useful when internal actions should flow through immediately but external actions need review.

## What's next?

- [04 · Extend & Wrap Tools](./04-extend-tools)
- [13 · Production Resilience](./13-production)