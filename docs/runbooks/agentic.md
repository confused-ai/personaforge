---
title: "Runbook: Agentic"
description: "Operational runbook for personaforge/agentic — import, run, verify, recover. 1 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Agentic

> Auto-generated from `./src/agentic/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/agentic`  ·  **Public symbols:** 1  ·  **Guide:** [/guide/agents](../guide/agents.md)

## What it is
`personaforge/agentic` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createAgenticAgent } from 'personaforge/agentic';
```

## Public API surface
- **Factories / functions** — `createAgenticAgent`

## Minimal use
Real example from the agents guide:

```ts
import { AgenticRunner, createAgenticAgent } from 'personaforge';
import { OpenAIProvider } from 'personaforge';

const runner = new AgenticRunner({
  llm: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: myToolRegistry,
  maxSteps: 10,
  timeoutMs: 60_000,
});

runner.setGuardrails(myGuardrailEngine);
runner.setHumanInTheLoop(myHITLHooks);

const result = await runner.run({
  name: 'my-agent',
  instructions: 'Process the request.',
  prompt: 'Analyse the latest sales data.',
});
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/agentic` with no missing-module error.
- Runtime: `node -e "import('personaforge/agentic').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/agents](../guide/agents.md).

## Common failures
- `Cannot find module 'personaforge/agentic'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/agents](../guide/agents.md)
