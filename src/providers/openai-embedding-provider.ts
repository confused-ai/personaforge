/**
 * OpenAI Embedding Provider for generating vector embeddings
 * Used for RAG knowledge base and semantic memory
 *
 * Requires: npm install openai
 */

import type { EmbeddingProvider } from './types-embedding.js';
import { DebugLogger, createDebugLogger } from '../shared/index.js';
import { createRequire } from 'node:module';
// ESM-safe require: tsup's ESM bundle turns bare require() into a shim that
// throws "Dynamic require not supported". createRequire restores sync peer-dep loading.
const _require = createRequire(import.meta.url);

interface OpenAIEmbeddingClient {
    embeddings: {
        create(params: OpenAIEmbeddingParams): Promise<OpenAIEmbeddingResponse>;
    };
}

interface OpenAIEmbeddingParams {
    model: string;
    input: string | string[];
}

interface OpenAIEmbeddingResponse {
    data: Array<{ embedding: number[] }>;
    model: string;
    usage: { prompt_tokens: number; total_tokens: number };
}

export interface OpenAIEmbeddingProviderConfig {
    /** OpenAI client instance */
    client?: OpenAIEmbeddingClient;
    /** Model name (default: text-embedding-3-small for speed, text-embedding-3-large for quality) */
    model?: string;
    /** API key (used only if client not provided) */
    apiKey?: string;
    /** Base URL (optional) */
    baseURL?: string;
    /** Enable debug logging */
    debug?: boolean;
}

/**
 * OpenAI embedding provider for RAG and semantic memory
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private client: OpenAIEmbeddingClient;
    private model: string;
    private dimension: number;
    private logger: DebugLogger;

    constructor(config: OpenAIEmbeddingProviderConfig = {}) {
        this.logger = createDebugLogger('OpenAIEmbeddingProvider', config.debug ?? false);
        this.model = config.model ?? 'text-embedding-3-small';
        this.dimension = this.model === 'text-embedding-3-large' ? 3072 : 1536;

        if (config.client) {
            this.client = config.client;
        } else {
            const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
            if (!apiKey) {
                throw new Error('OpenAIEmbeddingProvider requires apiKey (or OPENAI_API_KEY)');
            }
            const { OpenAI } = _require('openai');
            this.client = new OpenAI({
                apiKey,
                ...(config.baseURL && { baseURL: config.baseURL }),
            });
        }

        this.logger.debug('OpenAIEmbeddingProvider initialized', undefined, { model: this.model, dimension: this.dimension });
    }

    async embed(text: string): Promise<number[]> {
        try {
            const response = await this.client.embeddings.create({
                model: this.model,
                input: text,
            });
            return response.data[0].embedding;
        } catch (err) {
            this.logger.error(`Failed to embed text (length=${text.length})`, undefined, { error: String(err) });
            throw err;
        }
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        if (texts.length === 1) return [await this.embed(texts[0])];

        try {
            const response = await this.client.embeddings.create({
                model: this.model,
                input: texts,
            });
            return response.data.sort((a, b) => (a as any).index - (b as any).index).map(d => d.embedding);
        } catch (err) {
            this.logger.error(`Failed to embed ${texts.length} texts`, undefined, { error: String(err) });
            throw err;
        }
    }

    getDimension(): number {
        return this.dimension;
    }
}
