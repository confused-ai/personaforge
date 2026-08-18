/**
 * Provider-neutral embedding contract — the minimal surface every embedding
 * adapter (OpenAI, Google Gemini, Cohere, ...) must satisfy so RAG / semantic
 * memory can be powered by any provider, not just OpenAI.
 */
export interface EmbeddingProvider {
    /**
     * Generate an embedding vector for a single text.
     */
    embed(text: string, options?: { model?: string }): Promise<number[]>;

    /**
     * Generate embedding vectors for multiple texts (batch API where available).
     */
    embedBatch(texts: string[], options?: { model?: string }): Promise<number[][]>;
}
