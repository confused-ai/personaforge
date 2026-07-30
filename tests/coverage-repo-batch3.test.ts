/**
 * Repo coverage batch 3 — serve feedback/lifecycle, observability ingest, skills.
 *
 * Callers: vitest CI via tests include glob only.
 * Existing coverage-serve.test.ts does not cover skills/observability ingest.
 * No durable data I/O — in-memory mocks + fake fetch only.
 * User instruction: "cover all the repo"
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { handleFeedback, createFeedbackHandler } from '../src/serve/feedback.js';
import { setupGracefulShutdown, makeCleanup } from '../src/serve/lifecycle.js';
import { sendLangSmithRunBatch } from '../src/observability/langsmith-ingest.js';
import { sendLangfuseBatch } from '../src/observability/langfuse-ingest.js';
import { webResearchSkill } from '../src/skills/web-research.js';
import { codeReviewerSkill } from '../src/skills/code-reviewer.js';
import { pdfSummarizerSkill } from '../src/skills/pdf-summarizer.js';

describe('serve/feedback', () => {
    it('handleFeedback validates and stores', async () => {
        const store = {
            append: vi.fn(async (e: unknown) => ({ ...(e as object), id: 'f1', timestamp: 't' })),
        };
        const bad = await handleFeedback({ nope: true }, store as never);
        expect(bad.status).toBe(422);

        const good = await handleFeedback(
            { runId: 'r1', rating: 1, comment: 'great' },
            store as never,
        );
        expect(good.status).toBe(201);
        expect(store.append).toHaveBeenCalled();
    });

    it('createFeedbackHandler covers method/json/success paths', async () => {
        const store = {
            append: vi.fn(async (e: unknown) => e),
        };
        const handler = createFeedbackHandler(store as never);

        expect((await handler(new Request('http://x/v1/feedback', { method: 'GET' }))).status).toBe(
            405,
        );

        const badJson = await handler(
            new Request('http://x/v1/feedback', {
                method: 'POST',
                body: 'not-json',
                headers: { 'content-type': 'application/json' },
            }),
        );
        expect(badJson.status).toBe(400);

        const ok = await handler(
            new Request('http://x/v1/feedback', {
                method: 'POST',
                body: JSON.stringify({ runId: 'r', rating: -1 }),
                headers: { 'content-type': 'application/json' },
            }),
        );
        expect(ok.status).toBe(201);
    });
});

describe('serve/lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('makeCleanup success and failure', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await makeCleanup('ok', async () => undefined)();
        expect(warn).toHaveBeenCalled();

        await makeCleanup('bad', async () => {
            throw new Error('fail');
        })();
        expect(err).toHaveBeenCalled();
    });

    it('setupGracefulShutdown handles signals once', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        const close = vi.fn((cb?: (err?: Error) => void) => {
            cb?.();
        });
        const cleanup = vi.fn(async () => undefined);

        setupGracefulShutdown({ close }, [cleanup], 1000);
        process.emit('SIGTERM');
        process.emit('SIGTERM');
        await vi.runAllTimersAsync();

        expect(close).toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(0);
        vi.useRealTimers();
    });
});

describe('observability ingest', () => {
    it('sendLangSmithRunBatch success and error', async () => {
        const okFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
        await sendLangSmithRunBatch('key', [{ name: 'n', run_type: 'llm' }], {
            fetchImpl: okFetch as never,
            baseUrl: 'https://example.test/',
        });
        expect(okFetch).toHaveBeenCalled();

        const badFetch = vi
            .fn()
            .mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
        await expect(
            sendLangSmithRunBatch('key', [{ name: 'n', run_type: 'llm' }], {
                fetchImpl: badFetch as never,
            }),
        ).rejects.toThrow(/LangSmith/);
    });

    it('sendLangfuseBatch success and error', async () => {
        const okFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
        await sendLangfuseBatch(
            { publicKey: 'pk', secretKey: 'sk', fetchImpl: okFetch as never, baseUrl: 'https://lf.test/' },
            [{ type: 'trace-create', body: { id: '1' } }],
        );
        expect(okFetch).toHaveBeenCalled();

        const badFetch = vi
            .fn()
            .mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' });
        await expect(
            sendLangfuseBatch({ publicKey: 'pk', secretKey: 'sk', fetchImpl: badFetch as never }, [
                {},
            ]),
        ).rejects.toThrow(/Langfuse/);
    });
});

describe('skills', () => {
    it('exports skill metadata', () => {
        expect(webResearchSkill.id).toBe('web-research');
        expect(webResearchSkill.tools?.length).toBeGreaterThan(0);
        expect(codeReviewerSkill.id).toBe('code-reviewer');
        expect(pdfSummarizerSkill.id).toBe('pdf-summarizer');
    });

    it('webResearchSkill fetch_page tool', async () => {
        const tool = webResearchSkill.tools![0]!;
        await expect(tool.execute!({ url: 'http://insecure' })).rejects.toThrow(/HTTPS/);

        const prev = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: async () =>
                '<html><script>x</script><style>y</style><body>Hello World</body></html>',
        }) as never;
        try {
            const text = await tool.execute!({ url: 'https://example.test', maxChars: 20 });
            expect(String(text)).toContain('Hello');
            expect(String(text).length).toBeLessThanOrEqual(20);

            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                text: async () => '',
            }) as never;
            await expect(tool.execute!({ url: 'https://example.test/missing' })).rejects.toThrow(
                /404/,
            );
        } finally {
            globalThis.fetch = prev;
        }
    });
});
