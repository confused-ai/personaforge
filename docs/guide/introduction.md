---
title: Introduction
description: Build agents, teams, and workflows in TypeScript from one package, with a clear path from first prototype to production runtime.
outline: [2, 3]
---

# Introduction

personaforge gives you three primitives for building AI systems in TypeScript: **agents**, **teams**, and **workflows**. The goal isn't to make your first version look like a platform — it's to make the first useful version small, then let it grow into a real system without changing frameworks.

## One quick example

One tool, one agent, one useful response. This is what personaforge feels like:

```ts
import { agent, tool } from 'personaforge';
import { z } from 'zod';

const getQuote = tool({
  name: 'get_quote',
  description: 'Return a stock quote for a ticker symbol.',
  parameters: z.object({ symbol: z.string() }),
  execute: async ({ symbol }) => ({ symbol, price: 927.5, changePct: 1.4 }),
});

const financeAgent = agent({
  name: 'finance-agent',
  model: 'gpt-4o-mini',
  instructions: 'Use the tool to answer market questions in one concise sentence.',
  tools: [getQuote],
});

const result = await financeAgent.run("What's NVDA trading at today?");
console.log(result.text); // "NVDA is trading at $927.50, up 1.4% today."
```

Plain application code. Explicit capabilities. Direct path from concept to working behavior.

## The three primitives

| Primitive | Use it when |
|---|---|
| **Agent** | One model-backed worker with instructions, tools, and optional state can handle the task |
| **Team** | Work should be split across specialists — supervisor, consensus, handoff, or swarm |
| **Workflow** | Execution path is staged, deterministic, or branch-aware — DAG engine with checkpoints |

Most applications should begin with one agent. Teams and workflows become useful only when one agent stops being the right unit of control.

## The growth curve

personaforge is designed so complexity grows outward from a stable center. Here's what that looks like in code:

```ts
// Stage 1: One agent (5 lines)
const bot = agent('You are a helpful assistant.');
await bot.run('What is 2+2?');

// Stage 2: Add a tool (10 lines)
import { tool } from 'personaforge';
const search = tool({ name: 'search', /* ... */ });
const bot2 = agent({ instructions: '...', tools: [search] });

// Stage 3: Add sessions (15 lines)
import { InMemorySessionStore } from 'personaforge';
const bot3 = agent({ instructions: '...', tools: [search], sessionStore: new InMemorySessionStore() });
await bot3.run('My name is Alice.', { sessionId: 'alice' });

// Stage 4: Add memory (20 lines)
import { Memory } from 'personaforge';
const bot4 = agent({ instructions: '...', tools: [search], memory: new Memory({ /* ... */ }) });

// Stage 5: Multi-agent orchestration (30 lines)
import { compose } from 'personaforge';
const pipeline = compose(researcher, writer, editor);

// Stage 6: Production serving (10 more lines)
import { createHttpService } from 'personaforge';
await createHttpService({ agent: pipeline }).listen(3000);
```

Each stage adds exactly one capability. You never rewrite — you extend. You never migrate frameworks — the same package scales with you.

## Why personaforge

### One package, no dependency hunting

```bash
npm install personaforge
```

That's it. Sessions, memory, RAG, orchestration, guardrails, circuit breakers, budget enforcement, OTLP tracing, and a control plane dashboard — all in one install. No `@langchain/core`, no `@langchain/community`, no `ai`, no `@ai-sdk/openai`, no `@mastra/core`, no `@mastra/memory`.

### Plain TypeScript, not a DSL

You write ordinary application code. Agents, tools, sessions, serving, and orchestration live alongside the rest of your system. No YAML config maps. No parallel configuration language. Just TypeScript.

### Production layers are built in, not bolted on

Sessions, retrieval, serving, observability, evaluation, approvals, and runtime controls are available when you need them. They're not prerequisites for the first hello world — but they're ready the moment you need them.

### Start small, scale naturally

The intended progression is:

1. One agent working
2. One missing capability at a time (tool, session, memory)
3. One runtime surface at a time (HTTP, schedule, orchestration)
4. Production controls as needed (guardrails, budgets, evals)

## The main layers

| Layer | When to add it |
|---|---|
| **Agent** | The first useful version — instructions, model, tools |
| **Tools** | The model needs live data or side effects |
| **Sessions** | Conversations span multiple turns |
| **Memory** | The system should remember user preferences or facts |
| **Knowledge / RAG** | Answers should come from your documents |
| **Storage** | Durable state outside the conversation loop |
| **HTTP Serving** | The agent becomes a real endpoint |
| **Orchestration** | One agent isn't enough — compose, supervise, consensus |
| **Graph Workflows** | Staged execution with branching and parallelism |
| **Guardrails** | Validate inputs, detect PII, block prompt injection |
| **HITL Approvals** | Humans review before sensitive tool calls |
| **Budget Enforcement** | Stop before the bill surprises you |
| **Observability** | Traces, metrics, logs — understand what's happening |
| **Evaluation** | Measure and regression-test agent quality |

## What the framework won against

| personaforge vs | Shipping advantage |
|---|---|
| **LangChain** | One package (not 200+). Built-in checkpoint/replay. SSRF-protected tools. |
| **Vercel AI SDK** | Full agent runtime — not just streaming primitives. Sessions, memory, teams, durability, guardrails. |
| **CrewAI** | TypeScript-native. 6 team modes vs 2. Event-sourced durability. Built-in eval. 120+ tools. |
| **LangGraph** | Same graph semantics in TypeScript — plus budgets, guardrails, OTLP, eval, control plane. |
| **Mastra** | Durable DAG engine, circuit breakers, USD budget caps, multi-tenancy, 100+ tools, enterprise audit. |
| **AutoGen / Agno** | TypeScript-native. Durable interrupts + resume. Built-in guardrails + budget enforcement. OTLP. |

## What to avoid early

Most early complexity comes from adding advanced layers before the base agent behavior is stable:

- Multi-agent orchestration before one agent has proven useful
- Several tools before one tool has proven necessary
- Runtime controls before core prompt behavior is understood
- Multiple providers before the task shape is clear

Those features are valuable later. They're just not the right place to start.

## Where to go next

- **[Getting Started](/guide/getting-started)** — full walkthrough from install to enterprise gateway
- **[Creating Agents](/guide/agents)** — complete `agent()` / `createAgent()` API reference
- **[Examples](/examples/)** — 22 runnable examples from hello-world to full-stack
- **[Framework Comparisons](/guide/comparisons)** — detailed comparisons with LangChain, CrewAI, LangGraph, Mastra, Agno
- **[Trust & Reliability](/guide/trust)** — security, test coverage, benchmarks, governance
