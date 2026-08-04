---
title: "Runbook: Registry"
description: "Operational runbook for personaforge/registry — import, run, verify, recover. 4 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Registry

> Auto-generated from `./src/registry/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/registry`  ·  **Public symbols:** 4  ·  **Guide:** [/guide/registry](../guide/registry.md)

## What it is
`personaforge/registry` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createAgentRegistry, AgentRegistry } from 'personaforge/registry';
```

## Public API surface
- **Factories / functions** — `createAgentRegistry`
- **Classes** — `AgentRegistry`
- **Interfaces** — `AgentRecord`, `AgentRegistryEntry`

## Minimal use
Real example from the registry guide:

```ts
import { createAgentRegistry } from 'personaforge/registry';
import { agent } from 'personaforge';

const registry = createAgentRegistry();

registry.register({
  name: 'translator',
  description: 'Translate text into another language',
  tags: ['language', 'nlp'],
  agent: agent('You translate text.'),
});

registry.register({
  name: 'summarizer',
  description: 'Summarize long documents',
  tags: ['nlp', 'summarization'],
  agent: agent('You summarize documents.'),
});

// O(1) lookup by name
const t = registry.get('translator');              // AgentRecord

// Case-insensitive discovery across name/description/tags
const matches = registry.search('translate');      // → [translator record]
const scoped = registry.search('nlp');             // → [translator, summarizer]

// Delegate to any agent as an LLM tool
const translateTool = registry.asTool('translator');

// Or expose every registered agent as a delegation toolkit:
const tools = registry.toTools();                  // one tool per agent
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/registry` with no missing-module error.
- Runtime: `node -e "import('personaforge/registry').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/registry](../guide/registry.md).

## Common failures
- `Cannot find module 'personaforge/registry'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/registry](../guide/registry.md)
