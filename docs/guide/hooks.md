---
title: Hooks
description: Tap into every phase of an agent run — prompt rewriting, step observation, tool call interception, and error handling — with AgenticLifecycleHooks.
outline: [2, 3]
---

# Hooks

`AgenticLifecycleHooks` let you attach behavior at key lifecycle points without touching core agent logic. Pass a `hooks` object to `createAgent()`.

```ts
import { createAgent } from 'personaforge';
import type { AgenticLifecycleHooks } from 'personaforge';
```

---

## All hooks

```ts
interface AgenticLifecycleHooks {
  // Called before the run starts. Return a modified prompt to rewrite it.
  beforeRun?(prompt: string, config: unknown): Promise<string> | string;

  // Called after the run completes. Return a modified result to post-process it.
  afterRun?(result: AgentRunResult): Promise<AgentRunResult> | AgentRunResult;

  // Called before each LLM step. Return modified messages to inject context.
  beforeStep?(step: number, messages: Message[]): Promise<Message[]> | Message[];

  // Called after each LLM step completes.
  afterStep?(step: number, messages: Message[], text: string): Promise<void> | void;

  // Called before each tool call. Return modified args to transform inputs.
  beforeToolCall?(name: string, args: Record<string, unknown>, step: number): Promise<Record<string, unknown>> | Record<string, unknown>;

  // Called after each tool call with the result.
  afterToolCall?(name: string, result: unknown, args: Record<string, unknown>, step: number): Promise<unknown>;

  // Override the full system prompt construction (instructions + RAG context).
  buildSystemPrompt?(instructions: string, ragContext?: string): Promise<string> | string;

  // Called on any unhandled error inside the run.
  onError?(error: Error, step: number): Promise<void> | void;
}
```

---

## Examples

### Logging every tool call

```ts
const agent = createAgent({
  name: 'monitored-agent',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    beforeToolCall: (name, args, step) => {
      console.log(`[step ${step}] → calling tool: ${name}`, args);
      return args;  // must return args (can be modified)
    },
    afterToolCall: (name, result, args, step) => {
      console.log(`[step ${step}] ← tool result: ${name}`, result);
      return result;  // must return result (can be modified)
    },
  },
});
```

### Prompt rewriting

```ts
const agent = createAgent({
  name: 'rewriting-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    beforeRun: async (prompt) => {
      // Translate to English before the agent sees it
      const english = await translateToEnglish(prompt);
      return english;
    },
    afterRun: async (result) => {
      // Translate the answer back
      const translated = await translateBack(result.text);
      return { ...result, text: translated };
    },
  },
});
```

### Injecting context on each step

```ts
const agent = createAgent({
  name: 'context-injecting-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    beforeStep: async (step, messages) => {
      // Prepend a real-time context message at step 0 only
      if (step === 0) {
        return [
          { role: 'system', content: `Current time: ${new Date().toISOString()}` },
          ...messages,
        ];
      }
      return messages;
    },
  },
});
```

### Custom system prompt builder

```ts
const agent = createAgent({
  name: 'custom-prompt-agent',
  instructions: 'You are a customer service agent for Acme Corp.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    buildSystemPrompt: async (instructions, ragContext) => {
      const user = await loadCurrentUser();
      return [
        instructions,
        ragContext ? `\n\nRelevant documentation:\n${ragContext}` : '',
        `\n\nCurrent user: ${user.name} (plan: ${user.plan})`,
      ].join('');
    },
  },
});
```

### Error handling and alerting

```ts
const agent = createAgent({
  name: 'resilient-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    onError: async (error, step) => {
      await sendAlert({
        severity: 'high',
        message: `Agent error at step ${step}: ${error.message}`,
        stack: error.stack,
      });
    },
  },
});
```

### Step timing and tracing

```ts
const stepStartTimes = new Map<number, number>();

const agent = createAgent({
  name: 'timed-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    beforeStep: (step, messages) => {
      stepStartTimes.set(step, Date.now());
      return messages;
    },
    afterStep: (step, _messages, text) => {
      const start = stepStartTimes.get(step) ?? Date.now();
      console.log(`Step ${step} took ${Date.now() - start}ms. Output: ${text.slice(0, 80)}...`);
    },
  },
});
```

---

## Streaming events

For non-blocking real-time observation, use `agent.streamEvents()` instead:

```ts
for await (const event of agent.streamEvents('Summarise the report.')) {
  switch (event.type) {
    case 'text-delta':   process.stdout.write(event.delta); break;
    case 'tool-call':    console.log('calling', event.tool?.name); break;
    case 'tool-result':  console.log('result', event.tool?.output); break;
    case 'step-finish':  console.log(`step ${event.stepNumber} done`); break;
    case 'run-finish':   console.log('complete in', event.run?.steps, 'steps'); break;
    case 'error':        console.error(event.error); break;
  }
}
```

---

## Where to go next

- [Observability](./observability) — OTLP tracing, Prometheus metrics, Langfuse.
- [Guardrails](./guardrails) — block bad inputs/outputs with policy rules.
