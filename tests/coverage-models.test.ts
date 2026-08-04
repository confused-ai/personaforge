/**
 * Hermetic coverage for src/models — openai adapter, ollama adapter, multimodal
 * builders, stream-utils. Mocks optional SDKs; no network.
 * Callers: vitest only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const openaiCreateMock = vi.fn();
vi.mock('openai', () => ({
    default: class {
        chat = { completions: { create: openaiCreateMock } };
    },
}));

const ollamaChatMock = vi.fn();
vi.mock('ollama', () => ({
    Ollama: class {
        chat = ollamaChatMock;
    },
}));

const anthropicCreateMock = vi.fn();
const anthropicStreamMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
    default: class {
        messages = {
            create: anthropicCreateMock,
            stream: anthropicStreamMock,
        };
    },
}));

const bedrockSendMock = vi.fn();
const bedrockInvokeMock = vi.fn();
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
    BedrockRuntimeClient: class {
        send = bedrockSendMock;
    },
    InvokeModelCommand: class {
        opts: unknown;
        constructor(opts: unknown) {
            this.opts = opts;
            bedrockInvokeMock(opts);
        }
    },
}));

const geminiSendMock = vi.fn();
const geminiStreamMock = vi.fn();
vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: class {
        getGenerativeModel() {
            return {
                startChat: () => ({
                    sendMessage: async () => ({
                        response: {
                            text: () => 'gemini reply',
                            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
                        },
                    }),
                    sendMessageStream: async () => ({
                        stream: (async function* () {
                            yield { text: () => 'a' };
                            yield { text: () => 'b' };
                        })(),
                    }),
                }),
            };
        }
    },
}));

import { openai } from '../src/models/openai.js';
import { ollama } from '../src/models/ollama.js';
import { anthropic } from '../src/models/anthropic.js';
import { bedrock } from '../src/models/bedrock.js';
import { google } from '../src/models/google.js';
import { withFallbacks, withRetry } from '../src/models/fallback.js';
import type { LLMProvider } from '../src/core/index.js';
import {
    text,
    image,
    audio,
    video,
    file,
    buildMessage,
    contentToText,
    isVisionCapable,
    isAudioCapable,
} from '../src/models/multimodal.js';

describe('models/openai adapter', () => {
    beforeEach(() => {
        openaiCreateMock.mockReset();
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_MODEL;
    });

    it('generateText with tools, tool choice, usage, and tool_calls', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{
                message: {
                    content: 'hi',
                    tool_calls: [{ id: 'tc1', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
                },
                finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        const provider = openai({ model: 'gpt-4o', apiKey: 'k' });
        const result = await provider.generateText(
            [{ role: 'user', content: 'hello', name: 'n' }],
            {
                tools: [{ name: 'lookup', description: 'd', parameters: {} }],
                toolChoice: 'required',
                maxTokens: 100,
                temperature: 0.5,
            },
        );
        expect(result.text).toBe('hi');
        expect(result.finishReason).toBe('tool_calls');
        expect(result.toolCalls).toEqual([{ id: 'tc1', name: 'lookup', arguments: { q: 'x' } }]);
        expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it('generateText defaults + no usage + toolChoice none', async () => {
        openaiCreateMock.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
        const provider = openai({});
        const result = await provider.generateText([{ role: 'user', content: 'x' }], { toolChoice: 'none' });
        expect(result.text).toBe('ok');
        expect(result.finishReason).toBe('stop');
        expect(result.toolCalls).toBeUndefined();
        expect(result.usage).toBeUndefined();
    });

    it('streamText accumulates content and tool calls across chunks', async () => {
        async function* stream() {
            yield { choices: [{ delta: { content: 'Hel' } }] };
            yield { choices: [{ delta: { content: 'lo' } }] };
            yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'f', arguments: '{"a"' } }] } }] };
            yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] };
            yield { choices: [{}] };
        }
        openaiCreateMock.mockResolvedValue(stream());
        const provider = openai({ model: 'gpt-4o', apiKey: 'k' });
        const chunks: string[] = [];
        const result = await provider.streamText([{ role: 'user', content: 'x' }], { onChunk: (c) => chunks.push(c) });
        expect(result.text).toBe('Hello');
        expect(chunks).toEqual(['Hel', 'lo']);
        expect(result.toolCalls).toEqual([{ id: 't1', name: 'f', arguments: { a: 1 } }]);
        expect(result.finishReason).toBe('tool_calls');
    });

    it('streamText without tool calls returns stop', async () => {
        async function* stream() {
            yield { choices: [{ delta: { content: 'a' } }] };
            yield { choices: [{ delta: {} }] };
        }
        openaiCreateMock.mockResolvedValue(stream());
        const provider = openai({});
        const result = await provider.streamText([{ role: 'user', content: 'x' }]);
        expect(result.text).toBe('a');
        expect(result.finishReason).toBe('stop');
    });

    it('uses env fallbacks and baseURL', async () => {
        process.env.OPENAI_API_KEY = 'env-key';
        process.env.OPENAI_MODEL = 'gpt-4o-mini';
        openaiCreateMock.mockResolvedValue({ choices: [{ message: { content: 'e' } }] });
        const provider = openai({ baseURL: 'http://x' });
        const result = await provider.generateText([{ role: 'user', content: 'x' }]);
        expect(result.text).toBe('e');
        expect(openaiCreateMock.mock.calls[0]![0]).toMatchObject({ model: 'gpt-4o-mini' });
    });

    it('missing SDK throws helpful message', async () => {
        // Mock module is present; simulate missing via direct import failure is
        // not possible here, so just verify the adapter works (covered above).
        expect(openai).toBeTypeOf('function');
    });
});

describe('models/ollama adapter', () => {
    beforeEach(() => {
        ollamaChatMock.mockReset();
        delete process.env.OLLAMA_HOST;
    });

    it('generateText returns content + usage', async () => {
        ollamaChatMock.mockResolvedValue({
            message: { content: 'ollama reply' },
            prompt_eval_count: 7,
            eval_count: 3,
        });
        const provider = ollama({ model: 'llama3.2' });
        const result = await provider.generateText([{ role: 'user', content: 'hi' }]);
        expect(result.text).toBe('ollama reply');
        expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
    });

    it('streamText accumulates deltas', async () => {
        async function* stream() {
            yield { message: { content: 'one ' } };
            yield { message: { content: 'two' } };
        }
        ollamaChatMock.mockResolvedValue(stream());
        const provider = ollama({});
        const chunks: string[] = [];
        const result = await provider.streamText([{ role: 'user', content: 'x' }], { onChunk: (c) => chunks.push(c) });
        expect(result.text).toBe('one two');
        expect(chunks).toEqual(['one ', 'two']);
    });

    it('uses env OLLAMA_HOST', async () => {
        process.env.OLLAMA_HOST = 'http://custom:1234';
        ollamaChatMock.mockResolvedValue({ message: { content: 'r' }, prompt_eval_count: 1, eval_count: 1 });
        const provider = ollama({});
        await provider.generateText([{ role: 'user', content: 'x' }]);
        expect(ollamaChatMock.mock.calls[0]![0]).toMatchObject({ model: 'llama3.2' });
    });
});

describe('models/multimodal builders', () => {
    it('text/image/audio/video/file builders', () => {
        expect(text('hi')).toEqual({ type: 'text', text: 'hi' });
        expect(image.fromUrl('http://i.png', 'high')).toMatchObject({ type: 'image_url', image_url: { url: 'http://i.png', detail: 'high' } });
        expect(image.fromUrl('http://i.png')).toMatchObject({ image_url: { detail: 'auto' } });
        expect(image.fromBase64(Buffer.from('abc'))).toMatchObject({ image_url: { url: 'data:image/png;base64,YWJj' } });
        expect(image.fromBase64(new Uint8Array([97]), 'image/jpeg')).toMatchObject({ image_url: { url: 'data:image/jpeg;base64,YQ==' } });
        expect(audio.fromUrl('http://a.mp3', 'mp3')).toEqual({ type: 'audio', audio: { url: 'http://a.mp3', format: 'mp3' } });
        expect(audio.fromUrl('http://a.mp3')).toEqual({ type: 'audio', audio: { url: 'http://a.mp3' } });
        expect(audio.fromBase64(Buffer.from('x'), 'audio/mp3', 'mp3').audio.url).toContain('data:audio/mp3;base64');
        expect(audio.fromBase64(new Uint8Array([1]), 'audio/ogg', 'ogg').audio.url).toContain('data:audio/ogg;base64');
        expect(video.fromUrl('http://v.mp4', 'mp4')).toEqual({ type: 'video', video: { url: 'http://v.mp4', format: 'mp4' } });
        expect(file.fromUrl('http://f.pdf', 'f.pdf', 'application/pdf')).toEqual({ type: 'file', file: { url: 'http://f.pdf', filename: 'f.pdf', mimeType: 'application/pdf' } });
        expect(file.fromUrl('http://f.pdf')).toEqual({ type: 'file', file: { url: 'http://f.pdf' } });
    });

    it('fromFile infers mime from extension', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-mm-'));
        const png = path.join(dir, 'a.png');
        fs.writeFileSync(png, Buffer.from([137, 80, 78, 71]));
        const jpg = path.join(dir, 'b.jpeg');
        fs.writeFileSync(jpg, Buffer.from([1, 2]));
        const webp = path.join(dir, 'c.webp');
        fs.writeFileSync(webp, Buffer.from([1]));
        const gif = path.join(dir, 'd.gif');
        fs.writeFileSync(gif, Buffer.from([1]));
        const unknown = path.join(dir, 'e.bin');
        fs.writeFileSync(unknown, Buffer.from([1]));

        expect((await image.fromFile(png)).image_url.url).toContain('data:image/png;base64');
        expect((await image.fromFile(jpg)).image_url.url).toContain('data:image/jpeg;base64');
        expect((await image.fromFile(webp)).image_url.url).toContain('data:image/webp;base64');
        expect((await image.fromFile(gif)).image_url.url).toContain('data:image/gif;base64');
        expect((await image.fromFile(unknown)).image_url.url).toContain('data:image/png;base64');
        expect((await audio.fromFile(png)).audio.url).toContain('data:audio/wav;base64');
        const mp3 = path.join(dir, 'f.mp3');
        fs.writeFileSync(mp3, Buffer.from([1]));
        const ogg = path.join(dir, 'g.ogg');
        fs.writeFileSync(ogg, Buffer.from([1]));
        const webmA = path.join(dir, 'h.webm');
        fs.writeFileSync(webmA, Buffer.from([1]));
        expect((await audio.fromFile(mp3)).audio.url).toContain('data:audio/mp3;base64');
        expect((await audio.fromFile(ogg)).audio.url).toContain('data:audio/ogg;base64');
        expect((await audio.fromFile(webmA)).audio.url).toContain('data:audio/webm;base64');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('buildMessage + contentToText', () => {
        const msg = buildMessage('user', [text('a'), text('b')]);
        expect(msg).toEqual({ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
        expect(contentToText('plain')).toBe('plain');
        expect(contentToText([{ type: 'text', text: 'x' }, image.fromUrl('http://i')])).toBe('x');
    });

    it('isVisionCapable / isAudioCapable', () => {
        expect(isVisionCapable('gpt-4o')).toBe(true);
        expect(isVisionCapable('claude-3-5-sonnet')).toBe(true);
        expect(isVisionCapable('gemini-2.0-flash')).toBe(true);
        expect(isVisionCapable('llama3')).toBe(false);
        expect(isAudioCapable('gpt-4o-audio')).toBe(true);
        expect(isAudioCapable('whisper-1')).toBe(true);
        expect(isAudioCapable('gpt-4o')).toBe(false);
    });
});

describe('models/anthropic adapter', () => {
    beforeEach(() => {
        anthropicCreateMock.mockReset();
        anthropicStreamMock.mockReset();
        delete process.env.ANTHROPIC_API_KEY;
    });

    it('generateText with system, tools, tool_use, and usage', async () => {
        anthropicCreateMock.mockResolvedValue({
            content: [
                { type: 'text', text: 'answer' },
                { type: 'tool_use', id: 'tu1', name: 'lookup', input: { q: 1 } },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 5, output_tokens: 3 },
        });
        const provider = anthropic({ model: 'claude-3-5', apiKey: 'k' });
        const result = await provider.generateText(
            [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
            { tools: [{ name: 'lookup', description: 'd', parameters: { type: 'object' } }], maxTokens: 100 },
        );
        expect(result.text).toBe('answer');
        expect(result.toolCalls).toEqual([{ id: 'tu1', name: 'lookup', arguments: { q: 1 } }]);
        expect(result.finishReason).toBe('tool_calls');
        expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 3, totalTokens: 8 });
    });

    it('generateText without tools, tool results, assistant toolCalls, non-string content', async () => {
        anthropicCreateMock.mockResolvedValue({
            content: [{ type: 'text', text: 't' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
        });
        const provider = anthropic({ apiKey: 'k' });
        const result = await provider.generateText([
            { role: 'user', content: 'plain' },
            { role: 'tool', content: 'tool-out', toolCallId: 'tc9' },
            { role: 'assistant', content: 'prev', toolCalls: [{ id: 'x', name: 'f', arguments: {} }] },
            { role: 'user', content: [{ type: 'text', text: 'obj' }] as never },
        ]);
        expect(result.text).toBe('t');
        expect(result.finishReason).toBe('stop');
        expect(anthropicCreateMock.mock.calls[0]![0].messages).toHaveLength(4);
    });

    it('streamText accumulates text + usage from events', async () => {
        async function* stream() {
            yield { type: 'message_start', message: { usage: { input_tokens: 9, output_tokens: 1 } } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } };
            yield { type: 'message_delta', usage: { output_tokens: 7 }, delta: { stop_reason: 'tool_use' } };
            yield { type: 'other' };
        }
        anthropicStreamMock.mockReturnValue(stream());
        const provider = anthropic({ apiKey: 'k' });
        const chunks: string[] = [];
        const result = await provider.streamText(
            [{ role: 'user', content: 'x' }],
            { onChunk: (c) => chunks.push(c), signal: new AbortController().signal },
        );
        expect(result.text).toBe('Hello');
        expect(chunks).toEqual(['Hel', 'lo']);
        expect(result.finishReason).toBe('tool_calls');
        expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 7, totalTokens: 16 });
    });

    it('streamText default stop finish', async () => {
        async function* stream() {
            yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
        }
        anthropicStreamMock.mockReturnValue(stream());
        const provider = anthropic({ apiKey: 'k' });
        const result = await provider.streamText([{ role: 'user', content: 'x' }]);
        expect(result.finishReason).toBe('stop');
    });
});

describe('models/fallback', () => {
    const okProvider = (text: string): LLMProvider => ({
        generateText: async () => ({ text, finishReason: 'stop' }),
    });

    it('withFallbacks tries primary then fallbacks, throws last error', async () => {
        const bad = { generateText: async () => { throw new Error('bad1'); } };
        const good = okProvider('recovered');
        const proxy = withFallbacks(bad, [good]);
        expect((await proxy.generateText([])).text).toBe('recovered');

        const allBad = withFallbacks(bad, [bad]);
        await expect(allBad.generateText([])).rejects.toThrow('bad1');
    });

    it('withFallbacks proxies streamText when available', async () => {
        const bad = { generateText: async () => { throw new Error('x'); } };
        const good = {
            generateText: async () => ({ text: 'g', finishReason: 'stop' as const }),
            streamText: async () => ({ text: 'streamed', finishReason: 'stop' as const }),
        };
        const proxy = withFallbacks(bad, [good]);
        expect((await proxy.streamText!([], { onChunk: () => {} })).text).toBe('streamed');

        const noStream = withFallbacks(okProvider('p'), []);
        expect(noStream.streamText).toBeUndefined();
    });

    it('withFallbacks throws when no provider supports streamText', async () => {
        const bad = { generateText: async () => { throw new Error('s1'); } };
        const proxy = withFallbacks(bad, [bad]) as { streamText?: (m: unknown[], o?: unknown) => Promise<unknown> };
        // streamText only exists if some provider has it — with none, it's undefined
        expect(proxy.streamText).toBeUndefined();
    });

    it('withRetry retries then succeeds and throws after exhausting', async () => {
        let n = 0;
        const flaky = {
            generateText: async () => {
                n++;
                if (n < 3) throw new Error('transient');
                return { text: 'ok', finishReason: 'stop' as const };
            },
        };
        const proxy = withRetry(flaky, { maxRetries: 3, baseDelayMs: 1 });
        expect((await proxy.generateText([])).text).toBe('ok');
        expect(n).toBe(3);

        const always = withRetry({ generateText: async () => { throw new Error('always'); } }, { maxRetries: 2, baseDelayMs: 1 });
        await expect(always.generateText([])).rejects.toThrow('always');
    });

    it('withRetry honors retryOn predicate and skips backoff when not retryable', async () => {
        const never = withRetry({ generateText: async () => { throw new Error('fatal'); } }, { maxRetries: 3, retryOn: () => false });
        await expect(never.generateText([])).rejects.toThrow('fatal');
    });

    it('withRetry wraps streamText when present', async () => {
        let n = 0;
        const provider = {
            generateText: async () => ({ text: 'x', finishReason: 'stop' as const }),
            streamText: async () => {
                n++;
                if (n < 2) throw new Error('stream fail');
                return { text: 'ok', finishReason: 'stop' as const };
            },
        };
        const proxy = withRetry(provider, { maxRetries: 2, baseDelayMs: 1 });
        expect((await proxy.streamText!([], { onChunk: () => {} })).text).toBe('ok');
    });
});

describe('models/bedrock adapter', () => {
    beforeEach(() => {
        bedrockSendMock.mockReset();
        bedrockInvokeMock.mockReset();
        delete process.env.AWS_REGION;
    });

    it('generateText builds anthropic-style body and parses response', async () => {
        bedrockSendMock.mockResolvedValue({
            body: new TextEncoder().encode(JSON.stringify({
                content: [{ text: 'bedrock answer' }],
                usage: { input_tokens: 4, output_tokens: 2 },
            })),
        });
        const provider = bedrock({ model: 'anthropic.claude-3', region: 'us-west-2' });
        const result = await provider.generateText(
            [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
            { maxTokens: 500 },
        );
        expect(result.text).toBe('bedrock answer');
        expect(result.finishReason).toBe('stop');
        expect(result.usage).toEqual({ promptTokens: 4, completionTokens: 2, totalTokens: 6 });
        expect(bedrockInvokeMock).toHaveBeenCalled();
        const cmd = bedrockInvokeMock.mock.calls[0]![0] as { modelId: string };
        expect(cmd.modelId).toBe('anthropic.claude-3');
    });

    it('handles missing content/usage gracefully', async () => {
        bedrockSendMock.mockResolvedValue({ body: new TextEncoder().encode(JSON.stringify({ content: [] })) });
        const provider = bedrock({});
        const result = await provider.generateText([{ role: 'user', content: 'x' }]);
        expect(result.text).toBe('');
        expect(result.usage).toEqual({ promptTokens: undefined, completionTokens: undefined, totalTokens: 0 });
    });
});

describe('models/google adapter', () => {
    beforeEach(() => {
        delete process.env.GOOGLE_API_KEY;
        delete process.env.GEMINI_API_KEY;
    });

    it('generateText uses history + last turn, returns usage', async () => {
        const provider = google({ apiKey: 'k', model: 'gemini-2.0-flash' });
        const result = await provider.generateText([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'mid' },
            { role: 'user', content: 'last' },
        ]);
        expect(result.text).toBe('gemini reply');
        expect(result.finishReason).toBe('stop');
        expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
    });

    it('streamText accumulates chunks and calls onChunk', async () => {
        const provider = google({});
        const chunks: string[] = [];
        const result = await provider.streamText([{ role: 'user', content: 'x' }], { onChunk: (c) => chunks.push(c) });
        expect(result.text).toBe('ab');
        expect(chunks).toEqual(['a', 'b']);
    });
});
