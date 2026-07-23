---
title: 12 · Observability & Hooks
description: Instrument agents with lifecycle hooks for structured logging, tracing, metrics, and error tracking. Zero external dependencies required.
outline: [2, 3]
---

# 12 · Observability & Hooks

Lifecycle hooks let you observe every stage of an agent run — before and after each turn, around every tool call, and on errors. They require no external dependencies and work with any logging or tracing backend.

---

## What you'll learn

- All available lifecycle hook signatures
- How to build structured logs around runs and tool calls
- How to track token usage and step counts
- How to integrate with external tracing systems using `runId` and `traceId`
- How to use the `personaforge/observe` module for richer metrics

---

## All lifecycle hooks

```ts
import { z } from 'zod/v3';
import { createAgent, tool } from 'personaforge';

const lookupOrder = tool({
  name: 'lookup_order',
  description: 'Return the current status for an order.',
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({
    orderId,
    status: 'shipped',
    eta: '2026-05-14',
  }),
});

const observedAgent = createAgent({
  name: 'support-agent',
  instructions: 'Answer support questions. Use lookup_order for order status queries.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [lookupOrder],
  hooks: {
    // Called before the run starts — can modify or replace the prompt
    beforeRun: (prompt, config) => {
      console.log('[run:start]', {
        runId: config.runId,
        traceId: config.traceId,
        userId: config.userId,
        sessionId: config.sessionId,
        prompt: prompt.slice(0, 120),
      });
      return prompt;  // return modified prompt or the original unchanged
    },

    // Called before each tool invocation — can modify args
    beforeToolCall: async (name, args, step) => {
      console.log('[tool:start]', { name, args, step });
      return args;  // return modified args or the original unchanged
    },

    // Called after each tool invocation — can modify result
    afterToolCall: async (name, result, _args, step) => {
      console.log('[tool:end]', { name, step, result });
      return result;  // return modified result or the original unchanged
    },

    // Called to build the system prompt — can inject extra context
    buildSystemPrompt: (instructions, ragContext) => {
      const parts = [instructions];
      if (ragContext) parts.push(`\n\nContext:\n${ragContext}`);
      return parts.join('');
    },

    // Called after the run completes — can modify or annotate the result
    afterRun: (result) => {
      console.log('[run:finish]', {
        runId: result.runId,
        steps: result.steps,
        finishReason: result.finishReason,
        usage: result.usage,
      });
      return result;
    },

    // Called when the run throws an unrecoverable error
    onError: (error, step) => {
      console.error('[run:error]', {
        step,
        message: error.message,
        stack: error.stack,
      });
    },
  },
});

const result = await observedAgent.run('What is the status of order ORD-42?', {
  userId: 'cust-42',
  sessionId: 'sess-001',
});
console.log(result.text);
```

---

## Structured logging to a log sink

Replace `console.log` with your preferred logger:

```ts
import pino from 'pino';
import { createAgent } from 'personaforge';

const logger = pino({ level: 'info' });

const agent = createAgent({
  name: 'logged-agent',
  instructions: 'You are a concise assistant.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    beforeRun: (prompt, config) => {
      logger.info({ event: 'run.start', runId: config.runId, userId: config.userId });
      return prompt;
    },
    afterRun: (result) => {
      logger.info({
        event: 'run.finish',
        runId: result.runId,
        steps: result.steps,
        tokensUsed: result.usage?.totalTokens,
        finishReason: result.finishReason,
      });
      return result;
    },
    onError: (error, step) => {
      logger.error({ event: 'run.error', step, message: error.message });
    },
  },
});
```

---

## Tracing with `runId` and `traceId`

Pass a `traceId` into `run()` to correlate agent runs with your distributed trace:

```ts
import { randomUUID } from 'node:crypto';

// In your HTTP handler
async function handleRequest(req: Request) {
  const traceId = req.headers.get('x-trace-id') ?? randomUUID();

  const result = await agent.run(req.body.message, {
    userId: req.headers.get('x-user-id') ?? undefined,
    traceId,
  });

  return Response.json({ text: result.text, traceId });
}
```

The `traceId` and `runId` flow through every hook, so every log line for the same request carries the same correlation ID.

---

## Token usage tracking

`result.usage` gives you input, output, and total token counts after every run:

```ts
const agent = createAgent({
  name: 'usage-tracked',
  instructions: 'You are a concise assistant.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    afterRun: (result) => {
      if (result.usage) {
        metrics.increment('llm.tokens.input',  result.usage.inputTokens);
        metrics.increment('llm.tokens.output', result.usage.outputTokens);
        metrics.increment('llm.tokens.total',  result.usage.totalTokens);
      }
      return result;
    },
  },
});
```

---

## `personaforge/observe` — richer metrics and evals

For structured traces, eval suites, and metric aggregation, use the observe module:

```ts
import { createAgent } from 'personaforge';
import { createObserver, runEvalSuite } from 'personaforge/observe';

const observer = createObserver({
  onEvent: (event) => {
    // Emit to your metrics backend (Datadog, Prometheus, etc.)
    console.log(JSON.stringify(event));
  },
});

const agent = createAgent({
  name: 'observed-agent',
  instructions: 'Answer questions clearly.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  observer,
});
```

---

## Hook quick reference

| Hook | Arguments | Returns | Use for |
|---|---|---|---|
| `beforeRun` | `(prompt, config)` | `string` | Log run start, modify prompt |
| `afterRun` | `(result)` | `AgentResult` | Log run finish, track usage |
| `beforeToolCall` | `(name, args, step)` | `args` | Log tool invocations, modify args |
| `afterToolCall` | `(name, result, args, step)` | `result` | Log tool outputs, cache results |
| `buildSystemPrompt` | `(instructions, ragContext)` | `string` | Inject custom context |
| `onError` | `(error, step)` | `void` | Log or report errors |

---

## What's next?

- [13 · Production Resilience](./13-production) — circuit breakers and rate limits
- [22 · Eval Regression Guard](./22-eval-ci) — automated evaluation in CI
- [Observability guide](../guide/observability) — `personaforge/observe` full reference
