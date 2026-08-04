---
title: "Runbook: Orchestration"
description: "Operational runbook for personaforge/orchestration — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Orchestration

> Auto-generated from `./src/orchestration/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/orchestration`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/orchestration](../guide/orchestration.md)

## What it is
`personaforge/orchestration` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/orchestration';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the orchestration guide:

```ts
import { createSupervisor, createRole } from 'personaforge/orchestration';
import { createAgent } from 'personaforge';

const supervisor = createSupervisor({
  name: 'triage',
  description: 'Coordinates specialist agents to resolve each request.',
  // Each sub-agent is paired with a role describing its responsibilities.
  subAgents: [
    { agent: createAgent({ name: 'billing', instructions: 'Handle billing and payment questions.', model: 'gpt-4o-mini', apiKey: '...' }), role: createRole('billing', ['Handle billing and payment questions']) },
    { agent: createAgent({ name: 'tech',    instructions: 'Solve technical product issues.',        model: 'gpt-4o',      apiKey: '...' }), role: createRole('tech',    ['Solve technical product issues']) },
    { agent: createAgent({ name: 'general', instructions: 'Answer general questions.',               model: 'gpt-4o-mini', apiKey: '...' }), role: createRole('general', ['Answer general questions']) },
  ],
  guidelines: ['Assign each request to the most relevant specialist.'],
  // coordinationType?: 'sequential' (default) | 'parallel'
});

const result = await supervisor.run('My invoice shows the wrong amount.');
console.log(result);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/orchestration` with no missing-module error.
- Runtime: `node -e "import('personaforge/orchestration').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/orchestration](../guide/orchestration.md).

## Common failures
- `Cannot find module 'personaforge/orchestration'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/orchestration](../guide/orchestration.md)
