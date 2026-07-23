---
title: 17 · Full Framework Showcase
description: A guided tour of every personaforge module — what each one does, when to add it, and how the layers fit together in a real application.
outline: [2, 3]
---

# 17 · Full Framework Showcase

This page is the platform map. It shows how every module fits together and gives you a concrete, runnable starting point before describing what to layer on top.

---

## What you'll learn

- The full module layout and when each layer applies
- A complete runnable slice using the most common modules
- The recommended order for adding complexity
- Which module to reach for in common scenarios

---

## Runnable starting point

This is the right baseline for most applications: one agent, one tool, session continuity, and an HTTP service.

```ts
import { z } from 'zod/v3';
import { createAgent, tool } from 'personaforge';
import { InMemorySessionStore } from 'personaforge/session';
import { createHttpService, listenService } from 'personaforge/serve';

const lookupStorePolicy = tool({
  name: 'lookup_store_policy',
  description: 'Return the store policy for a given topic.',
  parameters: z.object({ topic: z.string() }),
  execute: async ({ topic }) => ({
    topic,
    policy: `Policy for "${topic}": 30-day return window, manager approval required after day 30.`,
  }),
});

const storeOps = createAgent({
  name: 'store-ops',
  instructions: 'Help store managers with policy questions and stock issues.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [lookupStorePolicy],
  sessionStore: new InMemorySessionStore(),
});

const service = createHttpService({
  agents: { storeOps },
  cors: '*',
});

void listenService(service, 8787);
console.log('Running on http://localhost:8787');
```

---

## Platform module map

### Agent creation

| API | Use when |
|---|---|
| `createAgent()` / `agent()` | Standard agent authoring — start here |
| `defineAgent()` | Typed input/output contracts for API boundaries |
| `bare()` | Minimal agent for pipelines and tests — no sessions, no guardrails |

### Tools

| Module | Use when |
|---|---|
| `tool()` from `personaforge` | Simple custom tools attached to one agent |
| `extendTool()` / `wrapTool()` | Add logging, caching, or fallbacks to an existing tool |
| `loadMcpToolsFromUrl()` from `personaforge/tool` | Load tools from a remote MCP server |
| `createMcpServer()` from `personaforge/tool` | Expose your tool registry to external clients |

### State and memory

| Module | Use when |
|---|---|
| `personaforge/session` | Conversation continuity across turns |
| `InMemoryStore` / `memoryStore` | Long-term agent recall (facts, preferences) |
| `personaforge/knowledge` | Retrieval-backed answers from documents or policies |
| `personaforge/storage` | Durable application state (caches, run metadata, config) |

### HTTP and real-time

| Module | Use when |
|---|---|
| `personaforge/serve` | REST, SSE, and OpenAPI-compatible HTTP runtime |
| `personaforge/websocket` | Persistent bidirectional connections |
| `personaforge/voice` | Real-time voice interactions |
| `personaforge/video` | Video understanding and frame analysis |

### Orchestration and workflows

| Module | Use when |
|---|---|
| `compose()` / `pipe()` | Sequential agent pipelines with optional branching |
| `createGraph()` from `personaforge` | DAG workflows with fan-out, join, retry, and checkpoints |
| `personaforge/orchestration` | Multi-agent teams, supervisors, and role-based delegation |

### Production and reliability

| Module | Use when |
|---|---|
| `withResilience()` from `personaforge/production` | Circuit breaker, rate limits, retry, and health checks |
| `budget` on `createAgent()` | Hard token and cost caps |
| `checkpointStore` on `createAgent()` | Durable resume across process restarts |
| `personaforge/guard` | Guardrails for input/output safety |
| `personaforge/production` (approvals) | Human-in-the-loop approval flows |

### Observability and evaluation

| Module | Use when |
|---|---|
| Lifecycle `hooks` on `createAgent()` | Lightweight logging and tracing |
| `personaforge/observe` | Metrics, structured traces, eval suites |
| `runEvalSuite()` | Regression testing in CI |

### Schedulers and background work

| Module | Use when |
|---|---|
| `personaforge/scheduler` | Cron-based scheduled agent runs |
| `personaforge/queue` | Background job queues for async agent runs |

---

## Decision guide: what to add next

**The agent gives wrong or outdated answers?**
→ Add `knowledgebase` with a `KnowledgeEngine` pointing at your documents.

**Users return for follow-up questions but context is lost?**
→ Add `sessionStore` with a persistent `SqliteSessionStore`.

**The agent keeps repeating the same preferences incorrectly?**
→ Add `memoryStore` so the agent retains learned facts.

**Seeing occasional 429 or timeout errors from the LLM?**
→ Wrap with `withResilience()` and set `circuitBreaker` + `rateLimit`.

**Need to scale tool calls across multiple models or control cost?**
→ Use `createSmartRouter()` or `createCostOptimizedRouter()` as the `llm` option.

**Multiple agents need to collaborate on a task?**
→ Use `createTeam()` or `createSupervisor()` from `personaforge/orchestration`.

**A pipeline step should run on a schedule, not on demand?**
→ Add `ScheduleManager` from `personaforge/scheduler`.

**Need to review sensitive tool actions before they execute?**
→ Set `needsApproval: true` on the tool and add `approvalStore` to the HTTP service.

---

## Recommended rollout order

1. **One agent + one tool** — prove the core interaction works.
2. **Add `sessionStore`** — enable multi-turn conversations.
3. **Add HTTP service** — open to your frontend or API consumers.
4. **Add `withResilience()`** — protect against load and failures.
5. **Add `knowledgebase` or `memoryStore`** — when retrieval or recall quality matters.
6. **Add orchestration** — only when a single agent is provably not enough.
7. **Add evals** — run regression suites in CI before every release.

---

## What's next?

- [01 · Hello World](./01-hello-world) — the simplest possible agent
- [15 · Full-Stack App](./15-full-stack) — the baseline slice with HTTP and sessions
- [Concepts guide](../guide/concepts) — framework mental model
- [All modules](../guide/all-modules) — complete module and export reference
