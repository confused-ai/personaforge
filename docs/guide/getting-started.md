---
title: Getting Started
description: Install personaforge, run your first agent, and follow a clean path from hello-world to production without switching frameworks.
outline: [2, 3]
---

# Getting Started

The fastest way into personaforge is one working result, then one capability at a time. This guide takes you from `npm install` through tools, sessions, memory, streaming, and multi-agent orchestration — in that order, because that's the order most applications need them.

## 1. Install

```bash
npm install personaforge
```

One package. No peer dependencies required for basic use. If you use Bun, pnpm, or yarn the package name is the same.

```bash
bun add personaforge
```

## 2. Set a provider key

Start with one provider. Don't add several until the task is already working.

```bash
OPENAI_API_KEY=sk-...
```

## 3. Your first agent

This is the smallest working agent possible — no tools, no session, just a model and instructions.

```ts
import { agent } from 'personaforge';

const bot = agent({
  name: 'assistant',
  model: 'gpt-4o-mini',
  instructions: 'You are a helpful assistant. Be concise.',
});

const result = await bot.run('What is the capital of France?');
console.log(result.text); // "The capital of France is Paris."
```

If this run isn't working reliably, stop and fix it before layering anything else on. Every advanced feature you add later will be harder to debug if the base isn't solid.

## 4. Two entry points: `agent()` vs `createAgent()`

personaforge gives you two ways to create agents. Pick the one that matches how you like to write TypeScript.

### `agent()` — minimal, one call

```ts
import { agent } from 'personaforge';

const bot = agent({
  name: 'my-agent',
  model: 'gpt-4o',
  instructions: 'You are a helpful assistant.',
  tools: [myTool],
  dev: true,                    // enables console logging
  sessionStore: mySessionStore,
});
```

Everything in one config object. Best for quick starts and the majority of production code.

### `createAgent()` — explicit, more options exposed

```ts
import { createAgent } from 'personaforge';

const bot = createAgent({
  name: 'my-agent',
  model: 'gpt-4o',
  instructions: 'You are a helpful assistant.',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [myTool],
  sessionStore: mySessionStore,
});
```

Both APIs produce identical agents. Use whichever reads better to you.

## 5. Model providers

personaforge supports 40+ providers. Set the model string and the framework resolves the correct provider from environment variables.

### OpenAI

```ts
agent({ model: 'gpt-4o', instructions: '...' });
// reads OPENAI_API_KEY from env
```

### Anthropic Claude

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

```ts
agent({ model: 'claude-sonnet-4', instructions: '...' });
```

### Google Gemini

```bash
GOOGLE_AI_API_KEY=...
```

```ts
agent({ model: 'gemini-2.0-flash', instructions: '...' });
```

### Local models (Ollama, LM Studio, etc.)

```ts
agent({
  model: 'llama3.2',
  instructions: '...',
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',  // Ollama doesn't need a real key
});
```

### Bring your own provider instance

```ts
import { OpenAIProvider } from 'personaforge';

agent({
  llm: new OpenAIProvider({ apiKey: '...', model: 'gpt-4o' }),
  instructions: '...',
});
```

### All providers at a glance

| Provider | Model string | Env variable |
|---|---|---|
| OpenAI | `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini` | `OPENAI_API_KEY` |
| Anthropic | `claude-sonnet-4`, `claude-opus-4`, `claude-haiku-3.5` | `ANTHROPIC_API_KEY` |
| Google | `gemini-2.5-pro`, `gemini-2.0-flash` | `GOOGLE_AI_API_KEY` |
| Groq | `llama-3.3-70b`, `mixtral-8x7b` | `GROQ_API_KEY` |
| DeepSeek | `deepseek-chat`, `deepseek-reasoner` | `DEEPSEEK_API_KEY` |
| Mistral | `mistral-large`, `mistral-small` | `MISTRAL_API_KEY` |
| Together AI | `meta-llama/Llama-3.3-70B` | `TOGETHER_API_KEY` |
| xAI Grok | `grok-2` | `XAI_API_KEY` |
| Cohere | `command-r-plus` | `COHERE_API_KEY` |
| Perplexity | `llama-3.1-sonar-large` | `PERPLEXITY_API_KEY` |
| Fireworks | `accounts/fireworks/models/llama-v3p1-70b` | `FIREWORKS_API_KEY` |
| OpenRouter | `openrouter:openai/gpt-4o` | `OPENROUTER_API_KEY` |
| AWS Bedrock | `bedrock:anthropic.claude-3-5-sonnet` | AWS credentials |
| Azure OpenAI | `azure:gpt-4o` | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` |
| Ollama | `llama3.2`, `mistral` | none (local) |
| LocalAI / vLLM / TextGen | custom provider URL | none (local) |

## 6. Add your first tool

Tools give the agent access to live data and side effects. Define one with `tool()`:

```ts
import { agent, tool } from 'personaforge';
import { z } from 'zod';

const getWeather = tool({
  name: 'get_weather',
  description: 'Get current weather for a city. Call this when the user asks about weather.',
  parameters: z.object({
    city: z.string().describe('City name, e.g. "Tokyo"'),
  }),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.com/${city}`);
    return res.json();
  },
});

const weatherBot = agent({
  name: 'weather-bot',
  model: 'gpt-4o-mini',
  instructions: 'Answer weather questions using the get_weather tool.',
  tools: [getWeather],
});

const result = await weatherBot.run("What's the weather in Tokyo?");
console.log(result.text);
// → "Tokyo is currently 22°C and sunny."
```

### Built-in tools (120+ across 20 categories)

```ts
import { TavilySearchTool } from 'personaforge/tools/search';
import { HttpClientTool } from 'personaforge/tools/utils';
import { StripeTool } from 'personaforge/tools/finance';

const search = new TavilySearchTool({ apiKey: process.env.TAVILY_API_KEY! });
const http   = new HttpClientTool();
```

Categories: search (Tavily, Exa, Brave, Serper, Arxiv, PubMed, Perplexity, Reddit, YouTube), scraping (FireCrawl, Newspaper), HTTP, filesystem, shell, browser, finance (Stripe, Yahoo), CRM, media, productivity, devtools, MCP, social, data, AI, communication, memory.

## 7. Sessions — persist conversations across turns

Without a session store, every `run()` is stateless. Add one to track conversation history:

```ts
import { InMemorySessionStore } from 'personaforge';

const bot = agent({
  name: 'assistant',
  model: 'gpt-4o-mini',
  instructions: 'You are a helpful assistant.',
  sessionStore: new InMemorySessionStore(),
});

await bot.run('My name is Alice.', { sessionId: 'user-123' });
const result = await bot.run('What is my name?', { sessionId: 'user-123' });
console.log(result.text); // "Your name is Alice."
```

### Session store backends

| Store | Best for |
|---|---|
| `InMemorySessionStore` | Dev, testing, single-process |
| `createSqliteStore({ filename: './sessions.db' })` | Small production, local |
| `createRedisStore(redisClient)` | Multi-process, production |
| `createDbSessionStore(pgPool)` | Large production with PostgreSQL |
| `createFallbackSessionStore([redis, sqlite])` | Resilient multi-tier fallback chain |

## 8. Streaming — tokens as they arrive

Don't wait for the full response. Stream tokens:

```ts
for await (const chunk of bot.stream('Tell me a short story.')) {
  process.stdout.write(chunk);
}
```

### Structured streaming events

Track tool calls, errors, and completion:

```ts
import { defineAgent } from 'personaforge';

const agent = defineAgent({
  name: 'streamer',
  model: 'gpt-4o',
  instructions: 'You are helpful.',
  tools: [myTool],
}).build();

for await (const event of agent.stream('Calculate 40 + 2 using the tool.')) {
  switch (event.type) {
    case 'text':        process.stdout.write(event.content ?? ''); break;
    case 'tool_call':   console.log(`→ Calling ${event.toolName}...`); break;
    case 'tool_result': console.log(`← Result: ${JSON.stringify(event.toolOutput)}`); break;
    case 'done':        console.log('✓ Finished'); break;
    case 'error':       console.error('✗ Error:', event.error); break;
  }
}
```

## 9. Structured output — force JSON responses

```ts
import { z } from 'zod';

const ReviewSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  score: z.number().min(1).max(10),
  summary: z.string(),
});

const reviewer = agent({
  name: 'reviewer',
  model: 'gpt-4o',
  instructions: 'Analyze product reviews.',
  outputSchema: ReviewSchema,
});

const { object } = await reviewer.run('This laptop is amazing! Fast, great screen, battery lasts all day.');
console.log(object);
// { sentiment: 'positive', score: 9, summary: 'Fast laptop with great screen and battery life.' }
```

## 10. Memory — remember across runs

personaforge has a multi-tier memory system. The simplest path is the unified `Memory` layer:

```ts
import { agent, Memory } from 'personaforge';

const memory = new Memory({
  options: {
    lastMessages: 20,
    workingMemory: { template: '# User Profile\n- Name:\n- Preferences:' },
  },
});

const bot = agent({
  name: 'assistant',
  model: 'gpt-4o',
  instructions: 'You are a helpful assistant. Remember user preferences.',
  memory,
});

await bot.run('I prefer dark mode and TypeScript.', { memory: { thread: 't1', resource: 'alice' } });
const result = await bot.run('What do I prefer?', { memory: { thread: 't1', resource: 'alice' } });
console.log(result.text); // references dark mode and TypeScript
```

When `memory` is set, personaforge automatically persists message history, injects working memory context, runs semantic indexing, and registers memory tools.

## 11. Knowledge / RAG — answer from your documents

```ts
import { agent, createKnowledgeEngine } from 'personaforge';

const kb = createKnowledgeEngine({
  name: 'docs-kb',
  embedder: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
});

await kb.addDocument('Quantum computing uses qubits instead of bits. Qubits can be in superposition.');
await kb.addDocument('Entanglement allows qubits to be correlated across distances.');

const expert = agent({
  name: 'quantum-expert',
  model: 'gpt-4o',
  instructions: 'Answer using only the knowledge base. Say "I don\'t know" if unclear.',
  knowledgebase: kb,
  addKnowledgeToContext: true,
});

const result = await expert.run('What is a qubit?');
console.log(result.text); // referenced from your documents
```

## 12. Multi-agent orchestration

### Sequential pipeline with `compose()`

```ts
import { agent, compose } from 'personaforge';

const researcher = agent({ name: 'researcher', model: 'gpt-4o', instructions: 'Research the topic deeply.' });
const writer     = agent({ name: 'writer',     model: 'gpt-4o', instructions: 'Write a clear report.' });
const editor     = agent({ name: 'editor',     model: 'gpt-4o', instructions: 'Edit and polish.' });

const pipeline = compose(researcher, writer, editor);
const result = await pipeline.run('State of quantum computing in 2026.');
```

### Supervisor — one agent delegates to specialists

```ts
import { createSupervisor, createAgent } from 'personaforge';

const coder    = createAgent({ name: 'coder',    instructions: 'You write code.',        model: 'gpt-4o' });
const reviewer = createAgent({ name: 'reviewer', instructions: 'You review code.',       model: 'gpt-4o' });
const deployer = createAgent({ name: 'deployer', instructions: 'You deploy code.',       model: 'gpt-4o' });

const supervisor = createSupervisor({
  name: 'tech-lead',
  instructions: 'Delegate coding tasks to the right specialist.',
  model: 'gpt-4o',
  specialists: [coder, reviewer, deployer],
});

const result = await supervisor.run('Build a REST API for user authentication.');
```

### Consensus — majority/weighted/unanimous voting

```ts
import { createConsensus, agent } from 'personaforge';

const a = agent({ name: 'analyst-a', model: 'gpt-4o-mini', instructions: 'Analyze the market.' });
const b = agent({ name: 'analyst-b', model: 'gpt-4o',      instructions: 'Analyze the market.' });
const c = agent({ name: 'analyst-c', model: 'claude-3',    instructions: 'Analyze the market.' });

const jury = createConsensus({
  agents: [a, b, c],
  mode: 'majority',
});

const verdict = await jury.run('Should we invest in AI infrastructure?');
```

## 13. Production serving

Turn your agent into an HTTP endpoint:

```ts
import { agent, createHttpService } from 'personaforge';

const bot = agent({ name: 'api-bot', model: 'gpt-4o-mini', instructions: 'Be helpful.' });

const app = createHttpService({ agent: bot });
await app.listen(3000);
// → POST http://localhost:3000/v1/chat  { messages: [...] }
// → GET  http://localhost:3000/health
// → GET  http://localhost:3000/v1/openapi.json
```

## 14. Enterprise gateway — multi-tenant with compliance dashboard

```ts
import { createAgent, createEnterpriseGateway } from 'personaforge';

const support = createAgent({ name: 'support', instructions: 'Support questions.' });
const billing = createAgent({ name: 'billing', instructions: 'Billing questions.' });

const gateway = createEnterpriseGateway({
  agents: { support, billing },
  auth: apiKeyAuth([process.env.GATEWAY_API_KEY!]),
  tenants: [
    { id: 'acme', monthlyBudgetUsd: 500, maxRpm: 60, allowedAgents: ['support', 'billing'] },
  ],
  policy: { monthlyBudgetUsd: 5000, requestTimeoutMs: 60_000 },
  auditStore: createSqliteAuditStore('./audit.db'),
});

await gateway.start(8787);
// → http://localhost:8787/compliance (SOC 2 / HIPAA / GDPR / ISO 27001)
```

## The build order that works

Add capabilities in this order. Each layer is optional — only add what your application actually needs:

1. **Agent + model** — get one `run()` working
2. **Tools** — give the agent live data access
3. **Sessions** — persist conversations across turns
4. **Memory or RAG** — contextual recall or document retrieval
5. **HTTP serving** — make the agent a real endpoint
6. **Orchestration** — when one agent is no longer enough
7. **Production controls** — guardrails, budgets, observability, resilience

Every layer should answer a specific missing requirement, not curiosity about what the framework can do.

## What to avoid early

- Starting with a team when one agent would do
- Mixing several model providers before you know the task shape
- Adding persistence or approvals before the core prompt behavior is understood
- Writing many tools before one tool has proven its value

## Next steps

- **[Creating Agents](/guide/agents)** — the complete `agent()` / `createAgent()` reference
- **[Tools](/guide/tools)** — 120+ built-in tools, custom tool patterns, composition
- **[Orchestration](/guide/orchestration)** — supervisor, swarm, consensus, handoff, pipeline
- **[Graph Engine](/guide/graph)** — DAG workflows with branching, parallelism, durability
- **[Memory & Sessions](/guide/memory)** — full memory architecture and session management
- **[Production](/guide/production)** — resilience, budgets, observability, control plane
- **[Examples](/examples/)** — 22 runnable examples from hello-world to full-stack
