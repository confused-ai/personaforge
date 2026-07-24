---
title: "Runbook: Planner"
description: "Operational runbook for personaforge/planner — import, run, verify, recover. 27 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Planner

> Auto-generated from `./dist/planner.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/planner`  ·  **Public symbols:** 27  ·  **Guide:** [/guide/planner](../guide/planner.md)

## What it is
`personaforge/planner` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { LLMPlanner, ClassicalPlanner, PlanValidator } from 'personaforge/planner';
```

## Public API surface
- **Classes** — `LLMPlanner`, `ClassicalPlanner`, `PlanValidator`
- **Enums** — `TaskPriority`, `TaskStatus`, `PlanExecutionStatus`, `PlanningAlgorithm`
- **Interfaces** — `Task`, `TaskMetadata`, `TaskResult`, `TaskError`, `Plan`, `PlanMetadata`, `PlanExecutionResult`, `PlannerConfig`, `RetryPolicy`, `Planner`, `PlanContext`, `PlanFeedback`, …(+6)
- **Types** — `EntityId`, `ValidationRule`

## Minimal use
Real example from the planner guide:

```ts
import { createAgent, OpenAIProvider } from 'personaforge';
import { LLMPlanner, TaskPriority } from 'personaforge';

const llm = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o' });

const planner = new LLMPlanner(
  {
    maxIterations: 10,
    allowParallelExecution: true,
    model: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 2_000,
  },
  {
    generateText: async (prompt) => {
      const result = await llm.generateText([{ role: 'user', content: prompt }]);
      return result.text;
    },
  },
);

// Generate a plan
const plan = await planner.plan('Launch a new product blog post', {
  availableTools: ['search_web', 'write_content', 'publish_post'],
  constraints: ['Must be done in 2 hours', 'Use SEO best practices'],
});
// …see full example in the guide
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/planner` with no missing-module error.
- Runtime: `node -e "import('personaforge/planner').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/planner](../guide/planner.md).

## Common failures
- `Cannot find module 'personaforge/planner'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/planner](../guide/planner.md)
