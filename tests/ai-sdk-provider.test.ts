
import { describe, it, expect } from 'vitest';
import { createAiSdkProvider } from '../src/providers/ai-sdk-provider.js';
import type { Message } from '../src/core/types.js';

// ── Test utilities ─────────────────────────────────────────────────────────

function mockMessages(text = 'Hi'): Message[] {
    return [{ role: 'user', content: text }];
}

/**
 * Create a mock AI SDK LanguageModelV1 for testing.
 * Pass `doGenerate` to control the generation result.
 */
function mockModel(doGenerate?: (opts: any) => any, doStream?: (opts: any) => any) {
    return {
        modelId: 'gpt-4o-mock',
        provider: 'openai',
        doGenerate: doGenerate ?? (async () => ({
            text: 'Hello from AI SDK!',
            toolCalls: [],
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 5 },
        })),
        doStream: doStream ?? (async () => ({
            stream: new ReadableStream({
                async start(controller: any) {
                    controller.enqueue({ type: 'text-delta', textDelta: 'Hello ' });
                    controller.enqueue({ type: 'text-delta', textDelta: 'from AI SDK!' });
                    controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } });
                    controller.close();
                },
            }),
            rawCall: { rawPrompt: [], rawSettings: {} },
        })),
    };
}

describe('createAiSdkProvider', () => {
    it('wraps a model into an LLMProvider with name', () => {
        const provider = createAiSdkProvider(mockModel());
        expect(provider).toBeDefined();
        expect(typeof provider.generateText).toBe('function');
        expect(typeof provider.streamText).toBe('function');
        expect((provider as any).name).toBe('openai:gpt-4o-mock');
    });

    it('generateText returns text from the AI SDK model', async () => {
        const provider = createAiSdkProvider(mockModel());
        const result = await provider.generateText(mockMessages());
        expect(result.text).toBe('Hello from AI SDK!');
        expect(result.finishReason).toBe('stop');
        expect(result.usage?.promptTokens).toBe(10);
        expect(result.usage?.completionTokens).toBe(5);
        expect(result.usage?.totalTokens).toBe(15);
    });

    it('generateText passes options (maxTokens, temperature, stop)', async () => {
        let capturedOpts: any = null;
        const provider = createAiSdkProvider(mockModel(async (opts: any) => {
            capturedOpts = opts;
            return { text: '', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } };
        }));
        await provider.generateText(mockMessages(), {
            maxTokens: 100,
            temperature: 0.5,
            stop: ['\n'],
        });
        expect(capturedOpts).not.toBeNull();
        expect(capturedOpts.maxTokens).toBe(100);
        expect(capturedOpts.temperature).toBe(0.5);
        expect(capturedOpts.stopSequences).toEqual(['\n']);
    });

    it('streamText collects chunks into a complete result', async () => {
        const provider = createAiSdkProvider(mockModel());
        const result = await provider.streamText!(mockMessages());
        expect(result.text).toBe('Hello from AI SDK!');
        expect(result.finishReason).toBe('stop');
        expect(result.usage?.totalTokens).toBe(15);
    });

    it('streamText invokes onChunk callback with each text delta', async () => {
        const provider = createAiSdkProvider(mockModel());
        const chunks: string[] = [];
        await provider.streamText!(mockMessages(), {
            onChunk: (chunk: string) => chunks.push(chunk),
        });
        expect(chunks).toEqual(['Hello ', 'from AI SDK!']);
    });

    it('handles tool calls in generateText', async () => {
        const provider = createAiSdkProvider(mockModel(async () => ({
            text: '',
            toolCalls: [{
                toolCallId: 'call_1',
                toolName: 'get_weather',
                args: { location: 'NYC' },
            }],
            finishReason: 'tool-calls',
            usage: { promptTokens: 5, completionTokens: 3 },
        })));
        const result = await provider.generateText(mockMessages());
        expect(result.finishReason).toBe('tool_calls');
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls![0]!.name).toBe('get_weather');
        expect(result.toolCalls![0]!.arguments).toEqual({ location: 'NYC' });
    });

    it('passes tools and toolChoice to the AI SDK model', async () => {
        let capturedOpts: any = null;
        const provider = createAiSdkProvider(mockModel(async (opts: any) => {
            capturedOpts = opts;
            return { text: '', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } };
        }));
        await provider.generateText(mockMessages(), {
            tools: [
                { name: 'search', description: 'Search', parameters: { type: 'object', properties: {} } },
            ],
            toolChoice: 'auto',
        });
        expect(capturedOpts).not.toBeNull();
        expect(capturedOpts.mode.tools).toBeDefined();
        expect(capturedOpts.mode.tools['search']).toBeDefined();
        expect(capturedOpts.mode.toolChoice).toBe('auto');
    });

    it('maps finishReason: length → max_tokens', async () => {
        const provider = createAiSdkProvider(mockModel(async () => ({
            text: 'too long',
            toolCalls: [],
            finishReason: 'length',
            usage: { promptTokens: 100, completionTokens: 200 },
        })));
        const result = await provider.generateText(mockMessages());
        expect(result.finishReason).toBe('max_tokens');
    });

    it('maps finishReason: error → error', async () => {
        const provider = createAiSdkProvider(mockModel(async () => ({
            text: '',
            toolCalls: [],
            finishReason: 'error',
            usage: { promptTokens: 0, completionTokens: 0 },
        })));
        const result = await provider.generateText(mockMessages());
        expect(result.finishReason).toBe('error');
    });

    it('maps finishReason: content-filter → error', async () => {
        const provider = createAiSdkProvider(mockModel(async () => ({
            text: '',
            toolCalls: [],
            finishReason: 'content-filter',
            usage: { promptTokens: 0, completionTokens: 0 },
        })));
        const result = await provider.generateText(mockMessages());
        expect(result.finishReason).toBe('error');
    });

    it('passes abortSignal to the AI SDK', async () => {
        const ac = new AbortController();
        let capturedOpts: any = null;
        const provider = createAiSdkProvider(mockModel(async (opts: any) => {
            capturedOpts = opts;
            return { text: '', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } };
        }));
        await provider.generateText(mockMessages(), { signal: ac.signal });
        expect(capturedOpts).not.toBeNull();
        expect(capturedOpts.abortSignal).toBe(ac.signal);
    });

    it('accepts modelId override', () => {
        const provider = createAiSdkProvider(mockModel(), { modelId: 'custom-model' });
        expect((provider as any).name).toBe('openai:custom-model');
    });
});
