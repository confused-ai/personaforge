---
title: "Runbook: Tools: Scraping"
description: "Operational runbook for personaforge/tools/scraping — import, run, verify, recover. 62 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Scraping

> Auto-generated from `./dist/tools/scraping.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/scraping`  ·  **Public symbols:** 62

## What it is
`personaforge/tools/scraping` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { ApifyRunActorTool, ApifyGetRunTool, ApifyGetDatasetItemsTool } from 'personaforge/tools/scraping';
```

## Public API surface
- **Classes** — `ApifyRunActorTool`, `ApifyGetRunTool`, `ApifyGetDatasetItemsTool`, `ApifyRunActorGetDataTool`, `ApifyToolkit`, `BrightDataScrapeTool`, `BrightDataSERPSTool`, `BrightDataDatasetCollectTool`, `BrightDataToolkit`, `BrowserbaseCreateSessionTool`, `BrowserbaseGetSessionTool`, `BrowserbaseScreenshotTool`, …(+21)
- **Constants** — `HackerNewsToolkit`, `WebSearchToolkit`, `WikipediaToolkit`
- **Interfaces** — `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `Tool`, `LogContext`, `Logger`, `DebugLoggerConfig`, `BaseToolConfig`, `ApifyToolConfig`, `BrightDataToolConfig`, …(+12)
- **Types** — `EntityId`, `ToolParameters`

## Minimal use
```ts
import { ApifyRunActorTool, ApifyGetRunTool, ApifyGetDatasetItemsTool } from 'personaforge/tools/scraping';

// `ApifyRunActorTool` is the primary entry for this feature.
// See the guide/type signature for full options.
const instance = new ApifyRunActorTool(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/scraping` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/scraping').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/tools/scraping'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
