---
title: "Runbook: Tools: Media"
description: "Operational runbook for personaforge/tools/media — import, run, verify, recover. 45 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Media

> Auto-generated from `./dist/tools/media.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/media`  ·  **Public symbols:** 45  ·  **Guide:** [/guide/tools](../guide/tools.md)

## What it is
`personaforge/tools/media` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { GiphySearchTool, GiphyTrendingTool, GiphyGetGifTool } from 'personaforge/tools/media';
```

## Public API surface
- **Classes** — `GiphySearchTool`, `GiphyTrendingTool`, `GiphyGetGifTool`, `GiphyRandomTool`, `GiphyTranslateTool`, `GiphyToolkit`, `UnsplashSearchPhotosTool`, `UnsplashGetPhotoTool`, `UnsplashGetRandomPhotoTool`, `UnsplashSearchCollectionsTool`, `UnsplashListCollectionPhotosTool`, `UnsplashToolkit`, …(+15)
- **Interfaces** — `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `Tool`, `LogContext`, `Logger`, `DebugLoggerConfig`, `BaseToolConfig`, `GiphyToolConfig`, `UnsplashToolConfig`, …(+4)
- **Types** — `EntityId`, `ToolParameters`

## Minimal use
```ts
import { GiphySearchTool, GiphyTrendingTool, GiphyGetGifTool } from 'personaforge/tools/media';

// `GiphySearchTool` is the primary entry for this feature.
// See the type signature for full options.
const instance = new GiphySearchTool(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/media` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/media').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/tools](../guide/tools.md).

## Common failures
- `Cannot find module 'personaforge/tools/media'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/tools](../guide/tools.md)
