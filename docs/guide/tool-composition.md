---
title: Tool Composition
description: Layer cross-cutting behavior onto tools with extendTool (lifecycle hooks, input/output transform), wrapTool (middleware pipeline), pipeTools (chain two tools), and versionTool (versioned wrappers).
outline: [2, 3]
---

# Tool Composition

Tool composition lets you add caching, auth, logging, retries, and other cross-cutting concerns to any tool without touching its core logic.

```ts
import { extendTool, wrapTool, pipeTools, versionTool } from 'personaforge';
```

---

## `extendTool` — lifecycle hooks + transforms

Add `beforeExecute`, `afterExecute`, `transformInput`, `transformOutput`, and `onError` to any existing tool:

```ts
import { extendTool } from 'personaforge';
import { webSearchTool } from 'personaforge';  // or any built-in / custom tool

// Add result trimming + console logging to the built-in web search
const limitedSearch = extendTool(webSearchTool, {
  name: 'limited_web_search',
  description: 'Web search — returns top 3 results only.',

  beforeExecute: async (params, ctx) => {
    console.log(`[${ctx.runId}] Searching: ${params.query}`);
    // Return false to cancel the call
  },

  transformInput: async (params) => ({
    ...params,
    query: params.query.trim().toLowerCase(),  // normalise
  }),

  transformOutput: (results) =>
    Array.isArray(results) ? results.slice(0, 3) : results,  // trim

  afterExecute: (results, params, ctx) => {
    console.log(`[${ctx.runId}] Got ${Array.isArray(results) ? results.length : 1} results`);
  },

  onError: (err, params) => {
    console.warn('Search failed, returning empty:', err.message);
    return [];  // graceful fallback
  },

  timeoutMs: 10_000,
});
```

### All `extendTool` options

| Option | Type | Description |
|---|---|---|
| `name` | `string` | Override the tool name |
| `description` | `string` | Override the description |
| `transformInput` | `(params, ctx) => params` | Rewrite inputs before execution |
| `transformOutput` | `(output, params, ctx) => output` | Rewrite outputs after execution |
| `beforeExecute` | `(params, ctx) => false \| undefined` | Pre-hook — return `false` to cancel |
| `afterExecute` | `(output, params, ctx) => void` | Post-hook for logging / analytics |
| `onError` | `(err, params, ctx) => output` | Error handler — return fallback or re-throw |
| `needsApproval` | `boolean \| fn` | Override approval requirement |
| `timeoutMs` | `number` | Override timeout |
| `tags` | `string[]` | Append tags |
| `category` | `ToolCategory` | Override category |

---

## `wrapTool` — middleware pipeline

Apply a stack of `(params, ctx, next) => result` middlewares (onion model):

```ts
import { wrapTool } from 'personaforge';

const safeTool = wrapTool(myTool, [
  // 1. Auth check (outermost — runs first)
  async (params, ctx, next) => {
    if (!ctx.userId) throw new Error('Unauthorized');
    return next(params, ctx);
  },
  // 2. Cache layer
  async (params, ctx, next) => {
    const key = `cache:${JSON.stringify(params)}`;
    const hit = await cache.get<string>(key);
    if (hit) return JSON.parse(hit);
    const result = await next(params, ctx);
    await cache.set(key, JSON.stringify(result), 300);
    return result;
  },
  // 3. Retry on transient failure
  async (params, ctx, next) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await next(params, ctx); }
      catch (err) {
        if (attempt === 2) throw err;
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  },
]);
```

---

## `pipeTools` — chain two tools

Output of the first tool becomes input to the second:

```ts
import { pipeTools } from 'personaforge';
import { fetchUrlTool, myHtmlParserTool } from './tools.js';

const fetchAndParse = pipeTools(fetchUrlTool, myHtmlParserTool, {
  name: 'fetch_and_parse',
  description: 'Fetch a URL then parse the HTML content.',
  // Map the first tool's output to the second tool's input schema
  adapter: (fetchResult, originalParams) => ({
    html: fetchResult.body,
    url: originalParams.url,
  }),
});

// Use like any other tool
const result = await fetchAndParse.execute({ url: 'https://example.com' }, ctx);
```

---

## `versionTool` — versioned wrappers

Tag a tool with a version for deprecation management:

```ts
import { versionTool, extendTool } from 'personaforge';

// Tag as version 2.0 with a changelog
const searchV2 = versionTool(searchTool, '2.0', {
  changelog: 'Returns structured results with source URLs and snippets.',
});

// Mark old version as deprecated
const searchV1 = versionTool(oldSearchTool, '1.0', {
  deprecated: true,
  replacedBy: 'search_v2_0',
});
```

---

## Compose with `toolMiddleware` on the agent

Apply middleware to every tool in an agent at once:

```ts
import { createAgent } from 'personaforge';

const starts = new Map<string, number>();

const agent = createAgent({
  name: 'monitored-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [searchTool, emailTool, dbTool],
  toolMiddleware: [
    {
      beforeExecute: (tool) => {
        starts.set(tool.name, Date.now());
      },
      afterExecute: (tool, result) => {
        const start = starts.get(tool.name) ?? Date.now();
        metrics.histogram('tool.duration_ms', Date.now() - start, {
          tool: tool.name,
          status: result.success ? 'ok' : 'error',
        });
      },
      onError: (tool) => {
        const start = starts.get(tool.name) ?? Date.now();
        metrics.histogram('tool.duration_ms', Date.now() - start, { tool: tool.name, status: 'error' });
      },
    },
  ],
});
```

---

## Where to go next

- [Custom tools](./custom-tools) — author tools from scratch with `tool()`.
- [Tools](./tools) — built-in tools and the `ToolRegistry`.
- [HITL](./hitl) — approval stores for `needsApproval` in production.
