---
title: "Runbook: Artifacts"
description: "Operational runbook for personaforge/artifacts — import, run, verify, recover. 27 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Artifacts

> Auto-generated from `./dist/artifacts.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/artifacts`  ·  **Public symbols:** 27  ·  **Guide:** [/guide/artifacts](../guide/artifacts.md)

## What it is
`personaforge/artifacts` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createTextArtifact, createMarkdownArtifact, createDataArtifact } from 'personaforge/artifacts';
```

## Public API surface
- **Factories / functions** — `createTextArtifact`, `createMarkdownArtifact`, `createDataArtifact`, `createReasoningArtifact`, `createPlanArtifact`, `createImageFromUrl`, `createImageFromBase64`, `createAudioFromUrl`, `createVideoFromUrl`
- **Classes** — `InMemoryArtifactStorage`, `MediaManager`
- **Interfaces** — `MetricValue`, `MetricsCollector`, `ArtifactMetadata`, `Artifact`, `TextArtifact`, `DataArtifact`, `BinaryArtifact`, `ReasoningArtifact`, `PlanArtifact`, `ReportArtifact`, `ArtifactStorageConfig`, `ArtifactStorage`, …(+3)
- **Types** — `ArtifactType`

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
// …see full example in the guide
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
