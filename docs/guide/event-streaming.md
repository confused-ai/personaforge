---
title: Event Streaming
description: LangGraph-style event stream protocol — values, updates, messages (token-level), debug, and custom events with StreamEventBus, StreamContext.emit(), and createStreamableRun().
outline: [2, 3]
---

# Event Streaming

The `confused-ai/streaming` module provides a LangGraph-style event stream protocol. Nodes, tools, and LLM adapters emit typed events; consumers choose which event types they want.

```ts
import {
  StreamEventBus, StreamContext, createStreamableRun,
  type StreamEvent, type StreamMode,
} from 'confused-ai/streaming';
```

---

## Stream modes

| Mode | What it delivers |
|---|---|
| `values` | Full state snapshot after each node finishes |
| `updates` | Per-node delta (node name + output) |
| `messages` | Token-level chunks from the LLM |
| `debug` | Tool call details, timing, internal telemetry |
| `custom` | User-emitted events via `ctx.emit()` |

Subscribe to one or more modes when you create a bus or a streamable run:

```ts
const bus = new StreamEventBus(['messages', 'updates']);
```

---

## Quick start with `createStreamableRun`

```ts
const { events, result } = createStreamableRun(async (ctx) => {
  ctx.token('Hello');
  ctx.token(' world');
  ctx.emit('milestone', { step: 1 });
  return { answer: 'Hello world' };
}, { streamMode: ['messages', 'custom'] });

for await (const event of events) {
  if (event.type === 'token') process.stdout.write(event.data);
  if (event.type === 'custom') console.log('Custom:', event.name, event.data);
}

const output = await result;
```

---

## Using `StreamContext` inside a node or tool

Every node receives a `StreamContext` bound to the event bus:

```ts
function myNode(input: unknown, ctx: StreamContext) {
  ctx.token('Thinking...');
  ctx.emit('search_started', { query: 'x' });
  ctx.toolCall('websearch', { q: 'x' }, { results: ['...'] });
  ctx.debug({ latencyMs: 42 });
  ctx.update({ partial: true });
  ctx.value({ full: 'state' });
}
```

Only events matching the bus's modes are forwarded to consumers.

---

## Using `StreamEventBus` directly

For low-level integration:

```ts
const bus = new StreamEventBus(['messages', 'debug']);

// Consumer
const iter = bus.events();
const consume = (async () => {
  for await (const event of iter) {
    console.log(event.type, event);
  }
})();

// Producer
bus.emit({ type: 'token', data: 'hi', timestamp: Date.now() });
bus.close();
await consume;
```

The iterator terminates cleanly when `close()` is called and the buffer is drained.

---

## Event types

```ts
interface TokenEvent   { type: 'token';     data: string;   node?: string }
interface UpdateEvent  { type: 'update';    data: unknown;  node: string  }
interface ValueEvent   { type: 'value';     data: Record<string, unknown>; node: string }
interface ToolCallEvent{ type: 'tool_call'; data: { name; arguments; result? } }
interface DebugEvent   { type: 'debug';     data: Record<string, unknown> }
interface CustomEvent  { type: 'custom';    name: string;  data: unknown }
```

All events carry a `timestamp` (epoch ms).

---

## Related pages

- [Graph Engine](/guide/graph) — event-sourced execution.
- [Stream Utilities](/guide/stream-utils) — lower-level text stream helpers.
