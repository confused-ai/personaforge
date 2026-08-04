2---
title: Durable Agents
description: Long-running, resumable agent execution with replay, approval, suspend/resume, and crash recovery via personaforge/durable.
outline: [2, 3]
---

# Durable Agents

`personaforge/durable` wraps any agent so its agentic loop runs in the background, publishes every event to a per-run topic, and lets late subscribers **replay or reconnect** without missing a chunk. Runs survive process restarts when backed by a Redis server cache and a suspended-run store.

```ts
import { createDurableAgent } from 'personaforge/durable';
```

---

## Quick start

```ts
import { createDurableAgent } from 'personaforge/durable';
import { agent } from 'personaforge';

const researcher = agent('You research topics and return findings.');

const durable = createDurableAgent({ agent: researcher });

// Start a run — the agentic loop runs in the background.
const { runId, output, cleanup } = await durable.stream('Research TypeScript 5');

// Consume events as they arrive (text, tool, approval, goal, run-finish).
for await (const event of output.fullStream) {
  if (event.type === 'text-delta') process.stdout.write(event.delta);
}
const final = await output.runResult;

// Clean up the run subscriptions / timers when you're done.
cleanup();
```

### Reconnect from another client

A client can disconnect and reconnect to a live run without missing chunks. Cached events are replayed first, then live ones:

```ts
// From any client, with the runId:
const { output } = await durable.observe(runId);
for await (const event of output.fullStream) { /* replay + live */ }
```

---

## Event output

`DurableAgentOutput` exposes independent async-iterable feeds (they never share a generator, so you can consume both):

| Property | Type | Description |
|---|---|---|
| `fullStream` | `AsyncIterable<DurableRunEvent>` | All events in order (`text-delta`, `tool-call`, `run-finish`, …) |
| `textStream` | `AsyncIterable<string>` | Text deltas only |
| `object` | `Promise<unknown>` | Final structured output (`run.object`) |
| `runResult` | `Promise<AgentRunResult>` | Final run result |

Each `DurableRunEvent` is a `StreamChunk` stamped with `seq` (monotonic ordering) and `at` (ISO timestamp), so consumers can dedupe and order across reconnects.

---

## Evented (fire-and-forget) mode

`createEventedAgent` starts runs and immediately closes the topic — ideal for webhooks / queue workers that don't need the caller to wait:

```ts
import { createEventedAgent } from 'personaforge/durable';

const durable = createEventedAgent({ agent: researcher });
await durable.stream('Process this ticket'); // returns immediately
```

---

## Human-in-the-loop on durable runs

Durable runs integrate with `personaforge/approval`: tools with `requireApproval` (or `needsApproval`) pause before executing, and `suspend()`-based tools pause mid-execution. Approve or decline without losing the run:

```ts
// A pending approval pauses the run and stores a SuspendedRun record.
const { output } = await durable.stream('Send an invoice to cust-123');

// The caller (or an admin UI) answers:
await durable.approveToolCall({ runId, toolCallId: 'call_123' });
// or
await durable.declineToolCall({ runId, toolCallId: 'call_123' });

// Resume a self-suspended tool with data:
await durable.resumeStream({ approved: true }, { runId, toolCallId: 'call_123' });

// Rediscover pending runs for a conversation (even after a restart):
const { runs } = await durable.listSuspendedRuns({ threadId: 't1', resourceId: 'user-7' });
```

---

## Crash recovery

Runs stuck in `running` status after a process crash can be re-driven from the last snapshot. Tools must be idempotent — LLM + tool calls are re-issued:

```ts
const { recovered, succeeded, failed } = await durable.recoverActiveRuns();
// Recover a specific run:
await durable.recoverActiveRuns({ runId: 'run_...' });
```

---

## Production persistence

By default runs use in-process caches and an in-memory suspended-run store — fine for a single process. For multi-replica deployments:

```ts
import { createDurableAgent, InMemoryServerCache } from 'personaforge/durable';
import { createSqliteSuspendedRunStore } from 'personaforge/approval';

const durable = createDurableAgent({
  agent: researcher,
  // Redis-backed cache → cached events survive restarts / scale across replicas.
  cache: InMemoryServerCache.fromRedis(process.env.REDIS_URL!),
  // SQLite suspended-run store → approvals survive restarts.
  suspendedStore: createSqliteSuspendedRunStore('./agent.db'),
});
```

You can also pass any `ioredis`-compatible `ServerCache` implementation.

---

## `untilIdle` / max idle time

By default `stream()` keeps the topic open for `maxIdleMs` (default 5 minutes) after completion so late observers can still read. `evented` mode closes immediately. Tune with:

```ts
const durable = createDurableAgent({ agent: researcher, maxIdleMs: 60_000 });
```

---

## Related pages

- [Approval (HITL)](./hitl) — tool approval / suspension signals and stores.
- [Memory](./memory) — thread-scoped, durable conversation state.
- [Processors](./processors) — input/output/error guardrails.
- [Goals](./goals) — durable, judge-scored objectives.