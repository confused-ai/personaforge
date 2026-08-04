---
title: "Runbook: Production"
description: "Operational runbook for personaforge/production — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Production

> Auto-generated from `./src/production/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/production`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/production](../guide/production.md)

## What it is
`personaforge/production` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/production';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the production guide:

```ts
import { createAgent } from 'personaforge';
import { withResilience } from 'personaforge/production';

const agent = createAgent({
  name: 'production-agent',
  instructions: 'You are a customer service assistant.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const resilientAgent = withResilience(agent, {
  circuitBreaker: {
    failureThreshold: 5,      // open after 5 failures
    resetTimeoutMs: 30_000,   // retry after 30s
  },
  rateLimit: { maxRpm: 60 },  // max requests per minute
  healthCheck: true,
  gracefulShutdown: true,
  retry: { maxRetries: 2, backoffMs: 500 },
});

// Use exactly like a regular agent
const result = await resilientAgent.run('Help me with my order.', {
  sessionId: 'session-1',
  userId: 'user-42',
  runId: 'run-abc',       // used for idempotency
});
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/production` with no missing-module error.
- Runtime: `node -e "import('personaforge/production').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/production](../guide/production.md).

## Common failures
- `Cannot find module 'personaforge/production'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/production](../guide/production.md)
