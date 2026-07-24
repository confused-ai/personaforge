---
title: "Runbook: Tools"
description: "Operational runbook for personaforge/tools — import, run, verify, recover. 139 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools

> Auto-generated from `./dist/tools.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools`  ·  **Public symbols:** 139  ·  **Guide:** [/guide/tools](../guide/tools.md)

## What it is
`personaforge/tools` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createTools, toToolRegistry, tool } from 'personaforge/tools';
```

## Public API surface
- **Factories / functions** — `toToolRegistry`, `tool`, `createTools`, `isLightweightTool`, `extendTool`, `wrapTool`, `pipeTools`, `versionTool`, `withCache`, `withCompression`, `handleToolGatewayRequest`, `zodToJsonSchema`, …(+15)
- **Classes** — `BaseTool`, `ToolRegistryImpl`, `ToolNameTrie`, `NGramIndex`, `ToolBuilder`, `ToolCache`, `ToolCompressor`, `HttpMcpClient`, `McpHttpServer`, `StreamableMcpClient`, `McpResourceRegistry`, `McpPromptRegistry`, …(+21)
- **Constants** — `createTool`, `httpClient`, `fileSystem`, `browserTool`, `ShellToolkit`, `CalculatorToolkit`
- **Enums** — `ToolCategory`
- **Interfaces** — `Tool`, `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `ToolRegistry`, `ToolSandboxConfig`, `ToolMiddleware`, `ToolFactory`, `ToolSchema`, `ParameterSchema`, …(+47)
- **Types** — `EntityId`, `ToolParameters`, `ToolProvider`, `SafeParseResult`, `InferToolSchema`, `ToolWrapMiddleware`, `CompressionStrategy`, `ToolInput`, `McpAuthConfig`, `NotificationHandler`, `McpResourceContent`, `McpMessageRole`, …(+1)

## Minimal use
```ts
import { createTools, toToolRegistry, tool } from 'personaforge/tools';

// `createTools` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createTools(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/tools](../guide/tools.md).

## Common failures
- `Cannot find module 'personaforge/tools'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/tools](../guide/tools.md)
