---
title: "Runbook: Tool"
description: "Operational runbook for personaforge/tool — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tool

> Auto-generated from `./src/tool.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tool`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/tools](../guide/tools.md)

## What it is
`personaforge/tool` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/tool';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the tools guide:

```ts
import { extendTool, wrapTool, pipeTools } from 'personaforge/tool';

// Normalise inputs and trim results around an existing tool
const reliableSearch = extendTool(searchTool, {
  name: 'reliable_search',
  transformInput: (params) => ({ ...params, query: params.query.trim() }),
  transformOutput: (results) => (Array.isArray(results) ? results.slice(0, 3) : results),
  timeoutMs: 10_000,
});

// Wrap with a middleware pipeline: (params, ctx, next)
const wrappedSearch = wrapTool(searchTool, [
  async (params, ctx, next) => {
    const sanitised = { ...params, query: params.query.trim() };
    const result = await next(sanitised, ctx);
    return { ...result, source: 'search' };
  },
]);

// Chain tools: output of tool1 becomes input of tool2
const pipeline = pipeTools(fetchPageTool, summariseTool, {
  name: 'fetch_and_summarise',
  description: 'Fetch a page then summarise it.',
  adapter: (page) => ({ text: page.body }),
});
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tool` with no missing-module error.
- Runtime: `node -e "import('personaforge/tool').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/tools](../guide/tools.md).

## Common failures
- `Cannot find module 'personaforge/tool'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/tools](../guide/tools.md)
