/**
 * Google Gemini embedding provider.
 * Requires: npm install @google/generative-ai
 *
 * Adapter for the provider-neutral `EmbeddingProvider` contract
 * (see types-embedding.js) — powers RAG / semantic memory on Gemini.
 */

import type { EmbeddingProvider } from './types-embedding.js';
import { createRequire } from 'node:module';
// ESM-safe require: tsup's ESM bundle turns bare require() into a shim that
// throws "Dynamic require not supported". createRequire restores sync peer-dep loading.
const _require = createRequire(import.meta.url);

// ── Minimal client contract ────────────────────────────────────────────────
// The embedding surface of the Google SDK has churned across versions (e.g.
// @google/generative-ai v0.24.x no longer exposes getEmbeddingModel on
// GoogleGenerativeAI — embeddings moved to @google/genai / GoogleGenAI).
// To stay robust and testable offline we keep the client contract deliberately
// minimal: any object exposing
//
//   client.getEmbeddingModel(model).embedContents({ contents, taskType })
//     -> Promise<{ embeddings?: Array<{ values?: number[] }> }>
//
// is accepted. This covers a mock in tests, a future GoogleGenAI wrapper, or
// any SDK build that exposes that surface. This shape is NOT integration-tested
// against a live Google SDK — callers constructing a raw client must adapt.
interface GoogleEmbeddingModel {
    embedContents(request: {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
        taskType?: string;
    }): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
}

interface GoogleEmbeddingClient {
    getEmbeddingModel(model: string): GoogleEmbeddingModel;
}

export interface GoogleEmbeddingProviderConfig {
    /** Google API key (falls back to GOOGLE_API_KEY / GEMINI_API_KEY env vars) */
    apiKey?: string;
    /** Pre-built client exposing getEmbeddingModel(model) (see contract above) */
    client?: GoogleEmbeddingClient;
    /** Embedding model name (default: text-embedding-004) */
    model?: string;
}

const DEFAULT_MODEL = 'text-embedding-004';
const EMBEDDING_TASK_TYPE = 'RETRIEVAL_DOCUMENT';

/**
 * Defensively extract a number[] embedding vector from an API response entry.
 * Never throws on extraction — falls back to an empty array for unknown shapes.
 */
function extractEmbedding(response: unknown): number[] {
    if (!response || typeof response !== 'object') return [];
    const r = response as Record<string, unknown>;

    // Direct: a bare entry ({ values: [...] } / { embedding: [...] }).
    for (const key of ['values', 'embedding']) {
        const maybeVector = r[key];
        if (Array.isArray(maybeVector) && maybeVector.every((v: unknown) => typeof v === 'number')) {
            return maybeVector as number[];
        }
    }

    // Primary: response.embeddings[i].values (or .embedding).
    const embeddings = r['embeddings'];
    if (Array.isArray(embeddings) && embeddings.length > 0 && embeddings[0] && typeof embeddings[0] === 'object') {
        const first = embeddings[0] as Record<string, unknown>;
        for (const key of ['values', 'embedding']) {
            const maybeVector = first[key];
            if (Array.isArray(maybeVector) && maybeVector.every((v: unknown) => typeof v === 'number')) {
                return maybeVector as number[];
            }
        }
    }

    // Fallback: candidates[0].content.parts[*].{values|embedding}.
    const candidates = r['candidates'];
    if (Array.isArray(candidates) && candidates.length > 0 && candidates[0] && typeof candidates[0] === 'object') {
        const content = (candidates[0] as Record<string, unknown>)['content'] as Record<string, unknown> | undefined;
        const parts = content?.['parts'];
        if (Array.isArray(parts)) {
            for (const part of parts) {
                const partObj = part as Record<string, unknown>;
                for (const key of ['values', 'embedding']) {
                    const maybeVector = partObj[key];
                    if (Array.isArray(maybeVector) && maybeVector.every((v: unknown) => typeof v === 'number')) {
                        return maybeVector as number[];
                    }
                }
            }
        }
    }

    return [];
}

/**
 * Google Gemini embedding provider for RAG and semantic memory.
 */
export class GoogleEmbeddingProvider implements EmbeddingProvider {
    private client: GoogleEmbeddingClient | null = null;
    private readonly clientOpts: { apiKey: string } | null = null;
    private readonly defaultModel: string;

    constructor(config: GoogleEmbeddingProviderConfig = {}) {
        if (config.client) {
            this.client = config.client;
        } else {
            const apiKey = config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
            if (!apiKey) {
                throw new Error('GoogleEmbeddingProvider requires apiKey or GOOGLE_API_KEY / GEMINI_API_KEY env var');
            }
            this.clientOpts = { apiKey };
        }
        this.defaultModel = config.model ?? DEFAULT_MODEL;
    }

    private getClient(): GoogleEmbeddingClient {
        if (this.client) return this.client;
        if (!this.clientOpts) {
            throw new Error('GoogleEmbeddingProvider requires apiKey or GOOGLE_API_KEY / GEMINI_API_KEY env var');
        }
        // Defer requiring the optional `@google/generative-ai` peer until first use
        // so construction with an injected client works when the peer is absent.
        let GoogleGenerativeAI: new (opts: { apiKey: string }) => GoogleEmbeddingClient;
        try {
            ({ GoogleGenerativeAI } = _require('@google/generative-ai') as {
                GoogleGenerativeAI: new (opts: { apiKey: string }) => GoogleEmbeddingClient;
            });
        } catch {
            throw new Error(
                'GoogleEmbeddingProvider requires the @google/generative-ai package.\n' +
                    '  Install: npm install @google/generative-ai',
            );
        }
        this.client = new GoogleGenerativeAI(this.clientOpts);
        return this.client;
    }

    private async embedContents(texts: string[], model: string): Promise<number[][]> {
        const embeddingModel = this.getClient().getEmbeddingModel(model);
        const response = await embeddingModel.embedContents({
            contents: texts.map(text => ({ role: 'user', parts: [{ text }] })),
            taskType: EMBEDDING_TASK_TYPE,
        });
        const embeddings = response?.embeddings;
        if (Array.isArray(embeddings)) {
            return embeddings.map(entry => extractEmbedding(entry));
        }
        // Defensive fallback: a single embedding object (or candidate shape) per text.
        return texts.map(() => extractEmbedding(response));
    }

    async embed(text: string, options?: { model?: string }): Promise<number[]> {
        const vectors = await this.embedContents([text], options?.model ?? this.defaultModel);
        return vectors[0] ?? [];
    }

    async embedBatch(texts: string[], options?: { model?: string }): Promise<number[][]> {
        if (texts.length === 0) return [];
        return this.embedContents(texts, options?.model ?? this.defaultModel);
    }
}
