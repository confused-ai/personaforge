---
title: "Runbook: Memory"
description: "Operational runbook for personaforge/memory — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Memory

> Auto-generated from `./src/memory/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/memory`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/memory](../guide/memory.md)

## What it is
`personaforge/memory` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/memory';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the memory guide:

```ts
import { MemoryDistiller, summariseMemories, summariseConversation } from 'personaforge/memory';
import { InMemoryStore } from 'personaforge';
import { OpenAIProvider } from 'personaforge';

const llm = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
const store = new InMemoryStore();

const distiller = new MemoryDistiller({
  store,                 // the MemoryStore to read short-term entries from and write summaries to
  llm,
  agentId: 'agent-123',  // optional: scope distillation to one agent
  triggerThreshold: 20,  // auto-distill once this many short-term entries accumulate (default: 20)
  batchSize: 30,         // max entries consumed per pass (default: 30)
  // intervalMs: 60_000, // optional background polling; omit to distill manually
});

// Run a distillation pass now. Returns DistillationResult { consumed, summary, skipped }.
const result = await distiller.distillNow(true);  // force = true ignores the threshold
if (result.summary) console.log(result.consumed, result.summary.content);

// One-shot helpers (entries/messages first, llm second; each returns a string)
const memorySummary = await summariseMemories(memories, llm);
const conversationSummary = await summariseConversation(messages, llm);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/memory` with no missing-module error.
- Runtime: `node -e "import('personaforge/memory').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/memory](../guide/memory.md).

## Common failures
- `Cannot find module 'personaforge/memory'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/memory](../guide/memory.md)
