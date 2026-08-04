/**
 * Hermetic coverage for src/providers — OpenAIProvider, AnthropicProvider,
 * GoogleProvider with injected mock clients. No network, no SDKs.
 * Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai-provider.js';
import { AnthropicProvider } from '../src/providers/anthropic-provider.js';
import { GoogleProvider } from '../src/providers/google-provider.js';
import type { Message } from '../src/providers/types.js';

// ── OpenAIProvider ──────────────────────────────────────────────────────────

describe('providers/OpenAIProvider', () => {
    it('constructor throws without apiKey or baseURL', () => {
        const saved = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_BASE_URL;
        expect(() => new OpenAIProvider({ model: 'gpt-4o' })).toThrow(/requires apiKey/);
        if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    });

    it('generateText maps messages, tools, tool calls, usage', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{
                message: {
                    content: 'answer',
                    tool_calls: [{ id: 't1', function: { name: 'f', arguments: '{"a":1}' } }],
                },
                finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        const provider = new OpenAIProvider({ client: { chat: { completions: { create } } } as never, model: 'gpt-4o' });
        const result = await provider.generateText(
            [
                { role: 'system', content: 'sys' },
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'prev', toolCalls: [{ id: 'x', name: 'f', arguments: {} }] },
                { role: 'tool', content: 'out', toolCallId: 'x' },
            ],
            { tools: [{ name: 'f', description: 'd', parameters: {} }], toolChoice: 'auto', temperature: 0.2, maxTokens: 50, stop: ['END'] },
        );
        expect(result.text).toBe('answer');
        expect(result.toolCalls).toEqual([{ id: 't1', name: 'f', arguments: { a: 1 } }]);
        expect(result.finishReason).toBe('tool_calls');
        expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
        const body = create.mock.calls[0]![0];
        expect(body.temperature).toBe(0.2);
        expect(body.tools).toHaveLength(1);
        expect(body.messages).toHaveLength(4);
    });

    it('generateText empty response + bad tool JSON + rethrow with status', async () => {
        const create = vi.fn().mockResolvedValue({});
        const provider = new OpenAIProvider({ client: { chat: { completions: { create } } } as never });
        const result = await provider.generateText([{ role: 'user', content: 'x' }]);
        expect(result.text).toBe('');
        expect(result.finishReason).toBeUndefined();

        const errCreate = vi.fn().mockRejectedValue({ response: { status: 429, headers: {} } });
        const p2 = new OpenAIProvider({ client: { chat: { completions: { create: errCreate } } } as never });
        await expect(p2.generateText([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ status: 429 });
    });

    it('streamText accumulates content + tool calls + usage + abort signal', async () => {
        async function* stream() {
            yield { choices: [{ delta: { content: 'Hi' } }] };
            yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'f', arguments: '{"x"' } }] } }] };
            yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':2}' } }] } }] };
            yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
            yield { choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } };
        }
        const create = vi.fn().mockResolvedValue(stream());
        const provider = new OpenAIProvider({ client: { chat: { completions: { create } } } as never });
        const chunks: string[] = [];
        const result = await provider.streamText([{ role: 'user', content: 'x' }], {
            onChunk: (c) => chunks.push(c),
            signal: new AbortController().signal,
        });
        expect(result.text).toBe('Hi');
        expect(chunks).toEqual(['Hi']);
        expect(result.toolCalls).toEqual([{ id: 't1', name: 'f', arguments: { x: 2 } }]);
        expect(result.finishReason).toBe('tool_calls');
        expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
    });

    it('streamText with malformed tool args returns {}', async () => {
        async function* stream() {
            yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'f', arguments: 'not-json' } }] } }] };
        }
        const create = vi.fn().mockResolvedValue(stream());
        const provider = new OpenAIProvider({ client: { chat: { completions: { create } } } as never });
        const result = await provider.streamText([{ role: 'user', content: 'x' }]);
        expect(result.toolCalls).toEqual([{ id: 't1', name: 'f', arguments: {} }]);
    });
});

// ── AnthropicProvider ───────────────────────────────────────────────────────

describe('providers/AnthropicProvider', () => {
    it('constructor throws without apiKey/client', () => {
        const saved = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        expect(() => new AnthropicProvider({})).toThrow(/requires apiKey/);
        if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    });

    it('generateText maps system/tools/tool_use/usage', async () => {
        const create = vi.fn().mockResolvedValue({
            content: [
                { type: 'text', text: 'claude answer' },
                { type: 'tool_use', id: 'tu1', name: 'f', input: { a: 1 } },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 6, output_tokens: 4 },
        });
        const provider = new AnthropicProvider({ client: { messages: { create } } as never, model: 'claude-3-5-sonnet' });
        const result = await provider.generateText(
            [
                { role: 'system', content: 'sys' },
                { role: 'user', content: 'hi' },
            ],
            { tools: [{ name: 'f', description: 'd', parameters: {} }], maxTokens: 100 },
        );
        expect(result.text).toBe('claude answer');
        expect(result.toolCalls).toEqual([{ id: 'tu1', name: 'f', arguments: { a: 1 } }]);
        expect(result.finishReason).toBe('tool_calls');
        expect(result.usage).toEqual({ promptTokens: 6, completionTokens: 4, totalTokens: 10 });
    });

    it('generateText with tool results + assistant toolCalls + multimodal user content', async () => {
        const create = vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
        });
        const provider = new AnthropicProvider({ client: { messages: { create } } as never });
        await provider.generateText([
            { role: 'tool', content: 'tool-out', toolCallId: 'tc1' },
            { role: 'assistant', content: 'prev', toolCalls: [{ id: 'x', name: 'f', arguments: {} }] },
            { role: 'user', content: [{ type: 'text', text: 't' }, { type: 'image_url', image_url: { url: 'http://i' } }] as never },
        ]);
        const body = create.mock.calls[0]![0];
        expect(body.messages).toHaveLength(3);
        expect(body.messages[0].content[0].type).toBe('tool_result');
    });

    it('streamText accumulates text + usage from events', async () => {
        async function* gen() {
            yield { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } }, usage: { input_tokens: 5, output_tokens: 1 } };
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } };
            yield { type: 'message_delta', usage: { input_tokens: 5, output_tokens: 9 }, delta: { stop_reason: 'end_turn' } };
        }
        // create() returns a Promise that resolves to an async-iterable of
        // stream events; .catch() on the promise yields the same iterable.
        const iterable = { [Symbol.asyncIterator]: gen };
        const create = vi.fn().mockResolvedValue(iterable);
        const provider = new AnthropicProvider({ client: { messages: { create } } as never });
        const result = await provider.streamText([{ role: 'user', content: 'x' }], { onChunk: () => {} });
        expect(result.text).toBe('a');
        expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 9, totalTokens: 14 });
    });
});

// ── GoogleProvider ──────────────────────────────────────────────────────────

describe('providers/GoogleProvider', () => {
    it('constructor throws without apiKey/client', () => {
        const saved = process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.GEMINI_API_KEY;
        expect(() => new GoogleProvider({})).toThrow(/apiKey|client/);
        if (saved !== undefined) process.env.GOOGLE_API_KEY = saved;
    });

    it('generateText returns text + usage from injected client', async () => {
        const generateContent = vi.fn().mockResolvedValue({
            response: {
                text: () => 'gemini ok',
                usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
                candidates: [{ finishReason: 'STOP' }],
            },
        });
        const client = {
            getGenerativeModel: vi.fn().mockReturnValue({ generateContent, generateContentStream: vi.fn() }),
        };
        const provider = new GoogleProvider({ client: client as never, model: 'gemini-2.0-flash' });
        const result = await provider.generateText([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hi' },
            { role: 'tool', content: 'out', toolCallId: 't1', toolName: 'fn' },
            { role: 'assistant', content: 'prev', toolCalls: [{ id: 'x', name: 'f', arguments: {} }] },
        ]);
        expect(result.text).toBe('gemini ok');
        expect(result.finishReason).toBe('stop');
        expect(result.usage).toEqual({ promptTokens: 2, completionTokens: 3, totalTokens: 5 });
    });

    it('generateText extracts tool calls from candidates', async () => {
        const generateContent = vi.fn().mockResolvedValue({
            response: {
                text: () => 'with tools',
                candidates: [{
                    finishReason: 'STOP',
                    content: { parts: [{ functionCall: { name: 'fn', args: { a: 1 } } }] },
                }],
            },
        });
        const client = { getGenerativeModel: vi.fn().mockReturnValue({ generateContent, generateContentStream: vi.fn() }) };
        const provider = new GoogleProvider({ client: client as never });
        const result = await provider.generateText(
            [{ role: 'user', content: 'hi' }],
            { tools: [{ name: 'fn', description: 'd', parameters: {} }] },
        );
        expect(result.toolCalls?.[0]).toMatchObject({ name: 'fn', arguments: { a: 1 } });
    });

    it('streamText accumulates chunks', async () => {
        async function* stream() {
            yield { text: () => 'x', candidates: [{ finishReason: null }] };
            yield { text: () => 'y', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } };
        }
        const generateContentStream = vi.fn().mockResolvedValue({ stream: stream() });
        const client = {
            getGenerativeModel: vi.fn().mockReturnValue({ generateContent: vi.fn(), generateContentStream }),
        };
        const provider = new GoogleProvider({ client: client as never });
        const chunks: string[] = [];
        const result = await provider.streamText([{ role: 'user', content: 'hi' }], { onChunk: (c) => chunks.push(c) });
        expect(result.text).toBe('xy');
        expect(chunks).toEqual(['x', 'y']);
        expect(result.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    });
});
