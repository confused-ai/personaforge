---
title: "Runbook: Tools: Shell"
description: "Operational runbook for personaforge/tools/shell — import, run, verify, recover. 3 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Shell

> Auto-generated from `./src/tools/shell.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/shell`  ·  **Public symbols:** 3  ·  **Guide:** [/guide/tools](../guide/tools.md)

## What it is
`personaforge/tools/shell` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createShellTool } from 'personaforge/tools/shell';
```

## Public API surface
- **Factories / functions** — `createShellTool`
- **Constants** — `shell`
- **Interfaces** — `ShellToolOptions`

## Minimal use
Real example from the tools guide:

```ts
import {
  httpClient,        // HTTP requests
  fileSystem,        // read/write local files
  browserTool,       // headless browser
  createShellTool,   // run shell commands
} from 'personaforge/tool';
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/shell` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/shell').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/tools](../guide/tools.md).

## Common failures
- `Cannot find module 'personaforge/tools/shell'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/tools](../guide/tools.md)
