---
title: "04 · Extend & Wrap Tools"
---

# 04 · Extend & Wrap Tools

You do not need to rewrite a tool to add production behavior. The current tool layer supports extension, middleware wrapping, composition, and version tagging.

## What you'll learn

- `extendTool()` for input normalization and fallback handling
- `wrapTool()` for middleware-style caching and logging
- `pipeTools()` and `versionTool()` for composition and versioning

## Extend a tool

```ts
import { z } from 'zod/v3';
import { extendTool, tool } from 'personaforge';

const fetchWeather = tool({
  name: 'fetch_weather',
  description: 'Return a weather summary for a city.',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ city, tempC: 22, condition: 'sunny' }),
});

const smartWeather = extendTool(fetchWeather, {
  name: 'smart_weather',
  beforeExecute: async (params) => {
    console.log(`fetching weather for ${params.city}`);
    return undefined;
  },
  transformInput: async (params) => ({ city: params.city.trim() }),
  transformOutput: async (output) => ({
    city: output.city,
    tempC: output.tempC,
    condition: output.condition.toUpperCase(),
  }),
  onError: async (_error, params) => ({
    city: params.city,
    tempC: -1,
    condition: 'UNAVAILABLE',
  }),
});

const result = await smartWeather.execute(
  { city: '  Tokyo  ' },
  { agentId: 'demo', sessionId: 'demo' },
);

console.log(result);
```

## Wrap a tool with middleware

```ts
import { z } from 'zod/v3';
import { tool, wrapTool } from 'personaforge';

const cache = new Map<string, { city: string; tempC: number; condition: string }>();

const fetchWeather = tool({
  name: 'fetch_weather',
  description: 'Return a weather summary for a city.',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ city, tempC: 22, condition: 'sunny' }),
});

const cachedWeather = wrapTool(
  fetchWeather,
  [
    async (params, ctx, next) => {
      console.log(`agent=${ctx.agentId} city=${params.city}`);
      return next(params, ctx);
    },
    async (params, ctx, next) => {
      const key = params.city.toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;
      const result = await next(params, ctx);
      cache.set(key, result);
      return result;
    },
  ],
  { name: 'cached_weather' },
);

const result = await cachedWeather.execute(
  { city: 'Paris' },
  { agentId: 'demo', sessionId: 'demo' },
);

console.log(result);
```

## Pipe and version tools

```ts
import { z } from 'zod/v3';
import { pipeTools, tool, versionTool } from 'personaforge';

const fetchUrl = tool({
  name: 'fetch_url',
  description: 'Return HTML for a URL.',
  parameters: z.object({ url: z.string().url() }),
  execute: async ({ url }) => ({ body: `<html><body>Read ${url}</body></html>` }),
});

const extractText = tool({
  name: 'extract_text',
  description: 'Strip HTML tags from a document.',
  parameters: z.object({ body: z.string() }),
  execute: async ({ body }) => ({ text: body.replace(/<[^>]+>/g, ' ').trim() }),
});

const fetchAndRead = pipeTools(fetchUrl, extractText, {
  name: 'fetch_and_read',
  description: 'Fetch a URL and return readable text.',
  adapter: (result) => ({ body: result.body }),
});

const fetchAndReadV2 = versionTool(fetchAndRead, '2.0', {
  changelog: 'Combines fetch and extraction into one tool call.',
});

const result = await fetchAndReadV2.execute(
  { url: 'https://example.com' },
  { agentId: 'demo', sessionId: 'demo' },
);

console.log(result);
```

## What's next?

- [05 · RAG Knowledge Base](./05-rag)
- [07 · Storage Patterns](./07-storage)