# 16 · Intelligent LLM Router

The `LLMRouter` is a drop-in `LLMProvider`. Build a routing table once, pass it to `createAgent()`, and the router picks the best model automatically based on task type, cost, speed, or quality goals.

## Full 5-provider router

```ts
import {
  OpenAIProvider,
  AnthropicProvider,
  GoogleProvider,
  GroqProvider,
  createAgent,
  createSmartRouter,
  TaskType,
} from 'personaforge';

// Build your provider table
const routerEntries = [
  {
    provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o' }),
    capabilities: [TaskType.reasoning, TaskType.tool_use, TaskType.long_context],
    costTier: 'high' as const,
    speedTier: 'medium' as const,
    qualityScore: 0.95,
  },
  {
    provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o-mini' }),
    capabilities: [TaskType.simple, TaskType.creative, TaskType.coding],
    costTier: 'low' as const,
    speedTier: 'fast' as const,
    qualityScore: 0.78,
  },
  {
    provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY!, model: 'claude-opus-4-20250514' }),
    capabilities: [TaskType.reasoning, TaskType.long_context],
    costTier: 'high' as const,
    speedTier: 'slow' as const,
    qualityScore: 0.97,
  },
  {
    provider: new GoogleProvider({ apiKey: process.env.GOOGLE_API_KEY!, model: 'gemini-2.0-flash' }),
    capabilities: [TaskType.multimodal, TaskType.long_context],
    costTier: 'medium' as const,
    speedTier: 'fast' as const,
    qualityScore: 0.88,
    contextWindow: 1_000_000,
  },
  {
    provider: new GroqProvider({ apiKey: process.env.GROQ_API_KEY!, model: 'llama-3.3-70b-versatile' }),
    capabilities: [TaskType.simple, TaskType.coding],
    costTier: 'low' as const,
    speedTier: 'ultra-fast' as const,
    qualityScore: 0.75,
  },
];

// Smart router (adaptive: task-type + quality + cost balanced)
const router = createSmartRouter(routerEntries);

const agent = createAgent({
  name: 'smart-agent',
  instructions: 'You are a helpful assistant.',
  llm: router,
  apiKey: '', // not needed — each entry has its own
});

// Simple task → routes to gpt-4o-mini or Groq (cheap + fast)
const simple = await agent.run('What is the capital of France?');

// Reasoning → routes to claude-opus or gpt-4o
const hard = await agent.run('Solve this step by step: [complex math problem]');

// Inspect the routing decision
const decision = router.getLastRouteDecision();
console.log(decision);
// { selectedEntry: 'gpt-4o', reason: 'reasoning task, quality threshold 0.90', latencyMs: 3 }
```

---

## Factory variants

```ts
import {
  createSmartRouter,
  createBalancedRouter,
  createCostOptimizedRouter,
  createQualityFirstRouter,
  createSpeedOptimizedRouter,
} from 'personaforge';

// Balanced: quality vs cost trade-off
const balanced = createBalancedRouter(routerEntries);

// Always cheapest model that meets minimum quality
const cheap = createCostOptimizedRouter(routerEntries, { minQualityScore: 0.70 });

// Always highest quality, ignore cost
const best = createQualityFirstRouter(routerEntries);

// Always fastest response time
const fast = createSpeedOptimizedRouter(routerEntries);
```

---

## Override rules

Override the automatic decision for specific conditions:

```ts
import { LLMRouter, TaskType } from 'personaforge';

const router2 = new LLMRouter({
  entries: routerEntries,
  strategy: 'adaptive',
  rules: [
    {
      // Always use Claude Opus for legal and compliance requests
      match: (ctx) => ctx.systemPrompt?.includes('legal') || ctx.systemPrompt?.includes('compliance'),
      useEntry: 2,  // index into routerEntries → claude-opus
    },
    {
      // Always use Groq for very short prompts (chatbot-style)
      match: (ctx) => ctx.prompt.length < 80,
      useEntry: 4,  // groq
    },
  ],
});
```

---

## Decision history and debug mode

```ts
// Inspect all decisions from this session
const history = router.getDecisionHistory();
console.log(history.map(d => ({ model: d.selectedEntry, reason: d.reason })));

// Reset decision history
router.clearHistory();

// Debug mode: log every routing decision to console
const debugRouter = createSmartRouter(routerEntries, { debug: true });
```

---

## Use with different agent strategies

```ts
// Research agent: quality first (best reasoning)
const researchAgent = createAgent({
  name: 'researcher',
  instructions: 'Research deeply and cite sources.',
  llm: createQualityFirstRouter(routerEntries),
  apiKey: '',
});

// Chat agent: speed first (instant responses)
const chatAgent = createAgent({
  name: 'chat',
  instructions: 'Keep responses short and friendly.',
  llm: createSpeedOptimizedRouter(routerEntries),
  apiKey: '',
});

// Batch processing: cost first (maximise throughput)
const batchAgent = createAgent({
  name: 'batch',
  instructions: 'Process the input.',
  llm: createCostOptimizedRouter(routerEntries, { minQualityScore: 0.65 }),
  apiKey: '',
});
```

---

## Related

- [LLM Router guide](../guide/llm-router) — full API reference.
- [Providers](../guide/providers) — all 40+ supported providers.
- [Example 01: Hello world agent](./01-hello-world.md) — basic agent without a router.
