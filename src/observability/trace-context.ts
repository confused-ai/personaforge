/**
 * W3C Trace Context — distributed tracing propagation across agent-to-agent calls.
 *
 * Extracts `traceparent` / `tracestate` from incoming HTTP headers and injects
 * them into outbound `HttpA2AClient` calls and tool HTTP requests.
 * Connects spans from a multi-agent swarm into a single distributed trace
 * visible in Jaeger, Grafana Tempo, Datadog, or any OTLP-compatible backend.
 *
 * @see https://www.w3.org/TR/trace-context/
 *
 * @example
 * ```ts
 * import { extractTraceContext, injectTraceHeaders, generateTraceparent } from 'personaforge/observability';
 *
 * // In an incoming HTTP handler:
 * const traceCtx = extractTraceContext(req.headers);
 *
 * // Pass to agent run:
 * await agent.run(prompt, { traceId: traceCtx.traceId });
 *
 * // In an outbound fetch (e.g. HttpA2AClient):
 * const headers = injectTraceHeaders({}, traceCtx);
 * fetch(url, { headers });
 * ```
 */

import { randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TraceContext {
    /** W3C traceparent header value. e.g. `00-<traceId>-<spanId>-01` */
    readonly traceparent: string;
    /** W3C tracestate header value (vendor-specific metadata). */
    readonly tracestate?: string;
    /** 32-hex-char trace ID. */
    readonly traceId: string;
    /** 16-hex-char parent span ID. */
    readonly spanId: string;
    /** Trace flags (01 = sampled). */
    readonly traceFlags: string;
}

// ── Parsing ────────────────────────────────────────────────────────────────

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Parse a `traceparent` header value.
 * Returns null if the value is missing or malformed.
 */
export function parseTraceparent(value: string | undefined): Omit<TraceContext, 'tracestate' | 'traceparent'> | null {
    if (!value) return null;
    const match = TRACEPARENT_REGEX.exec(value.trim());
    if (!match) return null;
    const [, traceId, spanId, traceFlags] = match as unknown as [string, string, string, string];
    return { traceId, spanId, traceFlags };
}

// ── Generation ─────────────────────────────────────────────────────────────

/** Generate a fresh W3C-compliant traceparent (new trace). */
export function generateTraceparent(): TraceContext {
    const traceId = randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    const traceFlags = '01'; // sampled
    return {
        traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
        traceId,
        spanId,
        traceFlags,
    };
}

/**
 * Create a child span from an existing trace context.
 * Keeps the same traceId, generates a new spanId.
 */
export function childSpan(parent: TraceContext): TraceContext {
    const spanId = randomBytes(8).toString('hex');
    return {
        traceparent: `00-${parent.traceId}-${spanId}-${parent.traceFlags}`,
        tracestate: parent.tracestate,
        traceId: parent.traceId,
        spanId,
        traceFlags: parent.traceFlags,
    };
}

// ── Extraction / injection ─────────────────────────────────────────────────

/**
 * Extract a `TraceContext` from incoming HTTP request headers.
 * Returns a freshly generated context if no traceparent is present.
 */
export function extractTraceContext(
    headers: Record<string, string | string[] | undefined>
): TraceContext {
    const rawTraceparent = Array.isArray(headers['traceparent'])
        ? headers['traceparent'][0]
        : headers['traceparent'];
    const rawTracestate = Array.isArray(headers['tracestate'])
        ? headers['tracestate'].join(',')
        : headers['tracestate'];

    const parsed = parseTraceparent(rawTraceparent);
    if (parsed) {
        const traceparent = `00-${parsed.traceId}-${parsed.spanId}-${parsed.traceFlags}`;
        return { ...parsed, traceparent, tracestate: rawTracestate };
    }
    const fresh = generateTraceparent();
    return rawTracestate ? { ...fresh, tracestate: rawTracestate } : fresh;
}

/**
 * Inject W3C trace headers into an outbound headers object.
 * Creates a child span from the provided context.
 *
 * @param headers - Existing headers object to mutate (or an empty object).
 * @param ctx - Parent trace context.
 * @returns The headers object with traceparent / tracestate added.
 */
export function injectTraceHeaders(
    headers: Record<string, string>,
    ctx: TraceContext
): Record<string, string> {
    const child = childSpan(ctx);
    headers['traceparent'] = child.traceparent;
    if (child.tracestate) {
        headers['tracestate'] = child.tracestate;
    }
    return headers;
}

/**
 * Build a `traceparent` string from component parts.
 * Useful when constructing spans manually.
 */
export function buildTraceparent(traceId: string, spanId: string, flags = '01'): string {
    return `00-${traceId}-${spanId}-${flags}`;
}
