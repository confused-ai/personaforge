---
title: "Runbook: Tools: Core"
description: "Operational runbook for personaforge/tools/core — import, run, verify, recover. 55 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Core

> Auto-generated from `./dist/tools/core.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/core`  ·  **Public symbols:** 55

## What it is
`personaforge/tools/core` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createTools, toToolRegistry, tool } from 'personaforge/tools/core';
```

## Public API surface
- **Factories / functions** — `toToolRegistry`, `tool`, `createTools`, `isLightweightTool`, `defineTool`, `extendTool`, `wrapTool`, `pipeTools`, `versionTool`, `handleToolGatewayRequest`, `withCache`, `withCompression`
- **Classes** — `ToolRegistryImpl`, `BaseTool`, `ToolBuilder`, `ToolCache`, `ToolCompressor`
- **Constants** — `createTool`
- **Enums** — `ToolCategory`
- **Interfaces** — `Tool`, `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `ToolRegistry`, `ToolSandboxConfig`, `ToolMiddleware`, `ToolFactory`, `ToolSchema`, `ParameterSchema`, …(+17)
- **Types** — `EntityId`, `ToolParameters`, `ToolProvider`, `SafeParseResult`, `InferToolSchema`, `ToolWrapMiddleware`, `CompressionStrategy`

## Minimal use
```ts
import { createTools, toToolRegistry, tool } from 'personaforge/tools/core';

// `createTools` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createTools(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/core` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/core').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/tools/core'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
