---
title: "API Reference"
description: "Public API map for personaforge with verified root and subpath imports."
outline: [2, 3]
---

# API Reference

`personaforge` is a single install. Public docs should use `personaforge` or `personaforge/<module>` imports only.

```bash
npm install personaforge
```

Do not use internal workspace imports such as `@personaforge/*`. Do not document `personaforge/contracts/extensions` as a consumer import surface.

## Recommended Import Map

| Import | Use for |
|--------|---------|
| `personaforge` | Main authoring API: `agent`, `createAgent`, `defineAgent`, `compose`, `pipe` |
| `personaforge/model` | Provider factories such as `openai`, `anthropic`, and `ollama` |
| `personaforge/tool` | Tool authoring helpers such as `tool`, `defineTool`, `createTools`, and `extendTool` |
| `personaforge/tools` | Built-in tools and focused tool subpaths |
| `personaforge/workflow` | Graphs, orchestration helpers, teams, handoffs, and agent routing |
| `personaforge/guard` | Circuit breaker, rate limiting, approval primitives, and guardrails |
| `personaforge/production` | `withResilience` plus audit, checkpoint, idempotency, approval, and tenancy utilities |
| `personaforge/serve` | HTTP service creation and transport helpers |
| `personaforge/observe` | Logging, tracing, metrics, and evaluation helpers |
| `personaforge/session` | Session persistence |
| `personaforge/memory` | Long-lived and vector memory |
| `personaforge/knowledge` | Knowledge and retrieval layers |
| `personaforge/storage` | Generic storage layer |
| `personaforge/skills` | Skill composition |
| `personaforge/background` | Background queues and hook offloading |
| `personaforge/voice` | Voice and speech providers |

`personaforge/runtime` and `personaforge/observability` are still exported, but they are compatibility aliases for the same runtime and telemetry surfaces exposed by `personaforge/serve` and `personaforge/observe`. For new docs, prefer `serve` and `observe`.

## Root Agent API

Use the root package for the default agent authoring flow.

```ts
import { agent } from 'personaforge';

const assistant = agent({
  name: 'assistant',
  model: 'openai:gpt-4o-mini',
  instructions: 'You are a concise assistant.',
  tools: [],
  sessionStore: false,
  guardrails: false,
});

const result = await assistant.run('Say hello in one sentence.');
console.log(result.text);
```

Use `createAgent(...)` when you want the factory-style API directly. Use `Agent` when you want a class-based API with legacy defaults plus modern fluent methods.

## Typed Builder

Use `defineAgent(...)` when you want schema-typed input and output.

```ts
import { defineAgent } from 'personaforge';
import { z } from 'zod';

const qa = defineAgent('qa')
  .model('openai:gpt-4o-mini')
  .input(z.object({ question: z.string() }))
  .output(z.object({ answer: z.string() }))
  .instructions('Answer clearly and briefly.')
  .build();

const result = await qa.run({ question: 'What is 2 + 2?' });
console.log(result.answer, result.runId, result.sessionId);
```

## Models

Use provider factories from `personaforge/model` when you want explicit model instances instead of string refs.

```ts
import { anthropic, ollama, openai } from 'personaforge/model';

const primary = openai('gpt-4o-mini');
const backup = anthropic('claude-sonnet-4-20250514');
const local = ollama('llama3.2');

void primary;
void backup;
void local;
```

## Serving Agents Over HTTP

Use `personaforge/serve` for HTTP endpoints and transports.

```ts
import { agent } from 'personaforge';
import { createHttpService, listenService } from 'personaforge/serve';

const chat = agent({
  name: 'chat',
  model: 'openai:gpt-4o-mini',
  instructions: 'You are a chat assistant.',
  tools: [],
  sessionStore: false,
  guardrails: false,
});

const service = createHttpService({
  agents: { chat },
  cors: '*',
});

await listenService(service, 3000);
```

## Production Wrappers

Use `personaforge/production` for resilience and operational stores.

```ts
import { agent } from 'personaforge';
import { withResilience } from 'personaforge/production';

const base = agent({
  name: 'assistant',
  model: 'openai:gpt-4o-mini',
  instructions: 'You are a helpful assistant.',
  tools: [],
  sessionStore: false,
  guardrails: false,
});

const resilient = withResilience(base, {
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
  rateLimit: { maxRpm: 60 },
  retry: { maxRetries: 3, backoffMs: 1_000 },
});

const result = await resilient.run('Summarize three practical TypeScript improvements.');
console.log(result.text);
```

## Tool Catalog Subpaths

Built-in tool collections are exposed under `personaforge/tools` and focused subpaths such as:

- `personaforge/tools/search`
- `personaforge/tools/devtools`
- `personaforge/tools/utils`
- `personaforge/tools/communication`

Use `personaforge/tool` when you are defining tools. Use `personaforge/tools` when you are importing ready-made tools and toolkits.

## Notes

- Prefer the owning subpath for focused modules like `session`, `memory`, `knowledge`, `storage`, `production`, `background`, `skills`, and `voice`.
- Do not assume every focused module is re-exported from the root package.
- Keep public docs aligned to one install story: `npm install personaforge`.