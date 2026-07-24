/**
 * Tests for personaforge/models pure utilities:
 *   - multimodal content builders (text, buildMessage, contentToText, capability checks)
 *   - withFallbacks / withRetry provider wrappers
 *   - streamToText / streamToChunks
 */

import { describe, it, expect } from 'vitest';
import { text, buildMessage, contentToText, isVisionCapable, isAudioCapable } from '../src/models/multimodal.js';
import { withFallbacks, withRetry } from '../src/models/fallback.js';
import { streamToText, streamToChunks } from '../src/models/stream-utils.js';
import type { LLMProvider, GenerateResult, StreamDelta } from '../src/core/index.js';

describe('multimodal builders', () => {
    it('text() builds a text content part', () => {
        expect(text('hi')).toEqual({ type: 'text', text: 'hi' });
    });

    it('buildMessage() wraps parts into a message', () => {
        const m = buildMessage('user', [text('a'), text('b')]);
        expect(m.role).toBe('user');
        expect(Array.isArray(m.content)).toBe(true);
    });

    it('contentToText() flattens a string or content array', () => {
        expect(contentToText('plain')).toBe('plain');
        expect(contentToText([text('one'), text('two')])).toBe('one\ntwo');
    });

    it('isVisionCapable() recognises vision models', () => {
        expect(isVisionCapable('gpt-4o')).toBe(true);
        expect(isVisionCapable('claude-3-opus')).toBe(true);
        expect(isVisionCapable('text-embedding-ada-002')).toBe(false);
    });

    it('isAudioCapable() recognises audio models', () => {
        expect(isAudioCapable('gpt-4o-audio-preview')).toBe(true);
        expect(isAudioCapable('whisper-1')).toBe(true);
        expect(isAudioCapable('gpt-3.5-turbo')).toBe(false);
    });
});

function provider(fn: () => Promise<GenerateResult>): LLMProvider {
    return { generateText: fn } as unknown as LLMProvider;
}

describe('withFallbacks', () => {
    it('uses the primary provider when it succeeds', async () => {
        const p = withFallbacks(
            provider(async () => ({ text: 'primary', finishReason: 'stop' })),
            [provider(async () => ({ text: 'backup', finishReason: 'stop' }))],
        );
        const r = await p.generateText([], {});
        expect(r.text).toBe('primary');
    });

    it('falls through to a backup when the primary throws', async () => {
        const p = withFallbacks(
            provider(async () => { throw new Error('primary down'); }),
            [provider(async () => ({ text: 'backup', finishReason: 'stop' }))],
        );
        const r = await p.generateText([], {});
        expect(r.text).toBe('backup');
    });

    it('throws when every provider fails', async () => {
        const p = withFallbacks(
            provider(async () => { throw new Error('a'); }),
            [provider(async () => { throw new Error('b'); })],
        );
        await expect(p.generateText([], {})).rejects.toThrow();
    });
});

describe('withRetry', () => {
    it('retries until success', async () => {
        let calls = 0;
        const p = withRetry(
            provider(async () => {
                calls += 1;
                if (calls < 3) throw new Error('flake');
                return { text: 'ok', finishReason: 'stop' };
            }),
            { maxRetries: 5, initialDelayMs: 0 },
        );
        const r = await p.generateText([], {});
        expect(r.text).toBe('ok');
        expect(calls).toBe(3);
    });

    it('gives up after maxRetries and throws', async () => {
        const p = withRetry(
            provider(async () => { throw new Error('always'); }),
            { maxRetries: 2, initialDelayMs: 0 },
        );
        await expect(p.generateText([], {})).rejects.toThrow('always');
    });

    it('respects a retryOn predicate (no retry when it returns false)', async () => {
        let calls = 0;
        const p = withRetry(
            provider(async () => { calls += 1; throw new Error('fatal'); }),
            { maxRetries: 5, initialDelayMs: 0, retryOn: () => false },
        );
        await expect(p.generateText([], {})).rejects.toThrow('fatal');
        expect(calls).toBe(1);
    });
});

async function* deltas(items: StreamDelta[]): AsyncIterable<StreamDelta> {
    for (const d of items) yield d;
}

describe('stream utilities', () => {
    it('streamToText concatenates text deltas', async () => {
        const out = await streamToText(deltas([
            { type: 'text', text: 'Hel' },
            { type: 'text', text: 'lo' },
        ] as StreamDelta[]));
        expect(out).toBe('Hello');
    });

    it('streamToChunks preserves delta boundaries', async () => {
        const out = await streamToChunks(deltas([
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
            { type: 'text', text: 'c' },
        ] as StreamDelta[]));
        expect(out).toEqual(['a', 'b', 'c']);
    });

    it('stream utilities ignore non-text deltas', async () => {
        const out = await streamToText(deltas([
            { type: 'text', text: 'x' },
            { type: 'tool_call', name: 'f', argsDelta: '{}' } as unknown as StreamDelta,
            { type: 'text', text: 'y' },
        ] as StreamDelta[]));
        expect(out).toBe('xy');
    });
});
