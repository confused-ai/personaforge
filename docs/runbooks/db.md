---
title: "Runbook: Db"
description: "Operational runbook for personaforge/db — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Db

> Auto-generated from `./src/db/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/db`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/database](../guide/database.md)

## What it is
`personaforge/db` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/db';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the database guide:

```ts
import { createAgent, DbSessionStore } from 'personaforge';
import { createDbKnowledgeEngine, OpenAIEmbeddingProvider } from 'personaforge';
import { SqliteAgentDb } from 'personaforge/db';
import { createDbMemoryStore } from 'personaforge/memory';

const db = new SqliteAgentDb({ path: './agent.db' });
const embedder = new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! });

const agent = createAgent({
  name: 'persistent-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  sessionStore:  new DbSessionStore(db),
  memoryStore:   createDbMemoryStore(db),   // AgentDb passed positionally
  knowledgebase: createDbKnowledgeEngine({
    db,
    embed: (text) => embedder.embed(text),  // embed is an EmbeddingFn, not a provider
  }),
});
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/db` with no missing-module error.
- Runtime: `node -e "import('personaforge/db').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/database](../guide/database.md).

## Common failures
- `Cannot find module 'personaforge/db'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/database](../guide/database.md)
