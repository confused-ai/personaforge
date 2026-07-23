/**
 * createTestHttpService — spins up a real HTTP service on a random port for integration tests.
 *
 * Automatically binds on port 0 (OS assigns), waits for ready, and provides a
 * `request()` helper. Automatically closes on test teardown when used with
 * `afterEach(() => handle.close())`.
 *
 * @example
 * ```ts
 * import { describe, it, afterEach, expect } from 'vitest';
 * import { createTestHttpService } from 'personaforge/testing';
 * import { MockLLMProvider } from 'personaforge/testing';
 * import { createAgent } from 'personaforge';
 *
 * describe('my agent API', () => {
 *   let server: Awaited<ReturnType<typeof createTestHttpService>>;
 *
 *   afterEach(() => server?.close());
 *
 *   it('responds to /v1/health', async () => {
 *     const agent = createAgent({ name: 'test', instructions: 'test', llm: new MockLLMProvider() });
 *     server = await createTestHttpService({ agents: { assistant: agent } });
 *     const res = await server.request({ method: 'GET', path: '/v1/health' });
 *     expect(res.status).toBe(200);
 *   });
 * });
 * ```
 */

import http from 'node:http';
import type { CreateHttpServiceOptions } from '../runtime/types.js';

export interface TestHttpHandle {
    readonly port: number;
    request(opts: {
        method: string;
        path: string;
        headers?: Record<string, string>;
        body?: string;
    }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>;
    close(): Promise<void>;
    readonly baseUrl: string;
}

/**
 * Start a test HTTP service on a random OS-assigned port.
 * Returns a handle with `request()` and `close()`.
 */
export async function createTestHttpService(
    options: CreateHttpServiceOptions
): Promise<TestHttpHandle> {
    const { createHttpService, listenService } = await import('../runtime/server.js');

    const svc = createHttpService(options, 0);
    const listening = await listenService(svc, 0);
    const port = listening.port;

    function request(opts: {
        method: string;
        path: string;
        headers?: Record<string, string>;
        body?: string;
    }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: opts.path,
                    method: opts.method,
                    headers: opts.headers,
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c: Buffer) => chunks.push(c));
                    res.on('end', () =>
                        resolve({
                            status: res.statusCode ?? 0,
                            headers: res.headers,
                            body: Buffer.concat(chunks).toString('utf8'),
                        })
                    );
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            if (opts.body) req.write(opts.body);
            req.end();
        });
    }

    return {
        port,
        request,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => listening.close(),
    };
}
