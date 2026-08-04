---
title: "Runbook: Goals"
description: "Operational runbook for personaforge/goals — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Goals

> Auto-generated from `./src/goals/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/goals`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/goals](../guide/goals.md)

## What it is
`personaforge/goals` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/goals';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the goals guide:

```ts
import { createLlmJudge, createStaticJudge, createRubricScorer, createSchemaScorer } from 'personaforge/goals';

// LLM judge with a custom prompt:
const judge = createLlmJudge({
  llm: myLlmProvider,
  prompt: 'You are a strict completeness judge. Respond with JSON.',
});

// Deterministic predicate judge:
const staticJudge = createStaticJudge((text) => text.includes('DONE'));

// Rubric (checklist) scorer with a backing LLM judge:
const rubric = createRubricScorer({
  judge,
  criteria: [
    { description: 'lists acceptance criteria', required: true },
    { description: 'explains test strategy' },
  ],
  requireAll: true,
});

// Schema-validated scorer:
const schemaScorer = createSchemaScorer(myOutputSchema);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/goals` with no missing-module error.
- Runtime: `node -e "import('personaforge/goals').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/goals](../guide/goals.md).

## Common failures
- `Cannot find module 'personaforge/goals'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/goals](../guide/goals.md)
