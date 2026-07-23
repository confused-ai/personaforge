# personaforge
<a href="https://www.producthunt.com/products/personaforge?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-personaforge" target="_blank" rel="noopener noreferrer"><img alt="personaforge - Build AI agents, teams, and workflows in TypeScript | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1146700&theme=light&t=1778823847031"></a>

`personaforge` is a TypeScript agent framework built around one stable install story: start with a single package, ship one useful agent, then layer tools, retrieval, sessions, serving, orchestration, and production controls without changing frameworks midway through the project.

## One quick example

```ts
import { agent, tool } from 'personaforge';
import { z } from 'zod/v3';

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
console.log(result.text);
```

The intended feel is simple: plain TypeScript, one explicit capability at a time, and a direct path from small prototype to production-ready runtime.

## What it is for

Use `personaforge` when you want to build one of these shapes from the same public API surface:

- a single agent that answers, summarizes, or classifies
- a tool-backed assistant that reads live application data or triggers side effects
- a retrieval-backed system that answers from documents or indexed knowledge
- a served application with sessions, resilience, and observability
- a multi-agent workflow with delegation, routing, or explicit reasoning steps

The design goal is not to force every feature on day one. The design goal is to let the first useful version stay small while keeping a direct path to a larger system.

## Three primitives

| Primitive | Use it when |
|---|---|
| Agent | one model-backed worker can handle the task |
| Team | specialists should coordinate or delegate work |
| Workflow | the execution path should be staged, deterministic, or branching |

These three shapes cover most systems in the framework. The difference is not branding. The difference is how control flows through the application.

## How to approach the framework

The cleanest adoption path is:

1. Start with one agent and one successful run.
2. Add one missing capability at a time, usually a tool, a session store, or retrieval.
3. Add runtime surfaces such as HTTP serving, scheduling, evaluation, or resilience only after the base behavior is correct.

That order matters because it keeps the model behavior understandable before infrastructure complexity gets involved.

## Public package story

The public install story is intentionally simple.

| Import path | Use it for |
|---|---|
| `personaforge` | core agent authoring, composition, and common entry points |
| `personaforge/session` | session stores and continuity |
| `personaforge/serve` | HTTP runtime |
| `personaforge/tool` | MCP and broader tool infrastructure |
| `personaforge/orchestration` | teams, supervisors, roles, and tasks |
| `personaforge/reasoning` | explicit reasoning steps and events |
| `personaforge/scheduler` | scheduled jobs and run history |
| `personaforge/observe` | traces, metrics, and evaluation workflows |
| `personaforge/adapters` | infrastructure adapters and bindings |
| `personaforge/guard` | runtime control primitives such as circuit breakers |

Avoid internal `@personaforge/*` package imports in application code and public documentation. Those paths describe the monorepo layout, not the intended consumer API.

## Core building blocks

The framework stays understandable if you think in layers:

- Agents are the unit that owns instructions, model selection, tools, and runtime behavior.
- Tools are the bridge to live data, side effects, and application-specific capabilities.
- Sessions, memory, knowledge, and storage add continuity or external context.
- Serving, scheduling, and orchestration control how and when the agent runs.
- Observability, budgets, approvals, and resilience turn a useful agent into an operable system.

Each layer is optional. Most real projects only need a subset.

## Capabilities

| Capability | What it gives you |
|---|---|
| Tools | explicit boundaries for live data and side effects |
| Sessions | continuity across turns |
| Memory | retained facts and selective recall |
| Knowledge | retrieval-backed answers from indexed content |
| Storage | durable state around the agent |
| Serve | HTTP runtime for real applications |
| Orchestration | teams, supervisors, roles, and routing |
| Reasoning | explicit reasoning loops when the task needs them |
| Scheduler | time-based execution for reports, digests, and automation |
| Observe | traces, metrics, and evaluation workflows |
| Guardrails and HITL | validation, approvals, and policy-driven runtime control |
| Graph | durable, replayable execution with tamper-evident audit |
| Compression | keep long-running contexts within model token limits |
| Learning | simulate runs and improve behavior from recorded outcomes |
| Advanced Retrieval | text splitters, BM25, hybrid RRF, rerankers, and retriever primitives (`personaforge/knowledge`) |
| Runnable / LCEL | composable `Runnable` primitive with pipe/batch/stream/withRetry/withFallbacks/assign (`personaforge/runnable`) |
| Output Parsers | JSON (Zod-aware), CSV, Regex, output-fixing, retry-with-error (`personaforge/parsers`) |
| Structured Output | unified native JSON-schema output across OpenAI, Anthropic, Gemini (`personaforge/structured`) |
| Event Streaming | LangGraph-style values/updates/messages/debug/custom event bus (`personaforge/streaming`) |
| Durable Interrupt | `interrupt()` / `resume()` / fork-from-checkpoint (`personaforge/checkpoint`) |
| Reasoning Tools | Agno-style `think` / `analyze` scratchpad tools (`personaforge/reasoning`) |
| Team Modes | `createModeTeam` with route / coordinate / collaborate (`personaforge/orchestration`) |
| Model Fallbacks | `withFallbacks(primary, [alt1, alt2])`, `withRetry(...)` (`personaforge/models`) |
| Toolkits | SQL, HTTP, File toolkits with prompt fragments (`personaforge/toolkits`) |
| Deep Research | `createDeepAgent` plan-research-synthesize recipe (`personaforge/skills`) |
| Trace ↔ Dataset | `spanToSample`, `replayDataset`, `diffResults` for regression eval (`personaforge/eval`) |
| Control Plane | zero-dep AgentOS dashboard: sessions, memory, evals, traces, approvals, chat (`personaforge/control-plane`) |

## Enterprise and compliance

For regulated or high-assurance deployments, the graph engine is event-sourced end to end (`personaforge/graph`), which unlocks a compliance and operations layer on top of any agent or workflow:

| Capability | What it gives you | Guide |
|---|---|---|
| Event sourcing | every run recorded to a durable, file-backed log (`SqliteEventStore`, `BatchingEventStore`) | `docs/guide/graph.md` |
| Deterministic replay | re-run a recorded execution with zero external calls for time-travel debugging and sims | `docs/guide/graph.md` |
| Tamper-evident audit | hash-chained event log verified with `verifyChain` to prove the record was not altered | `docs/guide/graph.md` |
| PII and secret redaction | `RunRecorder` scrubs secrets and free-text PII before anything is persisted | `docs/guide/graph.md` |
| Right-to-erasure | `EventStore.purge()` deletes every event for one execution (GDPR) | `docs/guide/graph.md` |
| Distributed execution | fan a graph across workers with a shared task queue | `docs/guide/graph.md` |
| Multi-tenancy | per-tenant isolation and configuration via `createTenantContext` and `TenantRegistry` | `docs/guide/multi-tenancy.md` |
| Admin API | health, audit log, pending approvals, and throughput endpoints | `docs/guide/admin-api.md` |
| Secret management | pluggable backends with versioning and live secret watching | `docs/guide/secret-manager.md` |

Guardrails, HITL approvals, and budget controls (see above) round out the runtime policy layer.

## Recommended reading order

If you are new to the repo, follow this order:

1. `docs/guide/introduction.md` for the mental model and product story.
2. `docs/guide/getting-started.md` for the first implementation path.
3. `docs/examples/index.md` for runnable examples by difficulty.
4. `docs/guide/` pages for capability-specific guidance.
5. `docs/api/` pages for a compact public API map.

## What to build first

The first milestone should be boring on purpose:

- one prompt
- one model
- one agent
- one verified output

Once that path is correct, the rest of the framework becomes a set of focused additions rather than a wall of concepts to learn up front.