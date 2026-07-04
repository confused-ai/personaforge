---
title: Packages & Imports
description: How to use the single confused-ai npm package and its module subpaths.
outline: [2, 3]
---

# Packages & Imports

Install `confused-ai` once. That is the public consumer package.

Use `confused-ai` for the common agent APIs. Use `confused-ai/<module>` when you want a more focused import path from the same installation.

```bash
npm install confused-ai
```

## Root imports

Use the root package for the headline APIs that most apps start with.

```ts
import { agent, defineAgent, compose, tool } from 'confused-ai';
```

## Module subpaths

Use subpaths when you want clearer intent or a narrower import surface.

```ts
import { TavilySearchTool } from 'confused-ai/tools/search';
import { createSqliteStore } from 'confused-ai/session';
import { GuardrailValidator, createPiiDetectionRule } from 'confused-ai/guardrails';
import { withResilience } from 'confused-ai/production';
import { CircuitBreaker } from 'confused-ai/guard';
import { createHttpService, listenService } from 'confused-ai/runtime';
import { ConsoleLogger } from 'confused-ai/observability';
import { openai } from 'confused-ai/model';
```

Common subpaths:

| Import path | Use for |
|---|---|
| `confused-ai/tools` | Integrations and toolkits |
| `confused-ai/session` | Session stores |
| `confused-ai/guardrails` | Safety rules and validators |
| `confused-ai/production` | `withResilience()` and production wrappers |
| `confused-ai/guard` | Low-level circuit breaker, rate limiter, health helpers |
| `confused-ai/runtime` | HTTP runtime, auth, WebSocket transport |
| `confused-ai/orchestration` | Supervisor, routing, consensus, A2A |
| `confused-ai/observability` | Logging, tracing, eval utilities |
| `confused-ai/llm` | Provider classes and routing utilities |
| `confused-ai/model` | `openai()`, `anthropic()`, `ollama()` shorthands |

## Contributor note

The repository is organized internally as a monorepo, so contributors will see `@confused-ai/*` workspace package names in implementation code and build scripts.

That internal layout is not the public install story. Consumer docs, app code, and examples should use:

- `confused-ai`
- `confused-ai/<module>`

## Publish checks

The repository still validates every exported subpath before publishing:

```bash
npm run package:prepare
```

That command builds the single public package surface and verifies that every declared export target exists on disk.
