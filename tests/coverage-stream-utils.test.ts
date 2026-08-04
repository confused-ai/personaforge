/**
 * Hermetic coverage for src/models/stream-utils.ts — streamToText, streamToChunks,
 * streamToSSE, streamWithBudget, streamTee, streamMap, streamFilter, streamMerge,
 * streamToNodeCallback.
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    streamToText,
    streamToChunks,
    streamToSSE,
    streamWithBudget,
    streamTee,
    streamMap,
    streamFilter,
    streamMerge,
    streamToNodeCallback,
} from '../src/models/stream-utils.js';
import type { StreamDelta } from '../src/core/index.js';

async function* gen(deltas: StreamDelta[]): AsyncIterable<StreamDelta> {
    for (const d of deltas) yield d;
}

const textDelta = (text: string): StreamDelta => ({ type: 'text', text } as StreamDelta);
const toolDelta = (id: string, name: string, argsDelta: string): StreamDelta =>
    ({ type: 'tool_call', id, name, argsDelta } as StreamDelta);

describe('models/stream-utils', () => {
    it('streamToText concatenates text deltas, ignores tool calls', async () => {
        const s = gen([textDelta('a'), toolDelta('1', 'f', '{}'), textDelta('b')]);
        expect(await streamToText(s)).toBe('ab');
    });

    it('streamToChunks collects text chunks preserving boundaries', async () => {
        const s = gen([textDelta('x'), toolDelta('1', 'f', '{}'), textDelta('y')]);
        expect(await streamToChunks(s)).toEqual(['x', 'y']);
    });

    it('streamToSSE writes events + done, ends response', async () => {
        const writes: string[] = [];
        const res = {
            headersSent: false,
            writeHead: vi.fn(),
            write: (chunk: string) => { writes.push(chunk); return true; },
            end: vi.fn(),
        } as never;
        const s = gen([textDelta('hi'), toolDelta('t1', 'fn', '{"a"')]);
        await streamToSSE(s, res as never, { textEvent: 'text', toolEvent: 'tool_call', doneEvent: 'done', keepAliveMs: 0 });
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream; charset=utf-8' }));
        expect(writes.join('')).toContain('event: text\ndata: {"text":"hi"}');
        expect(writes.join('')).toContain('event: tool_call');
        expect(writes.join('')).toContain('event: done');
        expect(res.end).toHaveBeenCalled();
    });

    it('streamToSSE with custom events and headers already sent', async () => {
        const writes: string[] = [];
        const res = {
            headersSent: true,
            writeHead: vi.fn(),
            write: (chunk: string) => { writes.push(chunk); return true; },
            end: vi.fn(),
        } as never;
        await streamToSSE(gen([textDelta('z')]), res as never, { textEvent: 'chunk', keepAliveMs: 0 });
        expect(res.writeHead).not.toHaveBeenCalled();
        expect(writes.join('')).toContain('event: chunk');
    });

    it('streamWithBudget stops after maxTokens', async () => {
        const onBudget = vi.fn();
        const s = gen([textDelta('hello '), textDelta('world '), textDelta('again')]);
        const out: string[] = [];
        for await (const d of streamWithBudget(s, { maxTokens: 2, onBudgetExceeded: onBudget })) {
            if (d.type === 'text') out.push(d.text);
        }
        expect(out.length).toBeGreaterThan(0);
        expect(out.length).toBeLessThan(3);
        expect(onBudget).toHaveBeenCalled();
    });

    it('streamWithBudget under budget yields everything', async () => {
        const s = gen([textDelta('hi'), textDelta(' there')]);
        const out: string[] = [];
        for await (const d of streamWithBudget(s, { maxTokens: 100 })) {
            if (d.type === 'text') out.push(d.text);
        }
        expect(out).toEqual(['hi', ' there']);
    });

    it('streamTee delivers every delta to both consumers', async () => {
        const [a, b] = streamTee(gen([textDelta('1'), textDelta('2'), textDelta('3')]));
        const outA: string[] = [];
        const outB: string[] = [];
        for await (const d of a) if (d.type === 'text') outA.push(d.text);
        for await (const d of b) if (d.type === 'text') outB.push(d.text);
        expect(outA).toEqual(['1', '2', '3']);
        expect(outB).toEqual(['1', '2', '3']);
    });

    it('streamMap transforms deltas and drops nulls', async () => {
        const s = gen([textDelta('a'), textDelta('b')]);
        const out: string[] = [];
        for await (const d of streamMap(s, (d) => (d.type === 'text' && d.text === 'a' ? textDelta('A') : null))) {
            if (d.type === 'text') out.push(d.text);
        }
        expect(out).toEqual(['A']);
    });

    it('streamFilter keeps matching deltas', async () => {
        const s = gen([textDelta('keep'), textDelta('drop')]);
        const out: string[] = [];
        for await (const d of streamFilter(s, (d) => d.type === 'text' && d.text === 'keep')) {
            if (d.type === 'text') out.push(d.text);
        }
        expect(out).toEqual(['keep']);
    });

    it('streamMerge merges concurrent streams', async () => {
        const s1 = gen([textDelta('a1'), textDelta('a2')]);
        const s2 = gen([textDelta('b1')]);
        const out: string[] = [];
        for await (const d of streamMerge([s1, s2])) {
            if (d.type === 'text') out.push(d.text);
        }
        expect(out.sort()).toEqual(['a1', 'a2', 'b1']);
    });

    it('streamToNodeCallback invokes callback per delta and null at end', async () => {
        const calls: Array<[Error | null, StreamDelta | null]> = [];
        streamToNodeCallback(gen([textDelta('x')]), (err, chunk) => calls.push([err, chunk]));
        await new Promise((r) => setTimeout(r, 10));
        expect(calls.length).toBe(2);
        expect(calls[0]![0]).toBeNull();
        expect(calls[0]![1]).toMatchObject({ type: 'text', text: 'x' });
        expect(calls[1]![1]).toBeNull();
    });

    it('streamToNodeCallback passes errors to callback', async () => {
        async function* bad(): AsyncIterable<StreamDelta> {
            throw new Error('stream broke');
        }
        const calls: Array<[Error | null, StreamDelta | null]> = [];
        streamToNodeCallback(bad(), (err, chunk) => calls.push([err, chunk]));
        await new Promise((r) => setTimeout(r, 10));
        expect(calls[0]![0]).toBeInstanceOf(Error);
        expect(calls[0]![0]!.message).toBe('stream broke');
        expect(calls[0]![1]).toBeNull();
    });
});
