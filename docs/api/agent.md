---
title: agent() / createAgent() API
description: Complete reference for agent(), createAgent(), defineAgent(), bare(), and all AgentConfig options including tools, sessions, memory, knowledge, guardrails, hooks, and budget.
outline: [2, 3]
---

# agent() / createAgent() API

The root package exposes four agent authoring functions for different levels of control. All share the same underlying runtime — the differences are in how much they configure by default and what contract they expose.

```ts
import { agent, createAgent, defineAgent, bare } from 'personaforge';
```

---

## Which function to use

| Function | Use when |
|---|---|
| `agent()` | Standard path for new application code — opinionated defaults |
| `createAgent()` | Explicit factory style — same capabilities, more readable in factory-heavy codebases |
| `defineAgent()` | Typed input/output contracts for API boundaries and workflow steps |
| `bare()` | Minimal agent for pipelines and tests — no sessions, no guardrails by default |

---

## `agent()` / `createAgent()`

Both functions accept an identical `AgentConfig` object and return an `Agent` instance. Prefer `agent()` for new code; use `createAgent()` when the explicit factory name reads better in context.

```ts
import { createAgent } from 'personaforge';

const assistant = createAgent({
  name: 'assistant',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  instructions: 'You are a concise, helpful assistant.',
  tools: [],
  sessionStore: false,
  guardrails: false,
});

const result = await assistant.run('What is idempotency?');
console.log(result.text);
```

---

## `AgentConfig` — all options

### Core (required)

| Option | Type | Description |
|---|---|---|
| `name` | `string` | Agent identifier — used in logs, traces, and session scoping |
| `instructions` | `string \| string[]` | System prompt. Arrays are joined with a space. |
| `model` | `string \| LLMProvider` | Model string (`'gpt-4o-mini'`) or provider instance |
| `apiKey` | `string` | Provider API key — not required when `llm` is a custom provider |

### Tools

| Option | Type | Default | Description |
|---|---|---|---|
| `tools` | `Tool[] \| false` | `[]` | Tools the agent can call. `false` disables tools entirely. |

### State and memory

| Option | Type | Default | Description |
|---|---|---|---|
| `sessionStore` | `SessionStore \| false` | auto | Conversation continuity store. `false` disables sessions. |
| `memoryStore` | `MemoryStore` | — | Long-term memory store for cross-session recall |
| `knowledgebase` | `KnowledgeEngine` | — | RAG engine — context injected into every run |

### Safety and quality

| Option | Type | Default | Description |
|---|---|---|---|
| `guardrails` | `Guardrails \| false` | auto | Input/output safety rules. `false` disables all guardrails. |
| `maxSteps` | `number` | `10` | Maximum tool call steps per run before forcing a stop |

### Resilience

| Option | Type | Default | Description |
|---|---|---|---|
| `retry` | `RetryConfig` | — | Retry policy for failed LLM calls |
| `timeoutMs` | `number` | — | Per-run timeout in milliseconds |
| `budget` | `BudgetConfig` | — | Hard caps on token and cost spend |
| `checkpointStore` | `CheckpointStore` | — | Persist run state for durable resume |

### Observability

| Option | Type | Description |
|---|---|---|
| `hooks` | `AgenticLifecycleHooks` | Lifecycle callbacks for logging, tracing, and metrics |
| `observer` | `Observer` | Structured event emitter for `personaforge/observe` integration |

### Advanced

| Option | Type | Description |
|---|---|---|
| `llm` | `LLMProvider \| LLMRouter` | Custom provider or router — overrides `model` and `apiKey` |
| `contextProviders` | `ContextProvider[]` | Additional context injected into the system prompt |
| `temperature` | `number` | Sampling temperature for LLM calls (0–2). Default: `0.7` |
| `maxTokens` | `number` | Maximum output tokens per LLM call. Default: `4096` |

---

## `agent.run()` — request-response

```ts
const result = await assistant.run('Summarise vector databases in one sentence.');

console.log(result.text);           // string — the agent's response
console.log(result.runId);          // string — unique run identifier
console.log(result.sessionId);      // string — current session ID
console.log(result.steps);          // number — total steps (including tool calls)
console.log(result.finishReason);   // 'stop' | 'tool_calls' | 'length' | 'error'
console.log(result.usage);          // { inputTokens, outputTokens, totalTokens }
```

**`run()` options:**

```ts
await assistant.run('Your message', {
  sessionId: 'sess-001',       // continue an existing session
  userId: 'user-42',           // attach user identity to the run
  runId: 'my-run-id',          // provide a deterministic run ID
  traceId: 'trace-abc',        // correlation ID for distributed tracing
  context: { tenantId: 'acme' }, // arbitrary metadata passed through hooks
});
```

---

## `agent.stream()` — streaming tokens

Use `stream()` when the user should see tokens arrive incrementally.

```ts
for await (const chunk of assistant.stream('Explain TypeScript project references.')) {
  process.stdout.write(chunk);
}
```

`stream()` accepts the same options as `run()`.

---

## Retry configuration

```ts
const agent = createAgent({
  name: 'resilient',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  instructions: 'You are a concise assistant.',
  retry: {
    maxRetries: 3,         // retry up to 3 times on rate limit or network errors
    backoffMs: 500,        // initial delay between retries
    maxBackoffMs: 10_000,  // maximum retry delay
  },
  timeoutMs: 30_000,       // abort the run if it takes more than 30 seconds
});
```

---

## Budget controls

```ts
const agent = createAgent({
  name: 'budget-agent',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  instructions: 'Answer concisely.',
  budget: {
    maxTokensPerRun: 2_000,  // hard cap on tokens for a single run
    maxUsdPerDay: 10.00,     // cumulative spend cap per day
  },
});
```

When a budget is exceeded, the agent throws `BudgetExceededError`.

---

## Lifecycle hooks

```ts
const agent = createAgent({
  name: 'observed',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  instructions: 'You are a concise assistant.',
  hooks: {
    beforeRun:       (prompt, config) => { console.log('[start]', config.runId); return prompt; },
    afterRun:        (result)         => { console.log('[finish]', result.usage); return result; },
    beforeToolCall:  async (name, args, step)          => { console.log('[tool:start]', name); return args; },
    afterToolCall:   async (name, result, _args, step) => { console.log('[tool:end]', name); return result; },
    buildSystemPrompt: (instructions, ragContext)      => [instructions, ragContext].filter(Boolean).join('\n\n'),
    onError:         (error, step)    => { console.error('[error]', error.message); },
  },
});
```

See the [Observability example](../examples/12-observability) for a full walkthrough.

---

## `defineAgent()` — typed input/output

Use `defineAgent()` when the agent sits behind a typed API boundary, workflow step, or internal SDK.

```ts
import { defineAgent } from 'personaforge';
import { z } from 'zod';

const classifier = defineAgent('classifier')
  .model('gpt-4o-mini')
  .apiKey(process.env.OPENAI_API_KEY!)
  .input(z.object({ text: z.string() }))
  .output(z.object({
    category: z.enum(['billing', 'technical', 'general']),
    confidence: z.number(),
  }))
  .instructions('Classify the support request. Return JSON with category and confidence (0–1).')
  .build();

const result = await classifier.run({ text: 'My invoice shows the wrong amount.' });
console.log(result.category);    // → 'billing'
console.log(result.confidence);  // → 0.95
```

The output schema is validated on every run. Use this pattern for agent-to-agent calls, API handlers, and pipeline stages where the shape of the output matters.

---

## `bare()` — minimal agent

`bare()` creates an agent with no default sessions, no guardrails, and minimal wiring. Ideal for `compose()` pipelines, tests, and background workers.

```ts
import { bare } from 'personaforge';

const worker = bare({
  name: 'worker',
  instructions: 'Process the input and return a structured result.',
  llm: myLlmAdapter,   // any object with a generateText() method
  tools: false,
  maxSteps: 1,
});

const result = await worker.run('Summarise this text: ...');
console.log(result.text);
```

`bare()` accepts the same `AgentConfig` shape but has no auto-wired defaults.

---

## Custom LLM provider

Pass any object implementing `{ generateText(messages): Promise<{ text, finishReason }> }` as `llm`:

```ts
import { createAgent } from 'personaforge';

const myProvider = {
  async generateText(messages: Array<{ role: string; content: unknown }>) {
    // call any LLM API here
    return { text: 'My response', finishReason: 'stop' as const };
  },
};

const agent = createAgent({
  name: 'custom-llm-agent',
  instructions: 'You are an assistant.',
  llm: myProvider,
  tools: false,
  sessionStore: false,
  guardrails: false,
});
```

For multi-provider routing, pass an `LLMRouter` from `createSmartRouter()` or similar factory.

---

## `AgentResult` — run output shape

```ts
interface AgentResult {
  text: string;                // final text response
  runId: string;               // unique run identifier
  sessionId: string;           // session this run belongs to
  steps: number;               // total steps including tool calls
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
```

---

## Where to go next

- [Tools API](./tools) — `tool()`, `extendTool()`, `wrapTool()`, and MCP
- [Knowledge API](./knowledge) — `createKnowledgeEngine()` and retrieval
- [Storage API](./storage) — `createStorage()` for durable state
- [Orchestration API](./orchestration) — `createTeam()` and `createSupervisor()`
- [01 · Hello World](../examples/01-hello-world) — minimal agent example
- [15 · Full-Stack App](../examples/15-full-stack) — all options wired together
