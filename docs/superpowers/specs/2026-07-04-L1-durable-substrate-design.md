# L1 Design: The Universal Durable Substrate

**Date:** 2026-07-04
**Sub-project:** L1 of the [Durable Agent Substrate roadmap](./2026-07-04-durable-agent-substrate-roadmap.md).
**Status:** Design — awaiting review before planning.

---

## 1. Goal

Make **one** event-sourced execution log the substrate for **every** agent run in the framework — not just explicit graph workflows — with **boundary-level deterministic replay**. This unlocks L2 (simulation), L3 (self-improvement), and L4 (types) for the entire framework, and removes the duplicate-engine rot as a side effect.

## 2. Non-goals (YAGNI)

- No distributed/multi-node durability. Single-process crash-safety first.
- No new event-store backends beyond what exists (InMemory + SQLite ship; Postgres/Redis/Kafka stay bring-your-own).
- No user-facing API redesign. Existing `agent.run()`, workflow, and graph APIs keep working.
- No new orchestration patterns.

## 3. Key findings (grounded in code)

1. **`src/graph/` is already a correct durable substrate.** CQRS event sourcing: append-only `GraphEvent` log, state via `replayState()`, idempotent appends, sequence ordering, checkpoints, `InMemoryEventStore` + `SqliteEventStore`, Postgres/Redis/Kafka as bring-your-own behind the same `EventStore` interface (`src/graph/event-store.ts`, `src/graph/types.ts`). Branded ids (`ExecutionId`, `NodeId`). **This is the winner.**
2. **The base agent runner emits nothing into it.** `grep` for `EventStore|GraphEvent` across `src/agentic/`, `src/core/runner/`, `src/agent.ts` → **zero hits**. A plain `agent.run()`, its tool calls, and its LLM calls produce **no durable log**. Only explicitly-constructed graph workflows do.
3. **Determinism is node-granular, not boundary-granular.** `replayState()` (`src/graph/engine.ts:1027`) rebuilds graph state and skips nodes that already have a result (`:914`). It does **not** re-serve recorded LLM/tool outputs to a re-executing node. So you can resume a crashed workflow, but you cannot deterministically replay the *inside* of a single agent turn — which is what time-travel debugging and simulation need.
4. **`src/execution/` is the loser.** It is a separate planner-oriented Task/Plan DAG executor (`src/execution/types.ts` imports `Task, Plan` from `planner/`) with its own `StateGraph` + `InMemoryCheckpointStore`. Its durable/v2 pieces are marked `@experimental`. It duplicates what `graph/` does better.

## 4. The three deliverables

### D1 — Universalize the log
Make `src/agentic/runner.ts` (and `src/core/runner/agent-runner.ts`) emit `GraphEvent`s into an injected `EventStore` for every run. A single agent run becomes a trivial one-node graph execution (or emits the same event vocabulary directly). New event kinds needed on top of the graph node events:
- `agent.turn.start` / `agent.turn.end`
- `llm.call.start` / `llm.call.result` (with the raw response captured)
- `tool.call.start` / `tool.call.result`
- `handoff` (agent → agent / team delegation)

Default `EventStore` is `InMemoryEventStore` (zero-config, no behavior change for existing users); production injects SQLite/Postgres. **This is the unlock** — after D1, the whole framework produces the log.

### D2 — Boundary-level determinism
Record non-determinism at its source and short-circuit it on replay:
- LLM responses, tool outputs, `Date.now()`/clock reads, randomness → recorded as `*.result` events.
- A `ReplayContext` flag: when replaying, the LLM/tool boundary returns the recorded event instead of making the real call.
- Upgrade path from node-granular resume → bit-for-bit replay. Reuse the existing `replayState()` sequence machinery; extend the boundary, not the state model.

### D3 — Collapse `execution/` into `graph/`
- Map the planner Task/Plan DAG onto graph nodes (a `PlannerAdapter` that compiles a `Plan` into a `GraphDef`).
- Keep `src/execution/` public exports as a **compatibility shim** re-exporting graph-backed equivalents.
- Delete the duplicate internals **only after** a parity test suite passes against both.

## 5. Unified event model

Adopt `graph/`'s `GraphEvent` as the one event type. Extend its `GraphEventType` enum with the agent/llm/tool/handoff kinds from D1. Everything — single agents, tools, teams, workflows, graphs — emits this one vocabulary into one `EventStore`. `src/execution/`'s separate `NodeExecutionRecord` / `StateGraphSnapshot` types are dropped (covered by the shim).

## 6. Determinism contract

> Given the same recorded event log and the same graph/agent definition, replay produces identical state and identical side-effect *decisions*, without making any external call.

Enforced by: recording every external boundary as an event; a replay mode that serves recorded values; a parity test that runs a scenario live, replays it, and asserts state + emitted-event equality.

## 7. Migration & compatibility

| Consumer | Today | After L1 |
|----------|-------|----------|
| `agent.run()` | no log | emits events into injected/default `EventStore` |
| graph workflows | own log | unchanged (already canonical) |
| `src/execution/` API | own engine | shim → graph-backed |
| `eval/`, `learning/` | consume ad-hoc traces | can consume the one event log (enables L3 later) |

No breaking public API changes. New capability is opt-in via injecting a durable store; default stays in-memory.

## 8. Testing (this is where coverage jumps)

- Event-emission tests for the base runner (currently: none).
- Replay parity tests: live-run vs replay equality (the determinism contract).
- `execution/` → `graph/` parity suite (guards the delete).
- Crash-resume test: kill mid-run, resume from checkpoint, assert completion.

This sub-project alone should meaningfully move the 7% coverage number, because it forces tests onto the most important path in the framework.

## 9. Open questions (resolve during planning)

1. Should the base runner literally build a one-node `GraphDef`, or emit the shared event vocabulary directly without the graph wrapper? (Perf vs. uniformity.)
2. How much of the LLM/tool boundary already flows through a single chokepoint we can instrument? (Need to read `providers/` + `tool.ts` call sites.)
3. Replay of streaming LLM responses — record the assembled result, the token stream, or both?

## 10. Rough effort

- D1 (universalize): medium — the boundary chokepoints likely already exist; wiring + event kinds.
- D2 (determinism): medium-hard — the discipline, not the mechanism, is the work.
- D3 (collapse): medium — adapter + parity tests + delete.
- Biggest value, lowest incremental cost: **D1**. It could ship first as its own slice and immediately make every run observable/replayable.

## 11. Recommended first slice

Ship **D1 for the single-agent path only** (`agent.run()` → events into a default in-memory store, with SQLite opt-in), plus its emission tests. Smallest change that proves the thesis end-to-end and produces a real durable log for the most common shape. D2/D3 follow as their own plans.
