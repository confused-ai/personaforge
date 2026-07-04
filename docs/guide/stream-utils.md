---
title: Stream Utilities
description: Consume and transform low-level LLM provider streams with streamToText, streamToSSE, streamTee, streamMap, and related helpers.
outline: [2, 3]
---

# Stream Utilities

`confused-ai/models` exports a set of helpers for `AsyncIterable<StreamDelta>` streams produced by model providers. These utilities are low-level building blocks for buffering, filtering, merging, and piping provider output to HTTP responses.

```ts
import {
  streamToText,
  streamToChunks,
  streamToSSE,
  streamWithBudget,
  streamTee,
  streamMap,
  streamFilter,
  streamMerge,
  streamToNodeCallback,
} from 'confused-ai/models';
```

---

## `StreamDelta`

All stream utilities operate on `AsyncIterable<StreamDelta>`:

```ts
type StreamDelta =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; argsDelta: string };
```

---

## `streamToText()`

Buffer an entire stream into one string. Tool-call deltas are ignored.

```ts
import { streamToText } from 'confused-ai/models';

async function* demoStream() {
  yield { type: 'text', text: 'Petals fall softly ' } as const;
  yield { type: 'text', text: 'through the morning light.' } as const;
}

const text = await streamToText(demoStream());
console.log(text); // "Petals fall softly through the morning light."
```

---

## `streamToChunks()`

Collect just the text segments from a stream while preserving chunk boundaries.

```ts
import { streamToChunks } from 'confused-ai/models';

async function* demoStream() {
  yield { type: 'text', text: 'alpha ' } as const;
  yield { type: 'tool_call', id: 'tool-1', name: 'search', argsDelta: '{"q":"beta"}' } as const;
  yield { type: 'text', text: 'gamma' } as const;
}

const chunks = await streamToChunks(demoStream());
console.log(chunks); // ['alpha ', 'gamma']
```

---

## `streamToSSE()`

Pipe a provider stream directly to a Node HTTP response as Server-Sent Events. The third argument is typed `StreamToSSEOptions` (also exported from `confused-ai/models`).

```ts
import { createServer } from 'node:http';
import { streamToSSE } from 'confused-ai/models';

async function* demoStream() {
  yield { type: 'text', text: 'Hello' } as const;
  yield { type: 'text', text: ' world' } as const;
}

const server = createServer(async (_req, res) => {
  await streamToSSE(demoStream(), res, { keepAliveMs: 0 });
});

server.listen(3000);
```

### SSE format

`streamToSSE()` writes events like:

```
event: text
data: {"text":"Hello"}

event: done
data: {}
```

---

## `streamWithBudget()`

Stop yielding deltas after an approximate token budget is reached. The options object is typed `StreamBudgetOptions` (also exported from `confused-ai/models`).

```ts
import { streamWithBudget } from 'confused-ai/models';

async function* demoStream() {
  yield { type: 'text', text: 'A short sentence.' } as const;
  yield { type: 'text', text: ' Another sentence that may exceed the budget.' } as const;
}

const budgetedStream = streamWithBudget(demoStream(), {
  maxTokens: 5,
  onBudgetExceeded: (used) => console.warn(`Budget exceeded at ~${used} tokens`),
});

for await (const chunk of budgetedStream) {
  if (chunk.type === 'text') process.stdout.write(chunk.text);
}
```

---

## `streamTee()`

Duplicate one stream into two independent consumers.

```ts
import { streamTee, streamToText } from 'confused-ai/models';

async function* demoStream() {
  yield { type: 'text', text: 'Explain ' } as const;
  yield { type: 'text', text: 'quantum entanglement.' } as const;
}

const [displayStream, saveStream] = streamTee(demoStream());

void (async () => {
  for await (const chunk of displayStream) {
    if (chunk.type === 'text') process.stdout.write(chunk.text);
  }
})();

void (async () => {
  const fullText = await streamToText(saveStream);
  console.log(fullText);
})();
```

::: warning Backpressure
`streamTee` buffers chunks internally when one consumer is slower than the other. For very long streams, prefer `streamToText` on one branch and process the other in real-time.
:::

---

## `streamMap()`

Transform each delta without buffering the entire stream.

```ts
import { streamMap, streamToText } from 'confused-ai/models';

async function* demoStream() {
  yield { type: 'text', text: 'hello ' } as const;
  yield { type: 'text', text: 'world' } as const;
}

const uppercaseStream = streamMap(demoStream(), async (delta) => {
  if (delta.type !== 'text') return delta;
  return { ...delta, text: delta.text.toUpperCase() };
});

console.log(await streamToText(uppercaseStream)); // "HELLO WORLD"
```

---

## `streamFilter()`

Drop chunks that don't satisfy a predicate:

```ts
import { streamFilter, streamToText } from 'confused-ai/models';

async function* demoStream() {
  yield { type: 'text', text: 'visible ' } as const;
  yield { type: 'tool_call', id: 'tool-1', name: 'search', argsDelta: '{"q":"hidden"}' } as const;
  yield { type: 'text', text: 'text' } as const;
}

const textOnly = streamFilter(demoStream(), (delta) => delta.type === 'text');
console.log(await streamToText(textOnly)); // "visible text"
```

---

## `streamMerge()`

Merge multiple concurrent streams into one stream. Deltas are yielded as they arrive.

```ts
import { streamMerge } from 'confused-ai/models';

async function* streamA() {
  yield { type: 'text', text: 'A1 ' } as const;
  yield { type: 'text', text: 'A2 ' } as const;
}

async function* streamB() {
  yield { type: 'text', text: 'B1 ' } as const;
}

for await (const chunk of streamMerge([streamA(), streamB()])) {
  if (chunk.type === 'text') process.stdout.write(chunk.text);
}
```

---

## `streamToNodeCallback()`

Adapt an `AsyncIterable<StreamDelta>` to a Node-style callback.

```ts
import { streamToNodeCallback } from 'confused-ai/models';

async function* demoStream() {
  yield { type: 'text', text: 'Hello' } as const;
}

streamToNodeCallback(
  demoStream(),
  (err, chunk) => {
    if (err) {
      console.error('Stream error:', err);
      return;
    }
    if (chunk?.type === 'text') process.stdout.write(chunk.text);
    if (chunk === null) console.log('\nStream complete');
  },
);
```

---

## Composing utilities

Most utilities accept and return `AsyncIterable<StreamDelta>`, so they compose naturally:

```ts
import {
  streamFilter,
  streamTee,
  streamToSSE,
  streamToText,
  streamWithBudget,
} from 'confused-ai/models';
import { createServer } from 'node:http';

async function* rawStream() {
  yield { type: 'text', text: 'hello ' } as const;
  yield { type: 'tool_call', id: 'tool-1', name: 'search', argsDelta: '{"q":"world"}' } as const;
  yield { type: 'text', text: 'world' } as const;
}

// Build a processing pipeline:
const [logStream, responseStream] = streamTee(
  streamWithBudget(
    streamFilter(rawStream(), (delta) => delta.type === 'text'),
    { maxTokens: 1000 },
  ),
);

const server = createServer(async (_req, res) => {
  await streamToSSE(responseStream, res, { keepAliveMs: 0 });
});

server.listen(3000);

console.log(await streamToText(logStream));
```

---

## Quick reference

| Function | Input | Output | Description |
|----------|-------|--------|-------------|
| `streamToText` | `AsyncIterable<StreamDelta>` | `Promise<string>` | Collect all text |
| `streamToChunks` | `AsyncIterable<StreamDelta>` | `Promise<string[]>` | Collect text chunks |
| `streamToSSE` | `AsyncIterable<StreamDelta>` | `Promise<void>` | Write SSE to a `ServerResponse` |
| `streamWithBudget` | `AsyncIterable<StreamDelta>` | `AsyncIterable<StreamDelta>` | Token-budget gate |
| `streamTee` | `AsyncIterable<StreamDelta>` | `[AsyncIterable, AsyncIterable]` | Duplicate stream |
| `streamMap` | `AsyncIterable<StreamDelta>` | `AsyncIterable<StreamDelta>` | Transform each delta |
| `streamFilter` | `AsyncIterable<StreamDelta>` | `AsyncIterable<StreamDelta>` | Drop deltas |
| `streamMerge` | `AsyncIterable<StreamDelta>[]` | `AsyncIterable<StreamDelta>` | Merge multiple streams |
| `streamToNodeCallback` | `AsyncIterable<StreamDelta>` | `void` | Node.js callback adapter |

---

## See also

- [Creating Agents](/guide/agents) — `agent.stream()` and `agent.streamEvents()`
- [WebSocket Transport](/guide/websocket) — stream over WebSocket
- [Observability & OTLP](/guide/observability) — trace every stream chunk
- [Background Queues](/guide/background-queues) — process streams asynchronously
