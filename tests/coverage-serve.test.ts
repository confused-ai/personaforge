/**
 * Hermetic coverage for src/serve — feedback, lifecycle, hardening.
 * Callers: vitest only (tests include glob). No production imports.
 * Existing: serve.test.ts (auth/prometheus/sse), coverage-repo-batch1 (schemas/validate).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleFeedback, createFeedbackHandler } from '../src/serve/feedback.js';
import { setupGracefulShutdown, makeCleanup } from '../src/serve/lifecycle.js';
import { securityHeaders, cors, bodyLimit } from '../src/serve/hardening.js';
import { InMemoryFeedbackStore } from '../src/production/feedback-store.js';

describe('handleFeedback / createFeedbackHandler', () => {
    it('returns 422 on invalid payload', async () => {
        const store = new InMemoryFeedbackStore();
        const res = await handleFeedback({ bad: true }, store);
        expect(res.status).toBe(422);
        expect((res.body as { error: string }).error).toBe('ValidationError');
    });

    it('appends valid feedback and returns 201', async () => {
        const store = new InMemoryFeedbackStore();
        const res = await handleFeedback({ runId: 'run_1', rating: 1, comment: 'ok' }, store);
        expect(res.status).toBe(201);
        expect((res.body as { runId: string; rating: number }).runId).toBe('run_1');
        expect((res.body as { rating: number }).rating).toBe(1);
    });

    it('createFeedbackHandler rejects non-POST and bad JSON', async () => {
        const store = new InMemoryFeedbackStore();
        const handler = createFeedbackHandler(store);

        const getRes = await handler(new Request('http://x/v1/feedback', { method: 'GET' }));
        expect(getRes.status).toBe(405);

        const badJson = await handler(
            new Request('http://x/v1/feedback', { method: 'POST', body: 'not-json' }),
        );
        expect(badJson.status).toBe(400);

        const ok = await handler(
            new Request('http://x/v1/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId: 'r2', rating: -1 }),
            }),
        );
        expect(ok.status).toBe(201);
    });
});

describe('lifecycle', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('setupGracefulShutdown closes server and runs cleanups', async () => {
        const close = vi.fn((cb?: (err?: Error) => void) => {
            cb?.();
        });
        const cleanup = vi.fn(async () => undefined);
        setupGracefulShutdown({ close }, [cleanup], 50);

        process.emit('SIGTERM');
        await vi.waitFor(() => {
            expect(close).toHaveBeenCalled();
            expect(cleanup).toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(0);
        });
        expect(warn.mock.calls.some((c) => String(c[0]).includes('SIGTERM'))).toBe(true);
    });

    it('makeCleanup logs success and failure', async () => {
        const ok = makeCleanup('Redis', async () => undefined);
        await ok();
        expect(warn.mock.calls.some((c) => String(c[0]).includes("cleanup 'Redis'"))).toBe(true);

        const bad = makeCleanup('DB', async () => {
            throw new Error('fail');
        });
        await bad();
        expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes("cleanup 'DB'"))).toBe(true);
    });
});

describe('hardening middleware', () => {
    function mockRes() {
        return {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            setHeader: vi.fn(),
            end: vi.fn(),
        };
    }

    it('securityHeaders sets CSP and continues', () => {
        const next = vi.fn();
        const res = mockRes();
        securityHeaders()({ headers: {} }, res as never, next);
        expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
        expect(next).toHaveBeenCalled();
    });

    it('cors allows *, allowlist, regex, and preflight', () => {
        const next = vi.fn();
        const res = mockRes();

        cors({ origin: '*' })({ headers: { origin: 'https://a.com' }, method: 'GET' }, res as never, next);
        expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://a.com');
        expect(next).toHaveBeenCalled();

        next.mockClear();
        res.setHeader.mockClear();
        cors({ origin: ['https://app.example.com'], credentials: true })(
            { headers: { origin: 'https://app.example.com' }, method: 'GET' },
            res as never,
            next,
        );
        expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
        expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Origin');

        next.mockClear();
        res.end.mockClear();
        cors({ origin: /^https:\/\/ok\./ })(
            { headers: { origin: 'https://ok.test' }, method: 'OPTIONS' },
            res as never,
            next,
        );
        expect(res.status).toHaveBeenCalledWith(204);
        expect(res.end).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('bodyLimit rejects oversized Content-Length', () => {
        const next = vi.fn();
        const res = mockRes();
        bodyLimit(10)({ headers: { 'content-length': '100' } }, res as never, next);
        expect(res.status).toHaveBeenCalledWith(413);
        expect(next).not.toHaveBeenCalled();

        bodyLimit(10)({ headers: { 'content-length': '5' } }, res as never, next);
        expect(next).toHaveBeenCalled();
    });
});
