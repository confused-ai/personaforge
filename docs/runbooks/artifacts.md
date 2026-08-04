---
title: "Runbook: Artifacts"
description: "Operational runbook for personaforge/artifacts — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Artifacts

> Auto-generated from `./src/artifacts/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/artifacts`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/artifacts](../guide/artifacts.md)

## What it is
`personaforge/artifacts` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/artifacts';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the artifacts guide:

```ts
import {
  createTextArtifact,
  createMarkdownArtifact,
  createDataArtifact,
  createPlanArtifact,
  createReasoningArtifact,
} from 'personaforge/artifacts';

// Plain text / code file
const code = createTextArtifact({
  name: 'auth-handler.ts',
  content: `export function verifyToken(token: string) { ... }`,
  type: 'code',
  mimeType: 'text/typescript',
  tags: ['auth', 'typescript'],
  createdBy: 'code-agent',
});

// Markdown report
const report = createMarkdownArtifact({
  name: 'Q4-report.md',
  content: '## Q4 Summary\n\nRevenue up 12% YoY...',
  tags: ['report', 'q4'],
});

// Structured data
const data = createDataArtifact({
  name: 'search-results',
  content: { query: 'LLM benchmarks', results: [...] },
  type: 'json',
});

// Agent reasoning trace
const trace = createReasoningArtifact({
  steps: [
    { title: 'Analyse', action: 'Read the requirements', result: '...', confidence: 0.9 },
  ],
  conclusion: 'Use a queue-based approach.',
  model: 'gpt-4o',
});

// Execution plan
const plan = createPlanArtifact({
  goal: 'Migrate database to PostgreSQL',
  tasks: [
    { id: '1', name: 'Backup current DB', priority: 0 },
    { id: '2', name: 'Provision RDS', priority: 1, dependencies: ['1'] },
  ],
});
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/artifacts` with no missing-module error.
- Runtime: `node -e "import('personaforge/artifacts').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/artifacts](../guide/artifacts.md).

## Common failures
- `Cannot find module 'personaforge/artifacts'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/artifacts](../guide/artifacts.md)
