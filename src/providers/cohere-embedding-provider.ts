/**
 * Cohere embedding provider (Embed v3 API).
 *
 * Minimal fetch-based HTTP adapter — no SDK dependency. Powers RAG / semantic
 * memory via the provider-neutral `EmbeddingProvider` contract
 * (see types-embedding.js).
 */

import type { EmbeddingProvider } from './types-embedding.js';

export interface CohereEmbeddingProviderConfig {
    /** Cohere API key (falls back to COHERE_API_KEY env var) */
    apiKey?: string;
    /**
     * Optional pre-built client for parity with other embedding adapters.
     * If provided it must expose `embed({ model, texts, input_type }) -> Promise<{ embeddings: { floats: number[][] } }>`.
     * When omitted, the default fetch-based path to the Cohere API is used.
     */
    client?: unknown;
    /** Embedding model name (default: embed-english-v3.0) */
    model?: string;
    /** Base URL (default: https://api.cohere.com/v2) */
    baseURL?: string;
    /** fetch implementation override (for tests) */
    fetchFn?: typeof fetch;
}

const DEFAULT_MODEL = 'embed-english-v3.0';
const DEFAULT_BASE_URL = 'https://api.cohere.com/v2';
const INPUT_TYPE = 'search_document';

/**
 * Defensively extract number[][] vectors from a Cohere Embed v3 response.
 * Handles embeddings.floats / .int8 / .uint8 (2D) and normalises a 1D vector to
 * a single-entry 2D array. Never throws on extraction — empty array fallback.
 */
function extractFloats(json: unknown): number[][] {
    if (!json || typeof json !== 'object') return [];
    const r = json as Record<string, unknown>;
    const embeddings = r['embeddings'];

    if (embeddings && typeof embeddings === 'object') {
        const emb = embeddings as Record<string, unknown>;
        const floats = emb['floats'] ?? emb['int8'] ?? emb['uint8'];
        if (Array.isArray(floats)) {
            if (floats.length > 0 && Array.isArray(floats[0])) {
                return floats as number[][];
            }
            if (floats.length > 0 && typeof floats[0] === 'number') {
                return [floats as number[]];
            }
        }
    }

    // Plain array-of-arrays fallback.
    if (Array.isArray(embeddings) && embeddings.every((e: unknown) => Array.isArray(e))) {
        return embeddings as number[][];
    }

    return [];
}

/**
 * Cohere embedding provider for RAG and semantic memory.
 */
export class CohereEmbeddingProvider implements EmbeddingProvider {
    private readonly apiKey: string;
    private readonly model: string;
    private readonly baseURL: string;
    private readonly fetchFn: typeof fetch;
    private readonly client: unknown;

    constructor(config: CohereEmbeddingProviderConfig = {}) {
        const apiKey = config.apiKey ?? process.env.COHERE_API_KEY;
        if (!config.client && !apiKey) {
            throw new Error('CohereEmbeddingProvider requires apiKey (or COHERE_API_KEY)');
        }
        this.client = config.client ?? null;
        this.apiKey = apiKey ?? '';
        this.model = config.model ?? DEFAULT_MODEL;
        this.baseURL = config.baseURL ?? DEFAULT_BASE_URL;
        if (config.fetchFn) {
            this.fetchFn = config.fetchFn;
        } else if (typeof fetch === 'function') {
            this.fetchFn = fetch;
        } else {
            throw new Error('CohereEmbeddingProvider requires a fetch implementation');
        }
    }

    private async requestEmbeddings(texts: string[], model: string): Promise<number[][]> {
        const client = this.client as { embed?(params: Record<string, unknown>): Promise<unknown> } | null;
        if (client?.embed) {
            const response = await client.embed({ model, texts, input_type: INPUT_TYPE });
            return extractFloats(response);
        }

        const response = await this.fetchFn(`${this.baseURL}/embed`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model, texts, input_type: INPUT_TYPE }),
        });
        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            throw new Error(`Cohere Embedding API error ${response.status}: ${bodyText}`);
        }
        return extractFloats(await response.json());
    }

    async embed(text: string, options?: { model?: string }): Promise<number[]> {
        const vectors = await this.requestEmbeddings([text], options?.model ?? this.model);
        return vectors[0] ?? [];
    }

    async embedBatch(texts: string[], options?: { model?: string }): Promise<number[][]> {
        if (texts.length === 0) return [];
        return this.requestEmbeddings(texts, options?.model ?? this.model);
    }
}
