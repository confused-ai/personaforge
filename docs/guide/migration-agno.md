---
title: Migrate From Agno
description: Port Agno agents, teams, knowledge bases, memory, and reasoning tools to personaforge. Python Agent becomes createAgent(). Team becomes createSupervisor(). Knowledge becomes createKnowledgeBase().
outline: [2, 3]
---

# Migrate From Agno

Agno is a Python-first agent framework with strong multi-agent and reasoning-tool patterns. `personaforge` provides the same concepts in **TypeScript-native** form — with durable execution, guardrails, budget enforcement, and OTLP tracing built in.

> **Note:** Agno runs on Python; personaforge runs on TypeScript/Node/Bun. This guide maps **concepts and patterns**, not a line-for-line port.

---

## Quick comparison

| Agno concept | personaforge equivalent |
|---|---|
| `Agent(model, instructions, tools)` | `createAgent({ model, instructions, tools })` |
| `Team(members, mode)` | `createSupervisor()` or `createOrchestrator()` |
| `Knowledge` / vector DB | `createKnowledgeBase()` + `contextProviders` |
| `Memory` / session history | `agent.createSession({ sessionId })` |
| `Storage` (SQLite, Postgres) | [Storage](./storage) + [Session](./session) |
| `think` / `analyze` tools | [Reasoning Tools](./reasoning-tools) — `createReasoningTools()` |
| `Workflow` | `compose()` / `pipe()` or [Graph Engine](./graph) |
| `AgentOS` / REST serving | [Production](./production) + automatic REST API |
| `ReasoningAgent` | `createAgent` + reasoning tools or [Reasoning (CoT)](./reasoning) |
| `DeepResearch` | [Deep Research Agent](./deep-research) |

---

## Agent migration

```python
# Agno
from agno.agent import Agent
from agno.models.openai import OpenAIChat

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    instructions="You are a helpful research assistant.",
    tools=[search_tool],
)
response = agent.run("What are the latest AI trends?")
```

```ts
// personaforge
import { createAgent } from 'personaforge';
import { webSearchTool } from 'personaforge';

const agent = createAgent({
  name: 'researcher',
  instructions: 'You are a helpful research assistant.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [webSearchTool],
});

const result = await agent.run('What are the latest AI trends?');
// result.text
```

---

## Team → supervisor

```python
# Agno
from agno.team import Team

team = Team(
    members=[researcher, writer],
    mode="coordinate",
)
response = team.run("Write a report on quantum computing.")
```

```ts
// personaforge
import { createSupervisor } from 'personaforge';

const supervisor = createSupervisor({
  name: 'project-lead',
  instructions: 'Coordinate the research and writing agents to complete the task.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  workers: [researcher, writer],
});

const result = await supervisor.run('Write a report on quantum computing.');
```

See [Team Modes](./team-modes) for all six coordination patterns (supervisor, handoff, consensus, and more).

---

## Knowledge / RAG

```python
# Agno
from agno.knowledge import Knowledge
from agno.vectordb.pgvector import PgVector

knowledge = Knowledge(vector_db=PgVector(...))
agent = Agent(knowledge=knowledge, ...)
```

```ts
// personaforge
import { createKnowledgeBase } from 'personaforge';

const kb = await createKnowledgeBase({
  type: 'memory',  // or 'pgvector', 'chroma', etc.
  embedder: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
});
await kb.add(documents);

const agent = createAgent({
  name: 'support-agent',
  instructions: 'Answer questions using the knowledge base.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  contextProviders: [kb.asContextProvider()],
});
```

---

## Reasoning tools (`think` / `analyze`)

Agno's reasoning-as-tools pattern is a first-class module in personaforge:

```ts
import { agent } from 'personaforge';
import { ReasoningScratchpad, createReasoningTools } from 'personaforge/reasoning';

const scratchpad = new ReasoningScratchpad();
const { think, analyze } = createReasoningTools(scratchpad);

const researcher = agent({
  name: 'researcher',
  model: 'gpt-4o-mini',
  instructions: 'Use think to plan before acting, and analyze to review your reasoning.',
  tools: [think, analyze, webSearchTool],
});

await researcher.run('Compare three database options for our workload.');
console.log(scratchpad.render());
```

See [Reasoning Tools](./reasoning-tools) for the full API.

---

## Memory & sessions

```python
# Agno — session persists across runs
agent = Agent(storage=SqliteStorage(...), session_id="user-123")
agent.run("My name is Alice")
agent.run("What is my name?")  # remembers Alice
```

```ts
// personaforge
const session = agent.createSession({ sessionId: 'user-123' });
await session.run('My name is Alice');
const result = await session.run('What is my name?'); // remembers Alice
```

---

## Custom tools

```python
# Agno
from agno.tools import tool

@tool
def get_stock_price(ticker: str) -> str:
    """Get the current stock price for a ticker."""
    return fetch_price(ticker)
```

```ts
// personaforge
import { tool } from 'personaforge';
import { z } from 'zod';

const getStockPrice = tool({
  name: 'get_stock_price',
  description: 'Get the current stock price for a ticker symbol.',
  schema: z.object({ ticker: z.string().describe('Stock ticker, e.g. AAPL') }),
  execute: async ({ ticker }) => fetchPrice(ticker),
});
```

---

## What you gain by switching

| Agno gap | personaforge answer |
|---|---|
| Python-only runtime | TypeScript-native — same language as your app |
| No built-in budget caps | [Budget Enforcement](./production#budget-enforcement) |
| Limited OTLP tracing | [Observability & OTLP](./observability) — OpenTelemetry-native |
| No control-plane dashboard | [Control Plane](./control-plane) |
| Add-on guardrails | [Guardrails & Safety](./guardrails) — PII, prompt injection, moderation |

---

## Where to go next

- [Framework Comparisons](./comparisons) — full capability matrix vs all frameworks.
- [Agents](./agents) — `createAgent` in full.
- [Orchestration](./orchestration) — supervisors, handoffs, consensus.
- [Reasoning Tools](./reasoning-tools) — Agno-style `think` / `analyze`.
- [Evaluation & Benchmarking](./eval) — run `examples/agno-vs-personaforge.ts` head-to-head.
