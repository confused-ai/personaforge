---
title: LLM Router
description: Route every request to the optimal model at runtime based on task type, cost, speed, and complexity — no extra LLM calls.
outline: [2, 3]
---

# LLM Router

`LLMRouter` implements `LLMProvider`, so it drops in wherever a provider is expected. It classifies each request by task type and complexity (locally, with no extra API calls) and selects the best entry from a configured table.

## Quick start

```ts
import { createAgent, AnthropicProvider, OpenAIProvider, createSmartRouter } from 'personaforge';

const openai    = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
const anthropic = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });

const router = createSmartRouter([
  {
    provider: openai,
    model: 'gpt-4o-mini',
    capabilities: ['simple', 'coding', 'tool_use'],
    costTier: 'small',
    speedTier: 'fast',
    contextWindow: 128_000,
  },
  {
    provider: anthropic,
    model: 'claude-sonnet-4-20250514',
    capabilities: ['reasoning', 'coding', 'long_context'],
    costTier: 'large',
    speedTier: 'medium',
    contextWindow: 200_000,
  },
]);

const agent = createAgent({
  name: 'smart-assistant',
  instructions: 'You are a helpful assistant.',
  llm: router,   // ← drop-in replacement for any provider
});

const result = await agent.run('Design a TypeScript retry utility with exponential backoff.');
console.log(result.text);
console.log(router.getLastRouteDecision());
// { model: 'claude-sonnet-4-20250514', detectedTask: 'coding', strategy: 'adaptive', ... }
```

---

## Router entry fields

| Field | Required | Description |
|---|---|---|
| `provider` | ✓ | Any `LLMProvider` instance |
| `model` | ✓ | Human-readable model name used in logs and decisions |
| `capabilities` | ✓ | Task types this model handles well (see below) |
| `costTier` | — | `nano` · `small` · `medium` · `large` · `frontier` |
| `speedTier` | — | `fast` · `medium` · `slow` |
| `contextWindow` | — | Max tokens; requests exceeding this skip the entry (default: 128 000) |
| `qualityScore` | — | Override quality 0–10; inferred from `costTier` when omitted |

### Task types

```ts
type TaskType =
  | 'simple'        // factual Q&A, short replies
  | 'coding'        // code generation, debugging, review
  | 'reasoning'     // multi-step logic, math, analysis
  | 'creative'      // stories, marketing, brainstorming
  | 'tool_use'      // requests that supply tools / function-calling
  | 'long_context'  // large prompts (RAG, document analysis)
  | 'multimodal';   // image / audio / video content
```

---

## Routing strategies

Pass `strategy` to `new LLMRouter({ ... })` or use a factory:

| Strategy | Factory | Behaviour |
|---|---|---|
| `adaptive` | `createSmartRouter()` | Weighted score across quality, cost, speed, and task fit. **Recommended default.** |
| `balanced` | `createBalancedRouter()` | Cheapest viable model; auto-escalates for demanding tasks |
| `cost` | `createCostOptimizedRouter()` | Always picks the cheapest capable entry |
| `quality` | `createQualityFirstRouter()` | Always picks the highest quality capable entry |
| `speed` | `createSpeedOptimizedRouter()` | Always picks the fastest capable entry |

### Adaptive weights (optional tuning)

```ts
const router = createSmartRouter(entries, {
  adaptiveWeights: {
    quality:       0.5,   // default: 0.35
    cost:          0.2,   // default: 0.28
    speed:         0.15,  // default: 0.27
    capabilityFit: 0.15,  // default: 0.25
  },
});
```

---

## Factory functions

### `createSmartRouter` — adaptive (recommended)

```ts
import { createSmartRouter } from 'personaforge';

const router = createSmartRouter(entries, {
  debug: true,               // log every decision
  rules: [...],              // override rules evaluated first
  adaptiveWeights: { ... },  // tune quality/cost/speed/fit tradeoffs
  classifyTask:      (ctx) => 'coding',    // custom task classifier
  classifyComplexity:(ctx) => 'high',      // custom complexity classifier
});
```

### `createBalancedRouter`

```ts
import { createBalancedRouter } from 'personaforge';

const router = createBalancedRouter(entries, { debug: true });
```

### `createCostOptimizedRouter` / `createQualityFirstRouter` / `createSpeedOptimizedRouter`

```ts
import { createCostOptimizedRouter, createQualityFirstRouter, createSpeedOptimizedRouter } from 'personaforge';

const cheap   = createCostOptimizedRouter(entries);
const quality = createQualityFirstRouter(entries);
const fast    = createSpeedOptimizedRouter(entries);
```

### `new LLMRouter` — full config control

```ts
import { LLMRouter } from 'personaforge';

const router = new LLMRouter({
  strategy: 'balanced',
  entries: [
    { provider: openai,    model: 'gpt-4.1-nano',    capabilities: ['simple'],          costTier: 'nano',     speedTier: 'fast',   contextWindow: 8_000   },
    { provider: openai,    model: 'gpt-4o-mini',     capabilities: ['simple','coding'], costTier: 'small',    speedTier: 'fast',   contextWindow: 128_000 },
    { provider: openai,    model: 'gpt-4.1',         capabilities: ['coding','creative'],costTier: 'medium',  speedTier: 'medium', contextWindow: 128_000 },
    { provider: anthropic, model: 'claude-sonnet-4', capabilities: ['coding','reasoning'],costTier: 'large',  speedTier: 'medium', contextWindow: 200_000 },
    { provider: anthropic, model: 'claude-opus-4',   capabilities: ['reasoning'],       costTier: 'frontier', speedTier: 'slow',   contextWindow: 200_000 },
  ],
  fallbackEntryIndex: 3,  // default fallback when all else fails
  debug: true,
});
```

---

## Override rules

Rules are evaluated before any strategy. The first matching rule wins.

```ts
import { createSmartRouter } from 'personaforge';

const router = createSmartRouter(entries, {
  rules: [
    {
      name: 'medical-query',
      match: (ctx) => ctx.messages.some(
        (m) => typeof m.content === 'string' && /diagnosis|symptom|medication/i.test(m.content)
      ),
      useEntry: 4,  // always use the frontier model for medical topics
    },
    {
      name: 'short-simple',
      match: (ctx) => ctx.estimatedTokens < 200 && ctx.detectedTask === 'simple',
      useEntry: 0,  // cheapest entry for trivial requests
    },
  ],
});
```

**`RouteContext` fields available inside `match`:**

```ts
interface RouteContext {
  messages: Message[];
  options?: GenerateOptions;
  detectedTask: TaskType;
  detectedComplexity: 'low' | 'medium' | 'high';
  estimatedTokens: number;
  hasTools: boolean;
  hasMultimodal: boolean;
}
```

---

## Inspecting decisions

```ts
// Last request's decision
const decision = router.getLastRouteDecision();
// {
//   model: 'claude-sonnet-4-20250514',
//   detectedTask: 'reasoning',
//   detectedComplexity: 'high',
//   strategy: 'adaptive',
//   reason: 'task=reasoning, complexity=high, strategy=adaptive, tokens≈1420',
//   estimatedTokens: 1420,
//   entryIndex: 3,
// }

// Full history (newest last, capped at 1000)
const history = router.getDecisionHistory();

// Reset
router.clearHistory();
```

---

## Complete example: five-model table

```ts
import {
  createSmartRouter,
  OpenAIProvider,
  AnthropicProvider,
  createGroqProvider,
  createAgent,
} from 'personaforge';

const openai    = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
const anthropic = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const groq      = createGroqProvider({ model: 'llama-3.1-8b-instant' });

const router = createSmartRouter([
  { provider: groq,      model: 'llama-3.1-8b-instant',    capabilities: ['simple'],                     costTier: 'nano',     speedTier: 'fast',   contextWindow: 8_000   },
  { provider: openai,    model: 'gpt-4o-mini',             capabilities: ['simple', 'coding', 'tool_use'],costTier: 'small',   speedTier: 'fast',   contextWindow: 128_000 },
  { provider: openai,    model: 'gpt-4o',                  capabilities: ['coding', 'creative'],          costTier: 'medium',  speedTier: 'medium', contextWindow: 128_000 },
  { provider: anthropic, model: 'claude-sonnet-4-20250514',capabilities: ['reasoning', 'long_context'],   costTier: 'large',   speedTier: 'medium', contextWindow: 200_000 },
  { provider: anthropic, model: 'claude-opus-4-20250514',  capabilities: ['reasoning'],                   costTier: 'frontier',speedTier: 'slow',   contextWindow: 200_000 },
], { debug: true });

const agent = createAgent({
  name: 'router-demo',
  instructions: 'You are a helpful assistant.',
  llm: router,
});

// Simple → groq or gpt-4o-mini
await agent.run('What is the capital of France?');

// Coding → gpt-4o or claude-sonnet
await agent.run('Write a TypeScript generic debounce function with proper types.');

// Complex reasoning → claude-sonnet or claude-opus
await agent.run('Analyse the philosophical implications of the ship of Theseus paradox across 4 ethical frameworks.');

for (const d of router.getDecisionHistory()) {
  console.log(`${d.model.padEnd(30)} task=${d.detectedTask} complexity=${d.detectedComplexity}`);
}
```

---

## Where to go next

- [Providers](./providers) — all supported LLM providers.
- [Production](./production) — circuit breakers, budget enforcement, and rate limiting.
