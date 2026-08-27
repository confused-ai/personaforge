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

## Shaping approval/suspension payloads for a UI

`err.args` / `payload` above are the raw values used for the model feedback loop and for persistence in the suspended-run store — they are never redacted automatically. If a tool's arguments or suspend payload shouldn't be shown verbatim in a browser stream or transcript, define `displayInput()` (or `toDisplayInput`) on the tool; the runner applies it before calling `streamHooks.onApproval` / `onSuspended`, while what's persisted to the suspended-run store and replayed on resume stays raw:

```ts
import { tool } from 'personaforge';

const chargeCard = tool({
  name: 'charge_card',
  description: 'Charge a customer credit card.',
  parameters: z.object({ cardNumber: z.string(), amount: z.number() }),
  needsApproval: true,
  execute: async ({ cardNumber, amount }) => paymentGateway.charge(cardNumber, amount),
}).displayInput((input) => ({ ...input, cardNumber: `••••${input.cardNumber.slice(-4)}` }));

await agent.run('Charge $50 to card 4111111111111111', {
  onApproval: ({ toolName, args }) => {
    // args.cardNumber is masked here — the model and the approval store
    // still see/persist the full card number.
    console.log(`${toolName} needs approval:`, args);
  },
});
```

See [Custom Tools](./custom-tools#shaping-output-for-the-model-vs-for-the-ui) for the full set of display hooks (`display()`, `displayInput()`, `displayError()`).

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