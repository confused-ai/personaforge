---
title: "Runbook: Memory"
description: "Operational runbook for personaforge/memory — import, run, verify, recover. 77 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Memory

> Auto-generated from `./dist/memory.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/memory`  ·  **Public symbols:** 77  ·  **Guide:** [/guide/memory](../guide/memory.md)

## What it is
`personaforge/memory` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createDbMemoryStore, summariseMemories, summariseConversation } from 'personaforge/memory';
```

## Public API surface
- **Factories / functions** — `createDbMemoryStore`, `summariseMemories`, `summariseConversation`, `createAgentMemoryTools`, `createTieredMemoryTools`, `createGraphMemoryTools`, `createSummaryBufferHook`
- **Classes** — `InMemoryStore`, `VectorMemoryStore`, `OpenAIEmbeddingProvider`, `InMemoryVectorStore`, `PineconeVectorStore`, `QdrantVectorStore`, `PgVectorStore`, `DbMemoryStore`, `MemoryDistiller`, `TieredMemory`, `GraphMemory`
- **Constants** — `DEFAULT_BLOCK_LIMIT`
- **Enums** — `MemoryType`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `SessionRow`, `MemoryRow`, `LearningRow`, `KnowledgeRow`, `TraceRow`, `ScheduleRow`, …(+41)
- **Types** — `LearningType`, `EntityId`, `MessageContent`, `SummaryBeforeStepHook`

## Minimal use
```ts
import { createDbMemoryStore, summariseMemories, summariseConversation } from 'personaforge/memory';

// `createDbMemoryStore` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createDbMemoryStore(/* opts */);
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
