<p align="center">
  <img src="docs/public/logo.svg" width="120" alt="personaforge">
</p>

<h1 align="center">personaforge</h1>

<p align="center">
  <strong>Ship production AI agents in TypeScript.</strong>
  <br>
  One package. Start with a one-line agent, then add tools, sessions, retrieval,<br>
  orchestration, serving, and production controls — without ever switching frameworks.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/personaforge"><img src="https://img.shields.io/npm/v/personaforge?style=flat-square" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/personaforge?style=flat-square" alt="MIT"></a>
  <a href="https://www.npmjs.com/package/personaforge"><img src="https://img.shields.io/npm/dm/personaforge?style=flat-square" alt="downloads"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.4+-blue?style=flat-square" alt="TypeScript">
  <img src="https://img.shields.io/badge/coverage-15k+-tests-green?style=flat-square" alt="tests">
</p>

---

## What makes personaforge different

Every agent framework can spin up an agent. personaforge is the **only TypeScript framework that ships durability, multi-agent orchestration, guardrails, eval, and a control-plane dashboard in a single `npm install`.**

| Against | personaforge wins on |
|---|---|
| **LangChain** | Single package (not 200+). Built-in checkpoint/replay. MCP + A2A protocols. SSRF-protected tools. τ-bench cross-framework benchmarks. |
| **Vercel AI SDK** | Full agent runtime (not just streaming primitives). Sessions, memory, knowledge, teams, durability, guardrails, eval, control plane. |
| **CrewAI** | TypeScript-native. 6 team modes vs 2. Event-sourced durability. Built-in eval. 120+ tools. Graph DAG engine. |
| **LangGraph** | Same graph semantics in TypeScript — plus budget enforcement, guardrails, OTLP tracing, eval, and control plane in one install. |
| **Mastra** | Durable DAG engine, circuit breakers, USD budget caps, multi-tenancy, 100+ tools, and enterprise audit logging. |
| **AutoGen / Agno** | TypeScript-native. Durable interrupts + resume. Built-in guardrails + budget enforcement. OTLP tracing. Control plane dashboard. |

## One quick example

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

## Installation

```bash
npm install personaforge
# or
bun add personaforge
```

Zero-config. Treeshakeable. No peer dependencies required for basic use.

---

## Feature Overview

### 🤖 Agents & Tools

- **ReAct agent runtime** — think-act-observe loop with configurable max steps, timeout, retry, and tool error handling
- **30+ LLM providers** — OpenAI, Anthropic, Google Gemini, AWS Bedrock, Ollama, OpenRouter, and more
- **120+ built-in tools** — search (Tavily, Exa, Brave, Serper, Arxiv, PubMed, Perplexity, Reddit, YouTube), web scraping (FireCrawl, Newspaper), HTTP client with SSRF protection, filesystem, shell, browser, finance (Stripe, Yahoo), CRM, media, productivity
- **Custom tools** — define with Zod schemas, auto-JSON-schema conversion
- **Tool composition** — `compose`, `pipe`, `parallel`, `fallback`, `retry`, `timeout`, `map`, `filter`

### 🧠 Memory & Knowledge

- **4-layer memory architecture** — short-term context, long-term vector, episodic workflow history, semantic graph memory
- **Vector stores** — in-memory, SQLite, Chroma, Pinecone, Redis, with OpenAI / custom embeddings
- **RAG engine** — `createKnowledgeBase` with text splitters, BM25 indexing, hybrid RRF fusion, rerankers (Cohere, Jina, LLM), multi-query, contextual compression, parent-document, self-query, time-weighted retrievers
- **Session stores** — in-memory, SQLite (zero-server), Redis, fallback chain, PostgreSQL

### 👥 Multi-Agent Orchestration

| Mode | What it does |
|---|---|
| **Supervisor** | Manager delegates to specialists, reviews output |
| **Swarm** | Dynamic sub-agent scaling (up to 100 agents) |
| **Consensus** | Majority-vote, unanimous, or weighted voting across agents |
| **Handoff** | Agent-to-agent transfer with context |
| **Router** | Instruction/tool-based agent routing |
| **Pipeline** | Sequential agent composition |
| **GSD** | Goal-Strategy-Decomposition pattern |
| **Team** | Role-based team creation with permission isolation |

### 🔗 DAG Graph Engine

- **Directed Acyclic Graph** execution with sequential, parallel, branching, and joining topologies
- **Conditional edges** — output-driven routing (LangGraph parity): `addConditionalEdges('classify', { map: { positive: 'handle', negative: 'escalate' }, default: 'review' })`
- **State machine channels** — typed state schemas with reducers, producers, consumers
- **Event sourcing** — every run recorded to append-only log (SQLite, Redis, in-memory)
- **Deterministic replay** — re-run from log with zero LLM calls for time-travel debugging, audit, simulation
- **Tamper-evident audit** — hash-chained event log with `verifyChain()`
- **Scheduler** — cron, interval, event-driven, and delay-based execution
- **Pluggable middleware** — telemetry, logging, audit, custom plugins
- **`interrupt()` / `resume()` / `fork()`** — durable checkpoints with `DurableExecutor`

### 🛡️ Production Safety

| Capability | What it does |
|---|---|
| **Guardrails** | PII detection/redaction, prompt injection detection (pattern + heuristic + LLM), content moderation (OpenAI Moderation API), allowlists for tools/hosts/output |
| **HITL** | Human-in-the-loop approval hooks with `interrupt()` / `resume()` |
| **Budget enforcement** | Per-user, per-session, and global token/cost caps |
| **Rate limiting** | Sliding-window (in-memory + Redis) |
| **Circuit breaker** | Provider failure detection and recovery |
| **Idempotency** | Deduplication of tool calls and agent runs |
| **Graceful shutdown** | Drain active executions before shutdown |
| **Health checks** | Readiness, liveness, and dependency probes |
| **Secret management** | Pluggable backends with live secret watching |

### 📊 Observability & Eval

- **OTLP-native tracing** — OpenTelemetry spans with gen-ai semantic conventions
- **Prometheus metrics** — request counts, latency, token usage, error rates
- **LLM-as-judge** — single-criterion and multi-criteria evaluation
- **Benchmark runner** — τ-bench harness with retail/data/coding domains (13 tasks)
- **Cross-framework comparison** — scores personaforge vs LangGraph, Agno, CrewAI, Mastra on identical tasks via `benchmarks/tau-bench/PROTOCOL.md`
- **Regression detection** — `replayDataset`, `diffResults` for eval regression
- **Trace ↔ Dataset** — `spanToSample` converts production traces to eval datasets

### 🚀 Serving & Runtime

- **HTTP server** — `createHttpService` with OpenAPI generation, admin API, WebSocket transport
- **Framework adapters** — Express router, Fastify plugin, Hono route (all lazy-loaded)
- **SSE streaming** — `text/event-stream` for real-time agent responses
- **A2A protocol** — Agent-to-Agent communication server
- **Background queues** — InMemory, BullMQ, Kafka, RabbitMQ, SQS, Redis PubSub
- **Scheduled agents** — cron and interval-based execution
- **CLI** — `npx personaforge` for quick agent runs

### 🛂 Enterprise Gateway

One declarative config turns on authentication, multi-tenant isolation, RBAC,
budget enforcement, rate limiting, and durable audit — plus a board-ready
**compliance dashboard** (SOC 2, HIPAA, GDPR, ISO 27001).

```ts
import { createAgent } from 'personaforge';
import { createEnterpriseGateway } from 'personaforge/gateway';
import { apiKeyAuth } from 'personaforge/runtime';
import { createSqliteAuditStore } from 'personaforge/production';

const support = createAgent({ name: 'support', instructions: 'You are a support agent.' });
const billing = createAgent({ name: 'billing', instructions: 'You handle billing questions.' });

const gateway = createEnterpriseGateway({
  agents: { support, billing },
  auth: apiKeyAuth([process.env.GATEWAY_API_KEY!]),
  tenants: [
    {
      id: 'acme',
      monthlyBudgetUsd: 500,
      maxRpm: 60,
      allowedAgents: ['support', 'billing'],
    },
  ],
  policy: { monthlyBudgetUsd: 5000, requestTimeoutMs: 60_000 },
  auditStore: createSqliteAuditStore('./audit.db'),
});

await gateway.start(8787);
// → http://localhost:8787/compliance  (compliance dashboard)
```

| Capability | What it does |
|---|---|
| **Multi-tenant** | Per-tenant budgets, rate limits, agent allowlists, RBAC |
| **Policy engine** | Global + per-tenant USD caps, RPM limits, timeouts |
| **Audit trail** | Hashed prompts, IPs, costs, tools called — SOC 2 ready |
| **Compliance dashboard** | `/compliance` — live SOC 2 / HIPAA / GDPR / ISO 27001 controls |

### 🎛️ Control Plane Dashboard

Built-in AgentOS dashboard served by `createControlPlane()`:

| Tab | What it shows |
|---|---|
| **Overview** | Session count, eval runs, traces, pending approvals |
| **Sessions** | Browse with search, view full conversation history |
| **Memory** | Inspect vector and graph memory stores |
| **Evals** | Pass/fail rates, score distribution, run history |
| **Traces** | Waterfall timeline visualization |
| **Approvals** | HITL queue with approve/reject buttons |
| **Knowledge** | Document browser with search |
| **Chat** | Interactive playground with agent selector |
| **Graph** | DAG workflow visualizer with SVG rendering |

### 📦 Structured & Composable

- **Structured output** — unified JSON-schema generation across OpenAI, Anthropic, Gemini
- **Output parsers** — JSON (Zod-aware), CSV, Regex, output-fixing, retry-with-error
- **Runnable / LCEL** — `pipe()`, `batch()`, `stream()`, `withRetry()`, `withFallbacks()`, `assign()`
- **Event streaming** — LangGraph-style `values | updates | messages | debug | custom` modes
- **Reasoning tools** — Agno-style `think` / `analyze` scratchpad tools
- **Deep research agent** — `createDeepAgent` plan-research-synthesize recipe

---

## Three Primitives

| Primitive | When to use |
|---|---|
| **Agent** | One model-backed worker can handle the task |
| **Team** | Specialists should coordinate, delegate, or vote |
| **Workflow** | Execution path should be staged, deterministic, or branching |

## How to adopt

1. **One agent, one run** — start boring
2. **Add one capability at a time** — a tool, a session store, memory
3. **Add runtime surfaces** — HTTP serving, scheduling, eval, resilience

Each layer is optional. Most projects only need a subset.

---

## Migrate from

| From | Guide |
|---|---|
| **LangChain** | [`docs/guide/migration-langchain.md`](docs/guide/migration-langchain.md) |
| **Vercel AI SDK** | [`docs/guide/migration-vercel.md`](docs/guide/migration-vercel.md) |
| **CrewAI** | [`docs/guide/migration-crewai.md`](docs/guide/migration-crewai.md) |
| **LangGraph** | [`docs/guide/migration-langgraph.md`](docs/guide/migration-langgraph.md) |
| **Mastra** | [`docs/guide/migration-mastra.md`](docs/guide/migration-mastra.md) |
| **Agno** | [`docs/guide/migration-agno.md`](docs/guide/migration-agno.md) |
| **All frameworks** | [`docs/guide/comparisons.md`](docs/guide/comparisons.md) |
| **Trust & reliability** | [`docs/guide/trust.md`](docs/guide/trust.md) |

---

## Repository stats

| Metric | Count |
|---|---|
| Source files | 560 |
| Lines of TypeScript | 111,000+ |
| Test files | 88 |
| Lines of test code | 15,300+ |
| Built-in tools | 120+ (across 20 categories) |
| LLM provider integrations | 30+ |
| Graph DAG engine | 5,200+ lines |
| Entry points (treeshakeable) | 70+ |

## Adopters

Using personaforge in production? Add yourself to [`ADOPTERS.md`](./ADOPTERS.md).

## License

MIT
