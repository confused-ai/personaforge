/**
 * Streaming Utilities
 * ====================
 * Consumer-side helpers for working with `AsyncIterable<StreamDelta>` streams
 * produced by LLM providers.
 *
 * Core primitives:
 *   streamToText         — fully buffer a stream → string
 *   streamToChunks       — collect all text chunks → string[]
 *   streamToSSE          — pipe a stream to an HTTP response as Server-Sent Events
 *   streamWithBudget     — abort a stream after N tokens (simple word-count heuristic)
 *   streamTee            — split one stream into two independent consumers
 *   streamMap            — transform each delta without buffering
 *   streamFilter         — drop deltas that don't match a predicate
 *   streamMerge          — merge multiple streams into one (round-robin)
 *   streamToNodeCallback — bridge stream to old-style (err, chunk) callback API
 *
 * Usage:
 *   import { streamToText, streamToSSE, streamWithBudget } from './stream.js';
 *
 *   // Fully buffer
 *   const text = await streamToText(provider.streamText(messages));
 *
 *   // Stream to HTTP response (Express / Node.js http)
 *   await streamToSSE(stream, res);
 *
 *   // Abort if response exceeds 500 tokens
 *   const budgeted = streamWithBudget(stream, { maxTokens: 500 });
 *   for await (const delta of budgeted) { ... }
 */

import type { StreamDelta } from '../core/index.js';
import type { ServerResponse } from 'node:http';
import { estimateTokenCount } from '../providers/context-window-manager.js';

// ── streamToText ──────────────────────────────────────────────────────────────

/**
 * Buffer an entire stream and return the concatenated text.
 * Tool-call deltas are ignored.
 */
export async function streamToText(
    stream: AsyncIterable<StreamDelta>,
): Promise<string> {
    let out = '';
    for await (const delta of stream) {
        if (delta.type === 'text') out += delta.text;
    }
    return out;
}

// ── streamToChunks ────────────────────────────────────────────────────────────

/**
 * Collect all text delta strings from a stream (preserves boundaries).
 */
export async function streamToChunks(
    stream: AsyncIterable<StreamDelta>,
): Promise<string[]> {
    const chunks: string[] = [];
    for await (const delta of stream) {
        if (delta.type === 'text') chunks.push(delta.text);
    }
    return chunks;
}

// ── streamToSSE ───────────────────────────────────────────────────────────────

export interface StreamToSSEOptions {
    /** SSE event name for text chunks. Default: 'text' */
    textEvent?:  string;
    /** SSE event name for tool-call chunks. Default: 'tool_call' */
    toolEvent?:  string;
    /** SSE event name for the stream-done marker. Default: 'done' */
    doneEvent?:  string;
    /** Emit a keep-alive comment every N ms. Default: 15000 (15s). Set 0 to disable. */
    keepAliveMs?: number;
}

/**
 * Pipe an `AsyncIterable<StreamDelta>` to a Node.js HTTP `ServerResponse`
 * (or any `WritableStream`-like with `.write()` / `.end()`).
 *
 * Sets appropriate SSE headers if not already set.
 */
export async function streamToSSE(
    stream: AsyncIterable<StreamDelta>,
    res: ServerResponse,
    options: StreamToSSEOptions = {},
): Promise<void> {
    const textEvent  = options.textEvent  ?? 'text';
    const toolEvent  = options.toolEvent  ?? 'tool_call';
    const doneEvent  = options.doneEvent  ?? 'done';
    const keepAliveMs = options.keepAliveMs ?? 15_000;

    if (!res.headersSent) {
        res.writeHead(200, {
            'Content-Type':  'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
            'X-Accel-Buffering': 'no',
        });
    }

    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    if (keepAliveMs > 0) {
        keepAliveTimer = setInterval(() => { res.write(': keep-alive\n\n'); }, keepAliveMs);
        keepAliveTimer.unref?.();
    }

    try {
        for await (const delta of stream) {
            if (delta.type === 'text') {
                res.write(`event: ${textEvent}\ndata: ${JSON.stringify({ text: delta.text })}\n\n`);

            } else if (delta.type === 'tool_call') {
                res.write(`event: ${toolEvent}\ndata: ${JSON.stringify({ id: delta.id, name: delta.name, argsDelta: delta.argsDelta })}\n\n`);
            }
        }
        res.write(`event: ${doneEvent}\ndata: {}\n\n`);
    } finally {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        res.end();
    }
}

// ── streamWithBudget ──────────────────────────────────────────────────────────

export interface StreamBudgetOptions {
    /**
     * Approximate token budget (estimated with the shared BPE-aware estimator).
     * The stream is cut after this many tokens are emitted.
     */
    maxTokens: number;
    /**
     * Called when the budget is exceeded (stream truncated).
     * Receives the total tokens estimated so far.
     */
    onBudgetExceeded?: (estimatedTokens: number) => void;
}

/**
 * Wrap a stream; stops yielding deltas after approximately `maxTokens` tokens.
 * Uses the shared {@link estimateTokenCount} BPE-aware estimator so budget
 * counts stay consistent with the router and context-window manager.
 */
export async function* streamWithBudget(
    stream: AsyncIterable<StreamDelta>,
    options: StreamBudgetOptions,
): AsyncIterable<StreamDelta> {
    let estimatedTokens = 0;
    for await (const delta of stream) {
        if (delta.type === 'text') {
            estimatedTokens += estimateTokenCount(delta.text);
        }
        if (estimatedTokens > options.maxTokens) {
            options.onBudgetExceeded?.(estimatedTokens);
            return;
        }
        yield delta;
    }
}

// ── streamTee ─────────────────────────────────────────────────────────────────

/**
 * Split a single `AsyncIterable<StreamDelta>` into two independent consumers.
 * Both consumers receive every delta. Neither consumer blocks the other.
 *
 * **Note:** The source stream is drained at the rate of the *faster* consumer.
 * The slower consumer buffers deltas in memory until it catches up.
 */
export function streamTee(
    source: AsyncIterable<StreamDelta>,
): [AsyncIterable<StreamDelta>, AsyncIterable<StreamDelta>] {
    const bufA: StreamDelta[] = [];
    const bufB: StreamDelta[] = [];
    // Use object properties so TypeScript doesn't narrow them to `null` inside closures
    const state = {
        done:   false,
        drainA: null as ((() => void) | null),
        drainB: null as ((() => void) | null),
    };

    // Drain source into both buffers
    void (async () => {
        for await (const delta of source) {
            bufA.push(delta);
            bufB.push(delta);
            state.drainA?.();
            state.drainB?.();
        }
        state.done = true;
        state.drainA?.();
        state.drainB?.();
    })();

    async function* makeConsumer(buf: StreamDelta[], side: 'drainA' | 'drainB'): AsyncIterable<StreamDelta> {
        while (true) {

            if (buf.length > 0) {

                yield buf.shift()!;
            } else if (state.done) {
                return;
            } else {
                await new Promise<void>((r) => { state[side] = r; });
                state[side] = null;
            }
        }
    }

    return [
        makeConsumer(bufA, 'drainA'),
        makeConsumer(bufB, 'drainB'),
    ];
}

// ── streamMap ─────────────────────────────────────────────────────────────────

/**
 * Transform each `StreamDelta` without buffering the entire stream.
 */
export async function* streamMap(
    stream: AsyncIterable<StreamDelta>,
    fn: (delta: StreamDelta) => StreamDelta | null | Promise<StreamDelta | null>,
): AsyncIterable<StreamDelta> {
    for await (const delta of stream) {
        const mapped = await fn(delta);
        if (mapped !== null) yield mapped;
    }
}

// ── streamFilter ──────────────────────────────────────────────────────────────

/**
 * Drop deltas that don't pass `predicate`.
 */
export async function* streamFilter(
    stream: AsyncIterable<StreamDelta>,
    predicate: (delta: StreamDelta) => boolean | Promise<boolean>,
): AsyncIterable<StreamDelta> {
    for await (const delta of stream) {
        if (await predicate(delta)) yield delta;
    }
}

// ── streamMerge ───────────────────────────────────────────────────────────────

/**
 * Merge multiple streams into one. Deltas are emitted as they arrive (concurrent).
 * Completes when all source streams are exhausted.
 */
export async function* streamMerge(
    streams: AsyncIterable<StreamDelta>[],
): AsyncIterable<StreamDelta> {
    const queue: StreamDelta[] = [];
    let active = streams.length;
    // Object property avoids TypeScript narrowing `null` in closures
    const state = { notify: null as ((() => void) | null) };

    for (const stream of streams) {
        void (async () => {
            for await (const delta of stream) {
                queue.push(delta);
                state.notify?.();
            }
            active--;
            state.notify?.();
        })();
    }

    while (active > 0 || queue.length > 0) {
        if (queue.length > 0) {

            yield queue.shift()!;
        } else {
            await new Promise<void>((r) => { state.notify = r; });
            state.notify = null;
        }
    }
}

// ── streamToNodeCallback ──────────────────────────────────────────────────────

/**
 * Bridge a stream to a Node.js-style `(err, chunk) => void` callback API.
 * `chunk` is `null` when the stream ends.
 */
export function streamToNodeCallback(
    stream: AsyncIterable<StreamDelta>,
    callback: (err: Error | null, chunk: StreamDelta | null) => void,
): void {
    void (async () => {
        try {
            for await (const delta of stream) callback(null, delta);
            callback(null, null);
        } catch (err) {
            callback(err instanceof Error ? err : new Error(String(err)), null);
        }
    })();
}
