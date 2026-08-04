---
title: "Runbook: Adapters"
description: "Operational runbook for personaforge/adapters — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Adapters

> Auto-generated from `./src/adapters/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/adapters`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/adapters](../guide/adapters.md)

## What it is
`personaforge/adapters` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/adapters';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the adapters guide:

```ts
import { createAgent } from 'personaforge';
import {
  InMemoryCacheAdapter,
  InMemorySessionStoreAdapter,
  InMemoryVectorAdapter,
  createAdapterRegistry,
} from 'personaforge/adapters';

const registry = createAdapterRegistry();
registry.register(new InMemoryCacheAdapter());
registry.register(new InMemoryVectorAdapter());
registry.register(new InMemorySessionStoreAdapter());

await registry.connectAll();

const agent = createAgent({
  name: 'assistant',
  instructions: 'Use the registered adapters.',
  model: 'gpt-4o-mini',
  adapters: registry,
});

console.log(registry.toBindings());
void agent;
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/adapters` with no missing-module error.
- Runtime: `node -e "import('personaforge/adapters').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/adapters](../guide/adapters.md).

## Common failures
- `Cannot find module 'personaforge/adapters'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/adapters](../guide/adapters.md)
