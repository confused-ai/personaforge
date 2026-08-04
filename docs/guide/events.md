---
title: Events
description: First-class typed event bus with a core event vocabulary. Subscribe to agent, tool, LLM, and workflow events across the framework.
outline: [2, 3]
---

# Events

`personaforge/events` gives every agent and workflow a first-class typed pub/sub bus. Everything that happens — agent started, tool called, LLM delta, run finished, workflow suspended — is an observable, typed event.

```ts
import { eventBus, AGENT_EVENT } from 'personaforge/events';
```

---

## Quick start

```ts
import { eventBus, AGENT_EVENT } from 'personaforge/events';
import { agent } from 'personaforge';

// A bus pre-wired with the core event vocabulary.
const bus = eventBus({ replayBufferSize: 100 });

bus.on(AGENT_EVENT.runFinished, (e) => {
  console.log('run finished', e.agentId, e.result);
});
bus.on('*', (type, payload) => {
  console.log('any event →', type);
});

// Emit from your own hooks:
const bot = agent({
  instructions: 'You are helpful.',
  hooks: {
    afterRun: async (result) => {
      await bus.emit(AGENT_EVENT.runFinished, { agentId: 'bot', sessionId: 's1', result });
    },
  },
});
```

---

## Core event vocabulary

`AGENT_EVENT` contains the canonical event names — use these to avoid typos across the framework:

| Constant | Event name | Payload |
|---|---|---|
| `AGENT_EVENT.agentStarted` | `agent:started` | `{ agentId?, sessionId?, prompt? }` |
| `AGENT_EVENT.agentOutput` | `agent:output` | `{ agentId?, sessionId?, text? }` |
| `AGENT_EVENT.agentFinished` | `agent:finished` | `{ agentId?, steps, tokensUsed?, costUsd? }` |
| `AGENT_EVENT.toolCalled` | `tool:called` | `{ agentId?, sessionId?, name, input }` |
| `AGENT_EVENT.toolResult` | `tool:result` | `{ agentId?, sessionId?, name, success, output?, durationMs? }` |
| `AGENT_EVENT.llmDelta` | `llm:delta` | `{ agentId?, sessionId?, delta }` |
| `AGENT_EVENT.stepFinished` | `step:finished` | `{ agentId?, sessionId?, step }` |
| `AGENT_EVENT.runFinished` | `run:finished` | `{ agentId?, sessionId?, result? }` |
| `AGENT_EVENT.workflowSuspended` | `workflow:suspended` | `{ workflowId?, awaiting, token?, message? }` |
| `AGENT_EVENT.workflowCompleted` | `workflow:completed` | `{ workflowId?, results? }` |
| `AGENT_EVENT.error` | `error` | `{ agentId?, message, error? }` |

`CoreEventMap` is the TypeScript type for these payloads — your handlers are fully typed.

---

## Generic event bus

For a custom `EventMap`, use `createAgentEventBus`:

```ts
import { createAgentEventBus } from 'personaforge/events';

interface MyEvents {
  'ping': { at: number };
  'pong': { at: number };
}
const bus = createAgentEventBus<MyEvents>({ replayBufferSize: 64 });

bus.on('ping', (p) => console.log('ping at', p.at));
await bus.emit('ping', { at: Date.now() });
```

---

## Replay buffer

With `replayBufferSize > 0`, late subscribers receive buffered events after subscribing — useful for audit / dashboard views:

```ts
const bus = eventBus({ replayBufferSize: 100 });
await bus.emit(AGENT_EVENT.toolCalled, { name: 'search', input: {...} });

// Later subscriber still sees the buffered event:
bus.on(AGENT_EVENT.toolCalled, (e) => console.log('replay >', e.name));
```

---

## Handler failures

Handler errors surface as an `AggregateError` after all handlers run, so one failing handler doesn't break the others:

```ts
try {
  await bus.emit(AGENT_EVENT.error, { message: 'x' });
} catch (err) {
  // AggregateError of handler failures
}
```

---

## Related pages

- [Hooks](./hooks) — lifecycle hooks on agents / workflows.
- [Event Streaming](./event-streaming) — SSE event streaming for HTTP serving.
- [Observability](./observability) — traces and metrics.