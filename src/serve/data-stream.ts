/**
 * @personaforge/serve — agent data-stream protocol.
 *
 * Bridges `agent.streamEvents()` (typed {@link StreamChunk}s) to a wire format
 * frontends can consume with zero glue, and back again. SSE on the wire
 * (`text/event-stream`), one JSON object per `data:` line — the same shape the
 * Vercel AI SDK popularised, so existing UI clients map onto it trivially.
 *
 * Server:
 * ```ts
 * // in a fetch/Next.js route handler:
 * return toSSEResponse(agent.streamEvents(prompt));
 * ```
 *
 * Client (browser or node):
 * ```ts
 * const res = await fetch('/api/chat', { method: 'POST', body });
 * for await (const ev of readDataStream(res)) {
 *   if (ev.type === 'text-delta') append(ev.delta);
 * }
 * ```
 *
 * No dependencies — uses web-standard ReadableStream / TextEncoder, available in
 * Node 18+, Deno, Bun, and browsers.
 */

import type { StreamChunk } from '../create-agent/types.js';

/**
 * JSON-safe wire form of a {@link StreamChunk}. Identical to StreamChunk except
 * `error` is flattened to a string message (Error is not JSON-serialisable).
 */
export interface DataStreamEvent {
    type: StreamChunk['type'];
    delta?: string;
    tool?: { name: string; input: unknown; output?: unknown };
    stepNumber?: number;
    run?: StreamChunk['run'];
    error?: string;
}

const SSE_HEADERS: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering (nginx) so chunks flush immediately.
    'X-Accel-Buffering': 'no',
};

/** Serialise a StreamChunk to its JSON-safe wire form. */
function toWire(chunk: StreamChunk): DataStreamEvent {
    const ev: DataStreamEvent = { type: chunk.type };
    if (chunk.delta !== undefined) ev.delta = chunk.delta;
    if (chunk.tool !== undefined) ev.tool = chunk.tool;
    if (chunk.stepNumber !== undefined) ev.stepNumber = chunk.stepNumber;
    if (chunk.run !== undefined) ev.run = chunk.run;
    if (chunk.error !== undefined) ev.error = chunk.error.message;
    return ev;
}

/** Reconstruct a StreamChunk from its wire form. */
function fromWire(ev: DataStreamEvent): StreamChunk {
    const chunk: StreamChunk = { type: ev.type };
    if (ev.delta !== undefined) chunk.delta = ev.delta;
    if (ev.tool !== undefined) chunk.tool = ev.tool;
    if (ev.stepNumber !== undefined) chunk.stepNumber = ev.stepNumber;
    if (ev.run !== undefined) chunk.run = ev.run;
    if (ev.error !== undefined) chunk.error = new Error(ev.error);
    return chunk;
}

/** Encode one event as an SSE frame. */
export function encodeSSE(chunk: StreamChunk): string {
    return `data: ${JSON.stringify(toWire(chunk))}\n\n`;
}

/**
 * Convert an async iterable of {@link StreamChunk}s into an SSE byte stream.
 * Errors thrown mid-iteration are emitted as a final `error` event, not dropped.
 */
export function toDataStream(events: AsyncIterable<StreamChunk>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const iterator = events[Symbol.asyncIterator]();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { value, done } = await iterator.next();
                if (done) {
                    controller.close();
                    return;
                }
                controller.enqueue(encoder.encode(encodeSSE(value)));
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                controller.enqueue(encoder.encode(encodeSSE({ type: 'error', error: new Error(message) })));
                controller.close();
            }
        },
        async cancel(reason) {
            // Propagate client disconnect so the agent run can abort upstream.
            await iterator.return?.(reason);
        },
    });
}

/**
 * Wrap an agent event stream in a `Response` ready to return from a fetch /
 * Next.js / Hono route handler.
 */
export function toSSEResponse(events: AsyncIterable<StreamChunk>, init?: ResponseInit): Response {
    return new Response(toDataStream(events), {
        ...init,
        headers: { ...SSE_HEADERS, ...(init?.headers as Record<string, string> | undefined) },
    });
}

/**
 * Parse an SSE agent data-stream back into typed {@link StreamChunk}s.
 * Accepts a `Response`, its `ReadableStream` body, or any byte stream.
 */
export async function* readDataStream(
    source: Response | ReadableStream<Uint8Array> | { body: ReadableStream<Uint8Array> | null },
): AsyncGenerator<StreamChunk> {
    const body = source instanceof ReadableStream ? source : source.body;
    if (!body) throw new Error('readDataStream: source has no readable body.');

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE frames are separated by a blank line.
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                const line = frame.split('\n').find((l) => l.startsWith('data:'));
                if (!line) continue;
                const json = line.slice(5).trim();
                if (!json) continue;
                yield fromWire(JSON.parse(json) as DataStreamEvent);
            }
        }
    } finally {
        reader.releaseLock();
    }
}
