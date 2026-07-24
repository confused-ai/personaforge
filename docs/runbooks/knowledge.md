---
title: "Runbook: Knowledge"
description: "Operational runbook for personaforge/knowledge — import, run, verify, recover. 83 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Knowledge

> Auto-generated from `./dist/knowledge.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/knowledge`  ·  **Public symbols:** 83  ·  **Guide:** [/guide/rag](../guide/rag.md)

## What it is
`personaforge/knowledge` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createKnowledgeEngine, withEmbeddingCache, createDbKnowledgeEngine } from 'personaforge/knowledge';
```

## Public API surface
- **Factories / functions** — `withEmbeddingCache`, `createKnowledgeEngine`, `createDbKnowledgeEngine`, `loadPdf`, `loadCsv`, `loadUrl`, `rrfFuse`, `loadMarkdown`, `loadMarkdownText`, `loadHtml`, `loadHtmlText`, `loadJson`, …(+4)
- **Classes** — `KnowledgeEngine`, `DbKnowledgeEngine`, `DbVectorStore`, `Neo4jKnowledgeAdapter`, `ChromaKnowledgeAdapter`, `PgvectorKnowledgeAdapter`, `RecursiveCharacterSplitter`, `MarkdownSplitter`, `SemanticSplitter`, `BM25Index`, `HybridRetriever`, `CohereReranker`, …(+8)
- **Interfaces** — `Document`, `SearchResult`, `VectorStore`, `RAGEngine`, `RAGChunk`, `RAGQueryOptions`, `RAGQueryResult`, `KnowledgeEngineOptions`, `SessionRow`, `MemoryRow`, `LearningRow`, `KnowledgeRow`, …(+33)
- **Types** — `EmbeddingFn`, `LearningType`

## Minimal use
Real example from the rag guide:

```ts
import { createAgent } from 'personaforge';
import { createKnowledgeEngine, loadUrl } from 'personaforge';
import { OpenAIEmbeddingProvider } from 'personaforge';

// 1. Build the engine — `embed` is an EmbeddingFn: (text) => Promise<number[]>
const embedder = new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! });
const kb = createKnowledgeEngine({
  embed: (text) => embedder.embed(text),
  // default: InMemoryVectorStore (cosine similarity)
});

// 2. Ingest documents
const docs = await loadUrl('https://docs.example.com/api-reference', { recursive: true, maxPages: 20 });
await kb.addDocuments(docs);

// 3. Attach to agent
const agent = createAgent({
  name: 'docs-assistant',
  instructions: 'Answer questions about our product using the provided documentation.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  knowledgebase: kb,
  addKnowledgeToContext: true,   // automatically prepends retrieved chunks to system prompt (default: true when a knowledgebase is set)
});

const result = await agent.run('How do I authenticate API requests?');
// …see full example in the guide
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/knowledge` with no missing-module error.
- Runtime: `node -e "import('personaforge/knowledge').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/rag](../guide/rag.md).

## Common failures
- `Cannot find module 'personaforge/knowledge'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/rag](../guide/rag.md)
