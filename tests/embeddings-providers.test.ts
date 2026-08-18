import { describe, it, expect, vi } from 'vitest';
import { OpenAIEmbeddingProvider } from '../src/providers/openai-embedding-provider.js';
import { GoogleEmbeddingProvider } from '../src/providers/google-embedding-provider.js';
import { CohereEmbeddingProvider } from '../src/providers/cohere-embedding-provider.js';
import type { EmbeddingProvider } from '../src/providers/types-embedding.js';

function withoutEnv(...names: string[]) {
    const snapshot = new Map<string, string | undefined>();
    for (const name of names) {
        snapshot.set(name, process.env[name]);
        delete process.env[name];
    }
    return () => {
        for (const name of names) process.env[name] = snapshot.get(name);
    };
}

describe('OpenAIEmbeddingProvider', () => {
    it('shape-satisfies EmbeddingProvider and delegates to the injected client', async () => {
        const client = {
            embeddings: {
                create: vi.fn(async ({ input }: { input: string | string[] }) => {
                    if (Array.isArray(input)) {
                        return {
                            data: input.map((_, i) => ({ embedding: [i, 1], index: i })),
                            model: 'text-embedding-3-small',
                            usage: { prompt_tokens: 1, total_tokens: 1 },
                        };
                    }
                    return {
                        data: [{ embedding: [0.1, 0.2] }],
                        model: 'text-embedding-3-small',
                        usage: { prompt_tokens: 1, total_tokens: 1 },
                    };
                }),
            },
        };
        const provider: EmbeddingProvider = new OpenAIEmbeddingProvider({
            client: client as any,
            model: 'text-embedding-3-small',
        });

        await expect(provider.embed('hi')).resolves.toEqual([0.1, 0.2]);
        expect(client.embeddings.create).toHaveBeenCalledWith({ model: 'text-embedding-3-small', input: 'hi' });

        await expect(provider.embedBatch(['a', 'b'])).resolves.toEqual([
            [0, 1],
            [1, 1],
        ]);
    });
});

describe('GoogleEmbeddingProvider', () => {
    it('embed returns the vector from the injected client at the default model', async () => {
        const embedContents = vi.fn(async () => ({
            embeddings: [{ values: [0.1, 0.2, 0.3] }],
        }));
        const getEmbeddingModel = vi.fn(() => ({ embedContents }));
        const provider = new GoogleEmbeddingProvider({ client: { getEmbeddingModel } as any });

        await expect(provider.embed('hello')).resolves.toEqual([0.1, 0.2, 0.3]);
        expect(getEmbeddingModel).toHaveBeenCalledWith('text-embedding-004');
        expect(embedContents).toHaveBeenCalledWith({
            contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
            taskType: 'RETRIEVAL_DOCUMENT',
        });
    });

    it('embedBatch maps each embeddings entry to a vector', async () => {
        const embedContents = vi.fn(async () => ({
            embeddings: [
                { values: [1, 2] },
                { values: [3, 4] },
            ],
        }));
        const provider = new GoogleEmbeddingProvider({
            client: { getEmbeddingModel: () => ({ embedContents }) } as any,
        });

        await expect(provider.embedBatch(['a', 'b'])).resolves.toEqual([
            [1, 2],
            [3, 4],
        ]);
    });

    it('honors per-call model override', async () => {
        const embedContents = vi.fn(async () => ({ embeddings: [{ values: [9] }] }));
        const getEmbeddingModel = vi.fn(() => ({ embedContents }));
        const provider = new GoogleEmbeddingProvider({ client: { getEmbeddingModel } as any });

        await provider.embed('x', { model: 'text-embedding-005' });
        expect(getEmbeddingModel).toHaveBeenCalledWith('text-embedding-005');
    });

    it('throws exact error when no apiKey and no client', () => {
        const restore = withoutEnv('GOOGLE_API_KEY', 'GEMINI_API_KEY');
        try {
            expect(() => new GoogleEmbeddingProvider({})).toThrow(
                'GoogleEmbeddingProvider requires apiKey or GOOGLE_API_KEY / GEMINI_API_KEY env var',
            );
        } finally {
            restore();
        }
    });
});

describe('CohereEmbeddingProvider', () => {
    it('embed sends the right request and returns the parsed vector', async () => {
        const fetchFn = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({ embeddings: { floats: [[0.1, 0.2]] } }),
        } as never));
        const provider = new CohereEmbeddingProvider({ apiKey: 'test-key', fetchFn: fetchFn as any });

        await expect(provider.embed('hi')).resolves.toEqual([0.1, 0.2]);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(fetchFn).toHaveBeenCalledWith(
            'https://api.cohere.com/v2/embed',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer test-key',
                }),
                body: JSON.stringify({
                    model: 'embed-english-v3.0',
                    texts: ['hi'],
                    input_type: 'search_document',
                }),
            }),
        );
    });

    it('embedBatch returns an array of vectors', async () => {
        const fetchFn = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({ embeddings: { floats: [[0.1, 0.2], [0.3, 0.4]] } }),
        } as never));
        const provider = new CohereEmbeddingProvider({ apiKey: 'test-key', fetchFn: fetchFn as any });

        await expect(provider.embedBatch(['a', 'b'])).resolves.toEqual([
            [0.1, 0.2],
            [0.3, 0.4],
        ]);
        expect(fetchFn).toHaveBeenCalledWith(
            'https://api.cohere.com/v2/embed',
            expect.objectContaining({
                body: JSON.stringify({
                    model: 'embed-english-v3.0',
                    texts: ['a', 'b'],
                    input_type: 'search_document',
                }),
            }),
        );
    });

    it('honors per-call model override', async () => {
        const fetchFn = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({ embeddings: { floats: [[1]] } }),
        } as never));
        const provider = new CohereEmbeddingProvider({ apiKey: 'test-key', fetchFn: fetchFn as any });

        await provider.embed('x', { model: 'embed-english-v3.1' });
        expect(fetchFn).toHaveBeenCalledWith(
            'https://api.cohere.com/v2/embed',
            expect.objectContaining({
                body: JSON.stringify({
                    model: 'embed-english-v3.1',
                    texts: ['x'],
                    input_type: 'search_document',
                }),
            }),
        );
    });

    it('throws exact error when no apiKey and no client', () => {
        const restore = withoutEnv('COHERE_API_KEY');
        try {
            expect(() => new CohereEmbeddingProvider({})).toThrow(
                'CohereEmbeddingProvider requires apiKey (or COHERE_API_KEY)',
            );
        } finally {
            restore();
        }
    });
});
