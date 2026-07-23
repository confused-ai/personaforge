---
title: Tools API
description: Complete reference for tool(), defineTool(), extendTool(), wrapTool(), pipeTools(), versionTool(), createTools(), and MCP tool loading.
outline: [2, 3]
---

# Tools API

Tools are how agents interact with real systems. A tool gives the model a named, schema-validated function it can call when it needs live data, wants to trigger a side effect, or must perform a calculation that goes beyond its training knowledge.

```ts
import { tool, extendTool, wrapTool, pipeTools, versionTool, createTools } from 'personaforge';
import { loadMcpToolsFromUrl, HttpMcpClient, createMcpServer } from 'personaforge/tool';
```

---

## `tool()` — define a tool

The primary tool authoring function. All tool inputs are validated with a Zod schema before `execute` is called.

```ts
import { z } from 'zod/v3';
import { tool } from 'personaforge';

const getWeather = tool({
  name: 'get_weather',
  description: 'Return current weather conditions for a city.',
  parameters: z.object({
    city: z.string().describe('City name, e.g. "Tokyo"'),
    units: z.enum(['metric', 'imperial']).default('metric'),
  }),
  execute: async ({ city, units }) => {
    const data = await fetchWeatherApi(city, units);
    return { city, temp: data.temp, condition: data.condition };
  },
});
```

**Options:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✓ | Unique tool identifier shown to the model |
| `description` | `string` | ✓ | What the tool does — the model uses this to decide when to call it |
| `parameters` | `ZodObject` | ✓ | Input schema — validated before `execute` |
| `execute` | `async (params, ctx) => any` | ✓ | Implementation — receives validated params and run context |
| `needsApproval` | `boolean \| (params) => boolean` | — | Gate this tool behind human review |

---

## `needsApproval` — require human review

Set `needsApproval: true` to hold execution until a human approves the call. Use a function to gate selectively.

```ts
const sendEmail = tool({
  name: 'send_email',
  description: 'Send an email to a recipient.',
  parameters: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  // Gate only external addresses — internal ones flow through immediately
  needsApproval: ({ to }) => !to.endsWith('@mycompany.com'),
  execute: async ({ to, subject, body }) => {
    await emailClient.send({ to, subject, body });
    return { sent: true };
  },
});
```

Attach an `approvalStore` to the HTTP service to expose the pending approval queue:

```ts
import { createHttpService } from 'personaforge/serve';
import { createSqliteApprovalStore } from 'personaforge/production';

const service = createHttpService({
  agents: { myAgent },
  approvalStore: createSqliteApprovalStore('./agent.db'),
});
```

---

## `extendTool()` — add pre/post processing

Extend an existing tool without modifying its source. Add input normalisation, output transformation, logging, and error fallbacks.

```ts
import { extendTool } from 'personaforge';

const smartWeather = extendTool(getWeather, {
  name: 'smart_weather',
  // Normalize input before execution
  transformInput: async (params) => ({
    ...params,
    city: params.city.trim(),
  }),
  // Transform output after execution
  transformOutput: async (result) => ({
    ...result,
    condition: result.condition.toUpperCase(),
  }),
  // Log before calling the underlying tool
  beforeExecute: async (params) => {
    console.log(`Fetching weather for ${params.city}`);
    return undefined;  // return a value to short-circuit execution
  },
  // Return a fallback value if execution throws
  onError: async (_error, params) => ({
    city: params.city,
    temp: null,
    condition: 'UNAVAILABLE',
  }),
});
```

---

## `wrapTool()` — middleware chain

Wrap a tool with a stack of middleware functions. Each middleware receives `params`, `ctx`, and `next` — similar to Express-style middleware.

```ts
import { wrapTool } from 'personaforge';

const cache = new Map<string, unknown>();

const cachedWeather = wrapTool(
  getWeather,
  [
    // Middleware 1: logging
    async (params, ctx, next) => {
      const start = Date.now();
      const result = await next(params, ctx);
      console.log(`tool:get_weather ${Date.now() - start}ms`);
      return result;
    },
    // Middleware 2: caching
    async (params, ctx, next) => {
      const key = params.city.toLowerCase();
      if (cache.has(key)) return cache.get(key);
      const result = await next(params, ctx);
      cache.set(key, result);
      return result;
    },
  ],
  { name: 'cached_weather' },
);
```

---

## `pipeTools()` — chain two tools

Compose two tools into one. The output of the first tool is adapted into the input of the second.

```ts
import { pipeTools } from 'personaforge';

const fetchUrl = tool({
  name: 'fetch_url',
  description: 'Fetch the HTML of a URL.',
  parameters: z.object({ url: z.string().url() }),
  execute: async ({ url }) => ({ html: await fetch(url).then((r) => r.text()) }),
});

const extractText = tool({
  name: 'extract_text',
  description: 'Strip HTML tags and return readable text.',
  parameters: z.object({ html: z.string() }),
  execute: async ({ html }) => ({ text: html.replace(/<[^>]+>/g, ' ').trim() }),
});

const fetchAndRead = pipeTools(fetchUrl, extractText, {
  name: 'fetch_and_read',
  description: 'Fetch a URL and return its readable text content.',
  adapter: (result) => ({ html: result.html }),   // map fetchUrl output → extractText input
});
```

---

## `versionTool()` — add version metadata

Tag a tool with a semantic version and optional changelog. Useful for tracking which tool version is in production.

```ts
import { versionTool } from 'personaforge';

const fetchAndReadV2 = versionTool(fetchAndRead, '2.0', {
  changelog: 'Combines URL fetch and HTML extraction into a single tool call.',
});

console.log(fetchAndReadV2.version);    // → '2.0'
console.log(fetchAndReadV2.changelog);  // → 'Combines URL ...'
```

---

## `createTools()` — build a registry

Group related tools into a named registry for organised sharing.

```ts
import { createTools } from 'personaforge';

const weatherTools = createTools('weather', [getWeather, cachedWeather, smartWeather]);

// Attach all tools from the registry to an agent
const agent = createAgent({
  name: 'weather-agent',
  instructions: 'Answer weather questions.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: weatherTools.all(),
});

// Or select specific tools
const agent2 = createAgent({
  name: 'weather-agent-v2',
  instructions: 'Answer weather questions.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: weatherTools.pick(['get_weather', 'cached_weather']),
});
```

---

## MCP tools — `personaforge/tool`

Load tools from a remote MCP server or expose your own:

```ts
import { loadMcpToolsFromUrl, HttpMcpClient, createMcpServer, McpHttpServer, runMcpStdioToolServer } from 'personaforge/tool';

// Load all tools from a remote server
const remoteTools = await loadMcpToolsFromUrl('http://localhost:3100/mcp', {
  authorization: 'Bearer token',
});

// Fine-grained client for listing and selecting
const client = new HttpMcpClient({ url: 'http://localhost:3100/mcp' });
const tools = await client.listTools();

// Serve your tools as an MCP HTTP server
const server = createMcpServer({ name: 'my-tools', version: '1.0', tools: [getWeather] });
const httpServer = new McpHttpServer(server, { port: 3100 });
await httpServer.start();

// Serve over stdio (for Claude Desktop, Cursor, etc.)
await runMcpStdioToolServer({ name: 'my-tools', version: '1.0', tools: [getWeather] });
```

---

## Tool execution context

The second argument to `execute` is the run context:

```ts
const myTool = tool({
  name: 'my_tool',
  description: '...',
  parameters: z.object({ input: z.string() }),
  execute: async (params, ctx) => {
    console.log(ctx.agentId);    // the agent running this tool
    console.log(ctx.sessionId);  // current session
    console.log(ctx.runId);      // current run
    return { result: params.input };
  },
});
```

---

## Where to go next

- [Custom tools guide](../guide/custom-tools) — authoring patterns and best practices
- [Tool composition guide](../guide/tool-composition) — `extendTool`, `wrapTool`, `pipeTools` in depth
- [MCP guide](../guide/mcp) — full MCP client and server reference
- [02 · First Custom Tool](../examples/02-custom-tool) — runnable custom tool example
- [04 · Extend & Wrap Tools](../examples/04-extend-tools) — runnable composition example
