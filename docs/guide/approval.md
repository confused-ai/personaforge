---
title: Agent Approval
description: Human-in-the-loop tool approval and self-suspension. Suspend a tool call before execution or mid-execution, persist pending runs, and approve, decline, or resume.
outline: [2, 3]
---

# Agent Approval

`personaforge/approval` provides the signals and stores for human-in-the-loop agent control. Two suspension mechanisms are supported:

- **Before execution** — a tool call is paused before `execute` runs when `requireApproval` / `needsApproval` is set on the tool (or `requireToolApproval` on the run).
- **Mid-execution** — a tool self-pauses by calling `context.agent.suspend(payload)` to request more input.

```ts
import {
  isApprovalRequiredError,
  isToolSuspendedError,
  InMemorySuspendedRunStore,
  createSqliteSuspendedRunStore,
} from 'personaforge/approval';
```

---

## Signals

### `ApprovalRequiredError`

Raised *before* a tool executes when approval is required. The `toolCall` and `step` are attached for inspection:

```ts
import { isApprovalRequiredError } from 'personaforge/approval';

try {
  await agent.run('Send an email to bob@example.com');
} catch (err) {
  if (isApprovalRequiredError(err)) {
    console.log(`Tool ${err.toolName} needs approval (args:`, err.args, ')');
    // answer via the durable agent / approval store, or surface to a human UI.
  }
}
```

### `ToolSuspendedError`

Raised *inside* a tool's `execute` when it calls `context.agent.suspend(payload)`:

```ts
import { tool } from 'personaforge';

const collectAddress = tool({
  name: 'collect_address',
  description: 'Collect a shipping address.',
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }, ctx) => {
    // Pause and ask for more input instead of failing:
    ctx.agent.suspend({ orderId, question: 'Please provide the shipping address.' });
    // Unreachable — suspend() never returns.
  },
});
```

---

## Suspended-run store

Pending approvals / suspensions are persisted as `SuspendedRun` records so a later request (after a restart, or from a different server) can rediscover and answer them.

### In-memory (development)

```ts
import { InMemorySuspendedRunStore } from 'personaforge/approval';

const store = new InMemorySuspendedRunStore();
```

### SQLite (production)

```ts
import { createSqliteSuspendedRunStore } from 'personaforge/approval';

const store = createSqliteSuspendedRunStore('./agent.db');
await store.save({
  runId: 'run_123',
  agentId: 'support-bot',
  threadId: 't1',
  resourceId: 'user-7',
  status: 'approval',
  toolCalls: [{
    toolCallId: 'call_1',
    toolName: 'send_invoice',
    args: { customerId: 'c1', amount: 500 },
    requiresApproval: true,
  }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const pending = await store.list({ threadId: 't1' });
await store.markResolved('run_123');
```

---

## Run-scoped approval

For run-wide approval policy, use `requireToolApproval` in the agent run options — boolean for every tool, or a function for per-call decisions (fails closed):

```ts
await agent.run('Deploy to prod', {
  requireToolApproval: ({ toolName, args }) =>
    toolName === 'deploy' && args.environment === 'production',
});
```

Use `approvedToolCalls` to carry already-approved call ids into a resumed run:

```ts
await agent.run('Deploy to prod', {
  approvedToolCalls: ['call_789'],
});
```

---

## Integration with durable agents

Durable runs expose `approveToolCall`, `declineToolCall`, `resumeStream`, and `listSuspendedRuns` directly. See [Durable Agents](./durable) for the full flow.

---

## Related pages

- [Durable Agents](./durable) — resumable, replayable runs with approval wiring.
- [Human-in-the-Loop (HITL)](./hitl) — the production approval store + HTTP endpoints.
- [Tools](./tools) — `needsApproval` / `requireApproval` on `tool()`.