---
title: "Runbook: Durable"
description: "Operational runbook for personaforge/durable — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Durable

> Auto-generated from `./src/durable/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/durable`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/durable](../guide/durable.md)

## What it is
`personaforge/durable` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/durable';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the durable guide:

```ts
import { createDurableAgent } from 'personaforge/durable';
import { agent } from 'personaforge';

const researcher = agent('You research topics and return findings.');

const durable = createDurableAgent({ agent: researcher });

// Start a run — the agentic loop runs in the background.
const { runId, output, cleanup } = await durable.stream('Research TypeScript 5');

// Consume events as they arrive (text, tool, approval, goal, run-finish).
for await (const event of output.fullStream) {
  if (event.type === 'text-delta') process.stdout.write(event.delta);
}
const final = await output.runResult;

// Clean up the run subscriptions / timers when you're done.
cleanup();
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/durable` with no missing-module error.
- Runtime: `node -e "import('personaforge/durable').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/durable](../guide/durable.md).

## Common failures
- `Cannot find module 'personaforge/durable'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/durable](../guide/durable.md)
