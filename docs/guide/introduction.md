---
title: Introduction
description: Build agents, teams, and workflows in TypeScript from one package, with a clear path from first prototype to production runtime.
outline: [2, 3]
---

# Introduction

`personaforge` gives you three primitives for building AI systems in TypeScript: **agents**, **teams**, and **workflows**. The goal is not to make the first version look like a platform. The goal is to make the first useful version small, then let it grow into a real system without changing frameworks.

## One quick example

This is the kind of example that should feel immediately understandable: one focused tool, one agent, one useful response.

```ts
import { agent, tool } from 'personaforge';
import { z } from 'zod/v3';

const getQuote = tool({
	name: 'get_quote',
	description: 'Return a stock quote for a ticker symbol.',
	parameters: z.object({ symbol: z.string() }),
	execute: async ({ symbol }) => ({
		symbol,
		price: 927.5,
		changePct: 1.4,
	}),
});

const financeAgent = agent({
	name: 'finance-agent',
	model: 'gpt-4o-mini',
	instructions: 'Use the tool to answer market questions in one concise sentence.',
	tools: [getQuote],
});

const result = await financeAgent.run("What's NVDA trading at today?");
console.log(result.text);
```

That is the intended feel of the framework: plain application code, explicit capabilities, and a direct path from concept to working behavior.

## The three main primitives

| Primitive | Use it when |
|---|---|
| Agent | one model-backed worker can handle the task with instructions, tools, and optional state |
| Team | the work should be split across specialists, handoffs, or supervised roles |
| Workflow | the execution path itself should be deterministic, staged, or branch-aware |

Most applications should begin with one agent. Teams and workflows become useful only when one agent stops being the right unit of control.

## Why personaforge

The framework is organized around a small set of engineering choices that are easy to explain and hard to outgrow.

### One package, clear public subpaths

Install `personaforge` once. Use focused public subpaths only when a module has its own runtime surface, such as sessions, orchestration, scheduling, or observability.

### Plain TypeScript, not a separate DSL

You write ordinary application code. Agents, tools, sessions, serving, and orchestration live close to the rest of your system instead of in a parallel configuration language.

### Production layers are built in, not bolted on later

Sessions, retrieval, serving, observability, evaluation, approvals, and runtime controls are available when you need them. They are not prerequisites for the first hello world.

### Start small, then add capability in layers

The intended progression is:

1. one agent
2. one missing capability at a time
3. one runtime surface at a time

## The main layers

| Layer | What it adds | Typical reason to add it |
|---|---|---|
| Agent | instructions, model selection, tool access, execution behavior | the first useful version |
| Tools | live data access and side effects | the model should stop guessing and use real systems |
| Sessions and memory | continuity and retained facts | the interaction spans several turns or should remember preferences |
| Knowledge and storage | document-backed context and durable state | answers should come from source material or persisted data |
| Runtime | HTTP delivery and scheduled execution | the agent becomes a service or job |
| Coordination | composition, teams, supervision, reasoning | the control flow or responsibility split becomes important |
| Operations | guardrails, approvals, resilience, traces, evals | the system needs production controls |

## Capabilities

The point of the framework is not just to give you a prompt wrapper. It is to give you a path from useful prototype to production system.

| Capability | What it gives you |
|---|---|
| Models | one public authoring surface with broad provider support |
| Tools | custom tools, wrappers, composition, and broader tool infrastructure |
| Sessions | continuity across runs |
| Memory | retained facts and selective recall |
| Knowledge | retrieval-backed answers from indexed source material |
| Storage | durable state outside the conversation loop |
| Orchestration | teams, supervisors, roles, tasks, and handoffs |
| Reasoning | explicit step-by-step reasoning loops when the task needs them |
| Scheduling | cron-like or queued runtime execution |
| Observability | traces, metrics, and run-level visibility |
| Evals | regression-oriented quality checks |
| Guardrails and HITL | validation, approval, and policy-driven runtime control |
| Serve | HTTP runtime for production-facing agents |

## How to approach your first build

The most reliable first pass looks like this:

1. Pick one narrow task.
2. Build one agent that handles that task.
3. Validate one successful run.
4. Add only the next missing capability.

That sequence matters because it keeps failures local. When a new layer is introduced, you should be able to tell what changed.

## What people usually add too early

Most early complexity comes from adding advanced layers before the base agent behavior is stable. The usual examples are:

- multi-agent orchestration before one agent has proven useful
- several tools before one tool has proven necessary
- runtime controls before the core prompt behavior is known
- multiple providers before the task shape is clear

Those features are valuable later. They are just not the right place to start.

## Where to go next

- Read `getting-started.md` for the first implementation path.
- Read `concepts.md` for the layered mental model.
- Read [Framework Comparisons](./comparisons) to see how personaforge compares to LangChain, CrewAI, LangGraph, Mastra, and Agno.
- Read [Trust & Reliability](./trust) for security policy, test coverage, benchmarks, and governance.
- Read `examples/index.md` for runnable patterns by difficulty.
- Read `api/` when you want a compact map of the public surfaces.