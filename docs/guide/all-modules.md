---
title: All Modules
description: Public module reference for the single `confused-ai` package.
outline: [2, 3]
---

# All Modules

Install `confused-ai` once and import the module you need from that package.

```bash
npm install confused-ai
```

## Headline API

```ts
import { agent, defineAgent, compose, pipe, tool } from 'confused-ai';
```

## Public module map

| Import path | What it exposes |
|---|---|
| `confused-ai` | Headline agent APIs, SDK helpers, custom tool helpers |
| `confused-ai/tools` | Integrations and toolkits |
| `confused-ai/session` | Session stores |
| `confused-ai/knowledge` | Knowledge engine, loaders, retrieval |
| `confused-ai/memory` | Memory stores and embedding-backed recall |
| `confused-ai/guardrails` | Safety validators and built-in rules |
| `confused-ai/production` | Production wrappers such as `withResilience()` |
| `confused-ai/guard` | Circuit breaker, rate limiter, health checks |
| `confused-ai/runtime` | HTTP runtime, auth, WebSocket transport |
| `confused-ai/orchestration` | Supervisor, routing, consensus, A2A |
| `confused-ai/workflow` | Workflow control-flow helpers |
| `confused-ai/graph` | Durable DAG execution |
| `confused-ai/scheduler` | Cron scheduling |
| `confused-ai/reasoning` | Reasoning engines |
| `confused-ai/db` | Framework-managed persistence backends |
| `confused-ai/observability` | Logging, tracing, metrics, eval helpers |
| `confused-ai/llm` | Provider classes and routing helpers |
| `confused-ai/model` | `openai()`, `anthropic()`, `ollama()` shorthand factories |
| `confused-ai/skills` | Pre-built skill bundles |

## Example imports

```ts
import { agent } from 'confused-ai';
import { TavilySearchTool } from 'confused-ai/tools/search';
import { createSqliteStore } from 'confused-ai/session';
import { GuardrailValidator } from 'confused-ai/guardrails';
import { withResilience } from 'confused-ai/production';
import { CircuitBreaker } from 'confused-ai/guard';
import { createHttpService } from 'confused-ai/runtime';
import { createGraph } from 'confused-ai/graph';
import { ScheduleManager } from 'confused-ai/scheduler';
import { ReasoningManager } from 'confused-ai/reasoning';
import { createAgentDb } from 'confused-ai/db';
import { ConsoleLogger } from 'confused-ai/observability';
import { openai } from 'confused-ai/model';
import { webResearchSkill } from 'confused-ai/skills';
```

## Guidance

Use root imports for the common getting-started flow.

Use `confused-ai/<module>` when you want a narrower import surface or a clearer ownership boundary in app code.

The repository is still implemented as a monorepo, so contributor docs and migration notes may refer to `@confused-ai/*` workspace package names. Those internal names are not the public install story.
