---
title: "Runbook: Workflow"
description: "Operational runbook for personaforge/workflow — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Workflow

> Auto-generated from `./src/workflow/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/workflow`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/workflows](../guide/workflows.md)

## What it is
`personaforge/workflow` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/workflow';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the workflows guide:

```ts
import { createGraph, DAGEngine } from 'personaforge/workflow';

const graph = createGraph('data-pipeline')
  .addNode('fetch', {
    kind: 'task',
    execute: async (ctx) => {
      const url = ctx.state.variables.url as string;
      return { data: await fetchData(url) };
    },
  })
  .addNode('transform', {
    kind: 'task',
    execute: async (ctx) => {
      const { data } = ctx.state.results['fetch'] as { data: unknown };
      return { transformed: transform(data) };
    },
  })
  .addNode('save', {
    kind: 'task',
    execute: async (ctx) => {
      const { transformed } = ctx.state.results['transform'] as { transformed: unknown };
      await saveToDatabase(transformed);
      return { saved: true };
    },
  })
  .chain('fetch', 'transform', 'save')  // linear shorthand for addEdge
  .build();

const engine = new DAGEngine(graph);
const result = await engine.execute({ variables: { url: 'https://api.example.com/data' } });
console.log(result.state.results);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/workflow` with no missing-module error.
- Runtime: `node -e "import('personaforge/workflow').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/workflows](../guide/workflows.md).

## Common failures
- `Cannot find module 'personaforge/workflow'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/workflows](../guide/workflows.md)
