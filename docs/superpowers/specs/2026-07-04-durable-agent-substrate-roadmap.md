# Roadmap: The Durable Agent Substrate

**Date:** 2026-07-04
**Status:** Strategy approved (directional). Sub-project specs to follow.
**One line:** Turn `personaforge` from a wide-but-shallow feature race into the one framework that owns *durable, replayable, self-improving, type-provable* agent execution — by building a single event-sourced substrate and exposing four superpowers as thin layers over it.

---

## 1. The situation (honest)

- **531 source files, 39 test files (~789 tests).** That's a low *file-level* test-presence ratio (~7% of source files have a sibling test) — not a line-coverage figure. The framework out-features LangGraph, Mastra, Agno, CrewAI, and the Vercel AI SDK on surface area, while many modules have no direct tests at all.
- **Two execution engines exist in parallel:** `src/execution/` (`engine.ts`, `engine-v2.ts`, `state-graph.ts`, `workflow.ts`, `durable.ts`) and `src/graph/` (`engine.ts`, `scheduler.ts`, `orchestrator.ts`, `event-store.ts`). Same job, two implementations. Prior notes already flag "type divergence" and "de-dup pending."
- **Diagnosis:** growth by accretion. The framework is big because concepts were re-implemented, not because it's deep. Adding feature #200 makes this worse.

**Conclusion:** the winning move is not more features. It is depth in *one hard thing nobody has nailed* — and that same work removes the duplication rot.

## 2. The thesis: four picks, one stack

The four ambitions (durable runtime, simulation, self-improvement, type-provability) are **not four features**. They are four payoffs of building **one durable event log** correctly:

```
┌──────────────────────────────────────────────┐
│  L4  TYPE-PROVABLE   compile-time skin         │  types over the log
├──────────────────────────────────────────────┤
│  L3  SELF-IMPROVING  mine failures → optimize  │  the log IS training data
├──────────────────────────────────────────────┤
│  L2  SIMULATION      replay vs synthetic input │  the log IS the test corpus
├──────────────────────────────────────────────┤
│  L1  DURABLE LOG     one event-sourced runtime │  THE substrate (unifies the two engines)
└──────────────────────────────────────────────┘
```

Every agent run becomes an append-only, deterministic event log. Once that exists:
- **Replay it against fabricated inputs** → simulation / wind-tunnel. Nearly free.
- **Mine its failure events** → training data for prompt/route optimization. Nearly free.
- **The log itself** → crash-safe durable execution, time-travel debugging, fork/rewind/branch.
- **Type the events** → provable handoffs, budget ceilings, exhaustive tool routing.

No competitor ships all four from one substrate. Most bolt them on as separate products, or skip them.

## 3. Sequencing (dependency-forced)

| # | Layer | Why this order | Existing bones | Where the real build is |
|---|-------|----------------|----------------|-------------------------|
| **L1** | Durable substrate | Root dependency; also kills duplicate-engine rot | `execution/durable.ts` (331), `graph/event-store.ts` (277), `graph/engine.ts` (1133), replay benchmark | Unify two engines behind one event model + deterministic replay |
| **L2** | Simulation wind-tunnel | Replay harness over L1; *also raises the 7% coverage* | `graph/testing/graph-runner.ts`, `eval/` (real: llm-judge, regression, benchmark) | Synthetic-input generation, adversarial agents, statistical assertions |
| **L3** | Self-improving loop | Consumes L1 failure traces + L2 sim results | `learning/` (real, DB-backed), `optimize/` (**only 137 lines**), `eval/finetune.ts` | The failure→optimize→eval-gate→ship loop. Biggest net-new build. |
| **L4** | Type-provable agents | Polish skin over stable L1 events | `contracts/`, existing Zod usage | Typed event contracts, budget-as-type, exhaustive routing proofs |

Each layer is its **own** spec → plan → build cycle. They are not merged into one spec — that would repeat the accretion mistake.

## 4. The "world-first" claim per layer

- **L1** — Agent runs that survive process death and replay *deterministically bit-for-bit*, with time-travel fork/rewind. Temporal-grade durability, but native to agent semantics (tools, LLM calls, handoffs), in TypeScript. Rare and hard.
- **L2** — Agents get a real test harness: thousands of simulated + adversarial conversations, statistical behavior assertions, before deploy. "A wind tunnel for agents."
- **L3** — Agents that measurably improve in production: mine their own failures, A/B their own prompts/routes, ship eval-gated improvements. Continuous DSPy, online.
- **L4** — The type system catches agent bugs before runtime: provable termination, budget ceilings enforced at compile time, exhaustive handoff routing. No JS/TS agent framework has this.

## 5. Risks & mitigations

- **Unifying two engines is invasive.** Mitigate: L1 ships a compatibility shim so both old public APIs keep working while internals converge; delete the loser only once tests prove parity.
- **Determinism is hard with LLM calls.** Mitigate: record-and-replay non-determinism at the boundary (LLM responses, tool I/O, clocks, randomness) — the standard durable-execution playbook. This repo already has the record side (event-store); the gap is disciplined replay.
- **Scope creep back into feature-adding.** Mitigate: each layer has a hard YAGNI list (below). No new providers/integrations during this arc.

## 6. Explicitly NOT doing (YAGNI)

- No new model providers, vector DBs, or integrations during this arc.
- No new orchestration patterns until L1 is the single engine.
- No distributed/multi-node durability in L1 (single-process crash-safety first; cluster later only if demand is real).
- No new docs marketing surface until L1+L2 are real and tested.

## 7. Immediate next step

Sub-project **L1 (durable substrate)** gets a full design doc next, grounded in a read of both engines. That design decides: the unified event model, the deterministic replay contract, the compatibility shim, and the delete plan for the losing engine.
