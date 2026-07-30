/**
 * Turn any HTTP/JSON API endpoint into a personaforge tool.
 * "Works with any system" — wrap REST backends without custom tool classes.
 */

import { z } from 'zod';
import { tool } from '../../tools/core/tool-helper.js';
import type { LightweightTool, ToolObjectSchemaLike, ToolSchemaLike } from '../../tools/core/tool-helper.js';
import { ToolCategory } from '../../tools/core/types.js';

export interface HttpToolOptions<TOutput = unknown> {
    readonly name: string;
    readonly description: string;
    readonly url: string | ((params: Record<string, unknown>) => string);
    readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    readonly headers?: Record<string, string> | ((params: Record<string, unknown>) => Record<string, string>);
    readonly body?: (params: Record<string, unknown>) => unknown;
    /** Map query params for GET. Default: all params as query string. */
    readonly query?: (params: Record<string, unknown>) => Record<string, string | number | boolean | undefined>;
    readonly timeoutMs?: number;
    readonly fetchImpl?: typeof fetch;
    readonly tags?: string[];
}

export function fromHttpTool<TOutput = unknown>(
    options: HttpToolOptions<TOutput>,
): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
    const method = options.method ?? 'POST';
    const parameters =
        options.parameters ??
        (z.object({}).passthrough() as ToolObjectSchemaLike<Record<string, unknown>>);
    const fetchImpl = options.fetchImpl ?? fetch;

    return tool({
        name: options.name,
        description: options.description,
        parameters,
        ...(options.outputSchema !== undefined ? { outputSchema: options.outputSchema } : {}),
        category: ToolCategory.API,
        tags: ['http-adapted', ...(options.tags ?? [])],
        timeoutMs: options.timeoutMs ?? 60_000,
        execute: async (params) => {
            const p = params as Record<string, unknown>;
            let url = typeof options.url === 'function' ? options.url(p) : options.url;

            if (method === 'GET') {
                const q = options.query
                    ? options.query(p)
                    : (p as Record<string, string | number | boolean | undefined>);
                const usp = new URLSearchParams();
                for (const [k, v] of Object.entries(q)) {
                    if (v !== undefined) usp.set(k, String(v));
                }
                const qs = usp.toString();
                if (qs) url += (url.includes('?') ? '&' : '?') + qs;
            }

            const headers: Record<string, string> = {
                Accept: 'application/json',
                ...(typeof options.headers === 'function' ? options.headers(p) : (options.headers ?? {})),
            };

            const init: RequestInit = { method, headers };
            if (method !== 'GET' && method !== 'DELETE') {
                headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
                init.body = JSON.stringify(options.body ? options.body(p) : p);
            }

            const res = await fetchImpl(url, init);
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`HTTP tool "${options.name}" failed (${String(res.status)}): ${text.slice(0, 500)}`);
            }
            const contentType = res.headers.get('content-type') ?? '';
            if (contentType.includes('application/json')) {
                return (await res.json()) as TOutput;
            }
            return (await res.text()) as unknown as TOutput;
        },
    });
}
