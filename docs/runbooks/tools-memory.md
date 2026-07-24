---
title: "Runbook: Tools: Memory"
description: "Operational runbook for personaforge/tools/memory — import, run, verify, recover. 45 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Memory

> Auto-generated from `./dist/tools/memory.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/memory`  ·  **Public symbols:** 45  ·  **Guide:** [/guide/memory](../guide/memory.md)

## What it is
`personaforge/tools/memory` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { Mem0AddMemoryTool, Mem0SearchMemoryTool, Mem0GetMemoriesTool } from 'personaforge/tools/memory';
```

## Public API surface
- **Classes** — `Mem0AddMemoryTool`, `Mem0SearchMemoryTool`, `Mem0GetMemoriesTool`, `Mem0GetMemoryTool`, `Mem0UpdateMemoryTool`, `Mem0DeleteMemoryTool`, `Mem0DeleteAllMemoriesTool`, `Mem0GetMemoryHistoryTool`, `Mem0Toolkit`, `ZepAddMemoryTool`, `ZepGetMemoryTool`, `ZepSearchMemoryTool`, …(+6)
- **Interfaces** — `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `Tool`, `LogContext`, `Logger`, `DebugLoggerConfig`, `BaseToolConfig`, `Mem0Config`, `ZepConfig`
- **Types** — `EntityId`, `ToolParameters`, `AddMemoryInput`, `SearchMemoryInput`, `GetMemoriesInput`, `GetSingleMemoryInput`, `UpdateMemoryInput`, `DeleteMemoryInput`, `DeleteAllMemoriesInput`, `GetMemoryHistoryInput`, `GetMemoryInput`, `CreateSessionInput`, …(+3)

## Minimal use
```ts
import { Mem0AddMemoryTool, Mem0SearchMemoryTool, Mem0GetMemoriesTool } from 'personaforge/tools/memory';

// `Mem0AddMemoryTool` is the primary entry for this feature.
// See the guide/type signature for full options.
const instance = new Mem0AddMemoryTool(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/memory` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/memory').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/memory](../guide/memory.md).

## Common failures
- `Cannot find module 'personaforge/tools/memory'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/memory](../guide/memory.md)
