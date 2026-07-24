---
title: "Runbook: Tools: Productivity"
description: "Operational runbook for personaforge/tools/productivity — import, run, verify, recover. 90 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Productivity

> Auto-generated from `./dist/tools/productivity.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/productivity`  ·  **Public symbols:** 90  ·  **Guide:** [/guide/tools](../guide/tools.md)

## What it is
`personaforge/tools/productivity` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { NotionCreatePageTool, NotionSearchTool, NotionUpdatePageTool } from 'personaforge/tools/productivity';
```

## Public API surface
- **Classes** — `NotionCreatePageTool`, `NotionSearchTool`, `NotionUpdatePageTool`, `JiraGetIssueTool`, `JiraCreateIssueTool`, `JiraSearchIssuesTool`, `JiraAddCommentTool`, `LinearCreateIssueTool`, `LinearGetIssueTool`, `LinearSearchIssuesTool`, `LinearUpdateIssueTool`, `LinearAddCommentTool`, …(+50)
- **Constants** — `NotionToolkit`, `JiraToolkit`
- **Interfaces** — `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `Tool`, `LogContext`, `Logger`, `DebugLoggerConfig`, `BaseToolConfig`, `NotionResult`, `JiraResult`, …(+12)
- **Types** — `EntityId`, `ToolParameters`

## Minimal use
Real example from the tools guide:

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

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/productivity` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/productivity').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/tools](../guide/tools.md).

## Common failures
- `Cannot find module 'personaforge/tools/productivity'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/tools](../guide/tools.md)
