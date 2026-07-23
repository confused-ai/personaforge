---
title: Tools
description: Define tools with tool() or defineTool(), compose them, and use 100+ built-in tools from search, communication, devtools, finance, and more.
outline: [2, 3]
---

# Tools

Tools are functions the agent can call during a run. They are defined with `tool()` or `defineTool()`, validated with Zod, and passed directly to `createAgent()`.

## Define a tool

```ts
import { tool } from 'personaforge/tool';
import { z } from 'zod';

const getWeather = tool({
  name: 'get_weather',
  description: 'Get the current weather for a city. Use this when the user asks about weather.',
  parameters: z.object({
    city: z.string().describe('City name, e.g. "Tokyo"'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  execute: async ({ city, unit }) => {
    // real implementation calls your weather API
    return { city, temperature: 22, unit, condition: 'sunny' };
  },
});
```

Pass the tool to `createAgent`:

```ts
import { createAgent } from 'personaforge';

const agent = createAgent({
  name: 'weather-agent',
  instructions: 'Help with weather queries. Always call get_weather before answering.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [getWeather],
});
```

---

## `tool()` vs `defineTool()`

Both produce the same result. `defineTool` is the older API; `tool` is the preferred shorthand.

```ts
import { tool, defineTool, createTool } from 'personaforge/tool';

// All three are equivalent:
const t1 = tool({ name: 'add', description: '...', parameters: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => a + b });
const t2 = defineTool({ name: 'add', description: '...', parameters: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => a + b });
const t3 = createTool({ name: 'add', description: '...', parameters: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => a + b });
```

---

## Multiple tools: `createTools`

```ts
import { createTools } from 'personaforge/tool';
import { z } from 'zod';

const tools = createTools({
  search_orders: {
    description: 'Find a customer order by id.',
    parameters: z.object({ orderId: z.string() }),
    execute: async ({ orderId }) => ({ orderId, status: 'shipped', eta: '2026-05-14' }),
  },
  cancel_order: {
    description: 'Cancel an order. Only use if the customer explicitly requests cancellation.',
    parameters: z.object({ orderId: z.string(), reason: z.string() }),
    execute: async ({ orderId, reason }) => ({ cancelled: true, orderId, reason }),
  },
});

const agent = createAgent({ name: 'support', instructions: '...', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY!, tools: Object.values(tools) });
```

---

## Tool context

Every tool receives a context object as the second argument:

```ts
const auditTool = tool({
  name: 'update_record',
  description: 'Update a database record.',
  parameters: z.object({ id: z.string(), data: z.record(z.string()) }),
  execute: async ({ id, data }, ctx) => {
    console.log('agent:', ctx.agentId);
    console.log('session:', ctx.sessionId);
    // ctx.abortSignal — AbortSignal for cancellation
    return { updated: true };
  },
});
```

---

## Tool middleware

Apply cross-cutting behaviour (logging, caching, auth) across all tools:

```ts
import { createAgent } from 'personaforge';

const agent = createAgent({
  name: 'agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [searchTool, dbTool],
  toolMiddleware: [
    // Logging middleware
    {
      beforeExecute: (tool, params) => {
        console.log(`[tool] ${tool.name} called`, params);
      },
      afterExecute: (tool, result) => {
        console.log(`[tool] ${tool.name} returned`, result);
      },
    },
  ],
});
```

---

## Extend and wrap tools

```ts
import { extendTool, wrapTool, pipeTools } from 'personaforge/tool';

// Normalise inputs and trim results around an existing tool
const reliableSearch = extendTool(searchTool, {
  name: 'reliable_search',
  transformInput: (params) => ({ ...params, query: params.query.trim() }),
  transformOutput: (results) => (Array.isArray(results) ? results.slice(0, 3) : results),
  timeoutMs: 10_000,
});

// Wrap with a middleware pipeline: (params, ctx, next)
const wrappedSearch = wrapTool(searchTool, [
  async (params, ctx, next) => {
    const sanitised = { ...params, query: params.query.trim() };
    const result = await next(sanitised, ctx);
    return { ...result, source: 'search' };
  },
]);

// Chain tools: output of tool1 becomes input of tool2
const pipeline = pipeTools(fetchPageTool, summariseTool, {
  name: 'fetch_and_summarise',
  description: 'Fetch a page then summarise it.',
  adapter: (page) => ({ text: page.body }),
});
```

---

## Built-in tools (100+)

Each provider-backed tool is imported from its category subpath (e.g. `personaforge/tools/search`).

### Search

```ts
import {
  TavilySearchTool,       // AI-optimised web search
  BraveSearchTool,        // privacy-first web search
  ExaSearchTool,          // neural search
  PerplexitySearchTool,   // web-grounded LLM search
  ArxivSearchTool,        // academic papers
  PubMedSearchTool,       // biomedical papers
  YouTubeSearchTool,
  RedditSearchTool,
  OpenWeatherToolkit,
  GoogleMapsToolkit,
} from 'personaforge/tools/search';

const agent = createAgent({
  name: 'researcher',
  instructions: 'Research the topic thoroughly.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [new TavilySearchTool({ apiKey: process.env.TAVILY_API_KEY! })],
});
```

### Communication

```ts
import {
  SlackToolkit,
  GmailToolkit,
  EmailToolkit,
  DiscordToolkit,
  TelegramTool,
  TwilioToolkit,
  ZoomToolkit,
  ResendToolkit,
} from 'personaforge/tools/communication';
```

### Productivity

```ts
import {
  JiraToolkit,
  NotionToolkit,
  ConfluenceToolkit,
  LinearToolkit,
  ClickUpToolkit,
  GoogleDriveToolkit,
  GoogleSheetsToolkit,
  GoogleCalendarToolkit,
} from 'personaforge/tools/productivity';
```

### Developer tools

```ts
import {
  GitHubToolkit,
  GitLabToolkit,
  DockerToolkit,
  E2BToolkit,        // sandboxed code execution
  CodeExecToolkit,   // local code execution
} from 'personaforge/tools/devtools';
```

### Data

```ts
import {
  BigQueryToolkit,
  CsvToolkit,
  DatabaseToolkit,
  Neo4jToolkit,
  RedisToolkit,
} from 'personaforge/tools/data';
```

### Finance

```ts
import {
  StripeToolkit,
  YFinanceTool,      // Yahoo Finance market data
} from 'personaforge/tools/finance';
```

### Utilities

```ts
import {
  httpClient,        // HTTP requests
  fileSystem,        // read/write local files
  browserTool,       // headless browser
  createShellTool,   // run shell commands
} from 'personaforge/tool';
```

### Web preset

Pass `tools: 'web'` to give the agent HTTP + browser tools with no imports:

```ts
const agent = createAgent({
  name: 'web-agent',
  instructions: 'Browse the web and answer questions.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: 'web',
});
```

---

## Tool registry

Group tools into a typed registry for advanced use:

```ts
import { ToolRegistryImpl } from 'personaforge/tool';

const registry = new ToolRegistryImpl();
registry.register(searchTool);
registry.register(emailTool);
registry.register(dbTool);

const agent = createAgent({ name: 'agent', instructions: '...', model: 'gpt-4o-mini', apiKey: '...', tools: registry });
```

---

## Where to go next

- [Custom tools](./custom-tools) — advanced tool authoring patterns.
- [Tool composition](./tool-composition) — wrapping, caching, and pipelining tools.
- [MCP](./mcp) — expose or consume tools via the Model Context Protocol.
- [HITL](./hitl) — require human approval before a tool executes.
