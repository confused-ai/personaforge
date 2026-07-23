---
title: 15 · Full-Stack App
description: Build a complete agent-powered HTTP service with tools, session continuity, observability hooks, and a production-ready serve layer.
outline: [2, 3]
---

# 15 · Full-Stack App

This example shows a realistic production-shaped application: one agent, an HTTP runtime, session continuity, a tool, and lifecycle hooks for observability. It deliberately avoids adding every available module — layer them in only once the simpler version is working.

---

## What you'll learn

- How to wire an agent with tools into an HTTP service
- How to add session continuity with `InMemorySessionStore`
- How to observe agent behaviour with lifecycle hooks
- How to layer in memory, knowledge, and production controls incrementally

---

## Minimal full-stack agent

```ts
import { z } from 'zod/v3';
import { createAgent, tool } from 'personaforge';
import { InMemorySessionStore } from 'personaforge/session';
import { createHttpService, listenService } from 'personaforge/serve';

// ── Tool ────────────────────────────────────────────────────────────────────
const lookupInventory = tool({
  name: 'lookup_inventory',
  description: 'Return the available stock count for a product SKU.',
  parameters: z.object({
    sku: z.string().describe('The product SKU, e.g. WIDGET-42'),
  }),
  execute: async ({ sku }) => ({
    sku,
    available: 17,
    warehouse: 'east-1',
    lastUpdated: new Date().toISOString(),
  }),
});

// ── Agent ───────────────────────────────────────────────────────────────────
const assistant = createAgent({
  name: 'store-ops',
  instructions: [
    'You help store managers with stock levels and store policy questions.',
    'Always check inventory before answering stock questions.',
    'Keep responses concise and factual.',
  ].join(' '),
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [lookupInventory],
  sessionStore: new InMemorySessionStore(),
  hooks: {
    beforeRun: (prompt, config) => {
      console.log('[run:start]', { userId: config.userId, prompt: prompt.slice(0, 80) });
      return prompt;
    },
    afterRun: (result) => {
      console.log('[run:finish]', { steps: result.steps, usage: result.usage });
      return result;
    },
    onError: (error, step) => {
      console.error('[run:error]', { step, message: error.message });
    },
  },
});

// ── HTTP service ─────────────────────────────────────────────────────────────
const service = createHttpService({
  agents: { assistant },
  cors: '*',
});

void listenService(service, 3000);
console.log('Agent HTTP service running on http://localhost:3000');
```

The service exposes:
- `POST /v1/agents/assistant/run` — single-turn run
- `POST /v1/agents/assistant/stream` — streaming response
- `GET  /v1/health` — health check

---

## Multi-turn conversations

Once the service is running, use the returned `sessionId` to continue a conversation:

```ts
// Turn 1 — starts a new session
const res1 = await fetch('http://localhost:3000/v1/agents/assistant/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'How many units of WIDGET-42 do we have?',
    userId: 'manager-1',
  }),
});
const { text, sessionId } = await res1.json();
console.log(text);

// Turn 2 — continues with the same sessionId
const res2 = await fetch('http://localhost:3000/v1/agents/assistant/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'What warehouse is it in?',
    sessionId,
    userId: 'manager-1',
  }),
});
const { text: followUp } = await res2.json();
console.log(followUp);
// The agent remembers the previous SKU and inventory lookup
```

---

## Layer in additional modules incrementally

Once the base service is stable, add modules one at a time:

### Add persistent sessions

```ts
import { createSqliteSessionStore } from 'personaforge/session';

const sessionStore = await createSqliteSessionStore('./agent.db');

const assistant = createAgent({
  // ... same config ...
  sessionStore,  // sessions survive process restarts
});
```

### Add a knowledge base

```ts
import { createKnowledgeEngine } from 'personaforge/knowledge';

const knowledge = createKnowledgeEngine({ topK: 3, maxContextChars: 1_500 });

await knowledge.addDocuments([
  { id: 'returns', content: 'Products can be returned within 30 days of purchase.' },
  { id: 'warranty', content: 'All products carry a 12-month manufacturer warranty.' },
]);

const assistant = createAgent({
  // ... same config ...
  knowledgebase: knowledge,  // agent now answers from store policies
});
```

### Add production resilience

```ts
import { withResilience } from 'personaforge/production';

const resilient = withResilience(assistant, {
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
  rateLimit: { maxRpm: 120 },
});

const service = createHttpService({
  agents: { assistant: resilient },
  cors: '*',
});
```

### Add long-term memory

```ts
import { InMemoryStore, MemoryType } from 'personaforge';

const memoryStore = new InMemoryStore();

const assistant = createAgent({
  // ... same config ...
  memoryStore,  // agent accumulates facts across sessions
});
```

---

## Deployment checklist

| Step | Description |
|---|---|
| Swap `InMemorySessionStore` | Use `createSqliteSessionStore()` or a Postgres-backed store |
| Swap `InMemoryStore` | Use a persistent memory store for production memory |
| Add `withResilience()` | Rate limiting and circuit breaker before going live |
| Set `cors` | Restrict origins in production — don't leave `'*'` |
| Add an `auditStore` | Audit every run for compliance-sensitive use cases |
| Use `budget` | Cap per-run token spend to prevent runaway costs |

---

## What's next?

- [13 · Production Resilience](./13-production) — full `withResilience()` configuration
- [14 · MCP Tools](./14-mcp) — connect external MCP tool servers
- [17 · Full Framework Showcase](./17-full-framework-showcase) — platform-level module map
- [Serve guide](../guide/adapters) — HTTP runtime configuration reference
