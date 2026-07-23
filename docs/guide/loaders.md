---
title: Document Loaders
description: Load documents from Markdown, HTML, JSON/JSONL, DOCX, PDF, CSV, URL, sitemap, GitHub repo, and S3 — ready for chunking, embedding, and ingestion into a KnowledgeEngine.
outline: [2, 3]
---

# Document Loaders

Loaders convert external data sources into `Document[]` objects ready for ingestion. All loaders share the same output shape, so you can mix sources and send them to the same vector store.

```ts
import {
  loadPdf, loadCsv, loadUrl,                           // original loaders
  loadMarkdown, loadMarkdownText,
  loadHtml, loadHtmlText,
  loadJson,
  loadDocx,
  loadSitemap,
  loadGithubRepo,
  loadS3,
} from 'personaforge/knowledge';
```

---

## Markdown

Splits on headings. Each heading section becomes a separate document, with the heading text in `metadata.heading`.

```ts
const docs = await loadMarkdown('./README.md');
// Or from a string:
const docs = loadMarkdownText(rawString, { source: 'README.md' });
```

---

## HTML

Strips `<script>`, `<style>`, all tags, and decodes HTML entities.

```ts
const docs = await loadHtml('./page.html');
// Or from a string:
const doc = loadHtmlText(rawHtml, { source: 'page.html' });
```

---

## JSON / JSONL

Each object in the array (or each line for `.jsonl`) becomes a `Document`.

```ts
const docs = await loadJson('./data.json', { contentField: 'description' });
const docs = await loadJson('./events.jsonl', { contentField: 'text' });
```

When `contentField` is omitted the full object is JSON-stringified as content.

---

## DOCX

Extracts text from `.docx` files. Uses the `mammoth` peer dependency when available; falls back to basic XML extraction.

```ts
const docs = await loadDocx('./report.docx');
```

Install `mammoth` for better extraction: `npm i mammoth`. The basic XML fallback uses `adm-zip` (`npm i adm-zip`).

---

## Sitemap

Fetches a `sitemap.xml`, crawls each `<loc>` URL (up to `maxPages`), strips HTML.

```ts
const docs = await loadSitemap('https://example.com/sitemap.xml', {
  maxPages: 100,
});
```

---

## GitHub repository

Fetches a repository's file tree from the GitHub API and loads text files.

```ts
const docs = await loadGithubRepo({
  owner: 'personaforge',
  repo: 'personaforge',
  branch: 'main',
  extensions: ['.md', '.ts'],
  maxFiles: 200,
  token: process.env.GITHUB_TOKEN,
});
```

---

## S3

Loads text objects from an S3 bucket. Requires `@aws-sdk/client-s3` (`npm i @aws-sdk/client-s3`).

```ts
const docs = await loadS3({
  bucket: 'my-docs-bucket',
  prefix: 'knowledge/',
  region: 'us-east-1',
});
```

---

## PDF / CSV / URL

The original loaders (`loadPdf`, `loadCsv`, `loadUrl`) are documented in the [RAG guide](/guide/rag).

---

## Metadata

Every loader accepts a `metadata?: Record<string, unknown>` option that is merged into each document's `metadata`. Loaders also add a `source` field automatically.

---

## After loading

Pass documents through a [text splitter](/guide/retrieval-advanced) and then into a vector store:

```ts
import { RecursiveCharacterSplitter, createKnowledgeEngine } from 'personaforge/knowledge';

const docs = await loadMarkdown('./docs.md');
const splitter = new RecursiveCharacterSplitter({ chunkSize: 800 });
const chunks = splitter.splitDocuments(docs.map((d) => ({ content: d.content, metadata: d.metadata })));

const engine = createKnowledgeEngine({ embed });
await engine.addDocuments(chunks.map((c) => ({
  id: crypto.randomUUID(),
  content: c.content,
  metadata: c.metadata,
})));
```

---

## Related pages

- [RAG / Knowledge](/guide/rag) — the KnowledgeEngine and vector stores.
- [Advanced Retrieval](/guide/retrieval-advanced) — splitters, BM25, hybrid, rerankers.
