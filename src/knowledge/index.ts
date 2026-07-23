/**
 * @confused-ai/knowledge — package barrel.
 */

export { KnowledgeEngine, createKnowledgeEngine, withEmbeddingCache } from './knowledge-engine.js';
export type { RAGEngine, VectorStore, EmbeddingFn, Document, SearchResult, RAGChunk, RAGQueryOptions, RAGQueryResult } from './types.js';

// ── AgentDb-backed engine ──────────────────────────────────────────────────
export { DbKnowledgeEngine, DbVectorStore, createDbKnowledgeEngine } from './db-knowledge-store.js';
export type { DbKnowledgeEngineOptions } from './db-knowledge-store.js';

// ── External vector-store adapters ─────────────────────────────────────────
export { Neo4jKnowledgeAdapter } from './adapters/neo4j-adapter.js';
export type { Neo4jAdapterConfig } from './adapters/neo4j-adapter.js';
export { ChromaKnowledgeAdapter } from './adapters/chroma-adapter.js';
export type { ChromaAdapterConfig } from './adapters/chroma-adapter.js';
export { PgvectorKnowledgeAdapter } from './adapters/pgvector-adapter.js';
export type { PgvectorAdapterConfig } from './adapters/pgvector-adapter.js';

// ── Document loaders ────────────────────────────────────────────────────────
export { loadPdf } from './loaders/pdf-loader.js';
export type { PdfLoaderOptions } from './loaders/pdf-loader.js';
export { loadCsv } from './loaders/csv-loader.js';
export type { CsvLoaderOptions } from './loaders/csv-loader.js';
export { loadUrl } from './loaders/url-loader.js';
export type { UrlLoaderOptions } from './loaders/url-loader.js';

// ── Advanced retrieval (splitters, hybrid, rerankers, retriever primitives) ──
export * from './retrieval/index.js';

// ── Additional loaders (markdown/html/json/docx/sitemap/github/s3) ────────────
export { loadMarkdown, loadMarkdownText } from './loaders/markdown-loader.js';
export type { MarkdownLoaderOptions } from './loaders/markdown-loader.js';
export { loadHtml, loadHtmlText } from './loaders/html-loader.js';
export type { HtmlLoaderOptions } from './loaders/html-loader.js';
export { loadJson } from './loaders/json-loader.js';
export type { JsonLoaderOptions } from './loaders/json-loader.js';
export { loadDocx } from './loaders/docx-loader.js';
export type { DocxLoaderOptions } from './loaders/docx-loader.js';
export { loadSitemap } from './loaders/sitemap-loader.js';
export type { SitemapLoaderOptions } from './loaders/sitemap-loader.js';
export { loadGithubRepo } from './loaders/github-loader.js';
export type { GithubLoaderOptions } from './loaders/github-loader.js';
export { loadS3 } from './loaders/s3-loader.js';
export type { S3LoaderOptions } from './loaders/s3-loader.js';
