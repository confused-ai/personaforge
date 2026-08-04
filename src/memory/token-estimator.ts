/**
 * @personaforge/memory — token estimation + zero-config deterministic embedder.
 *
 * Observational memory triggers on token counts without calling a tokenizer;
 * this module provides a fast, local estimator (~chars/4, the standard English
 * rule of thumb) with pluggable override. It also ships {@link HashingEmbedder},
 * a dependency-free deterministic embedder so semantic recall works with just
 * `semanticRecall: true` and no API key — swap in a real embedding provider
 * (e.g. `OpenAIEmbeddingProvider`) for production-grade similarity.
 */

export type TokenEstimator = (text: string) => number;

/** ~4 chars/token English heuristic. Override via `options.tokenEstimator`. */
export const estimateTokenCount: TokenEstimator = (text: string) => {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
};

/** Per-message protocol overhead counted by most tokenizers. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** Estimate tokens for a message's content (string or parts). */
export function estimateMessageTokens(content: unknown, estimator: TokenEstimator = estimateTokenCount): number {
    if (content == null) return 0;
    if (typeof content === 'string') return estimator(content) + MESSAGE_OVERHEAD_TOKENS;
    if (Array.isArray(content)) {
        let total = 0;
        for (const part of content) {
            if (typeof part === 'string') {
                total += estimator(part);
            } else if (part && typeof part === 'object') {
                const p = part as { type?: string; text?: unknown };
                if (p.type === 'text' && typeof p.text === 'string') total += estimator(p.text);
                else if (p.type === 'text' && Array.isArray((part as { content?: unknown[] }).content)) {
                    for (const block of (part as { content: unknown[] }).content) {
                        const b = block as { type?: string; text?: unknown };
                        if (b.type === 'text' && typeof b.text === 'string') total += estimator(b.text);
                    }
                } else if (p.type) {
                    // image / file / audio / video parts — fixed cost, provider-aware in Mastra
                    total += p.type === 'image' ? 85 : p.type === 'file' ? 40 : 20;
                }
            }
        }
        return total + MESSAGE_OVERHEAD_TOKENS;
    }
    return MESSAGE_OVERHEAD_TOKENS;
}

/** Estimate tokens for a full conversation (sum of message estimates). */
export function estimateConversationTokens(
    messages: readonly { role: string; content?: unknown }[],
    estimator: TokenEstimator = estimateTokenCount,
): number {
    let total = 0;
    for (const message of messages) total += estimateMessageTokens(message.content, estimator);
    return total;
}

/** Estimate tokens for one line of observation notes. */
export function estimateObservationTokens(
    lines: readonly (string | undefined)[],
    estimator: TokenEstimator = estimateTokenCount,
): number {
    let total = 0;
    for (const line of lines) if (line) total += estimator(line) + 1;
    return total;
}

/**
 * Deterministic hashing embedder — zero-config semantic recall.
 *
 * Produces a sparse bag-of-words style vector via hashing. Works offline and
 * improves with dimension (default 384). Not as accurate as a model embedder;
 * pass a real `EmbeddingProvider` for production.
 */
export class HashingEmbedder {
    readonly isHashing = true;
    private readonly dimension: number;

    constructor(dimension = 384) {
        this.dimension = dimension;
    }

    async embed(text: string): Promise<number[]> {
        return this._embedOne(text);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        return texts.map((t) => this._embedOne(t));
    }

    getDimension(): number {
        return this.dimension;
    }

    private _embedOne(text: string): number[] {
        const vector = new Array<number>(this.dimension).fill(0);
        const tokens = this._tokens(text);
        // tf-weighted hashed bag of words (unigram + bigram)
        for (const token of tokens) {
            const { index, sign } = hashIndex(token, this.dimension);
            vector[index] += sign;
        }
        let norm = 0;
        for (let i = 0; i < this.dimension; i++) norm += vector[i] * vector[i];
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < this.dimension; i++) vector[i] /= norm;
        return vector;
    }

    private _tokens(text: string): string[] {
        const lower = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        const words = lower.split(/\s+/).filter(Boolean);
        const tokens: string[] = [...words];
        for (let i = 0; i < words.length - 1; i++) tokens.push(`${words[i]}_${words[i + 1]}`);
        return tokens;
    }
}

function hashIndex(token: string, dimension: number): { index: number; sign: number } {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    const index = ((h % dimension) + dimension) % dimension;
    const sign = h < 0 ? -1 : 1;
    return { index, sign };
}

/** True when the embedder is the deterministic fallback (affects recall guidance). */
export function isHashingEmbedder(embedder: unknown): boolean {
    return !!embedder && typeof embedder === 'object' && (embedder as { isHashing?: boolean }).isHashing === true;
}
