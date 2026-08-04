---
title: "Runbook: Code Mode"
description: "Operational runbook for personaforge/code-mode — import, run, verify, recover. 3 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Code Mode

> Auto-generated from `./src/code-mode/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/code-mode`  ·  **Public symbols:** 3  ·  **Guide:** [/guide/code-mode](../guide/code-mode.md)

## What it is
`personaforge/code-mode` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createCodeMode } from 'personaforge/code-mode';
```

## Public API surface
- **Factories / functions** — `createCodeMode`
- **Interfaces** — `CodeModeOptions`, `CodeModeResult`

## Minimal use
Real example from the code-mode guide:

```ts
import { createCodeMode } from 'personaforge/code-mode';
import { agent } from 'personaforge';

const { tool, instructions } = createCodeMode({
  tools: { getTopProducts, getProductRatings }, // scoped tools
  sandbox: new LocalSandbox(),                   // default: isolated node process
});

const shopping = agent({
  instructions: ['You are a helpful shopping assistant.', instructions],
  tools: { execute_typescript: tool },           // one tool for the LLM
});
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/code-mode` with no missing-module error.
- Runtime: `node -e "import('personaforge/code-mode').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/code-mode](../guide/code-mode.md).

## Common failures
- `Cannot find module 'personaforge/code-mode'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/code-mode](../guide/code-mode.md)
