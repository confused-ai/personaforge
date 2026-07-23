/**
 * @confused-ai/knowledge/retrieval — advanced retrieval toolkit.
 *
 * Splitters, keyword (BM25) + hybrid (RRF) retrieval, rerankers, and composable
 * retriever primitives that bring the framework to LangChain-grade RAG depth.
 */

export {
  RecursiveCharacterSplitter,
  MarkdownSplitter,
  SemanticSplitter,
} from './splitters.js';
export type { Chunk, SplitterOptions, TextSplitter } from './splitters.js';

export { BM25Index } from './bm25.js';

export { HybridRetriever, rrfFuse } from './hybrid.js';
export type { HybridRetrieverOptions } from './hybrid.js';

export { CohereReranker, JinaReranker, LLMReranker } from './reranker.js';
export type {
  Reranker,
  CohereRerankerOptions,
  JinaRerankerOptions,
} from './reranker.js';

export {
  MultiQueryRetriever,
  ContextualCompressionRetriever,
  LLMCompressor,
  ParentDocumentRetriever,
  SelfQueryRetriever,
  TimeWeightedRetriever,
} from './retrievers.js';
export type { Retriever, DocumentCompressor } from './retrievers.js';
