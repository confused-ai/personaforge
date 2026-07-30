---
title: Framework Comparisons
description: How personaforge compares to LangChain, Vercel AI SDK, CrewAI, LangGraph, Mastra, and Agno — capability matrix, migration guides, and τ-bench cross-framework benchmarks.
outline: [2, 3]
---

# Framework Comparisons

`personaforge` is built for teams that outgrow streaming primitives or Python-only runtimes and need **TypeScript-native agents with production controls built in** — not bolted on later.

Use this page to pick the right migration guide, or scan the capability matrix below.

---

## Capability matrix

<ComparisonMatrix />

---

## Where personaforge wins

| Against | personaforge wins on |
|---|---|
| **LangChain** | Single package (not 200+). Built-in checkpoint/replay. MCP + A2A protocols. SSRF-protected tools. τ-bench cross-framework benchmarks. |
| **Vercel AI SDK** | Full agent runtime (not just streaming primitives). Sessions, memory, knowledge, teams, durability, guardrails, eval, control plane. |
| **CrewAI** | TypeScript-native. 6 team modes vs 2. Event-sourced durability. Built-in eval. 120+ tools. Graph DAG engine. |
| **LangGraph** | Same graph semantics in TypeScript — plus budget enforcement, guardrails, OTLP tracing, eval, and a control-plane dashboard in one install. |
| **Mastra** | Durable DAG engine, circuit breakers, USD budget caps, multi-tenancy, 100+ tools, and enterprise audit logging — not just typed step workflows. |
| **AutoGen / Agno** | TypeScript-native. Durable interrupts + resume. Built-in guardrails + budget enforcement. OTLP tracing. Control-plane dashboard. |

---

## Migrate from

Each guide follows the same structure: **quick comparison table → side-by-side code → where to go next**.

| Framework | Guide | Best for |
|---|---|---|
| **LangChain** | [Migrate From LangChain](./migration-langchain) | Chains, LCEL, retrievers, AgentExecutor |
| **Vercel AI SDK** | [Migrate From Vercel AI SDK](./migration-vercel) | `streamText`, `generateText`, `useChat` |
| **CrewAI** | [Migrate From CrewAI](./migration-crewai) | Role-based crews, tasks, hierarchical process |
| **LangGraph** | [Migrate From LangGraph](./migration-langgraph) | StateGraph, conditional edges, checkpointers |
| **Mastra** | [Migrate From Mastra](./migration-mastra) | Typed step workflows, agents, MCP |
| **Agno** | [Migrate From Agno](./migration-agno) | Python agents, teams, reasoning tools, knowledge |

---

## Cross-framework benchmarks

`personaforge` ships a τ-bench harness that runs **identical tool-calling tasks** against personaforge, LangGraph, Agno, CrewAI, and Mastra. Scores are verifier-based (tool-call arguments and ordering), not prose style — so results are reproducible in CI.

```bash
# Hermetic (mock LLM, always in CI)
bun run test tests/tau-bench-hermetic.test.ts

# Head-to-head vs Agno (requires agno server)
bun examples/agno-vs-personaforge.ts
```

See [`benchmarks/tau-bench/`](https://github.com/confused-ai/personaforge/tree/main/benchmarks/tau-bench) and [`PROTOCOL.md`](https://github.com/confused-ai/personaforge/blob/main/benchmarks/tau-bench/PROTOCOL.md) for the full protocol.

---

## Feature parity callouts

Some personaforge modules intentionally mirror familiar patterns from other frameworks:

| Pattern | personaforge module | Inspired by |
|---|---|---|
| `interrupt()` / `resume()` | [Durable Interrupt & Resume](./checkpoint) | LangGraph checkpointers |
| `values \| updates \| messages` stream modes | [Event Streaming](./event-streaming) | LangGraph stream protocol |
| `think` / `analyze` scratchpad tools | [Reasoning Tools](./reasoning-tools) | Agno reasoning tools |
| Typed step workflows | [Execution Workflows](./workflows) | Mastra workflows |

These are **API-compatible concepts**, not wrappers — you get the same mental model with TypeScript-native types and production middleware included.

---

## Where to go next

- [Trust & Reliability](./trust) — security, testing, benchmarks, and governance.
- [Getting Started](./getting-started) — first agent in minutes.
- [Core Concepts](./concepts) — agents, teams, workflows mental model.
- [Evaluation & Benchmarking](./eval) — built-in eval and regression detection.
