/**
 * Hermetic coverage: tools/scraping (apify, brightdata, browserbase, crawl4ai,
 * hackernews, playwright, scrapegraph, spider, websearch, wikipedia).
 *
 * All network access is stubbed via globalThis.fetch; playwright is mocked
 * via vi.doMock so no real browser or network is touched.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    ApifyRunActorTool,
    ApifyGetRunTool,
    ApifyGetDatasetItemsTool,
    ApifyRunActorGetDataTool,
    ApifyToolkit,
} from '../src/tools/scraping/apify.js';
import {
    BrightDataScrapeTool,
    BrightDataSERPSTool,
    BrightDataDatasetCollectTool,
    BrightDataToolkit,
} from '../src/tools/scraping/brightdata.js';
import {
    BrowserbaseCreateSessionTool,
    BrowserbaseGetSessionTool,
    BrowserbaseScreenshotTool,
    BrowserbaseExtractPageTool,
    BrowserbaseToolkit,
} from '../src/tools/scraping/browserbase.js';
import {
    Crawl4AICrawlUrlTool,
    Crawl4AICrawlMultipleTool,
    Crawl4AIExtractStructuredTool,
    Crawl4AIToolkit,
} from '../src/tools/scraping/crawl4ai.js';
import {
    HackerNewsTopStoriesTool,
    HackerNewsUserTool,
    HackerNewsToolkit,
} from '../src/tools/scraping/hackernews.js';
import {
    ScrapeGraphSmartScraperTool,
    ScrapeGraphSearchGraphTool,
    ScrapeGraphMarkdownifyTool,
    ScrapeGraphToolkit,
} from '../src/tools/scraping/scrapegraph.js';
import {
    SpiderCrawlTool,
    SpiderScrapeTool,
    SpiderSearchTool,
    SpiderToolkit,
} from '../src/tools/scraping/spider.js';
import {
    DuckDuckGoSearchTool,
    DuckDuckGoNewsTool,
    WebSearchTool,
    WebSearchToolkit,
} from '../src/tools/scraping/websearch.js';
import {
    WikipediaSearchTool,
    WikipediaToolkit,
} from '../src/tools/scraping/wikipedia.js';
import type { ToolContext } from '../src/tools/core/types.js';
import { ToolCategory } from '../src/tools/core/types.js';

const originalFetch = globalThis.fetch;

function ctx(over: Partial<ToolContext> = {}): ToolContext {
    return {
        toolId: 'tool_test',
        agentId: 'agent_test',
        sessionId: 'sess_test',
        permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        ...over,
    };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

function html(body: string, status = 200) {
    return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
    const saved: Record<string, string | undefined> = {};
    try {
        for (const k of Object.keys(env)) {
            saved[k] = process.env[k];
        }
        for (const [k, v] of Object.entries(env)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        await fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

// ── Apify ───────────────────────────────────────────────────────────────────

describe('Apify tools', () => {
    const cfg = { apiToken: 'apify-token' };

    it('toolkit + no-config default arg', () => {
        expect(new ApifyToolkit(cfg).getTools()).toHaveLength(4);
        expect(new ApifyToolkit().getTools()).toHaveLength(4);
        expect(new ApifyRunActorTool().id).toBeTruthy();
        expect(new ApifyGetRunTool().id).toBeTruthy();
        expect(new ApifyGetDatasetItemsTool().id).toBeTruthy();
        expect(new ApifyRunActorGetDataTool().id).toBeTruthy();
    });

    it('requires APIFY_API_TOKEN when neither config nor env has it', async () => {
        await withEnv({ APIFY_API_TOKEN: undefined }, async () => {
            const r = await new ApifyRunActorTool({}).execute({ actorId: 'a/b' }, ctx());
            expect(r.success).toBe(false);
        });
    });

    it('run actor: all optionals present & absent', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 'run1' })) as typeof fetch;
        const full = await new ApifyRunActorTool(cfg).execute({
            actorId: 'apify/web-scraper',
            input: { url: 'https://x.com' },
            build: 'latest',
            timeoutSecs: 60,
            memoryMbytes: 1024,
            waitForFinish: 30,
        }, ctx());
        expect(full.success).toBe(true);
        expect(full.data?.id).toBe('run1');

        globalThis.fetch = vi.fn(async () => json({ id: 'run2' })) as typeof fetch;
        const bare = await new ApifyRunActorTool(cfg).execute({
            actorId: 'u/actor',
            timeoutSecs: 0,
            waitForFinish: 0,
        }, ctx());
        expect(bare.success).toBe(true);
    });

    it('get run: uses ? and & joiners', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('/actor-runs/r1?token=');
            return json({ id: 'r1', status: 'SUCCEEDED' });
        }) as typeof fetch;
        expect((await new ApifyGetRunTool(cfg).execute({ runId: 'r1' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('/actor-runs/r1?x=1&token=');
            return json({ id: 'r1' });
        }) as typeof fetch;
        expect((await new ApifyGetRunTool(cfg).execute({ runId: 'r1?x=1' }, ctx())).success).toBe(true);
    });

    it('get dataset items: explicit + defaults', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('limit=5');
            expect(String(url)).toContain('offset=2');
            expect(String(url)).toContain('format=csv');
            return json({ items: [] });
        }) as typeof fetch;
        expect((await new ApifyGetDatasetItemsTool(cfg).execute({
            datasetId: 'ds1', limit: 5, offset: 2, format: 'csv',
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('limit=100');
            expect(String(url)).toContain('offset=0');
            expect(String(url)).toContain('format=json');
            return json({ items: [] });
        }) as typeof fetch;
        expect((await new ApifyGetDatasetItemsTool(cfg).execute({ datasetId: 'ds1' }, ctx())).success).toBe(true);
    });

    it('run actor get data: with and without defaultDatasetId', async () => {
        let call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return json({ data: { id: 'run1', defaultDatasetId: 'ds1' } });
            return json([{ x: 1 }]);
        }) as typeof fetch;
        const withDs = await new ApifyRunActorGetDataTool(cfg).execute({
            actorId: 'u/actor',
            input: { a: 1 },
            maxItems: 3,
            timeoutSecs: 120,
        }, ctx());
        expect(withDs.success).toBe(true);
        expect(withDs.data?.items).toEqual([{ x: 1 }]);
        expect(withDs.data?.run?.id).toBe('run1');

        globalThis.fetch = vi.fn(async () => json({ data: {} })) as typeof fetch;
        const noDs = await new ApifyRunActorGetDataTool(cfg).execute({ actorId: 'u/actor' }, ctx());
        expect(noDs.success).toBe(true);
        expect(noDs.data).toEqual({ data: {} });
    });

    it('fails gracefully on HTTP errors', async () => {
        globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
        expect((await new ApifyRunActorTool(cfg).execute({ actorId: 'a/b' }, ctx())).success).toBe(false);
        expect((await new ApifyGetRunTool(cfg).execute({ runId: 'r1' }, ctx())).success).toBe(false);
        expect((await new ApifyGetDatasetItemsTool(cfg).execute({ datasetId: 'd' }, ctx())).success).toBe(false);
        expect((await new ApifyRunActorGetDataTool(cfg).execute({ actorId: 'a/b' }, ctx())).success).toBe(false);

        let call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return json({ data: { defaultDatasetId: 'ds' } });
            return new Response('boom', { status: 500 });
        }) as typeof fetch;
        expect((await new ApifyRunActorGetDataTool(cfg).execute({ actorId: 'a/b' }, ctx())).success).toBe(false);
    });
});

// ── Bright Data ─────────────────────────────────────────────────────────────

describe('Bright Data tools', () => {
    const cfg = { apiToken: 'bd-token', zone: 'bd-zone' };

    it('toolkit + no-config default arg', () => {
        expect(new BrightDataToolkit(cfg).getTools()).toHaveLength(3);
        expect(new BrightDataToolkit().getTools()).toHaveLength(3);
        expect(new BrightDataScrapeTool().id).toBeTruthy();
        expect(new BrightDataSERPSTool().id).toBeTruthy();
        expect(new BrightDataDatasetCollectTool().id).toBeTruthy();
    });

    it('auth: env token + env zone + default zone fallback', async () => {
        globalThis.fetch = vi.fn(async () => html('<p>ok</p>')) as typeof fetch;
        await withEnv({ BRIGHTDATA_API_TOKEN: 'env-token', BRIGHTDATA_ZONE: 'env-zone' }, async () => {
            await new BrightDataScrapeTool({}).execute({ url: 'https://x.com', waitFor: '.sel' }, ctx());
            const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
            const body = JSON.parse(String(init.body));
            expect(body.zone).toBe('env-zone');
        });

        globalThis.fetch = vi.fn(async () => html('<p>ok</p>')) as typeof fetch;
        await withEnv({ BRIGHTDATA_API_TOKEN: 'env-token', BRIGHTDATA_ZONE: undefined }, async () => {
            await new BrightDataScrapeTool({}).execute({ url: 'https://x.com' }, ctx());
            const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
            const body = JSON.parse(String(init.body));
            expect(body.zone).toBe('scraping_browser1');
        });

        await withEnv({ BRIGHTDATA_API_TOKEN: undefined, BRIGHTDATA_ZONE: undefined }, async () => {
            expect((await new BrightDataScrapeTool({}).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);
        });
    });

    it('scrape URL success with waitFor absent/present', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            if (body.wait_for !== undefined) expect(body.wait_for).toBe('.sel');
            return html('<h1>hi</h1>');
        }) as typeof fetch;
        const a = await new BrightDataScrapeTool(cfg).execute({ url: 'https://x.com', waitFor: '.sel' }, ctx());
        expect(a.success).toBe(true);
        expect(a.data?.content).toContain('hi');
        expect(a.data?.format).toBe('markdown');
        const b = await new BrightDataScrapeTool(cfg).execute({ url: 'https://y.com', format: 'html', country: 'GB' }, ctx());
        expect(b.success).toBe(true);
        expect(b.data?.url).toBe('https://y.com');
    });

    it('SERPS: all engines', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            return html(`<div class="result">${body.url}</div>`);
        }) as typeof fetch;

        const google = await new BrightDataSERPSTool(cfg).execute({
            query: 'cats', searchEngine: 'google', numResults: 5, language: 'fr', country: 'FR',
        }, ctx());
        expect(google.success).toBe(true);
        expect(google.data?.engine).toBe('google');

        const bing = await new BrightDataSERPSTool(cfg).execute({
            query: 'cats', searchEngine: 'bing', numResults: 7, country: 'GB',
        }, ctx());
        expect(bing.data?.engine).toBe('bing');
        expect(bing.data?.html).toContain('bing.com');

        const yandex = await new BrightDataSERPSTool(cfg).execute({ query: 'cats', searchEngine: 'yandex' }, ctx());
        expect(yandex.data?.engine).toBe('yandex');
        expect(yandex.data?.html).toContain('yandex.com');
    });

    it('dataset collect with endpoint present/absent', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('endpoint=https');
            return json({ runId: 'rn1' });
        }) as typeof fetch;
        expect((await new BrightDataDatasetCollectTool(cfg).execute({
            datasetId: 'd1', inputs: [{ a: 'b' }], endpoint: 'https://notify.test/cb',
        }, ctx())).data?.runId).toBe('rn1');

        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).not.toContain('endpoint=');
            return json({ runId: 'rn2' });
        }) as typeof fetch;
        expect((await new BrightDataDatasetCollectTool(cfg).execute({
            datasetId: 'd1', inputs: [{ a: 'b' }],
        }, ctx())).data?.runId).toBe('rn2');
    });

    it('fails gracefully on HTTP errors', async () => {
        globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
        expect((await new BrightDataScrapeTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);
        expect((await new BrightDataSERPSTool(cfg).execute({ query: 'q' }, ctx())).success).toBe(false);
        expect((await new BrightDataDatasetCollectTool(cfg).execute({
            datasetId: 'd', inputs: [{ a: 'b' }],
        }, ctx())).success).toBe(false);
    });
});

// ── Browserbase ─────────────────────────────────────────────────────────────

describe('Browserbase tools', () => {
    const cfg = { apiKey: 'bb-key', projectId: 'bb-proj' };

    it('toolkit + no-config default arg', () => {
        expect(new BrowserbaseToolkit(cfg).getTools()).toHaveLength(4);
        expect(new BrowserbaseToolkit().getTools()).toHaveLength(4);
        expect(new BrowserbaseCreateSessionTool().id).toBeTruthy();
        expect(new BrowserbaseGetSessionTool().id).toBeTruthy();
        expect(new BrowserbaseScreenshotTool().id).toBeTruthy();
        expect(new BrowserbaseExtractPageTool().id).toBeTruthy();
    });

    it('auth: env fallback + each missing-key error', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 's1', status: 'running' })) as typeof fetch;
        await withEnv({ BROWSERBASE_API_KEY: 'env-key', BROWSERBASE_PROJECT_ID: 'env-proj' }, async () => {
            expect((await new BrowserbaseCreateSessionTool({}).execute({}, ctx())).success).toBe(true);
        });

        await withEnv({ BROWSERBASE_API_KEY: undefined, BROWSERBASE_PROJECT_ID: undefined }, async () => {
            const r = await new BrowserbaseCreateSessionTool({}).execute({}, ctx());
            expect(r.success).toBe(false);
            expect(r.error?.message).toMatch(/BROWSERBASE_API_KEY/);
        });

        await withEnv({ BROWSERBASE_API_KEY: undefined, BROWSERBASE_PROJECT_ID: undefined }, async () => {
            const r = await new BrowserbaseCreateSessionTool({ apiKey: 'k' }).execute({}, ctx());
            expect(r.success).toBe(false);
            expect(r.error?.message).toMatch(/BROWSERBASE_PROJECT_ID/);
        });
    });

    it('create session: browserSettings present/absent + viewport variants', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.browserSettings.viewport).toEqual({ width: 1920, height: 1080 });
            expect(body.browserSettings.stealth).toBe(true);
            return json({ id: 's1', status: 'running', connectUrl: 'wss://', replayUrl: 'https://' });
        }) as typeof fetch;
        expect((await new BrowserbaseCreateSessionTool(cfg).execute({}, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.browserSettings.viewport).toEqual({ width: 800, height: 600 });
            expect(body.browserSettings.stealth).toBe(false);
            expect(body.timeout).toBe(120);
            expect(body.region).toBe('eu-central-1');
            return json({ id: 's1' });
        }) as typeof fetch;
        expect((await new BrowserbaseCreateSessionTool(cfg).execute({
            browserSettings: {
                viewport: { width: 800, height: 600 },
                stealth: false,
            },
            timeout: 120,
            region: 'eu-central-1',
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.browserSettings.viewport).toEqual({ width: 1920, height: 1080 });
            return json({ id: 's1' });
        }) as typeof fetch;
        expect((await new BrowserbaseCreateSessionTool(cfg).execute({
            browserSettings: {},
        }, ctx())).success).toBe(true);
    });

    it('get session success + failure', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 's1', status: 'running' })) as typeof fetch;
        expect((await new BrowserbaseGetSessionTool(cfg).execute({ sessionId: 's1' }, ctx())).data?.id).toBe('s1');

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 404 })) as typeof fetch;
        expect((await new BrowserbaseGetSessionTool(cfg).execute({ sessionId: 's1' }, ctx())).success).toBe(false);
    });

    it('screenshot: create session then screenshot', async () => {
        let call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return json({ id: 's1' });
            return new Response('shot', { status: 200 });
        }) as typeof fetch;
        const r = await new BrowserbaseScreenshotTool(cfg).execute({
            url: 'https://x.com', fullPage: true, width: 640, height: 480, waitFor: 100,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.sessionId).toBe('s1');
        expect(r.data?.screenshotBase64).toBe(Buffer.from('shot').toString('base64'));
        expect(r.data?.url).toBe('https://x.com');
    });

    it('extract page: data present and absent', async () => {
        let call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return json({ id: 's1' });
            return json({
                title: 'T', content: 'C', links: [{ text: 'a', href: 'https://a.com' }],
            });
        }) as typeof fetch;
        const full = await new BrowserbaseExtractPageTool(cfg).execute({
            url: 'https://x.com', waitFor: 500, selector: '#main',
        }, ctx());
        expect(full.success).toBe(true);
        expect(full.data?.title).toBe('T');
        expect(full.data?.links![0]?.href).toBe('https://a.com');

        call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return json({ id: 's1' });
            return json({});
        }) as typeof fetch;
        const bare = await new BrowserbaseExtractPageTool(cfg).execute({ url: 'https://x.com' }, ctx());
        expect(bare.data?.title).toBe('');
        expect(bare.data?.content).toBe('');
        expect(bare.data?.links).toEqual([]);
    });

    it('fails gracefully on HTTP errors', async () => {
        globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
        expect((await new BrowserbaseCreateSessionTool(cfg).execute({}, ctx())).success).toBe(false);
        expect((await new BrowserbaseGetSessionTool(cfg).execute({ sessionId: 's1' }, ctx())).success).toBe(false);

        let call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return new Response('boom', { status: 500 });
            return json({ id: 's1' });
        }) as typeof fetch;
        expect((await new BrowserbaseScreenshotTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);

        call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return json({ id: 's1' });
            return new Response('boom', { status: 500 });
        }) as typeof fetch;
        expect((await new BrowserbaseScreenshotTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);

        call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return new Response('boom', { status: 500 });
            return json({ id: 's1' });
        }) as typeof fetch;
        expect((await new BrowserbaseExtractPageTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);

        call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return json({ id: 's1' });
            return new Response('boom', { status: 500 });
        }) as typeof fetch;
        expect((await new BrowserbaseExtractPageTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);
    });
});

// ── Crawl4AI ────────────────────────────────────────────────────────────────

describe('Crawl4AI tools', () => {
    const cfg = { apiToken: 'c4-token', host: 'https://crawl.test/' };

    it('toolkit + no-config default arg', () => {
        expect(new Crawl4AIToolkit(cfg).getTools()).toHaveLength(3);
        expect(new Crawl4AIToolkit().getTools()).toHaveLength(3);
        expect(new Crawl4AICrawlUrlTool().id).toBeTruthy();
        expect(new Crawl4AICrawlMultipleTool().id).toBeTruthy();
        expect(new Crawl4AIExtractStructuredTool().id).toBeTruthy();
    });

    it('auth: token header present/absent, host default + env', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            expect(String(url)).toBe('https://crawl.test/crawl');
            expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer c4-token' });
            return json({ ok: true });
        }) as typeof fetch;
        expect((await new Crawl4AICrawlUrlTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({ ok: true })) as typeof fetch;
        await withEnv({ CRAWL4AI_API_TOKEN: 'env-token', CRAWL4AI_HOST: 'https://env.host' }, async () => {
            expect((await new Crawl4AICrawlUrlTool({}).execute({ url: 'https://x.com' }, ctx())).success).toBe(true);
        });

        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toBe('https://api.crawl4ai.com/crawl');
            return json({ ok: true });
        }) as typeof fetch;
        expect((await new Crawl4AICrawlUrlTool({}).execute({ url: 'https://x.com' }, ctx())).success).toBe(true);
    });

    it('crawl url: all optionals present/absent', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.wait_for).toBe('.sel');
            expect(body.extraction_schema).toEqual({ fields: [] });
            expect(body.screenshot_options).toEqual({ full_page: false, quality: 90 });
            return json({ markdown: '# hi' });
        }) as typeof fetch;
        const full = await new Crawl4AICrawlUrlTool(cfg).execute({
            url: 'https://x.com',
            extractionType: 'json',
            jsEnabled: false,
            bypassCache: true,
            waitFor: '.sel',
            extractionSchema: { fields: [] },
            screenshotOptions: { fullPage: false, quality: 90 },
        }, ctx());
        expect(full.success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.wait_for).toBeUndefined();
            expect(body.screenshot_options).toBeUndefined();
            return json({ markdown: '# hi' });
        }) as typeof fetch;
        expect((await new Crawl4AICrawlUrlTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(true);
    });

    it('crawl multiple + extract structured', async () => {
        globalThis.fetch = vi.fn(async () => json([{ url: 'https://x.com' }])) as typeof fetch;
        const multi = await new Crawl4AICrawlMultipleTool(cfg).execute({
            urls: ['https://x.com', 'https://y.com'],
            extractionType: 'html',
            jsEnabled: false,
        }, ctx());
        expect(multi.success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.instruction).toBe('extract');
            expect(body.extraction_schema).toEqual({ a: 'string' });
            return json({ result: {} });
        }) as typeof fetch;
        expect((await new Crawl4AIExtractStructuredTool(cfg).execute({
            url: 'https://x.com', schema: { a: 'string' }, instruction: 'extract', jsEnabled: false,
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.instruction).toBeUndefined();
            return json({ result: {} });
        }) as typeof fetch;
        expect((await new Crawl4AIExtractStructuredTool(cfg).execute({
            url: 'https://x.com', schema: { a: 'string' },
        }, ctx())).success).toBe(true);
    });

    it('fails gracefully on HTTP errors', async () => {
        globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
        expect((await new Crawl4AICrawlUrlTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);
        expect((await new Crawl4AICrawlMultipleTool(cfg).execute({ urls: ['https://x.com'] }, ctx())).success).toBe(false);
        expect((await new Crawl4AIExtractStructuredTool(cfg).execute({
            url: 'https://x.com', schema: { a: 'b' },
        }, ctx())).success).toBe(false);
    });
});

// ── HackerNews ──────────────────────────────────────────────────────────────

describe('HackerNews tools', () => {
    it('toolkit create variants', () => {
        expect(HackerNewsToolkit.create()).toHaveLength(2);
        expect(HackerNewsToolkit.create({ enableTopStories: false })).toHaveLength(1);
        expect(HackerNewsToolkit.create({ enableUserDetails: false })).toHaveLength(1);
        expect(HackerNewsToolkit.create({ enableTopStories: false, enableUserDetails: false })).toHaveLength(0);
    });

    it('top stories: full fetch, skip, empty ids, rejected story, bad response', async () => {
        let call = 0;
        globalThis.fetch = vi.fn(async (url) => {
            call++;
            const u = String(url);
            if (u.includes('/topstories')) return json([1, 2, 3]);
            if (u.includes('/item/1.json')) return json({ id: 1, title: 'One', by: 'alice', score: 10 });
            if (u.includes('/item/2.json')) return new Response(null, { status: 404 });
            return json({ id: 3, title: 'Three' });
        }) as typeof fetch;
        const ok = await new HackerNewsTopStoriesTool().execute({ num_stories: 3 }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.stories).toHaveLength(2);
        expect(ok.data?.stories![0]?.username).toBe('alice');
        expect(ok.data?.stories![1]?.username).toBeUndefined();

        globalThis.fetch = vi.fn(async () => json([])) as typeof fetch;
        expect((await new HackerNewsTopStoriesTool().execute({}, ctx())).data?.stories).toEqual([]);

        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('/topstories')) return json([7]);
            throw new Error('item down');
        }) as typeof fetch;
        expect((await new HackerNewsTopStoriesTool().execute({}, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json([])) as typeof fetch;
        expect((await new HackerNewsTopStoriesTool({ name: 'custom', category: ToolCategory.UTILITY }).execute({}, ctx())).success).toBe(true);
    });

    it('top stories: outer error paths', async () => {
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
        const r = await new HackerNewsTopStoriesTool().execute({}, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.error).toMatch(/Failed to fetch top stories: 500/);

        globalThis.fetch = vi.fn(async () => { throw 'string-boom'; }) as typeof fetch;
        expect((await new HackerNewsTopStoriesTool().execute({}, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('user: full, missing, null, and error paths', async () => {
        globalThis.fetch = vi.fn(async () => json({
            id: 'alice', karma: 100, about: 'A person', submitted: [1, 2],
        })) as typeof fetch;
        const full = await new HackerNewsUserTool().execute({ username: 'alice' }, ctx());
        expect(full.success).toBe(true);
        expect(full.data?.user?.total_items_submitted).toBe(2);
        expect(full.data?.user?.id).toBe('alice');
        expect(full.data?.user?.karma).toBe(100);
        expect(full.data?.user?.about).toBe('A person');

        globalThis.fetch = vi.fn(async () => json({ id: 'bob' })) as typeof fetch;
        const partial = await new HackerNewsUserTool().execute({ username: 'bob' }, ctx());
        expect(partial.data?.user?.total_items_submitted).toBe(0);
        expect(partial.data?.user?.id).toBe('bob');
        expect(partial.data?.user?.karma).toBeUndefined();

        globalThis.fetch = vi.fn(async () => json(null)) as typeof fetch;
        const nul = await new HackerNewsUserTool().execute({ username: 'ghost' }, ctx());
        expect(nul.data?.error).toBe('User ghost not found');

        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
        const bad = await new HackerNewsUserTool({ name: 'custom', category: ToolCategory.UTILITY }).execute({ username: 'alice' }, ctx());
        expect(bad.data?.error).toMatch(/Failed to fetch user details: 500/);

        globalThis.fetch = vi.fn(async () => { throw 42; }) as typeof fetch;
        expect((await new HackerNewsUserTool().execute({ username: 'x' }, ctx())).data?.error).toBe('Unknown error occurred');
    });
});

// ── Playwright ──────────────────────────────────────────────────────────────

describe('Playwright page title tool', () => {
    it('returns document title using mocked playwright', async () => {
        const close = vi.fn(async () => {});
        const goto = vi.fn(async () => {});
        const title = vi.fn(async () => 'Mocked Title');
        vi.doMock('playwright', () => ({
            chromium: {
                launch: vi.fn(async () => ({
                    newPage: vi.fn(async () => ({ goto, title })),
                    close,
                })),
            },
        }));
        vi.resetModules();
        const { PlaywrightPageTitleTool } = await import('../src/tools/scraping/playwright.js');
        const r = await new PlaywrightPageTitleTool().execute({
            url: 'https://example.com', timeoutMs: 30_000,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.title).toBe('Mocked Title');
        expect(close).toHaveBeenCalled();
        expect(goto).toHaveBeenCalledWith('https://example.com', {
            timeout: 30_000, waitUntil: 'domcontentloaded',
        });
    });

    it('default timeout + page navigation failure closes the browser', async () => {
        const close = vi.fn(async () => {});
        const goto = vi.fn(async () => { throw new Error('goto failed'); });
        vi.doMock('playwright', () => ({
            chromium: {
                launch: vi.fn(async () => ({
                    newPage: vi.fn(async () => ({ goto, title: vi.fn() })),
                    close,
                })),
            },
        }));
        vi.resetModules();
        const { PlaywrightPageTitleTool } = await import('../src/tools/scraping/playwright.js');
        const r = await new PlaywrightPageTitleTool().execute({ url: 'https://example.com' }, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/goto failed/);
        expect(close).toHaveBeenCalled();
    });

    it('fails when playwright package is unavailable', async () => {
        vi.doMock('playwright', () => {
            throw new Error('cannot find module playwright');
        });
        vi.resetModules();
        const { PlaywrightPageTitleTool } = await import('../src/tools/scraping/playwright.js');
        const r = await new PlaywrightPageTitleTool().execute({ url: 'https://example.com' }, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/requires the `playwright` package/);
    });
});

// ── ScrapeGraph ─────────────────────────────────────────────────────────────

describe('ScrapeGraph tools', () => {
    const cfg = { apiKey: 'sg-key' };

    it('toolkit + no-config default arg + missing key', async () => {
        expect(new ScrapeGraphToolkit(cfg).getTools()).toHaveLength(3);
        expect(new ScrapeGraphToolkit().getTools()).toHaveLength(3);
        expect(new ScrapeGraphSmartScraperTool().id).toBeTruthy();
        expect(new ScrapeGraphSearchGraphTool().id).toBeTruthy();
        expect(new ScrapeGraphMarkdownifyTool().id).toBeTruthy();

        await withEnv({ SGAI_API_KEY: undefined }, async () => {
            expect((await new ScrapeGraphSmartScraperTool({}).execute({
                url: 'https://x.com', prompt: 'p',
            }, ctx())).success).toBe(false);
        });
    });

    it('env key fallback + smart scraper schema present/absent', async () => {
        globalThis.fetch = vi.fn(async () => json({ result: 'ok' })) as typeof fetch;
        await withEnv({ SGAI_API_KEY: 'env-key' }, async () => {
            expect((await new ScrapeGraphSmartScraperTool({}).execute({
                url: 'https://x.com', prompt: 'p',
            }, ctx())).success).toBe(true);
        });

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.output_schema).toEqual({ a: 'string' });
            return json({ result: 'ok' });
        }) as typeof fetch;
        const full = await new ScrapeGraphSmartScraperTool(cfg).execute({
            url: 'https://x.com', prompt: 'extract title', schema: { a: 'string' },
        }, ctx());
        expect(full.success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.output_schema).toBeUndefined();
            return json({ result: 'ok' });
        }) as typeof fetch;
        expect((await new ScrapeGraphSmartScraperTool(cfg).execute({
            url: 'https://x.com', prompt: 'p',
        }, ctx())).success).toBe(true);
    });

    it('search graph: numPages + schema present/absent', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.max_results).toBe(5);
            expect(body.output_schema).toEqual({ x: 'number' });
            return json({ result: 'ok' });
        }) as typeof fetch;
        expect((await new ScrapeGraphSearchGraphTool(cfg).execute({
            query: 'q', numPages: 5, schema: { x: 'number' },
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.max_results).toBe(3);
            expect(body.output_schema).toBeUndefined();
            return json({ result: 'ok' });
        }) as typeof fetch;
        expect((await new ScrapeGraphSearchGraphTool(cfg).execute({ query: 'q' }, ctx())).success).toBe(true);
    });

    it('markdownify + failures', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.website_url).toBe('https://x.com');
            return json({ markdown: '# m' });
        }) as typeof fetch;
        expect((await new ScrapeGraphMarkdownifyTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
        expect((await new ScrapeGraphSmartScraperTool(cfg).execute({
            url: 'https://x.com', prompt: 'p',
        }, ctx())).success).toBe(false);
        expect((await new ScrapeGraphSearchGraphTool(cfg).execute({ query: 'q' }, ctx())).success).toBe(false);
        expect((await new ScrapeGraphMarkdownifyTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);
    });
});

// ── Spider ──────────────────────────────────────────────────────────────────

describe('Spider tools', () => {
    const cfg = { apiKey: 'sp-key' };

    it('toolkit + no-config default arg + missing key', async () => {
        expect(new SpiderToolkit(cfg).getTools()).toHaveLength(3);
        expect(new SpiderToolkit().getTools()).toHaveLength(3);
        expect(new SpiderCrawlTool().id).toBeTruthy();
        expect(new SpiderScrapeTool().id).toBeTruthy();
        expect(new SpiderSearchTool().id).toBeTruthy();

        await withEnv({ SPIDER_API_KEY: undefined }, async () => {
            expect((await new SpiderCrawlTool({}).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);
        });
    });

    it('crawl: depth/jsRender/subpages options', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.depth).toBe(2);
            expect(body.request).toBe('chrome');
            expect(body.subpages).toBe(false);
            expect(body.limit).toBe(5);
            return json([{ url: 'https://x.com' }]);
        }) as typeof fetch;
        expect((await new SpiderCrawlTool(cfg).execute({
            url: 'https://x.com', limit: 5, depth: 2, jsRender: true, subpages: false, requestTimeout: 15,
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.depth).toBeUndefined();
            expect(body.request).toBe('http');
            expect(body.subpages).toBe(true);
            return json([{ url: 'https://x.com' }]);
        }) as typeof fetch;
        expect((await new SpiderCrawlTool(cfg).execute({
            url: 'https://x.com', jsRender: false, returnFormat: 'raw',
        }, ctx())).success).toBe(true);
    });

    it('scrape: screenshotOptions variants', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.screenshot).toBe(true);
            expect(body.screenshot_full_page).toBe(true);
            return json([{ content: 'x' }]);
        }) as typeof fetch;
        expect((await new SpiderScrapeTool(cfg).execute({
            url: 'https://x.com', screenshotOptions: { enabled: true, fullPage: true },
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.screenshot).toBeUndefined();
            return json([{ content: 'x' }]);
        }) as typeof fetch;
        expect((await new SpiderScrapeTool(cfg).execute({
            url: 'https://x.com', screenshotOptions: { enabled: false },
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.screenshot).toBe(true);
            expect(body.screenshot_full_page).toBe(false);
            expect(body.return_format).toBe('text');
            expect(body.request).toBe('http');
            return json([{ content: 'x' }]);
        }) as typeof fetch;
        expect((await new SpiderScrapeTool(cfg).execute({
            url: 'https://x.com', jsRender: false, returnFormat: 'text', screenshotOptions: { enabled: true, fullPage: false },
        }, ctx())).success).toBe(true);
    });

    it('crawl/scrape/search fail gracefully on HTTP errors', async () => {
        globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
        expect((await new SpiderCrawlTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);
        expect((await new SpiderScrapeTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(false);
        expect((await new SpiderSearchTool(cfg).execute({ query: 'q' }, ctx())).success).toBe(false);
    });

    it('search: options + failure', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            expect(body.limit).toBe(5);
            expect(body.return_format).toBe('raw');
            expect(body.fetch_page_content).toBe(true);
            return json([{ url: 'https://x.com' }]);
        }) as typeof fetch;
        expect((await new SpiderSearchTool(cfg).execute({
            query: 'q', limit: 5, returnFormat: 'raw', fetch: true,
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
        expect((await new SpiderSearchTool(cfg).execute({ query: 'q' }, ctx())).success).toBe(false);
    });
});

// ── WebSearch ───────────────────────────────────────────────────────────────

describe('WebSearch tools', () => {
    const GOOD_HTML = [
        '<a class="result__a" href="https://a.com">Alpha</a>',
        '<a class="result__a" href="/relative">Rel</a>',
        '<a class="result__a" href="">Empty href</a>',
        '<a class="result__a" href="https://b.com"><b>Bold</b></a>',
        '<a class="result__a" href="https://c.com"></a>',
    ].join('\n');

    it('toolkit create variants', () => {
        expect(WebSearchToolkit.createDuckDuckGo()).toHaveLength(2);
        expect(WebSearchToolkit.createDuckDuckGo({ modifier: 'site:example.com' })).toHaveLength(2);
        expect(WebSearchToolkit.createDuckDuckGo({ enableNews: false })).toHaveLength(1);
        expect(WebSearchToolkit.createGeneric()).toHaveLength(1);
        expect(WebSearchToolkit.createGeneric({ modifier: 'm' })).toHaveLength(1);

        const withMod = new DuckDuckGoSearchTool({ modifier: 'site:x' });
        expect((withMod as unknown as { modifier?: string }).modifier).toBe('site:x');
        expect(new DuckDuckGoSearchTool({ name: 'custom', category: ToolCategory.UTILITY }).name).toBe('custom');
    });

    it('ddg search: parses results, skips relative/empty, untitled fallback', async () => {
        globalThis.fetch = vi.fn(async () => html(GOOD_HTML)) as typeof fetch;
        const r = await new DuckDuckGoSearchTool().execute({ query: 'cats', max_results: 10 }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.backend).toBe('duckduckgo');
        expect(r.data?.query).toBe('cats');
        expect(r.data?.results).toHaveLength(3);
        expect(r.data?.results![0]).toMatchObject({ title: 'Alpha', url: 'https://a.com', source: 'DuckDuckGo' });
        expect(r.data?.results![1]?.title).toBe('Bold');
        expect(r.data?.results![2]?.title).toBe('Untitled');

        globalThis.fetch = vi.fn(async () => html('<p>nothing here</p>')) as typeof fetch;
        const empty = await new DuckDuckGoSearchTool().execute({ query: 'zzz', max_results: 10 }, ctx());
        expect(empty.data?.results).toEqual([]);
    });

    it('ddg search: modifier + error fallback', async () => {
        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        const tool = new DuckDuckGoSearchTool({ modifier: 'site:x.com' });
        const r = await tool.execute({ query: 'cats' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.query).toBe('site:x.com cats');
        expect(r.data?.results).toEqual([]);

        globalThis.fetch = vi.fn(async () => { throw new Error('net down'); }) as typeof fetch;
        expect((await tool.execute({ query: 'cats' }, ctx())).data?.results).toEqual([]);
    });

    it('ddg news: parses + error fallback', async () => {
        globalThis.fetch = vi.fn(async () => html(GOOD_HTML)) as typeof fetch;
        const r = await new DuckDuckGoNewsTool().execute({ query: 'news', max_results: 5 }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.results![0]?.source).toBe('DuckDuckGo News');
        expect(r.data?.results).toHaveLength(3);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        const bad = await new DuckDuckGoNewsTool().execute({ query: 'news' }, ctx());
        expect(bad.data?.results).toEqual([]);
    });

    it('web search tool: duckduckgo backend + modifier + failures', async () => {
        globalThis.fetch = vi.fn(async () => html(GOOD_HTML)) as typeof fetch;
        const r = await new WebSearchTool({ modifier: 'm' }).execute({ query: 'q', max_results: 10 }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.query).toBe('m q');
        expect(r.data?.results).toHaveLength(3);
        expect(r.data?.backend).toBe('duckduckgo');

        globalThis.fetch = vi.fn(async () => html('<p>x</p>')) as typeof fetch;
        const plain = await new WebSearchTool().execute({ query: 'q' }, ctx());
        expect(plain.data?.query).toBe('q');

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        expect((await new WebSearchTool().execute({ query: 'q' }, ctx())).data?.results).toEqual([]);

        globalThis.fetch = vi.fn(async () => { throw 'x'; }) as typeof fetch;
        expect((await new WebSearchTool().execute({ query: 'q', backend: 'duckduckgo' }, ctx())).data?.results).toEqual([]);
    });
});

// ── Wikipedia ───────────────────────────────────────────────────────────────

describe('Wikipedia tools', () => {
    it('toolkit creates one tool', () => {
        expect(WikipediaToolkit.create()).toHaveLength(1);
        expect(new WikipediaSearchTool({ name: 'custom', category: ToolCategory.UTILITY }).name).toBe('custom');
    });

    it('summary: full data + fallback to title/url', async () => {
        const fullUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent('Alberta')}`;
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toBe(fullUrl);
            return json({
                title: 'Alberta', extract: 'A province.',
                content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Alberta' } },
            });
        }) as typeof fetch;
        const full = await new WikipediaSearchTool().execute({ query: 'Alberta' }, ctx());
        expect(full.success).toBe(true);
        expect(full.data?.title).toBe('Alberta');
        expect(full.data?.content).toBe('A province.');
        expect(full.data?.url).toBe('https://en.wikipedia.org/wiki/Alberta');

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const bare = await new WikipediaSearchTool().execute({ query: 'foo bar' }, ctx());
        expect(bare.data?.title).toBe('foo bar');
        expect(bare.data?.content).toBe('No summary available');
        expect(bare.data?.url).toBe(`https://en.wikipedia.org/wiki/${encodeURIComponent('foo_bar')}`);
    });

    it('fallback: search then summary; no results; null first result; snippet fallback', async () => {
        let call = 0;
        globalThis.fetch = vi.fn(async (url) => {
            call++;
            if (call === 1) return new Response('no', { status: 404 });
            if (call === 2) return json({ query: { search: [{ title: 'Alpha', snippet: '<b>snip</b>' }] } });
            return json({ title: 'Alpha', extract: 'Full extract.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Alpha' } } });
        }) as typeof fetch;
        const ok = await new WikipediaSearchTool().execute({ query: 'Alpha' }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.content).toBe('Full extract.');

        call = 0;
        globalThis.fetch = vi.fn(async (url) => {
            call++;
            if (call === 1) return new Response('no', { status: 404 });
            if (call === 2) return json({ query: { search: [{ title: 'Alpha', snippet: '<b>snip</b>' }] } });
            return new Response('no', { status: 500 });
        }) as typeof fetch;
        const snippet = await new WikipediaSearchTool().execute({ query: 'Alpha' }, ctx());
        expect(snippet.data?.title).toBe('Alpha');
        expect(snippet.data?.content).toBe('snip');
        expect(snippet.data?.url).toBe('https://en.wikipedia.org/wiki/Alpha');

        call = 0;
        globalThis.fetch = vi.fn(async (url) => {
            call++;
            if (call === 1) return new Response('no', { status: 404 });
            if (call === 2) return json({ query: { search: [] } });
            return json({});
        }) as typeof fetch;
        const none = await new WikipediaSearchTool().execute({ query: 'nope' }, ctx());
        expect(none.data?.title).toBe('nope');
        expect(none.data?.content).toBe('No results found on Wikipedia');

        call = 0;
        globalThis.fetch = vi.fn(async (url) => {
            call++;
            if (call === 1) return new Response('no', { status: 404 });
            if (call === 2) return json({});
            return json({});
        }) as typeof fetch;
        const noQuery = await new WikipediaSearchTool().execute({ query: 'nope' }, ctx());
        expect(noQuery.data?.content).toBe('No results found on Wikipedia');

        call = 0;
        globalThis.fetch = vi.fn(async (url) => {
            call++;
            if (call === 1) return new Response('no', { status: 404 });
            if (call === 2) return json({ query: { search: [{ title: 'Alpha', snippet: '<b>snip</b>' }] } });
            return json({});
        }) as typeof fetch;
        const emptySummary = await new WikipediaSearchTool().execute({ query: 'Alpha' }, ctx());
        expect(emptySummary.data?.title).toBe('Alpha');
        expect(emptySummary.data?.content).toBe('snip');
        expect(emptySummary.data?.url).toBe('https://en.wikipedia.org/wiki/Alpha');

        call = 0;
        globalThis.fetch = vi.fn(async (url) => {
            call++;
            if (call === 1) return new Response('no', { status: 404 });
            if (call === 2) return json({ query: { search: [null] } });
            return json({});
        }) as typeof fetch;
        const nul = await new WikipediaSearchTool().execute({ query: 'nope' }, ctx());
        expect(nul.data?.content).toBe('No results found on Wikipedia');
    });

    it('fallback: search API failure + catch error variants', async () => {
        let call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return new Response('no', { status: 404 });
            return new Response('no', { status: 500 });
        }) as typeof fetch;
        const err = await new WikipediaSearchTool().execute({ query: 'q' }, ctx());
        expect(err.success).toBe(true);
        expect(err.data?.error).toMatch(/Wikipedia search failed: 500/);

        globalThis.fetch = vi.fn(async () => { throw new Error('net'); }) as typeof fetch;
        const thrown = await new WikipediaSearchTool().execute({ query: 'q' }, ctx());
        expect(thrown.data?.error).toBe('net');

        globalThis.fetch = vi.fn(async () => { throw 'str'; }) as typeof fetch;
        expect((await new WikipediaSearchTool().execute({ query: 'q' }, ctx())).data?.error).toBe('Unknown error occurred');

        let set = false;
        globalThis.fetch = vi.fn(async () => {
            if (!set) { set = true; return new Response('no', { status: 404 }); }
            throw 'inner-str';
        }) as typeof fetch;
        const inner = await new WikipediaSearchTool().execute({ query: 'q' }, ctx());
        expect(inner.data?.error).toBe('Unknown error occurred');
    });
});
