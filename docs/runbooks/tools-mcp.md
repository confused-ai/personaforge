---
title: "Runbook: Tools: Mcp"
description: "Operational runbook for personaforge/tools/mcp — import, run, verify, recover. 44 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Mcp

> Auto-generated from `./dist/tools/mcp.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/mcp`  ·  **Public symbols:** 44  ·  **Guide:** [/guide/mcp](../guide/mcp.md)

## What it is
`personaforge/tools/mcp` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createMcpServer, loadMcpToolsFromUrl, handleMcpStdioLine } from 'personaforge/tools/mcp';
```

## Public API surface
- **Factories / functions** — `loadMcpToolsFromUrl`, `createMcpServer`, `handleMcpStdioLine`, `runMcpStdioToolServer`, `connectMcpServer`, `buildServerCapabilities`
- **Classes** — `HttpMcpClient`, `McpHttpServer`, `StreamableMcpClient`, `McpResourceRegistry`, `McpPromptRegistry`, `McpSamplingClient`, `McpCapabilityHandler`, `McpSseEmitter`
- **Interfaces** — `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `Tool`, `ToolRegistry`, `MCPToolDescriptor`, `MCPClient`, `MCPServerAdapter`, `HttpMcpClientOptions`, `McpServerOptions`, …(+11)
- **Types** — `EntityId`, `ToolParameters`, `McpAuthConfig`, `NotificationHandler`, `McpResourceContent`, `McpMessageRole`, `McpPromptContent`

## Minimal use
Real example from the mcp guide:

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

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/mcp` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/mcp').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/mcp](../guide/mcp.md).

## Common failures
- `Cannot find module 'personaforge/tools/mcp'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/mcp](../guide/mcp.md)
