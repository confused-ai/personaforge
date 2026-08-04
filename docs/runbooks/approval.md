---
title: "Runbook: Approval"
description: "Operational runbook for personaforge/approval — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Approval

> Auto-generated from `./src/approval/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/approval`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/approval](../guide/approval.md)

## What it is
`personaforge/approval` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/approval';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the approval guide:

```ts
import { createSqliteSuspendedRunStore } from 'personaforge/approval';

const store = createSqliteSuspendedRunStore('./agent.db');
await store.save({
  runId: 'run_123',
  agentId: 'support-bot',
  threadId: 't1',
  resourceId: 'user-7',
  status: 'approval',
  toolCalls: [{
    toolCallId: 'call_1',
    toolName: 'send_invoice',
    args: { customerId: 'c1', amount: 500 },
    requiresApproval: true,
  }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const pending = await store.list({ threadId: 't1' });
await store.markResolved('run_123');
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/approval` with no missing-module error.
- Runtime: `node -e "import('personaforge/approval').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/approval](../guide/approval.md).

## Common failures
- `Cannot find module 'personaforge/approval'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/approval](../guide/approval.md)
