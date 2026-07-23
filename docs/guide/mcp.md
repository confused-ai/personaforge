---
title: MCP
description: Connect to Model Context Protocol servers as a client, expose your agent tools as an MCP server, and use Streamable HTTP transport with SSE notifications.
outline: [2, 3]
---

# MCP (Model Context Protocol)

The framework ships a full MCP implementation: an HTTP client to consume remote tools, an HTTP server to expose your tools to other agents and clients, and a streamable SSE transport.

```ts
import {
  loadMcpToolsFromUrl,         // simplest: load tools from any MCP URL
  HttpMcpClient,               // full HTTP JSON-RPC 2.0 client
  connectMcpServer,            // SSE streamable transport client
  StreamableMcpClient,         // lower-level SSE client
  createMcpServer,             // expose your tools as an MCP server
  McpHttpServer,
  runMcpStdioToolServer,       // stdio transport (for Claude Desktop, etc.)
} from 'personaforge';
```

---

## Load tools from an MCP server (client)

The easiest way to use a remote MCP server — load its tools and hand them straight to `createAgent()`:

```ts
import { createAgent, loadMcpToolsFromUrl } from 'personaforge';

// Load all tools exposed by a remote MCP HTTP server
const mcpTools = await loadMcpToolsFromUrl(
  'https://mcp.example.com/tools',
  { 'Authorization': `Bearer ${process.env.MCP_TOKEN}` },  // optional headers
);

const agent = createAgent({
  name: 'mcp-agent',
  instructions: 'Use the available tools to complete tasks.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: mcpTools,             // drop-in: MCP tools work exactly like local tools
});

const result = await agent.run('Run the analysis job for project #42.');
```

---

## Full HTTP client (`HttpMcpClient`)

```ts
import { HttpMcpClient } from 'personaforge';

const client = new HttpMcpClient({
  url: 'https://mcp.example.com',
  headers: { 'Authorization': `Bearer ${process.env.MCP_TOKEN}` },
  timeoutMs: 30_000,
});

// List available tools
const tools = await client.getTools();

// Call a tool directly
const result = await client.callTool('run_analysis', { projectId: '42', format: 'json' });
```

---

## SSE streamable transport (`connectMcpServer`)

Use the [MCP Streamable HTTP 2024-11-05](https://modelcontextprotocol.io/) transport for servers that push real-time notifications:

```ts
import { connectMcpServer } from 'personaforge';

const { client, tools } = await connectMcpServer('https://mcp.example.com/mcp', {
  headers: { 'Authorization': `Bearer ${process.env.MCP_TOKEN}` },
  preferStreaming: true,   // use SSE for streamed responses (default: true)
});

// Subscribe to server notifications (e.g. progress events)
client.onNotification('progress', (notification) => {
  console.log('Progress:', notification.params);
});

// Use tools with the agent
const agent = createAgent({
  name: 'streaming-mcp-agent',
  instructions: '...',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools,
});
```

---

## Expose your tools as an MCP server

Turn any local tools into an MCP server that Claude Desktop, other agents, or any MCP client can connect to:

```ts
import { createMcpServer } from 'personaforge';
import { searchTool, analysisTool, calculatorTool } from './tools.js';

const server = createMcpServer(
  [searchTool, analysisTool, calculatorTool],
  {
    name: 'my-agent-tools',
    version: '1.0.0',
    port: 3100,
    auth: {
      type: 'bearer',
      token: process.env.MCP_SERVER_TOKEN!,
    },
    cors: { allowedOrigins: ['https://claude.ai', 'https://my-app.example.com'] },
    toolTimeoutMs: 60_000,
  },
);

await server.start();
console.log('MCP server running on http://localhost:3100/mcp');

// Graceful stop
process.on('SIGTERM', () => server.stop());
```

The server exposes these JSON-RPC 2.0 methods:
- `initialize` — handshake and capabilities
- `tools/list` — list all registered tools
- `tools/call` — execute a tool by name

---

## Stdio server (Claude Desktop)

For Claude Desktop and other stdio-based MCP clients:

```ts
import { runMcpStdioToolServer } from 'personaforge';
import { searchTool, calculatorTool } from './tools.js';

// Reads from stdin, writes to stdout — launch from claude_desktop_config.json
await runMcpStdioToolServer({
  tools: [searchTool, calculatorTool],
  name: 'my-tools-server',
  version: '1.0.0',
});
```

`claude_desktop_config.json` entry:
```json
{
  "mcpServers": {
    "my-tools": {
      "command": "node",
      "args": ["/path/to/my-mcp-server.js"]
    }
  }
}
```

---

## MCP resources and prompts

```ts
import { McpResourceRegistry, McpPromptRegistry } from 'personaforge';

const resources = new McpResourceRegistry();
resources.define({
  uri: 'file://config.json',
  name: 'App Config',
  description: 'Current application configuration',
  mimeType: 'application/json',
  fetch: async () => JSON.stringify(await loadConfig()),
});

const prompts = new McpPromptRegistry();
prompts.define({
  name: 'summarise',
  description: 'Summarise a document',
  arguments: [{ name: 'document', description: 'The document to summarise', required: true }],
  render: async ({ document }) => [
    { role: 'user', content: `Summarise this document:\n\n${document}` },
  ],
});
```

---

## Where to go next

- [Tools](./tools) — local tool authoring with `tool()`.
- [Custom tools](./custom-tools) — extend or wrap existing tools.
- [Example 14: MCP](../examples/14-mcp) — full client + server example.
