---
title: WebSocket & Streaming
description: Stream agent responses over SSE or WebSocket using agent.stream(), agent.streamEvents(), ResumableStreamManager for reconnection, and formatSSE for Server-Sent Events output.
outline: [2, 3]
---

# WebSocket & Streaming

Agents support three streaming modes out of the box: simple string chunks via `agent.stream()`, typed events via `agent.streamEvents()`, and resumable SSE streams via `ResumableStreamManager`.

```ts
import { createAgent } from 'personaforge';
import { ResumableStreamManager, formatSSE } from 'personaforge';
```

---

## `agent.stream()` — text chunks

The simplest streaming mode — yields string chunks as the model generates:

```ts
const agent = createAgent({
  name: 'streamer',
  instructions: 'Be helpful.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

for await (const chunk of agent.stream('Explain async/await in TypeScript')) {
  process.stdout.write(chunk);
}
```

---

## `agent.streamEvents()` — typed events

Yields `StreamChunk` events differentiating text deltas, tool calls, step completions, and the final result:

```ts
for await (const event of agent.streamEvents('Research quantum computing')) {
  switch (event.type) {
    case 'text-delta':
      process.stdout.write(event.delta ?? '');
      break;
    case 'tool-call':
      console.log(`Calling tool: ${event.tool?.name}`);
      break;
    case 'tool-result':
      console.log(`Tool result: ${event.tool?.name}`);
      break;
    case 'step-finish':
      console.log(`Step ${event.stepNumber} done`);
      break;
    case 'run-finish':
      console.log(`Completed in ${event.run?.steps} steps`);
      break;
    case 'error':
      console.error('Stream error:', event.error);
      break;
  }
}
```

### `StreamChunk` fields

| `type` | Fields | Description |
|---|---|---|
| `text-delta` | `delta` | One token or phrase from the model |
| `tool-call` | `tool.name`, `tool.input` | Tool called by the agent |
| `tool-result` | `tool.name`, `tool.output` | Tool returned its result |
| `step-finish` | `stepNumber` | Reasoning step completed |
| `run-finish` | `run` (AgentRunResult) | Run complete — final result |
| `error` | `error` | Error during the run |

---

## SSE endpoint (HTTP)

Serve streaming responses as Server-Sent Events from any HTTP server:

```ts
import Fastify from 'fastify';
import { createAgent, formatSSE, ResumableStreamManager } from 'personaforge';

const app = Fastify();
const agent = createAgent({ ... });
const streams = new ResumableStreamManager({ maxAgeMs: 5 * 60_000 });

app.get('/stream', async (req, reply) => {
  const prompt = req.query.prompt as string;

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const streamId = streams.createStream();

  for await (const event of agent.streamEvents(prompt)) {
    const chunk = streams.saveChunk(streamId, {
      type:    event.type === 'text-delta' ? 'text' : 'tool_call',
      content: event.delta ?? JSON.stringify(event.tool),
    });
    if (chunk) {
      reply.raw.write(formatSSE(chunk));
    }
    if (event.type === 'run-finish' || event.type === 'error') break;
  }
  reply.raw.end();
});
```

---

## Resumable streams (reconnect after disconnect)

`ResumableStreamManager` checkpoints every chunk so clients can reconnect from where they left off:

```ts
import { ResumableStreamManager } from 'personaforge';

const streams = new ResumableStreamManager({
  maxAgeMs: 5 * 60_000,    // keep streams resumable for 5 minutes
  maxStreams: 1000,
});

// Create a stream
const streamId = streams.createStream();

// Save each chunk as it arrives
streams.saveChunk(streamId, { type: 'text', content: 'Hello' });
streams.saveChunk(streamId, { type: 'text', content: ' world!' });

// Client reconnects — resume from position
const checkpoint = streams.getCheckpoint(streamId);
const missedChunks = streams.getChunksSince(streamId, checkpoint.position);
```

### Reconnect endpoint

```ts
app.get('/stream/:id/resume', async (req, reply) => {
  const { id } = req.params as { id: string };
  const position = Number(req.query.position ?? 0);

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });

  // Send missed chunks
  for (const chunk of streams.getChunksSince(id, position)) {
    reply.raw.write(formatSSE(chunk));
  }
  reply.raw.end();
});
```

---

## WebSocket server

Use `streamEvents` inside a WebSocket handler to push events directly:

```ts
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const { prompt } = JSON.parse(data.toString());

    for await (const event of agent.streamEvents(prompt)) {
      if (ws.readyState !== ws.OPEN) break;
      ws.send(JSON.stringify(event));
    }
  });
});
```

---

## Where to go next

- [Observability](./observability) — trace and monitor streaming runs.
- [Production](./production) — graceful shutdown, rate limiting.
- [Voice](./voice) — voice streaming via `VoiceStreamSession`.
