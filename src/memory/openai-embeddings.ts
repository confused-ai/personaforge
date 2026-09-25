/**
 * OpenAI Embedding Provider
 *
 * Generates embeddings via the OpenAI embeddings API.
 * Supports text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002.
 */

import type { EmbeddingProvider } from './types.js';

export interface OpenAIEmbeddingConfig {
    /** OpenAI API key. Falls back to OPENAI_API_KEY. */
    apiKey?: string;
    /** Model ID (default: text-embedding-3-small) */
    model?: string;
    /** Embedding dimension override (for text-embedding-3-* only) */
    dimensions?: number;
    /** Base URL override */
    baseURL?: string;
}

const DIMENSIONS: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private apiKey: string;
    private model: string;
    private dimensions: number;
    private baseURL: string;

    constructor(config: OpenAIEmbeddingConfig = {}) {
        const envKey = typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined;
        this.apiKey = config.apiKey ?? envKey ?? '';
        this.model = config.model ?? 'text-embedding-3-small';
        this.dimensions = config.dimensions ?? DIMENSIONS[this.model] ?? 1536;
        this.baseURL = config.baseURL ?? 'https://api.openai.com/v1';
    }

    async embed(text: string): Promise<number[]> {
        const results = await this.embedBatch([text]);
        return results[0];
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (!this.apiKey) {
            throw new Error('OpenAIEmbeddingProvider: API key required. Set OPENAI_API_KEY or pass apiKey.');
        }

        const body: Record<string, unknown> = {
            model: this.model,
            input: texts,
        };

        // text-embedding-3-* supports dimension reduction
        if (this.model.startsWith('text-embedding-3-') && this.dimensions) {
            body.dimensions = this.dimensions;
        }

        const response = await fetch(`${this.baseURL}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI Embedding API error ${response.status}: ${err}`);
        }

        const json = await response.json() as {
            data: Array<{ embedding: number[]; index: number }>;
        };
        if (!Array.isArray(json.data) || json.data.length === 0) {
            throw new Error('OpenAI Embedding API returned no embeddings.');
        }

        // Sort by index to preserve input order
        return json.data
            .sort((a, b) => a.index - b.index)
            .map(d => d.embedding);
    }

    getDimension(): number {
        return this.dimensions;
    }
}
