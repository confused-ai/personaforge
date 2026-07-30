---
title: Migrate From Vercel AI SDK
description: Port Vercel AI SDK's streamText, generateText, streamObject, and useChat to personaforge. tool() is the same signature. Streaming maps to agent.stream(). React hooks become direct agent calls.
outline: [2, 3]
---

# Migrate From Vercel AI SDK

Vercel AI SDK focuses on streaming primitives and UI integration. `personaforge` provides the same streaming surface with persistence, multi-step reasoning, tools, sessions, and production middleware built in.

---

## Quick comparison

| Vercel AI SDK | personaforge equivalent |
|---|---|
| `generateText({ model, prompt })` | `agent.run(prompt)` → `result.text` |
| `streamText({ model, prompt })` | `agent.stream(prompt)` → `AsyncIterable<string>` |
| `generateObject({ model, schema })` | `agent.run(prompt)` + Zod schema in instructions |
| `streamObject(...)` | `agent.streamEvents(prompt)` |
| `tool({ description, parameters, execute })` | `tool({ name, description, schema, execute })` |
| `useChat()` hook | `agent.createSession()` + direct SDK calls |
| `CoreMessage[]` history | `agent.createSession({ sessionId })` |
| `maxSteps` | `createAgent({ maxSteps })` |
| `onChunk` callback | `agent.stream()` — iterate chunks |
| `experimental_telemetry` | [Observability](./observability) — OpenTelemetry-native |

---

## `generateText` → `agent.run`

```ts
// Vercel AI SDK
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const { text } = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Write a haiku about recursion.',
});

// personaforge
import { createAgent } from 'personaforge';

const agent = createAgent({
  name: 'writer',
  instructions: 'You are a creative writing assistant.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
});

const result = await agent.run('Write a haiku about recursion.');
// result.text
```

---

## `streamText` → `agent.stream`

```ts
// Vercel AI SDK
import { streamText } from 'ai';
const { textStream } = await streamText({ model: openai('gpt-4o'), prompt });
for await (const chunk of textStream) process.stdout.write(chunk);

// personaforge
for await (const chunk of agent.stream('Explain async/await in simple terms')) {
  process.stdout.write(chunk);
}
```

---

## Tools

Tools are intentionally similar — add `name` and change `parameters` to `schema`:

```ts
// Vercel AI SDK
import { tool } from 'ai';
import { z } from 'zod';

const getWeather = tool({
  description: 'Get weather for a city.',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => fetchWeather(city),
});

// personaforge (only difference: add `name`, rename `parameters` → `schema`)
import { tool } from 'personaforge';
import { z } from 'zod';

const getWeather = tool({
  name: 'get_weather',
  description: 'Get weather for a city.',
  schema: z.object({ city: z.string().describe('City name') }),
  execute: async ({ city }) => fetchWeather(city),
});
```

---

## Multi-step tool calls

```ts
// Vercel AI SDK
const { text } = await generateText({
  model: openai('gpt-4o'),
  tools: { getWeather },
  maxSteps: 5,
  prompt: 'What is the weather in Paris and London?',
});

// personaforge
const agent = createAgent({
  name: 'weather-agent',
  instructions: 'Answer weather questions using the available tools.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [getWeather],
  maxSteps: 5,
});
const result = await agent.run('What is the weather in Paris and London?');
```

---

## `useChat` hook → session

```ts
// Vercel AI SDK (Next.js)
import { useChat } from 'ai/react';
const { messages, input, handleSubmit } = useChat({ api: '/api/chat' });

// personaforge (route handler)
// app/api/chat/route.ts
export async function POST(req: Request) {
  const { message, sessionId } = await req.json();
  const session = agent.createSession({ sessionId });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of session.stream(message)) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}
```

---

## Streaming events

```ts
// Vercel AI SDK
const { fullStream } = streamText({ model: openai('gpt-4o'), tools: { ... }, prompt });
for await (const part of fullStream) {
  if (part.type === 'text-delta') process.stdout.write(part.textDelta);
}

// personaforge
for await (const event of agent.streamEvents('Plan my vacation to Japan')) {
  if (event.type === 'text-delta') process.stdout.write(event.delta ?? '');
  if (event.type === 'tool-call')  console.log('Calling tool:', event.tool?.name);
}
// event types: text-delta | tool-call | tool-result | step-finish | run-finish | error
```

---

## Structured output

```ts
// Vercel AI SDK
const { object } = await generateObject({
  model: openai('gpt-4o'),
  schema: z.object({ title: z.string(), tags: z.array(z.string()) }),
  prompt: 'Classify this article',
});

// personaforge — instruct the agent to return JSON, then parse
const agent = createAgent({
  name: 'classifier',
  instructions: 'Classify the article. Return ONLY a JSON object: { "title": string, "tags": string[] }',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
});
const result = await agent.run(articleText);
const parsed = JSON.parse(result.text);
```

---

## Where to go next

- [Framework Comparisons](./comparisons) — full capability matrix vs all frameworks.
- [Agents](./agents) — full `createAgent` API.
- [Tools](./tools) — `tool()` authoring.
- [Websocket & streaming](./websocket) — SSE and resumable stream endpoints.
- [Session](./session) — persistent conversation sessions.
