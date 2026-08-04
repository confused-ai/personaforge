/**
 * Hermetic coverage for src/serve — lifecycle, hardening, data-stream,
 * validate, feedback. No network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import { setupGracefulShutdown, makeCleanup } from '../src/serve/lifecycle.js';
import { securityHeaders, cors, bodyLimit } from '../src/serve/hardening.js';
import {
    encodeSSE,
    toDataStream,
    toSSEResponse,
    readDataStream,
} from '../src/serve/data-stream.js';
import { validateBody, validate } from '../src/serve/validate.js';
import { z } from 'zod';

describe('serve/lifecycle', () => {
    it('makeCleanup logs success and failure', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const ok = makeCleanup('db', async () => {});
        await ok();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('db'));
        const bad = makeCleanup('redis', async () => { throw new Error('down'); });
        await bad();
        expect(err).toHaveBeenCalledWith(expect.stringContaining('redis'), expect.any(Error));
        warn.mockRestore();
        err.mockRestore();
    });

    it('setupGracefulShutdown registers SIGTERM/SIGINT handlers', () => {
        const onSpy = vi.spyOn(process, 'once').mockImplementation(() => process as never);
        const server = { close: vi.fn() };
        setupGracefulShutdown(server, []);
        expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
        expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        onSpy.mockRestore();
    });
});

describe('serve/hardening', () => {
    function mockRes() {
        const headers: Record<string, string> = {};
        return {
            headers,
            setHeader: (n: string, v: string) => { headers[n] = v; },
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            end: vi.fn(),
        };
    }

    it('securityHeaders sets all headers and calls next', () => {
        const res = mockRes();
        const next = vi.fn();
        securityHeaders()({ headers: {} } as never, res as never, next);
        expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
        expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
        expect(res.headers['X-Frame-Options']).toBe('DENY');
        expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        expect(res.headers['X-Powered-By']).toBe('personaforge');
        expect(next).toHaveBeenCalled();
    });

    it('cors allowlist: allowed origin, credentials, vary, preflight, denied', () => {
        const res = mockRes();
        const next = vi.fn();
        cors({ origin: ['https://app.com'], credentials: true })({ headers: { origin: 'https://app.com' }, method: 'GET' } as never, res as never, next);
        expect(res.headers['Access-Control-Allow-Origin']).toBe('https://app.com');
        expect(res.headers['Access-Control-Allow-Credentials']).toBe('true');
        expect(res.headers['Vary']).toBe('Origin');
        expect(next).toHaveBeenCalled();

        // preflight
        const res2 = mockRes();
        const next2 = vi.fn();
        cors({ origin: '*' })({ headers: {}, method: 'OPTIONS' } as never, res2 as never, next2);
        expect(res2.headers['Access-Control-Allow-Methods']).toContain('GET');
        expect(res2.status).toHaveBeenCalledWith(204);
        expect(res2.end).toHaveBeenCalled();
        expect(next2).not.toHaveBeenCalled();

        // denied origin → no CORS header, still next
        const res3 = mockRes();
        const next3 = vi.fn();
        cors({ origin: 'https://only.com' })({ headers: { origin: 'https://evil.com' }, method: 'GET' } as never, res3 as never, next3);
        expect(res3.headers['Access-Control-Allow-Origin']).toBeUndefined();
        expect(next3).toHaveBeenCalled();

        // regex origin
        const res4 = mockRes();
        cors({ origin: /\.example\.com$/ })({ headers: { origin: 'https://x.example.com' }, method: 'GET' } as never, res4 as never, vi.fn());
        expect(res4.headers['Access-Control-Allow-Origin']).toBe('https://x.example.com');
    });

    it('bodyLimit rejects large payloads and allows small', () => {
        const res = mockRes();
        const next = vi.fn();
        bodyLimit(100)({ headers: { 'content-length': '200' } } as never, res as never, next);
        expect(res.status).toHaveBeenCalledWith(413);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'PAYLOAD_TOO_LARGE' }));
        expect(next).not.toHaveBeenCalled();

        const res2 = mockRes();
        const next2 = vi.fn();
        bodyLimit(100)({ headers: { 'content-length': '50' } } as never, res2 as never, next2);
        expect(next2).toHaveBeenCalled();

        const res3 = mockRes();
        const next3 = vi.fn();
        bodyLimit(100)({ headers: {} } as never, res3 as never, next3);
        expect(next3).toHaveBeenCalled();
    });
});

describe('serve/data-stream', () => {
    const chunk = { type: 'text-delta' as const, delta: 'hi' };
    const errChunk = { type: 'error' as const, error: new Error('boom') };

    it('encodeSSE serializes deltas and error messages', () => {
        expect(encodeSSE(chunk)).toBe('data: {"type":"text-delta","delta":"hi"}\n\n');
        expect(encodeSSE(errChunk)).toContain('"error":"boom"');
    });

    it('toDataStream + readDataStream round-trip via SSE frames', async () => {
        async function* gen() {
            yield chunk;
            yield { type: 'run-finish' as const, run: { text: 'done' } as never };
        }
        const stream = toDataStream(gen());
        const response = toSSEResponse(gen(), { status: 200 });
        expect(response.headers.get('Content-Type')).toContain('text/event-stream');

        const out: string[] = [];
        for await (const ev of readDataStream(stream)) {
            out.push(`${ev.type}:${(ev as { delta?: string }).delta ?? ''}`);
        }
        expect(out).toEqual(['text-delta:hi', 'run-finish:']);
    });

    it('toDataStream emits error event on mid-iteration throw', async () => {
        async function* gen() {
            yield chunk;
            throw new Error('stream broke');
        }
        const out: string[] = [];
        for await (const ev of readDataStream(toDataStream(gen()))) {
            out.push(ev.type);
        }
        expect(out).toContain('error');
    });

    it('readDataStream throws when source has no body', async () => {
        await expect(readDataStream({} as never).next()).rejects.toThrow(/no readable body/);
    });
});

describe('serve/validate', () => {
    const schema = z.object({ name: z.string() });

    it('validateBody success + failure', () => {
        const ok = validateBody(schema, { name: 'a' });
        expect(ok.ok).toBe(true);
        if (ok.ok) expect(ok.data).toEqual({ name: 'a' });
        const bad = validateBody(schema, { name: 1 });
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.error.message.length).toBeGreaterThan(0);
    });

    it('validate express middleware: passes and 400s', () => {
        const mw = validate(schema);
        const next = vi.fn();
        const req = { body: { name: 'ok' } };
        mw(req as never, { status: vi.fn(), json: vi.fn() } as never, next);
        expect(next).toHaveBeenCalled();
        expect((req as { body: unknown }).body).toEqual({ name: 'ok' });

        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next2 = vi.fn();
        mw({ body: { name: 1 } } as never, res as never, next2);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_FAILED' }));
        expect(next2).not.toHaveBeenCalled();
    });
});
