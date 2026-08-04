---
title: "Runbook: Events"
description: "Operational runbook for personaforge/events — import, run, verify, recover. 3 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Events

> Auto-generated from `./src/events/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/events`  ·  **Public symbols:** 3  ·  **Guide:** [/guide/events](../guide/events.md)

## What it is
`personaforge/events` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { eventBus } from 'personaforge/events';
```

## Public API surface
- **Factories / functions** — `eventBus`
- **Constants** — `AGENT_EVENT`
- **Interfaces** — `CoreEventMap`

## Minimal use
Real example from the events guide:

```ts
import { eventBus, AGENT_EVENT } from 'personaforge/events';
import { agent } from 'personaforge';

// A bus pre-wired with the core event vocabulary.
const bus = eventBus({ replayBufferSize: 100 });

bus.on(AGENT_EVENT.runFinished, (e) => {
  console.log('run finished', e.agentId, e.result);
});
bus.on('*', (type, payload) => {
  console.log('any event →', type);
});

// Emit from your own hooks:
const bot = agent({
  instructions: 'You are helpful.',
  hooks: {
    afterRun: async (result) => {
      await bus.emit(AGENT_EVENT.runFinished, { agentId: 'bot', sessionId: 's1', result });
    },
  },
});
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/events` with no missing-module error.
- Runtime: `node -e "import('personaforge/events').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/events](../guide/events.md).

## Common failures
- `Cannot find module 'personaforge/events'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/events](../guide/events.md)
