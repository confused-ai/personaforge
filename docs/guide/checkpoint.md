---
title: Durable Interrupt & Resume
description: LangGraph-style interrupt(), resume(), and fork-from-checkpoint — pause agent execution at any node, persist state, and resume or branch from any saved point.
outline: [2, 3]
---

# Durable Interrupt & Resume

The `confused-ai/checkpoint` module lets any graph node pause execution via `interrupt()`, persist a checkpoint, and resume later when a human (or external system) provides a value. Fork-from-checkpoint clones any saved state into a new thread for time-travel exploration.

```ts
import {
  DurableExecutor, InMemoryCheckpointStore, InterruptSignal,
} from 'confused-ai/checkpoint';
```

---

## Quick start

```ts
import type { NodeFn } from 'confused-ai/checkpoint';

const askApproval: NodeFn = (input, ctx) => {
  const value = ctx.interrupt({ question: 'Approve this transfer?' });
  return { input, approved: value };
};

const execute: NodeFn = (data) => ({ ...data, done: true });

const exec = new DurableExecutor({
  nodes: [['ask', askApproval], ['execute', execute]],
});

// Run — pauses at the interrupt
const r1 = await exec.run({ amount: 500 });
// r1.interrupted === true
// r1.interruptPayload === { question: 'Approve this transfer?' }

// Resume — passes a value back into the paused node
const r2 = await exec.resume(r1.threadId, { ok: true });
// r2.output === { input: { amount: 500 }, approved: { ok: true }, done: true }
```

---

## How it works

1. `interrupt(payload)` throws an `InterruptSignal` that the executor catches.
2. The executor persists a `Checkpoint` (state, history, pending input) to the `CheckpointStore`.
3. `resume(threadId, value)` re-runs the graph from the interrupted node, but this time `interrupt()` **returns** the resume value instead of throwing.
4. Execution continues past the pause point with no side-effect replay.

---

## Fork-from-checkpoint

Clone any saved checkpoint into a new thread:

```ts
const forkedThread = await exec.fork(originalThread);
await exec.resume(forkedThread, { ok: false });  // explore a different branch
```

---

## Pluggable `CheckpointStore`

The default `InMemoryCheckpointStore` is suitable for development. For production, implement the interface:

```ts
interface CheckpointStore {
  save(cp: Checkpoint): Promise<void>;
  load(threadId: string): Promise<Checkpoint | null>;
  loadById(checkpointId: string): Promise<Checkpoint | null>;
  list(threadId: string): Promise<Checkpoint[]>;
  delete(threadId: string): Promise<void>;
}
```

A SQLite or Postgres implementation follows the same pattern as `SqliteSessionStore`.

---

## Checkpoint shape

```ts
interface Checkpoint {
  id: string;
  threadId: string;
  node: string;                     // which node paused
  interruptPayload: unknown;       // data passed to interrupt()
  state: Record<string, unknown>;  // accumulated per-node outputs
  history: Array<{ node; output }>;
  pendingInput: unknown;           // input that was flowing into the paused node
  createdAt: number;
}
```

---

## Related pages

- [Graph Engine](/guide/graph) — event-sourced, replayable execution.
- [Human-in-the-Loop](/guide/hitl) — approval-based pauses.
