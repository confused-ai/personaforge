---
title: 14 · MCP Tools
description: Load tools from a remote MCP server into any agent, or expose your own tool registry as an MCP server using personaforge/tool.
outline: [2, 3]
---

# 14 · MCP Tools

The Model Context Protocol (MCP) lets you share tools across processes and languages. `personaforge` supports both sides: loading remote MCP tools into an agent, and serving a tool registry as an MCP server others can connect to.

```ts
import { loadMcpToolsFromUrl, HttpMcpClient, createMcpServer, runMcpStdioToolServer } from 'personaforge/tool';
```

---

## What you'll learn

- How to load tools from a remote MCP server into an agent
- How to use `HttpMcpClient` directly for fine-grained control
- How to expose your own tools as an MCP HTTP server
- How to serve tools over stdio for CLI-based clients

---

## Load remote MCP tools into an agent

The fastest path — `loadMcpToolsFromUrl()` fetches the tool schema from a remote server and returns typed tool objects ready to attach to any agent.

```ts
import { createAgent } from 'personaforge';
import { loadMcpToolsFromUrl } from 'personaforge/tool';

// Fetch all tools from a running MCP server
const remoteTools = await loadMcpToolsFromUrl('http://127.0.0.1:3100/mcp', {
  authorization: 'Bearer dev-token',
});

const mcpAgent = createAgent({
  name: 'mcp-assistant',
  instructions: 'Use the available tools to answer user requests accurately.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: remoteTools,
});

const result = await mcpAgent.run('What tools are available on the remote server?');
console.log(result.text);
```

---

## `HttpMcpClient` — manual control

Use `HttpMcpClient` when you want to list tools, call them directly, or selectively expose a subset to your agent.

```ts
import { createAgent } from 'personaforge';
import { HttpMcpClient } from 'personaforge/tool';

const client = new HttpMcpClient({
  url: 'http://127.0.0.1:3100/mcp',
  headers: { Authorization: 'Bearer dev-token' },
});

// Inspect what the server exposes
const allTools = await client.listTools();
console.log(allTools.map((t) => t.name));
// → ['search_docs', 'get_schema', 'run_query', ...]

// Only expose the tools you want
const selectedTools = allTools.filter((t) =>
  ['search_docs', 'get_schema'].includes(t.name),
);

const agent = createAgent({
  name: 'scoped-mcp-agent',
  instructions: 'Answer questions using the documentation search tool.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: selectedTools,
});

const result = await agent.run('Find docs about rate limiting.');
console.log(result.text);
```

---

## Expose your tools as an MCP HTTP server

Use `createMcpServer()` and `McpHttpServer` to publish your own tool registry so other agents — in any language — can connect to it.

```ts
import { z } from 'zod/v3';
import { tool } from 'personaforge';
import { createMcpServer, McpHttpServer } from 'personaforge/tool';

// Define the tools you want to expose
const searchDocs = tool({
  name: 'search_docs',
  description: 'Search the internal documentation index.',
  parameters: z.object({
    query: z.string().describe('Search terms'),
    limit: z.number().optional().default(5),
  }),
  execute: async ({ query, limit }) => {
    // Replace with your real search implementation
    return { results: [`Result for "${query}" (limit=${limit})`] };
  },
});

const getStatus = tool({
  name: 'get_status',
  description: 'Return the current system status.',
  parameters: z.object({}),
  execute: async () => ({ status: 'healthy', uptime: process.uptime() }),
});

// Create the MCP server
const mcpServer = createMcpServer({
  name: 'internal-tools',
  version: '1.0.0',
  tools: [searchDocs, getStatus],
});

// Serve it over HTTP on port 3100
const httpServer = new McpHttpServer(mcpServer, { port: 3100 });
await httpServer.start();

console.log('MCP server running on http://127.0.0.1:3100/mcp');
// Any MCP-compatible client can now call these tools
```

---

## Stdio server for CLI clients

The stdio transport is the standard for desktop MCP clients such as Claude Desktop and Cursor. It communicates over stdin/stdout rather than HTTP.

```ts
import { z } from 'zod/v3';
import { tool } from 'personaforge';
import { runMcpStdioToolServer } from 'personaforge/tool';

const readFile = tool({
  name: 'read_file',
  description: 'Read the contents of a local file.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative file path'),
  }),
  execute: async ({ path }) => {
    const { readFile } = await import('node:fs/promises');
    return { content: await readFile(path, 'utf-8') };
  },
});

// This blocks and communicates over stdio
await runMcpStdioToolServer({
  name: 'file-tools',
  version: '1.0.0',
  tools: [readFile],
});
```

Add this to `claude_desktop_config.json` to use it in Claude Desktop:

```json
{
  "mcpServers": {
    "file-tools": {
      "command": "npx",
      "args": ["tsx", "mcp-file-server.ts"]
    }
  }
}
```

---

## Summary of the MCP surface

| Export | Use for |
|---|---|
| `loadMcpToolsFromUrl(url, opts)` | Quickly load all remote tools into an agent |
| `HttpMcpClient` | Fine-grained tool listing and selective loading |
| `createMcpServer(config)` | Define an MCP server from your tool registry |
| `McpHttpServer` | Serve an MCP server over HTTP |
| `runMcpStdioToolServer(config)` | Serve an MCP server over stdio (CLI clients) |

All MCP imports come from `personaforge/tool`.

---

## What's next?

- [15 · Full-Stack App](./15-full-stack) — wire an agent behind an HTTP service
- [04 · Extend & Wrap Tools](./04-extend-tools) — add middleware to any tool before exposing it via MCP
- [Tools guide](../guide/mcp) — full MCP API reference
