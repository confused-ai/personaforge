---
title: Packages & Imports
description: How to use the single personaforge npm package and its module subpaths.
outline: [2, 3]
---

# Packages & Imports

Install `personaforge` once. That is the public consumer package.

Use `personaforge` for the common agent APIs. Use `personaforge/<module>` when you want a more focused import path from the same installation.

```bash
npm install personaforge
```

## Root imports

Use the root package for the headline APIs that most apps start with.

```ts
import { agent, defineAgent, compose, tool } from 'personaforge';
```

## Module subpaths

Use subpaths when you want clearer intent or a narrower import surface.

```ts
import { TavilySearchTool } from 'personaforge/tools/search';
import { createSqliteStore } from 'personaforge/session';
import { GuardrailValidator, createPiiDetectionRule } from 'personaforge/guardrails';
import { withResilience } from 'personaforge/production';
import { CircuitBreaker } from 'personaforge/guard';
import { createHttpService, listenService } from 'personaforge/runtime';
import { ConsoleLogger } from 'personaforge/observability';
import { openai } from 'personaforge/model';
```

Common subpaths:

| Import path | Use for |
|---|---|
| `personaforge/tools` | Integrations and toolkits |
| `personaforge/session` | Session stores |
| `personaforge/guardrails` | Safety rules and validators |
| `personaforge/production` | `withResilience()` and production wrappers |
| `personaforge/guard` | Low-level circuit breaker, rate limiter, health helpers |
| `personaforge/runtime` | HTTP runtime, auth, WebSocket transport |
| `personaforge/orchestration` | Supervisor, routing, consensus, A2A |
| `personaforge/observability` | Logging, tracing, eval utilities |
| `personaforge/llm` | Provider classes and routing utilities |
| `personaforge/model` | `openai()`, `anthropic()`, `ollama()` shorthands |
| `personaforge/processors` | Mastra-style input/output/error processor pipeline |
| `personaforge/durable` | Long-running, resumable agent execution with replay |
| `personaforge/goals` | Durable, thread-scoped judge-scored objectives |
| `personaforge/code-mode` | Sandboxed multi-tool computation |
| `personaforge/approval` | Human-in-the-loop approval + suspended runs |
| `personaforge/events` | Typed event bus + core event vocabulary |
| `personaforge/registry` | Agent registration, discovery, delegation toolkit |
| `personaforge/harness` | `evaluate()` — A/B harness over agents/tasks/workflows |

## Contributor note

The repository is organized internally as a monorepo, so contributors will see `@personaforge/*` workspace package names in implementation code and build scripts.

That internal layout is not the public install story. Consumer docs, app code, and examples should use:

- `personaforge`
- `personaforge/<module>`

## Publish checks

The repository still validates every exported subpath before publishing:

```bash
npm run package:prepare
```

That command builds the single public package surface and verifies that every declared export target exists on disk.
