---
title: "Runbook: Tools: Data"
description: "Operational runbook for personaforge/tools/data — import, run, verify, recover. 47 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Data

> Auto-generated from `./dist/tools/data.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/data`  ·  **Public symbols:** 47  ·  **Guide:** [/guide/tools](../guide/tools.md)

## What it is
`personaforge/tools/data` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { PostgreSQLQueryTool, PostgreSQLInsertTool, MySQLQueryTool } from 'personaforge/tools/data';
```

## Public API surface
- **Classes** — `PostgreSQLQueryTool`, `PostgreSQLInsertTool`, `MySQLQueryTool`, `SQLiteQueryTool`, `DatabaseToolkit`, `RedisGetTool`, `RedisSetTool`, `RedisDeleteTool`, `RedisKeysTool`, `RedisHashGetTool`, `RedisIncrTool`, `RedisToolkit`, …(+19)
- **Interfaces** — `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `Tool`, `LogContext`, `Logger`, `DebugLoggerConfig`, `BaseToolConfig`, `DatabaseToolConfig`, `RedisToolConfig`, …(+2)
- **Types** — `EntityId`, `ToolParameters`

## Minimal use
Real example from the tools guide:

```ts
import {
  BigQueryToolkit,
  CsvToolkit,
  DatabaseToolkit,
  Neo4jToolkit,
  RedisToolkit,
} from 'personaforge/tools/data';
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/data` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/data').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/tools](../guide/tools.md).

## Common failures
- `Cannot find module 'personaforge/tools/data'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/tools](../guide/tools.md)
