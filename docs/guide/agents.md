---
title: Agents
description: createAgent() — the main entry point for building agents with LLM, tools, sessions, guardrails, memory, RAG, and structured output.
outline: [2, 3]
---

# Agents

`createAgent()` is the primary authoring surface. It wires an LLM, tools, session, guardrails, memory, and knowledge into one agent and returns a `run()` method.

## Minimal agent

```ts
import { createAgent } from 'personaforge';

const agent = createAgent({
  name: 'assistant',
  instructions: 'You are a helpful assistant. Be concise.',
  model: 'gpt-4o',        // or llm: new OpenAIProvider({ ... })
  apiKey: process.env.OPENAI_API_KEY!,
});

const result = await agent.run('Summarise quantum entanglement in 3 bullet points.');
console.log(result.text);
```

---

## `createAgent` options

```ts
interface CreateAgentOptions {
  // ── Identity ──────────────────────────────────────────────────────────────
  name: string;           // unique name; used in logs and traces
  instructions: string;   // system-level instructions for the model

  // ── Model / Provider ──────────────────────────────────────────────────────
  llm?: LLMProvider;      // any provider instance (takes priority over model)
  model?: string;         // e.g. 'gpt-4o', 'claude-sonnet-4', 'provider:model'
  apiKey?: string;        // used when model string is provided
  baseURL?: string;       // override provider base URL
  openRouter?: { apiKey?: string; model?: string };  // shorthand for OpenRouter

  // ── Tools ─────────────────────────────────────────────────────────────────
  tools?: Tool[] | ToolRegistry | false | 'web';
  // 'web' = built-in HttpClientTool + BrowserTool preset
  // false / [] = no tools (pure text reasoning)
  toolMiddleware?: ToolMiddleware[];

  // ── Session ───────────────────────────────────────────────────────────────
  sessionStore?: SessionStore | false;
  // false = stateless (no session tracking)
  // omit = in-memory session store

  // ── Safety ────────────────────────────────────────────────────────────────
  guardrails?: GuardrailEngine | false;
  // false = disabled
  // omit = default PII + sensitive-data guardrail

  // ── Schema validation ─────────────────────────────────────────────────────
  inputSchema?: z.ZodType;    // validate input before sending to the model
  outputSchema?: z.ZodType;   // force structured JSON output + validate it

  // ── Memory ────────────────────────────────────────────────────────────────
  memoryStore?: MemoryStore;                // persist remembered facts
  enableAgenticMemory?: boolean;            // give agent remember/recall tools
  addMemoriesToContext?: boolean;           // prepend recalled memories
  numMemories?: number;                     // max memories in context (default: 5)

  // ── RAG / Knowledge ───────────────────────────────────────────────────────
  knowledgebase?: RAGEngine;                // attach a knowledge base
  addKnowledgeToContext?: boolean;          // prepend retrieved chunks (default: true when set)

  // ── Context management ────────────────────────────────────────────────────
  addHistoryToContext?: boolean;            // include prior turns
  numHistoryRuns?: number;                  // max prior runs to include
  numHistoryMessages?: number;              // max prior messages to include

  // ── Reliability ───────────────────────────────────────────────────────────
  maxSteps?: number;                        // max tool-call iterations (default: 10)
  timeoutMs?: number;                       // request timeout in ms
  temperature?: number;                     // default sampling temperature 0–2 (default: 0.7)
  maxTokens?: number;                       // default max output tokens (default: 4096)
  retry?: { maxRetries?: number; backoffMs?: number; maxBackoffMs?: number };

  // ── Storage & observability ───────────────────────────────────────────────
  storage?: Storage;                        // persist run metadata + usage
  logger?: Logger;                          // custom logger

  // ── Follow-ups ────────────────────────────────────────────────────────────
  followUps?: boolean;                      // generate follow-up suggestions
  numFollowups?: number;                    // max follow-ups (default: 3)

  // ── Lifecycle hooks ───────────────────────────────────────────────────────
  hooks?: AgenticLifecycleHooks;            // intercept every stage of the run — see the Hooks guide

  // ── Dev ───────────────────────────────────────────────────────────────────
  debugMode?: boolean;                      // console visibility for runs
  debugLevel?: 1 | 2;                       // level 2 streams text chunks
}
```

---

## `run()` options

```ts
const result = await agent.run('Your prompt here', {
  sessionId: 'user-123',        // load / persist session for this user
  userId: 'user-123',           // attach to traces and audit logs
  runId: 'run-abc',             // custom run id for correlation
  traceId: 'trace-xyz',         // W3C trace context propagation
  maxSteps: 5,                  // override per-run
  timeoutMs: 10_000,            // override per-run
  allowedTools: ['search'],     // restrict which tools can be called this run
});

// result shape
result.text;          // final text response
result.messages;      // full message history
result.usage;         // { promptTokens, completionTokens, totalTokens }
result.followups;     // follow-up suggestions (if enabled)
result.storageKey;    // key used when storage adapter persisted this run
```

---

## Examples

### Agent with tools

```ts
import { createAgent, tool } from 'personaforge';
import { z } from 'zod';

const getWeather = tool({
  name: 'get_weather',
  description: 'Get current weather for a city.',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    // call your weather API
    return { city, temperature: 22, condition: 'sunny' };
  },
});

const agent = createAgent({
  name: 'weather-agent',
  instructions: 'You help with weather queries. Always use the get_weather tool.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [getWeather],
});

const result = await agent.run('What is the weather in Tokyo?');
console.log(result.text);
```

### Agent with sessions (multi-turn)

```ts
import { createAgent, InMemorySessionStore } from 'personaforge';

const agent = createAgent({
  name: 'support-bot',
  instructions: 'You are a customer support agent. Remember context across turns.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  sessionStore: new InMemorySessionStore(),
  addHistoryToContext: true,
  numHistoryRuns: 10,
});

// Turn 1
await agent.run('My order #12345 has not arrived.', { sessionId: 'user-99' });

// Turn 2 — agent has full prior context
const result = await agent.run('What was my order number again?', { sessionId: 'user-99' });
console.log(result.text);  // references order #12345
```

### Agent with structured output

```ts
import { createAgent } from 'personaforge';
import { z } from 'zod';

const SentimentSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  score: z.number().min(-1).max(1),
  explanation: z.string(),
});

const agent = createAgent({
  name: 'sentiment-classifier',
  instructions: 'Classify the sentiment of the given text.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  outputSchema: SentimentSchema,
});

const result = await agent.run('I absolutely loved the new product launch!');
const data = result.structuredOutput as z.infer<typeof SentimentSchema>;
console.log(data.sentiment);  // 'positive'
console.log(data.score);      // 0.95
```

### Agent with memory

```ts
import { createAgent, InMemoryStore } from 'personaforge';

const agent = createAgent({
  name: 'personal-assistant',
  instructions: 'You are a personal assistant. Remember user preferences.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  memoryStore: new InMemoryStore(),
  enableAgenticMemory: true,     // gives agent remember() / recall() tools
  addMemoriesToContext: true,     // prepends recalled memories to each run
  numMemories: 5,
});

await agent.run('I prefer dark mode and use TypeScript for all my projects.', { userId: 'alice' });

// Later session — the agent recalls these facts automatically
const result = await agent.run('What code editor settings should I use?', { userId: 'alice' });
console.log(result.text);
```

### Agent with RAG (knowledge base)

```ts
import { createAgent, createKnowledgeEngine, InMemoryVectorStore } from 'personaforge';

const kb = createKnowledgeEngine({
  vectorStore: new InMemoryVectorStore(),
  embeddingFn: async (texts) => { /* return embeddings */ return []; },
});

await kb.addDocuments([
  { id: '1', content: 'Refund policy: all products have a 30-day return window.' },
  { id: '2', content: 'Shipping: standard delivery takes 3-5 business days.' },
]);

const agent = createAgent({
  name: 'support-agent',
  instructions: 'Answer questions using the provided knowledge base.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  knowledgebase: kb,
});

const result = await agent.run('What is your return policy?');
console.log(result.text);  // uses the knowledge base content
```

### Agent with retry + timeout

```ts
const agent = createAgent({
  name: 'resilient-agent',
  instructions: 'Process the user request.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  maxSteps: 5,
  timeoutMs: 30_000,
  retry: {
    maxRetries: 3,
    backoffMs: 500,
    maxBackoffMs: 5_000,
  },
});
```

---

## Low-level: `AgenticRunner`

For direct control over the ReAct loop without the `createAgent` convenience layer:

```ts
import { AgenticRunner, createAgenticAgent } from 'personaforge';
import { OpenAIProvider } from 'personaforge';

const runner = new AgenticRunner({
  llm: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: myToolRegistry,
  maxSteps: 10,
  timeoutMs: 60_000,
});

runner.setGuardrails(myGuardrailEngine);
runner.setHumanInTheLoop(myHITLHooks);

const result = await runner.run({
  name: 'my-agent',
  instructions: 'Process the request.',
  prompt: 'Analyse the latest sales data.',
});
```

---

## Where to go next

- [Tools](./tools) — define and attach tools to agents.
- [Memory](./memory) — persist facts across sessions.
- [Guardrails](./guardrails) — validate inputs/outputs and block unsafe behaviour.
- [Orchestration](./orchestration) — coordinate multiple agents in teams or pipelines.
