---
title: "Runbook: Skills"
description: "Operational runbook for personaforge/skills — import, run, verify, recover. 8 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Skills

> Auto-generated from `./dist/skills.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/skills`  ·  **Public symbols:** 8  ·  **Guide:** [/guide/skills](../guide/skills.md)

## What it is
`personaforge/skills` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createDeepAgent } from 'personaforge/skills';
```

## Public API surface
- **Factories / functions** — `createDeepAgent`
- **Constants** — `webResearchSkill`, `pdfSummarizerSkill`, `codeReviewerSkill`
- **Interfaces** — `Skill`, `DeepAgentConfig`, `DeepResearchResult`, `DeepStep`

## Minimal use
Real example from the skills guide:

```ts
import { webResearchSkill } from 'personaforge/skills';

const agent = defineAgent('researcher')
  .instructions('Research questions using the web.')
  .model('openai:gpt-4o-mini')
  .skills([webResearchSkill])
  .build();

const result = await agent.run('What is the latest version of Node.js?');
// Agent will call fetch_page('https://nodejs.org/en/download/releases') internally
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/skills` with no missing-module error.
- Runtime: `node -e "import('personaforge/skills').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/skills](../guide/skills.md).

## Common failures
- `Cannot find module 'personaforge/skills'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/skills](../guide/skills.md)
