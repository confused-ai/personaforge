/**
 * Hermetic coverage for search/discovery tools:
 * arxiv, brave, exa, firecrawl, google-maps, jina, linkup, newspaper,
 * perplexity, pubmed, reddit, searxng, serper, tavily, weather, youtube.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ToolContext } from '../src/tools/core/types.js';

import { ArxivSearchTool, ArxivGetPaperTool, ArxivToolkit } from '../src/tools/search/arxiv.js';
import {
    BraveSearchTool,
    BraveNewsSearchTool,
    BraveSearchToolkit,
} from '../src/tools/search/bravesearch.js';
import { ExaSearchTool, ExaFindSimilarTool, ExaGetContentsTool, ExaToolkit } from '../src/tools/search/exa.js';
import {
    FirecrawlScrapeTool,
    FirecrawlCrawlTool,
    FirecrawlMapTool,
    FirecrawlToolkit,
} from '../src/tools/search/firecrawl.js';
import {
    GoogleMapsSearchPlacesTool,
    GoogleMapsGeocodeTool,
    GoogleMapsReverseGeocodeTool,
    GoogleMapsDirectionsTool,
    GoogleMapsPlaceDetailsTool,
    GoogleMapsToolkit,
} from '../src/tools/search/google-maps.js';
import { JinaReaderTool, JinaSearchTool, JinaRerankTool, JinaToolkit } from '../src/tools/search/jina.js';
import { LinkupSearchTool, LinkupToolkit } from '../src/tools/search/linkup.js';
import {
    GetNewsArticleTool,
    SearchNewsTool,
    GetTopHeadlinesTool,
    NewspaperToolkit,
} from '../src/tools/search/newspaper.js';
import { PerplexitySearchTool, PerplexityToolkit } from '../src/tools/search/perplexity.js';
import { PubMedSearchTool, PubMedGetArticleTool, PubMedToolkit } from '../src/tools/search/pubmed.js';
import { RedditSearchTool, RedditGetPostsTool, RedditToolkit } from '../src/tools/search/reddit.js';
import { SearXNGSearchTool, SearXNGToolkit } from '../src/tools/search/searxng.js';
import {
    SerperWebSearchTool,
    SerperNewsSearchTool,
    SerperScholarSearchTool,
    SerperScrapeTool,
    SerperToolkit,
} from '../src/tools/search/serper.js';
import { TavilySearchTool, TavilyExtractTool, TavilyToolkit } from '../src/tools/search/tavily.js';
import { OpenWeatherCurrentTool, OpenWeatherForecastTool, OpenWeatherToolkit } from '../src/tools/search/weather.js';
import { YouTubeSearchTool, YouTubeGetVideoTool, YouTubeToolkit } from '../src/tools/search/youtube.js';

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
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function runFail(p: Promise<{ success: boolean }>) {
    const r = await p;
    expect(r.success).toBe(false);
    return r;
}

function saveEnv(name: string): string | undefined {
    return process.env[name];
}

function restoreEnv(name: string, prev: string | undefined) {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
}

describe('Arxiv tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const XML = `<feed>
  <entry>
    <id>http://arxiv.org/abs/2301.07041v2</id>
    <title> A   Test  Paper </title>
    <summary>Short summary text.</summary>
    <author><name>Alice</name></author>
    <author><name /></author>
    <published>2023-01-17T00:00:00Z</published>
    <updated>2023-01-18T00:00:00Z</updated>
    <link title="pdf" href="http://arxiv.org/pdf/2301.07041v2"/>
    <category term="cs.AI"/>
  </entry>
  <entry>
    <id>math.ST/2201.00001</id>
    <title>Another</title>
    <summary>abs</summary>
  </entry>
</feed>`;

    it('toolkit exposes both tools', () => {
        const t = new ArxivToolkit();
        expect(t.tools).toHaveLength(2);
    });

    it('rejects invalid input via schema', async () => {
        const r = await new ArxivSearchTool().execute({}, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.code).toBe('VALIDATION_ERROR');
        expect(new ArxivSearchTool().validate({ query: 'x' })).toBe(true);
        expect(new ArxivSearchTool().validate({})).toBe(false);
    });

    it('search with category + parse both entry variants', async () => {
        let lastUrl = '';
        globalThis.fetch = vi.fn(async (url) => {
            lastUrl = String(url);
            return new Response(XML, { status: 200 });
        }) as typeof fetch;

        const r = await new ArxivSearchTool().execute({
            query: 'transformers',
            category: 'cs.AI',
            maxResults: 5,
            sortBy: 'submittedDate',
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.total).toBe(2);
        expect(lastUrl).toContain('+AND+cat%3Acs.AI');
        const [a, b] = r.data!.papers;
        expect(a.id).toBe('2301.07041v2');
        expect(a.title).toBe('A Test Paper');
        expect(a.authors).toEqual(['Alice']);
        expect(a.pdfUrl).toBe('http://arxiv.org/pdf/2301.07041v2');
        expect(a.categories).toEqual(['cs.AI']);
        expect(a.published).toBe('2023-01-17T00:00:00Z');
        expect(b.id).toBe('2201.00001');
        expect(b.authors).toEqual([]);
        expect(b.pdfUrl).toBe('https://arxiv.org/pdf/2201.00001');
        expect(b.categories).toEqual([]);
        expect(b.published).toBe('');
    });

    it('search without category + empty result set', async () => {
        globalThis.fetch = vi.fn(async () => new Response('<feed></feed>', { status: 200 })) as typeof fetch;
        const r = await new ArxivSearchTool().execute({ query: 'x' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.papers).toEqual([]);
        expect(r.data?.total).toBe(0);
    });

    it('search error path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('err', { status: 500 })) as typeof fetch;
        await runFail(new ArxivSearchTool().execute({ query: 'x' }, ctx()));
    });

    it('get paper with plain id, full abs url, and pdf url', async () => {
        let lastUrl = '';
        globalThis.fetch = vi.fn(async (url) => {
            lastUrl = String(url);
            return new Response('<feed><entry><id>http://arxiv.org/abs/2301.07041</id><title>T</title><summary>S</summary></entry></feed>', { status: 200 });
        }) as typeof fetch;

        expect((await new ArxivGetPaperTool().execute({ paperId: '2301.07041' }, ctx())).data?.id).toBe('2301.07041');
        await new ArxivGetPaperTool().execute({ paperId: 'https://arxiv.org/abs/2301.07041v3' }, ctx());
        expect(lastUrl).toContain('id_list=2301.07041');
        await new ArxivGetPaperTool().execute({ paperId: 'https://arxiv.org/pdf/2301.07041.pdf' }, ctx());
        expect(lastUrl).toContain('id_list=2301.07041');
    });

    it('get paper returns null when no entries', async () => {
        globalThis.fetch = vi.fn(async () => new Response('<feed><entry /></feed>', { status: 200 })) as typeof fetch;
        const r = await new ArxivGetPaperTool().execute({ paperId: '999' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data).toBeNull();
    });

    it('get paper error path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('err', { status: 400 })) as typeof fetch;
        await runFail(new ArxivGetPaperTool().execute({ paperId: '1' }, ctx()));
    });
});

describe('Brave Search tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const cfg = { apiKey: 'bk' };

    it('requires key + toolkit', async () => {
        const prev = process.env['BRAVE_API_KEY'];
        delete process.env['BRAVE_API_KEY'];
        await runFail(new BraveSearchTool({}).execute({ query: 'x' }, ctx()));
        await runFail(new BraveNewsSearchTool({}).execute({ query: 'x' }, ctx()));
        restoreEnv('BRAVE_API_KEY', prev);

        const tk = new BraveSearchToolkit({ apiKey: 'bk' });
        expect(tk.getTools()).toHaveLength(2);
        expect(tk.search).toBeInstanceOf(BraveSearchTool);
    });

    it('web search with all optional params + config fallbacks', async () => {
        globalThis.fetch = vi.fn(async () => json({
            web: { results: [{ title: 'T', url: 'u', description: 'd', age: '2023-01-01' }] },
        })) as typeof fetch;
        const full = await new BraveSearchTool(cfg).execute({
            query: 'q', maxResults: 3, country: 'GB', searchLang: 'de', freshness: 'pd', safesearch: 'strict',
        }, ctx());
        expect(full.success).toBe(true);
        expect(full.data?.webResults[0]?.age).toBe('2023-01-01');
        expect(full.data?.totalResults).toBe(1);

        // config fallbacks for maxResults/language, no age on result
        globalThis.fetch = vi.fn(async () => json({
            web: { results: [{ title: 'T', url: 'u', description: 'd' }] },
        })) as typeof fetch;
        const cfgFallback = await new BraveSearchTool({ apiKey: 'bk', maxResults: 7, language: 'fr' }).execute({
            query: 'q', freshness: 'pw',
        }, ctx());
        expect(cfgFallback.success).toBe(true);
        expect(cfgFallback.data?.webResults[0]?.age).toBeUndefined();

        // no input/config, no age
        globalThis.fetch = vi.fn(async () => json({ web: { results: [] } })) as typeof fetch;
        const none = await new BraveSearchTool({ apiKey: 'bk' }).execute({ query: 'q' }, ctx());
        expect(none.data?.totalResults).toBe(0);
    });

    it('web search error path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch;
        await runFail(new BraveSearchTool(cfg).execute({ query: 'q' }, ctx()));
    });

    it('news search with age + source and without', async () => {
        globalThis.fetch = vi.fn(async () => json({
            results: [{
                title: 'T', url: 'u', description: 'd', age: '2023-02-02', meta_url: { hostname: 'cnn.com' },
            }],
        })) as typeof fetch;
        const full = await new BraveNewsSearchTool(cfg).execute({
            query: 'n', freshness: 'pm', country: 'DE', maxResults: 2,
        }, ctx());
        expect(full.success).toBe(true);
        expect(full.data?.newsResults[0]?.age).toBe('2023-02-02');
        expect(full.data?.newsResults[0]?.source).toBe('cnn.com');

        globalThis.fetch = vi.fn(async () => json({
            results: [{ title: 'T', url: 'u', description: 'd' }],
        })) as typeof fetch;
        const none = await new BraveNewsSearchTool(cfg).execute({ query: 'n' }, ctx());
        expect(none.data?.newsResults[0]?.age).toBeUndefined();
        expect(none.data?.newsResults[0]?.source).toBeUndefined();

        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        expect((await new BraveNewsSearchTool(cfg).execute({ query: 'n' }, ctx())).data?.newsResults).toEqual([]);
    });

    it('news search error path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('bad', { status: 500 })) as typeof fetch;
        await runFail(new BraveNewsSearchTool(cfg).execute({ query: 'q' }, ctx()));
    });
});

describe('Exa tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const cfg = { apiKey: 'ek' };

    it('requires key + toolkit', async () => {
        const prev = process.env['EXA_API_KEY'];
        delete process.env['EXA_API_KEY'];
        await runFail(new ExaSearchTool({}).execute({ query: 'x' }, ctx()));
        restoreEnv('EXA_API_KEY', prev);
        expect(new ExaToolkit(cfg).tools).toHaveLength(3);
    });

    it('search with all optional payload fields', async () => {
        globalThis.fetch = vi.fn(async () => json({
            results: [{
                id: '1', url: 'u', title: 'T', score: 0.9,
                publishedDate: '2023-01-01', author: 'A',
            }],
        })) as typeof fetch;
        const r = await new ExaSearchTool(cfg).execute({
            query: 'q', numResults: 3, useAutoprompt: false, type: 'neural',
            includeDomains: ['a.com'], excludeDomains: ['b.com'],
            startPublishedDate: '2023-01-01', endPublishedDate: '2023-12-31',
            includeText: true, includeHighlights: true,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.count).toBe(1);
        expect(r.data?.results[0]?.publishedDate).toBe('2023-01-01');
        expect(r.data?.results[0]?.author).toBe('A');
    });

    it('search minimal payload omits optional fields', async () => {
        globalThis.fetch = vi.fn(async () => json({ results: [{ id: '1', url: 'u', title: 'T', score: 0 }] })) as typeof fetch;
        const r = await new ExaSearchTool(cfg).execute({ query: 'q' }, ctx());
        expect(r.data?.results[0]?.publishedDate).toBeUndefined();
        expect(r.data?.results[0]?.author).toBeUndefined();
        expect(r.data?.results[0]?.text).toBeUndefined();
        expect(r.data?.results[0]?.highlights).toBeUndefined();
    });

    it('find similar with domains + text', async () => {
        globalThis.fetch = vi.fn(async () => json({
            results: [{ id: '1', url: 'u', title: 'T', score: 1, text: 'body', highlights: ['h'] }],
        })) as typeof fetch;
        const r = await new ExaFindSimilarTool(cfg).execute({
            url: 'https://x.com', numResults: 5,
            includeDomains: ['x.com'], excludeDomains: ['y.com'], includeText: true,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.results[0]?.text).toBe('body');
        expect(r.data?.results[0]?.highlights).toEqual(['h']);
    });

    it('find similar minimal + get contents variants + errors', async () => {
        globalThis.fetch = vi.fn(async () => json({
            results: [{ id: '1', url: 'u', title: 'T', score: 1, text: 'x', highlights: ['h'] }],
        })) as typeof fetch;
        expect((await new ExaFindSimilarTool(cfg).execute({ url: 'https://x.com' }, ctx())).success).toBe(true);

        const contents = await new ExaGetContentsTool(cfg).execute({
            urls: ['u1', 'u2'], text: true, highlights: true,
        }, ctx());
        expect(contents.success).toBe(true);
        expect(contents.data?.contents).toHaveLength(1);

        globalThis.fetch = vi.fn(async () => json({ results: [{ id: '1', url: 'u', title: 'T', score: 0 }] })) as typeof fetch;
        const contentsMin = await new ExaGetContentsTool(cfg).execute({ urls: ['u1'], text: false, highlights: false }, ctx());
        expect(contentsMin.success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 402 })) as typeof fetch;
        await runFail(new ExaSearchTool(cfg).execute({ query: 'q' }, ctx()));
        await runFail(new ExaGetContentsTool(cfg).execute({ urls: ['u1'] }, ctx()));
    });
});

describe('Firecrawl tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const cfg = { apiKey: 'fk' };

    it('requires key + toolkit', async () => {
        const prev = process.env['FIRECRAWL_API_KEY'];
        delete process.env['FIRECRAWL_API_KEY'];
        await runFail(new FirecrawlScrapeTool({}).execute({ url: 'https://x.com' }, ctx()));
        restoreEnv('FIRECRAWL_API_KEY', prev);
        expect(new FirecrawlToolkit(cfg).tools).toHaveLength(3);
    });

    it('scrape with all fields', async () => {
        globalThis.fetch = vi.fn(async () => json({
            data: {
                url: 'u', markdown: 'md', html: 'ht', rawHtml: 'raw', links: ['l'], screenshot: 's.png',
                metadata: { title: 'T', description: 'd', statusCode: 200 },
            },
        })) as typeof fetch;
        const r = await new FirecrawlScrapeTool(cfg).execute({
            url: 'https://x.com', formats: ['markdown', 'html'], onlyMainContent: false,
            waitFor: 100, timeout: 5000, excludeTags: ['nav'], includeTags: ['p'],
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.markdown).toBe('md');
        expect(r.data?.html).toBe('ht');
        expect(r.data?.rawHtml).toBe('raw');
        expect(r.data?.links).toEqual(['l']);
        expect(r.data?.screenshot).toBe('s.png');
        expect(r.data?.metadata?.title).toBe('T');
    });

    it('scrape flat payload (no data wrapper)', async () => {
        globalThis.fetch = vi.fn(async () => json({ url: 'ignored' })) as typeof fetch;
        const r = await new FirecrawlScrapeTool(cfg).execute({ url: 'https://x.com' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.url).toBe('https://x.com');
        expect(r.data?.markdown).toBeUndefined();
        expect(r.data?.metadata).toBeUndefined();
    });

    it('crawl with pages, jobId and missing url field', async () => {
        globalThis.fetch = vi.fn(async () => json({
            jobId: 'j1',
            data: [
                { url: 'https://x.com/a', markdown: 'md', html: 'ht', metadata: { title: 'A' } },
                { html: 'only' },
            ],
        })) as typeof fetch;
        const r = await new FirecrawlCrawlTool(cfg).execute({
            url: 'https://x.com', limit: 5, maxDepth: 2,
            includePaths: ['/a'], excludePaths: ['/b'],
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.count).toBe(2);
        expect(r.data?.jobId).toBe('j1');
        expect(r.data?.pages[0]?.url).toBe('https://x.com/a');
        expect(r.data?.pages[1]?.url).toBe('');  // d['url'] ?? ''
    });

    it('crawl with empty data and no jobId', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const r = await new FirecrawlCrawlTool(cfg).execute({ url: 'https://x.com' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.count).toBe(0);
        expect(r.data?.jobId).toBeUndefined();
    });

    it('map with links, urls, and neither', async () => {
        globalThis.fetch = vi.fn(async () => json({ links: ['/a', '/b'] })) as typeof fetch;
        expect((await new FirecrawlMapTool(cfg).execute({ url: 'https://x.com', search: 'blog' }, ctx())).data?.urls).toHaveLength(2);

        globalThis.fetch = vi.fn(async () => json({ urls: ['/c'] })) as typeof fetch;
        expect((await new FirecrawlMapTool(cfg).execute({ url: 'https://x.com' }, ctx())).data?.urls).toEqual(['/c']);

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await new FirecrawlMapTool(cfg).execute({ url: 'https://x.com' }, ctx())).data?.count).toBe(0);
    });

    it('error paths', async () => {
        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        await runFail(new FirecrawlScrapeTool(cfg).execute({ url: 'https://x.com' }, ctx()));
        await runFail(new FirecrawlCrawlTool(cfg).execute({ url: 'https://x.com' }, ctx()));
        await runFail(new FirecrawlMapTool(cfg).execute({ url: 'https://x.com' }, ctx()));
    });
});

describe('Google Maps tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const cfg = { apiKey: 'gk' };

    it('requires key + toolkit', async () => {
        const prev = process.env['GOOGLE_MAPS_API_KEY'];
        delete process.env['GOOGLE_MAPS_API_KEY'];
        await runFail(new GoogleMapsGeocodeTool({}).execute({ address: 'x' }, ctx()));
        restoreEnv('GOOGLE_MAPS_API_KEY', prev);
        expect(new GoogleMapsToolkit(cfg).tools).toHaveLength(5);
    });

    it('search places with all params + rating optional', async () => {
        globalThis.fetch = vi.fn(async () => json({
            status: 'OK',
            results: [{
                place_id: 'p1', name: 'N', formatted_address: 'A', rating: 4.5,
                types: ['restaurant'], geometry: { location: { lat: 1, lng: 2 } },
            }],
        })) as typeof fetch;
        const r = await new GoogleMapsSearchPlacesTool(cfg).execute({
            query: 'coffee', location: '40.7,-74', radius: 2000, type: 'restaurant', maxResults: 3,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.places[0]?.rating).toBe(4.5);
        expect(r.data?.places[0]?.location).toEqual({ lat: 1, lng: 2 });

        globalThis.fetch = vi.fn(async () => json({
            status: 'OK', results: [{
                place_id: 'p2', name: 'N', formatted_address: 'A', types: [], geometry: { location: { lat: 1, lng: 2 } },
            }],
        })) as typeof fetch;
        const noRating = await new GoogleMapsSearchPlacesTool(cfg).execute({ query: 'q' }, ctx());
        expect(noRating.data?.places[0]?.rating).toBeUndefined();
    });

    it('geocode success + empty results', async () => {
        globalThis.fetch = vi.fn(async () => json({
            status: 'OK',
            results: [{ formatted_address: 'Addr', geometry: { location: { lat: 5, lng: 6 } }, place_id: 'g1' }],
        })) as typeof fetch;
        const r = await new GoogleMapsGeocodeTool(cfg).execute({ address: 'x' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.formattedAddress).toBe('Addr');
        expect(r.data?.placeId).toBe('g1');

        globalThis.fetch = vi.fn(async () => json({ status: 'OK', results: [] })) as typeof fetch;
        await runFail(new GoogleMapsGeocodeTool(cfg).execute({ address: 'x' }, ctx()));
    });

    it('reverse geocode success + empty', async () => {
        globalThis.fetch = vi.fn(async () => json({
            status: 'OK',
            results: [{
                formatted_address: 'Addr',
                address_components: [{ long_name: 'L', short_name: 'S', types: ['street'] }],
            }],
        })) as typeof fetch;
        const r = await new GoogleMapsReverseGeocodeTool(cfg).execute({ lat: 1, lng: 2 }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.components[0]).toEqual({ types: ['street'], longName: 'L', shortName: 'S' });

        globalThis.fetch = vi.fn(async () => json({ status: 'OK', results: [] })) as typeof fetch;
        await runFail(new GoogleMapsReverseGeocodeTool(cfg).execute({ lat: 1, lng: 2 }, ctx()));
    });

    it('directions with waypoints + missing route/leg', async () => {
        globalThis.fetch = vi.fn(async () => json({
            status: 'OK',
            routes: [{
                summary: 'S',
                legs: [{
                    distance: { text: '10 km' }, duration: { text: '20 min' },
                    steps: [{ html_instructions: 'Turn <b>left</b>', distance: { text: '1 km' }, duration: { text: '2 min' } }],
                }],
            }],
        })) as typeof fetch;
        const r = await new GoogleMapsDirectionsTool(cfg).execute({
            origin: 'a', destination: 'b', mode: 'walking', waypoints: ['c', 'd'],
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.steps[0]?.instruction).toBe('Turn left');
        expect(r.data?.summary).toBe('S');

        globalThis.fetch = vi.fn(async () => json({ status: 'OK', routes: [] })) as typeof fetch;
        const noRoute = await new GoogleMapsDirectionsTool(cfg).execute({ origin: 'a', destination: 'b', mode: 'driving' }, ctx());
        expect(noRoute.success).toBe(false);

        globalThis.fetch = vi.fn(async () => json({
            status: 'OK', routes: [{ summary: 'S', legs: [] }],
        })) as typeof fetch;
        const noLeg = await new GoogleMapsDirectionsTool(cfg).execute({ origin: 'a', destination: 'b' }, ctx());
        expect(noLeg.success).toBe(false);
    });

    it('place details with/without result + API error statuses', async () => {
        globalThis.fetch = vi.fn(async () => json({
            status: 'OK', result: { name: 'X', rating: 5 },
        })) as typeof fetch;
        const r = await new GoogleMapsPlaceDetailsTool(cfg).execute({
            placeId: 'p1', fields: ['name'],
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.name).toBe('X');

        globalThis.fetch = vi.fn(async () => json({ status: 'OK' })) as typeof fetch;
        expect((await new GoogleMapsPlaceDetailsTool(cfg).execute({ placeId: 'p1' }, ctx())).data).toEqual({});

        // non-OK status throws
        globalThis.fetch = vi.fn(async () => json({
            status: 'REQUEST_DENIED', error_message: 'no key',
        })) as typeof fetch;
        const denied = await new GoogleMapsGeocodeTool(cfg).execute({ address: 'x' }, ctx());
        expect(denied.success).toBe(false);
        expect(denied.error?.message).toMatch(/REQUEST_DENIED/);

        globalThis.fetch = vi.fn(async () => new Response('err', { status: 403 })) as typeof fetch;
        await runFail(new GoogleMapsGeocodeTool(cfg).execute({ address: 'x' }, ctx()));
    });
});

describe('Jina tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('toolkit + reader json/text branches', async () => {
        const tk = new JinaToolkit({
            apiKey: 'jk',
        });
        expect(tk.getTools()).toHaveLength(3);

        globalThis.fetch = vi.fn(async () => json({
            data: { url: 'https://resolved', title: 'T', content: 'C', description: 'D' },
        })) as typeof fetch;
        const jsonR = await new JinaReaderTool({ apiKey: 'jk' }).execute({
            url: 'https://x.com', returnFormat: 'markdown', proxyUrl: 'https://proxy',
        }, ctx());
        expect(jsonR.success).toBe(true);
        expect(jsonR.data?.url).toBe('https://resolved');
        expect(jsonR.data?.title).toBe('T');
        expect(jsonR.data?.description).toBe('D');

        // json but sparse data
        globalThis.fetch = vi.fn(async () => json({ data: {} })) as typeof fetch;
        const sparse = await new JinaReaderTool({ apiKey: 'jk' }).execute({ url: 'https://x.com' }, ctx());
        expect(sparse.data?.url).toBe('https://x.com');
        expect(sparse.data?.content).toBe('');
        expect(sparse.data?.title).toBeUndefined();
        expect(sparse.data?.description).toBeUndefined();

        // text (non-json) content-type, no key
        globalThis.fetch = vi.fn(async () =>
            new Response('<html>plain</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })) as typeof fetch;
        const textR = await new JinaReaderTool({}).execute({ url: 'https://x.com', returnFormat: 'text' }, ctx());
        expect(textR.success).toBe(true);
        expect(textR.data?.content).toBe('<html>plain</html>');
        expect(textR.data?.url).toBe('https://x.com');

        globalThis.fetch = vi.fn(async () => new Response('oops', { status: 500 })) as typeof fetch;
        await runFail(new JinaReaderTool({}).execute({ url: 'https://x.com' }, ctx()));
    });

    it('search results slicing + error', async () => {
        globalThis.fetch = vi.fn(async () => json({
            data: [
                { title: 't1', url: 'u1', content: 'c1', description: 'd1' },
                { title: 't2', url: 'u2', content: 'c2' },
                { title: 't3', url: 'u3', content: 'c3' },
            ],
        })) as typeof fetch;
        const r = await new JinaSearchTool({}).execute({ query: 'q', numResults: 2 }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.results).toHaveLength(2);
        expect(r.data?.query).toBe('q');

        globalThis.fetch = vi.fn(async () => json({ data: [] })) as typeof fetch;
        expect((await new JinaSearchTool({ apiKey: 'jk' }).execute({ query: 'q' }, ctx())).data?.results).toEqual([]);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 429 })) as typeof fetch;
        await runFail(new JinaSearchTool({ apiKey: 'jk' }).execute({ query: 'q' }, ctx()));
    });

    it('rerank with/without results + error', async () => {
        globalThis.fetch = vi.fn(async () => json({
            results: [{ document: { text: 'doc' }, relevance_score: 0.9, index: 0 }],
        })) as typeof fetch;
        const r = await new JinaRerankTool({}).execute({
            query: 'q', documents: ['a', 'b'], topN: 1, model: 'jina-reranker-v2-base-multilingual',
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.results[0]?.relevanceScore).toBe(0.9);

        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        expect((await new JinaRerankTool({}).execute({ query: 'q', documents: ['a'] }, ctx())).data?.results).toEqual([]);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 400 })) as typeof fetch;
        await runFail(new JinaRerankTool({}).execute({ query: 'q', documents: ['a'] }, ctx()));
    });
});

describe('Linkup tool', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires key + toolkit', async () => {
        const prev = process.env['LINKUP_API_KEY'];
        delete process.env['LINKUP_API_KEY'];
        await runFail(new LinkupSearchTool({}).execute({ query: 'x' }, ctx()));
        restoreEnv('LINKUP_API_KEY', prev);
        expect(new LinkupToolkit({ apiKey: 'lk' }).getTools()).toHaveLength(1);
    });

    it('sourcedAnswer + searchResults paths', async () => {
        globalThis.fetch = vi.fn(async () => json({
            answer: 'The answer',
            results: [{ name: 'N', url: 'u', content: 'c' }],
        })) as typeof fetch;
        const r = await new LinkupSearchTool({ apiKey: 'lk' }).execute({
            query: 'q', depth: 'deep', outputType: 'sourcedAnswer', numResults: 3,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.answer).toBe('The answer');
        expect(r.data?.results).toHaveLength(1);

        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        const none = await new LinkupSearchTool({ apiKey: 'lk' }).execute({ query: 'q' }, ctx());
        expect(none.data?.answer).toBeUndefined();
        expect(none.data?.results).toEqual([]);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 502 })) as typeof fetch;
        await runFail(new LinkupSearchTool({ apiKey: 'lk' }).execute({ query: 'q' }, ctx()));
    });
});

describe('Newspaper tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const FULL_HTML = `<!doctype html><html><head>
<meta property="og:title" content="Headline">
<meta property="og:description" content="Desc">
<meta property="article:published_time" content="2023-03-03T00:00:00Z">
<meta property="og:site_name" content="Example">
<title>Fallback title</title>
</head><body>
<article><p>Body <b>text</b></p><script>var x=1;</script><style>.a{}</style></article>
</body></html>`;

    it('toolkit + article extraction with og tags', async () => {
        expect(new NewspaperToolkit({ newsApiKey: 'nk' }).getTools()).toHaveLength(3);

        globalThis.fetch = vi.fn(async () => new Response(FULL_HTML, { status: 200 })) as typeof fetch;
        const r = await new GetNewsArticleTool().execute({ url: 'https://example.com/article' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.title).toBe('Headline');
        expect(r.data?.description).toBe('Desc');
        expect(r.data?.publishedAt).toBe('2023-03-03T00:00:00Z');
        expect(r.data?.source).toBe('Example');
        expect(r.data?.content).toMatch(/Body text/);
        expect(r.data?.content).not.toContain('<script>');
    });

    it('article extraction fallback patterns + raw html', async () => {
        const FALLBACK = `<!doctype html><html><head>
<title>Plain Title</title>
<meta name="description" content="MetaDesc">
<time datetime="2021-05-05">
</head><body><main><p>Main text</p></main></body></html>`;
        globalThis.fetch = vi.fn(async () => new Response(FALLBACK, { status: 200 })) as typeof fetch;
        const r = await new GetNewsArticleTool().execute({ url: 'https://example.com/a' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.title).toBe('Plain Title');
        expect(r.data?.description).toBe('MetaDesc');
        expect(r.data?.publishedAt).toBe('2021-05-05');
        expect(r.data?.source).toBeUndefined();
        expect(r.data?.content).toMatch(/Main text/);

        // no article/main/meta — raw html body, everything missing
        const RAW = '<div>just text</div>';
        globalThis.fetch = vi.fn(async () => new Response(RAW, { status: 200 })) as typeof fetch;
        const r2 = await new GetNewsArticleTool().execute({ url: 'https://example.com/b' }, ctx());
        expect(r2.data?.content).toMatch(/just text/);
        expect(r2.data?.title).toBeUndefined();
    });

    it('article fetch error', async () => {
        globalThis.fetch = vi.fn(async () => new Response('no', { status: 404 })) as typeof fetch;
        await runFail(new GetNewsArticleTool().execute({ url: 'https://example.com/c' }, ctx()));
    });

    it('news search requires key + full params', async () => {
        const prev = process.env['NEWS_API_KEY'];
        delete process.env['NEWS_API_KEY'];
        await runFail(new SearchNewsTool({}).execute({ query: 'q' }, ctx()));
        restoreEnv('NEWS_API_KEY', prev);

        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('/everything?');
            return json({
                totalResults: 1,
                articles: [{
                    title: 'T', url: 'u', description: 'd', publishedAt: '2023-01-01',
                    source: { name: 'CNN' }, author: 'Alice',
                }],
            });
        }) as typeof fetch;
        const r = await new SearchNewsTool({ newsApiKey: 'nk' }).execute({
            query: 'q', language: 'es', sortBy: 'relevancy', pageSize: 5,
            from: '2023-01-01', to: '2023-12-31', domains: 'cnn.com', sources: 'cnn',
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.totalResults).toBe(1);
        expect(r.data?.articles[0]?.source).toBe('CNN');
        expect(r.data?.articles[0]?.author).toBe('Alice');

        // optional fields omitted, source fallback
        globalThis.fetch = vi.fn(async () => json({
            totalResults: 1,
            articles: [{ title: 'T', url: 'u', publishedAt: '2023-01-01' }],
        })) as typeof fetch;
        const min = await new SearchNewsTool({ newsApiKey: 'nk' }).execute({ query: 'q' }, ctx());
        expect(min.data?.articles[0]?.source).toBe('Unknown');
        expect(min.data?.articles[0]?.description).toBeUndefined();
        expect(min.data?.author).toBeUndefined();

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 401 })) as typeof fetch;
        await runFail(new SearchNewsTool({ newsApiKey: 'nk' }).execute({ query: 'q' }, ctx()));
    });

    it('top headlines requires key + params + error', async () => {
        const prev = process.env['NEWS_API_KEY'];
        delete process.env['NEWS_API_KEY'];
        await runFail(new GetTopHeadlinesTool({}).execute({}, ctx()));
        restoreEnv('NEWS_API_KEY', prev);

        globalThis.fetch = vi.fn(async () => json({
            totalResults: 1,
            articles: [{ title: 'T', url: 'u', description: 'd', publishedAt: '2023-01-01', source: { name: 'BBC' } }],
        })) as typeof fetch;
        const r = await new GetTopHeadlinesTool({ newsApiKey: 'nk' }).execute({
            category: 'technology', country: 'gb', query: 'ai', pageSize: 3,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.articles[0]?.source).toBe('BBC');

        globalThis.fetch = vi.fn(async () => json({
            totalResults: 0,
            articles: [{ title: 'T', url: 'u', publishedAt: '2023-01-01' }],
        })) as typeof fetch;
        const min = await new GetTopHeadlinesTool({ newsApiKey: 'nk' }).execute({}, ctx());
        expect(min.data?.articles[0]?.description).toBeUndefined();
        expect(min.data?.articles[0]?.source).toBe('Unknown');

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 429 })) as typeof fetch;
        await runFail(new GetTopHeadlinesTool({ newsApiKey: 'nk' }).execute({}, ctx()));
    });
});

describe('Perplexity tool', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires key + toolkit', async () => {
        const prev = process.env['PERPLEXITY_API_KEY'];
        delete process.env['PERPLEXITY_API_KEY'];
        await runFail(new PerplexitySearchTool({}).execute({ query: 'q' }, ctx()));
        restoreEnv('PERPLEXITY_API_KEY', prev);
        expect(new PerplexityToolkit({ apiKey: 'pk' }).getTools()).toHaveLength(1);
    });

    it('search with citations + answers + fallbacks + error', async () => {
        globalThis.fetch = vi.fn(async () => json({
            choices: [{ message: { content: 'answer text' } }],
            citations: ['https://u1', 'https://u2'],
        })) as typeof fetch;
        const r = await new PerplexitySearchTool({ apiKey: 'pk' }).execute({
            query: 'q', model: 'sonar-pro', maxResults: 3,
            searchRecencyFilter: 'week', searchDomainFilter: ['x.com'],
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.answer).toBe('answer text');
        expect(r.data?.citations).toHaveLength(2);
        expect(r.data?.results[0]?.url).toBe('https://u1');

        // empty choices/citations, config fallbacks
        globalThis.fetch = vi.fn(async () => json({ choices: [] })) as typeof fetch;
        const empty = await new PerplexitySearchTool({
            apiKey: 'pk', model: 'sonar', searchRecencyFilter: 'month',
        }).execute({ query: 'q' }, ctx());
        expect(empty.data?.answer).toBe('');
        expect(empty.data?.citations).toEqual([]);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 401 })) as typeof fetch;
        await runFail(new PerplexitySearchTool({ apiKey: 'pk' }).execute({ query: 'q' }, ctx()));
    });
});

describe('PubMed tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    function esearch(count: string, ids: string[]) {
        return { esearchresult: { count, idlist: ids } };
    }

    function efetchPayload() {
        return {
            PubmedArticleSet: {
                PubmedArticle: [
                    {
                        MedlineCitation: {
                            PMID: { _: '1' },
                            Article: {
                                ArticleTitle: 'Alpha beta',
                                Abstract: { AbstractText: [{ _: 'part1' }, 'part2', {}] },
                                AuthorList: {
                                    Author: [
                                        { ForeName: 'F', LastName: 'L' },
                                        { ForeName: undefined, LastName: 'Only' },
                                    ],
                                },
                                Journal: { Title: 'J', JournalIssue: { PubDate: { Year: '2023', Month: '06' } } },
                                ELocationID: [{ EIdType: 'doi', _: '10.1' }, { EIdType: 'pii', _: 'p1' }],
                                PublicationTypeList: { PublicationType: [{ _: 'Journal Article' }, {}] },
                            },
                        },
                    },
                    {
                        MedlineCitation: {
                            PMID: '2',
                            Article: {
                                ArticleTitle: { _x: 'obj' },
                                Abstract: { AbstractText: 'string abs' },
                                AuthorList: { Author: [] },
                                Journal: { Title: undefined, JournalIssue: { PubDate: { Year: '2022' } } },
                                ELocationID: { EIdType: 'doi', _: '10.2' },
                                PublicationTypeList: { PublicationType: { _: 'Review' } },
                            },
                        },
                    },
                    {
                        MedlineCitation: {},
                    },
                    {
                        MedlineCitation: { PMID: '4' },
                    },
                ],
            },
        };
    }

    function routeFetch(es: unknown, ef: unknown) {
        return vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('esearch.fcgi')) return json(es);
            return json(ef);
        }) as typeof fetch;
    }

    it('toolkit + search variant A (filters, no abstract, apiKey)', async () => {
        expect(new PubMedToolkit({ apiKey: 'pk' }).getTools()).toHaveLength(2);

        globalThis.fetch = routeFetch(
            esearch('3', ['1', '2', '3']),
            efetchPayload(),
        );

        const r = await new PubMedSearchTool({ apiKey: 'pk', toolName: 'tool', email: 'e@e.com' }).execute({
            query: 'cancer', maxResults: 5, offset: 10, sortBy: 'pub_date', dateType: 'edat',
            dateRange: { from: '2023', to: '2024' }, articleTypes: ['Review', 'Meta-Analysis'],
            includeAbstract: false,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.totalCount).toBe(3);
        expect(r.data?.pmids).toEqual(['1', '2', '3']);
        expect(r.data?.articles).toHaveLength(4);
        expect(r.data?.articles[0]?.abstract).toBeUndefined();
        expect(r.data?.articles[1]?.abstract).toBeUndefined();
        expect(r.data?.articles[0]?.journal).toBe('J');
        expect(r.data?.articles[0]?.pubDate).toBe('2023/06');
        expect(r.data?.articles[1]?.pubDate).toBe('2022');
    });

    it('search variant B (no filters, abstract parsed, no apiKey)', async () => {
        globalThis.fetch = routeFetch(
            esearch('3', ['1', '2', '3']),
            efetchPayload(),
        );

        const r = await new PubMedSearchTool({}).execute({ query: 'cancer' }, ctx());
        expect(r.success).toBe(true);
        const [a, b, c, d] = r.data!.articles;
        expect(a.pmid).toBe('1');
        expect(a.title).toBe('Alpha beta');
        expect(a.abstract).toBe('part1 part2 ');
        expect(a.authors).toEqual(['F L', 'Only']);
        expect(a.doi).toBe('10.1');
        expect(b.pmid).toBe('2');
        expect(b.title).toBe('[object Object]');
        expect(b.abstract).toBe('string abs');
        expect(b.authors).toEqual([]);
        expect(b.doi).toBe('10.2');
        expect(c.pmid).toBe('');
        expect(c.doi).toBeUndefined();
        expect(d.pmid).toBe('4');
    });

    it('search with empty pmids returns early', async () => {
        globalThis.fetch = routeFetch(esearch('0', []), efetchPayload());
        const r = await new PubMedSearchTool({ apiKey: 'pk' }).execute({ query: 'none' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.totalCount).toBe(0);
        expect(r.data?.articles).toEqual([]);
    });

    it('search error paths: non-retryable + non-Error throw', async () => {
        globalThis.fetch = vi.fn(async () => new Response('bad', { status: 400 })) as typeof fetch;
        await runFail(new PubMedSearchTool({}).execute({ query: 'q' }, ctx()));

        globalThis.fetch = vi.fn(async () => { throw 'boom'; }) as typeof fetch;
        const r = await new PubMedSearchTool({ maxRetries: 1 }).execute({ query: 'q' }, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toBe('PubMed fetch failed');
    });

    it('get article full mapping + includeAbstract false', async () => {
        globalThis.fetch = vi.fn(async () => json(efetchPayload())) as typeof fetch;
        const r = await new PubMedGetArticleTool({ apiKey: 'pk' }).execute({
            pmids: ['1', '2', '3', '4'], includeAbstract: true,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.articles).toHaveLength(4);
        expect(r.data?.articles[0]?.publicationTypes).toEqual(['Journal Article']);
        expect(r.data?.articles[0]?.abstract).toBe('part1 part2 ');
        expect(r.data?.articles[1]?.publicationTypes).toEqual(['Review']);

        const none = await new PubMedGetArticleTool({ apiKey: 'pk' }).execute({
            pmids: ['1'], includeAbstract: false,
        }, ctx());
        expect(none.data?.articles[0]?.abstract).toBeUndefined();
        expect(none.data?.articles[0]?.publicationTypes).toEqual(['Journal Article']);
    });

    it('get article empty result set', async () => {
        globalThis.fetch = vi.fn(async () => json({ PubmedArticleSet: { PubmedArticle: [] } })) as typeof fetch;
        expect((await new PubMedGetArticleTool({}).execute({ pmids: ['1'] }, ctx())).data?.articles).toEqual([]);
    });

    it('retry on retryable status then success', async () => {
        let calls = 0;
        globalThis.fetch = vi.fn(async () => {
            calls++;
            if (calls === 1) return new Response('x', { status: 503 });
            return json({ PubmedArticleSet: { PubmedArticle: [] } });
        }) as typeof fetch;
        const r = await new PubMedGetArticleTool({ apiKey: 'pk', maxRetries: 1 }).execute({ pmids: ['1'] }, ctx());
        expect(r.success).toBe(true);
        expect(calls).toBe(2);
    });

    it('retryable status exhausted throws', async () => {
        globalThis.fetch = vi.fn(async () => new Response('x', { status: 500 })) as typeof fetch;
        await runFail(new PubMedGetArticleTool({ maxRetries: 0 }).execute({ pmids: ['1'] }, ctx()));
    });

    it('fetch that throws an Error is rethrown', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('net down'); }) as typeof fetch;
        const r = await new PubMedGetArticleTool({ maxRetries: 1 }).execute({ pmids: ['1'] }, ctx());
        expect(r.error?.message).toBe('net down');
    });
});

describe('Reddit tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('toolkit + search within/without subreddit + post mapping variants', async () => {
        expect(new RedditToolkit().tools).toHaveLength(2);

        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('/r/tech/search?');
            return json({
                data: {
                    children: [
                        {
                            data: {
                                id: 'p1', title: 'T', author: 'a', subreddit: 'tech',
                                score: 5, num_comments: 2, url: 'u', created_utc: 123, is_video: false,
                                selftext: 'hello', link_flair_text: 'Ask',
                            },
                        },
                        {
                            data: {
                                id: 'p2', title: 'T', author: 'a', subreddit: 'tech',
                                score: 5, num_comments: 2, url: 'u', created_utc: 123, is_video: false,
                                selftext: '',
                            },
                        },
                        {
                            data: {
                                id: 'p3', title: 'T', author: 'a', subreddit: 'tech',
                                score: 5, num_comments: 2, url: 'u', created_utc: 123, is_video: false,
                            },
                        },
                    ],
                },
            });
        }) as typeof fetch;

        const r = await new RedditSearchTool({}).execute({
            query: 'rust', subreddit: 'tech', sort: 'new', timeFilter: 'week', limit: 3,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.count).toBe(3);
        expect(r.data?.posts[0]?.selfText).toBe('hello');
        expect(r.data?.posts[0]?.flair).toBe('Ask');
        expect(r.data?.posts[1]?.selfText).toBeUndefined();
        expect(r.data?.posts[2]?.selfText).toBeUndefined();
        expect(r.data?.posts[2]?.flair).toBeUndefined();

        // no subreddit path + authenticated (oauth + basic auth from config)
        globalThis.fetch = vi.fn(async (url, init) => {
            expect(String(url)).toContain('oauth.reddit.com/search?');
            expect((init?.headers as Record<string, string>)['Authorization']).toMatch(/^Basic /);
            return json({ data: { children: [] } });
        }) as typeof fetch;
        const creds = await new RedditSearchTool({
            clientId: 'cid', clientSecret: 'csec',
        }).execute({ query: 'q' }, ctx());
        expect(creds.success).toBe(true);

        // auth via env vars (config fallback path)
        const prevId = process.env['REDDIT_CLIENT_ID'];
        const prevSec = process.env['REDDIT_CLIENT_SECRET'];
        process.env['REDDIT_CLIENT_ID'] = 'envid';
        delete process.env['REDDIT_CLIENT_SECRET'];
        globalThis.fetch = vi.fn(async (url, init) => {
            expect(String(url)).toContain('oauth.reddit.com/search?');
            return json({ data: { children: [] } });
        }) as typeof fetch;
        const envOnlyClient = await new RedditSearchTool({}).execute({ query: 'q' }, ctx());
        expect(envOnlyClient.success).toBe(true);

        // clientId without a secret -> oauth base url but no Authorization header
        globalThis.fetch = vi.fn(async (url, init) => {
            expect(String(url)).toContain('oauth.reddit.com/search?');
            expect((init?.headers as Record<string, string>)['Authorization']).toBeUndefined();
            return json({ data: { children: [] } });
        }) as typeof fetch;
        const noSecret = await new RedditSearchTool({ clientId: 'cid' }).execute({ query: 'q' }, ctx());
        expect(noSecret.success).toBe(true);

        process.env['REDDIT_CLIENT_SECRET'] = 'envsec';
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('oauth.reddit.com/search?');
            return json({ data: { children: [] } });
        }) as typeof fetch;
        const envCreds = await new RedditSearchTool({}).execute({ query: 'q' }, ctx());
        expect(envCreds.success).toBe(true);
        restoreEnv('REDDIT_CLIENT_SECRET', prevSec);
        restoreEnv('REDDIT_CLIENT_ID', prevId);
    });

    it('get posts + error path', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('/r/tech/hot?');
            return json({
                data: { children: [{ data: { id: 'p1', title: 'T', author: 'a', subreddit: 'tech', score: 1, num_comments: 0, url: 'u', created_utc: 1, is_video: true } }] },
            });
        }) as typeof fetch;
        const r = await new RedditGetPostsTool({}).execute({
            subreddit: 'tech', sort: 'hot', limit: 10, timeFilter: 'all',
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.posts).toHaveLength(1);
        expect(r.data?.subreddit).toBe('tech');

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 403 })) as typeof fetch;
        await runFail(new RedditGetPostsTool({}).execute({ subreddit: 'tech' }, ctx()));
    });
});

describe('SearXNG tool', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('toolkit + host resolution variants', async () => {
        expect(new SearXNGToolkit().getTools()).toHaveLength(1);

        const prev = process.env['SEARXNG_HOST'];
        delete process.env['SEARXNG_HOST'];
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('https://searx.be/search?');
            return json({
                results: [{
                    title: 'T', url: 'u', content: 'c', engine: 'google', publishedDate: '2023-01-01',
                }],
                suggestions: ['s1'],
            });
        }) as typeof fetch;
        const def = await new SearXNGSearchTool({}).execute({
            query: 'q', categories: ['general'], engines: ['google'], language: 'en', pageno: 2,
            timeRange: 'day', safesearch: 1,
        }, ctx());
        expect(def.success).toBe(true);
        expect(def.data?.results[0]?.engine).toBe('google');
        expect(def.data?.results[0]?.publishedDate).toBe('2023-01-01');
        expect(def.data?.suggestions).toEqual(['s1']);
        restoreEnv('SEARXNG_HOST', prev);

        // config host + no optional fields
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('https://my.searx/search?');
            return json({ results: [{ title: 'T', url: 'u', content: 'c' }] });
        }) as typeof fetch;
        const cfgHost = await new SearXNGSearchTool({ host: 'https://my.searx/' }).execute({
            query: 'q', categories: [],
        }, ctx());
        expect(cfgHost.success).toBe(true);
        expect(cfgHost.data?.suggestions).toEqual([]);
        expect(cfgHost.data?.results[0]?.engine).toBeUndefined();

        // env host
        process.env['SEARXNG_HOST'] = 'https://env.searx';
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('https://env.searx/search?');
            return json({});
        }) as typeof fetch;
        const envHost = await new SearXNGSearchTool({}).execute({ query: 'q' }, ctx());
        expect(envHost.success).toBe(true);
        delete process.env['SEARXNG_HOST'];
    });

    it('error path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        await runFail(new SearXNGSearchTool({}).execute({ query: 'q' }, ctx()));
    });
});

describe('Serper tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const cfg = { apiKey: 'sk' };

    it('requires key + toolkit', async () => {
        const prev = process.env['SERPER_API_KEY'];
        delete process.env['SERPER_API_KEY'];
        await runFail(new SerperWebSearchTool({}).execute({ query: 'q' }, ctx()));
        restoreEnv('SERPER_API_KEY', prev);
        expect(new SerperToolkit(cfg).getTools()).toHaveLength(4);
    });

    it('web search body variants (input/config defaults)', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            expect(String(url)).toBe('https://google.serper.dev/search');
            const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
            expect(body['gl']).toBe('us');
            expect(body['hl']).toBe('en');
            expect(body['tbs']).toBe('qdr:d');
            return json({ organic: [{ title: 'T', link: 'u' }] });
        }) as typeof fetch;

        const full = await new SerperWebSearchTool(cfg).execute({
            query: 'q', numResults: 5, location: 'us', language: 'en', dateRange: 'qdr:d',
        }, ctx());
        expect(full.success).toBe(true);

        // config fallbacks
        globalThis.fetch = vi.fn(async (url, init) => {
            const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
            expect(body['num']).toBe(10);
            expect(body['gl']).toBe('gb');
            expect(body['hl']).toBe('fr');
            expect(body['tbs']).toBeUndefined();
            return json({});
        }) as typeof fetch;
        const cfgFallback = await new SerperWebSearchTool({
            apiKey: 'sk', numResults: 7, location: 'gb', language: 'fr',
        }).execute({ query: 'q' }, ctx());
        expect(cfgFallback.success).toBe(true);

        // no location/language at all
        globalThis.fetch = vi.fn(async (url, init) => {
            const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
            expect(body['num']).toBe(10);
            expect(body['gl']).toBeUndefined();
            expect(body['hl']).toBeUndefined();
            return json({});
        }) as typeof fetch;
        expect((await new SerperWebSearchTool({ apiKey: 'sk' }).execute({ query: 'q' }, ctx())).success).toBe(true);
    });

    it('news/scholar/scrape + error', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toBe('https://google.serper.dev/news');
            return json({ news: [] });
        }) as typeof fetch;
        expect((await new SerperNewsSearchTool(cfg).execute({ query: 'q', numResults: 2 }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toBe('https://google.serper.dev/scholar');
            return json({ organic: [] });
        }) as typeof fetch;
        expect((await new SerperScholarSearchTool({
            apiKey: 'sk', numResults: 3,
        }).execute({ query: 'q' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (url) => {
            expect(String(url)).toBe('https://scrape.serper.dev');
            return json({ markdown: 'md' });
        }) as typeof fetch;
        const scrapeMarkdown = await new SerperScrapeTool(cfg).execute({
            url: 'https://example.com', markdown: true,
        }, ctx());
        expect(scrapeMarkdown.success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        await runFail(new SerperScrapeTool(cfg).execute({ url: 'https://example.com' }, ctx()));
        await runFail(new SerperWebSearchTool(cfg).execute({ query: 'q' }, ctx()));
    });
});

describe('Tavily tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const cfg = { apiKey: 'tk' };

    it('requires key + toolkit', async () => {
        const prev = process.env['TAVILY_API_KEY'];
        delete process.env['TAVILY_API_KEY'];
        await runFail(new TavilySearchTool({}).execute({ query: 'q' }, ctx()));
        restoreEnv('TAVILY_API_KEY', prev);
        expect(new TavilyToolkit(cfg).tools).toHaveLength(2);
    });

    it('search with answer/results variants', async () => {
        globalThis.fetch = vi.fn(async () => json({
            answer: 'A', query: 'q',
            results: [{ title: 'T', url: 'u', content: 'c', score: 0.5 }],
        })) as typeof fetch;
        const r = await new TavilySearchTool(cfg).execute({
            query: 'q', searchDepth: 'advanced', maxResults: 3,
            includeDomains: ['a.com'], excludeDomains: ['b.com'],
            includeAnswer: true, includeRawContent: true,
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.answer).toBe('A');
        expect(r.data?.results).toHaveLength(1);
        expect(r.data?.query).toBe('q');

        globalThis.fetch = vi.fn(async () => json({ query: 'q' })) as typeof fetch;
        const none = await new TavilySearchTool(cfg).execute({ query: 'q' }, ctx());
        expect(none.data?.answer).toBeUndefined();
        expect(none.data?.results).toEqual([]);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 401 })) as typeof fetch;
        await runFail(new TavilySearchTool(cfg).execute({ query: 'q' }, ctx()));
    });

    it('extract with failed flag + error', async () => {
        globalThis.fetch = vi.fn(async () => json({
            results: [{ url: 'u', raw_content: 'raw', failed: true }],
        })) as typeof fetch;
        const r = await new TavilyExtractTool(cfg).execute({
            urls: ['https://a.com', 'https://b.com'],
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.results[0]?.failed).toBe(true);
        expect(r.data?.results[0]?.rawContent).toBe('raw');

        globalThis.fetch = vi.fn(async () => json({ results: [{ url: 'u', raw_content: 'raw' }] })) as typeof fetch;
        expect((await new TavilyExtractTool(cfg).execute({ urls: ['https://a.com'] }, ctx())).data?.results[0]?.failed).toBeUndefined();

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        await runFail(new TavilyExtractTool(cfg).execute({ urls: ['https://a.com'] }, ctx()));
    });
});

describe('OpenWeather tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires key + toolkit', async () => {
        const prev = process.env['OPENWEATHER_API_KEY'];
        delete process.env['OPENWEATHER_API_KEY'];
        await runFail(new OpenWeatherCurrentTool({}).execute({ location: 'x' }, ctx()));
        restoreEnv('OPENWEATHER_API_KEY', prev);
        expect(new OpenWeatherToolkit({ apiKey: 'wk' }).tools).toHaveLength(2);
    });

    it('current weather with units variants + empty weather', async () => {
        globalThis.fetch = vi.fn(async () => json({
            name: 'London', sys: { country: 'GB' },
            main: { temp: 20, feels_like: 18, humidity: 50 },
            weather: [{ description: 'cloudy' }], wind: { speed: 3 },
        })) as typeof fetch;
        const r = await new OpenWeatherCurrentTool({ apiKey: 'wk' }).execute({
            location: 'London,GB', units: 'imperial',
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.location).toBe('London');
        expect(r.data?.country).toBe('GB');
        expect(r.data?.temperature).toBe(20);
        expect(r.data?.units).toBe('imperial');

        globalThis.fetch = vi.fn(async () => json({
            name: 'P', sys: { country: 'X' }, main: { temp: 1, feels_like: 1, humidity: 1 },
            weather: [], wind: { speed: 1 },
        })) as typeof fetch;
        const cfgUnits = await new OpenWeatherCurrentTool({
            apiKey: 'wk', units: 'standard',
        }).execute({ location: 'P' }, ctx());
        expect(cfgUnits.data?.units).toBe('standard');
        expect(cfgUnits.data?.description).toBe('');

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 401 })) as typeof fetch;
        await runFail(new OpenWeatherCurrentTool({ apiKey: 'wk' }).execute({ location: 'x' }, ctx()));
    });

    it('forecast with days default + empty weather', async () => {
        globalThis.fetch = vi.fn(async () => json({
            city: { name: 'Rome' },
            list: [{ dt_txt: '2023-01-01 12:00:00', main: { temp: 5, humidity: 10 }, weather: [{ description: 'sun' }] }],
        })) as typeof fetch;
        const r = await new OpenWeatherForecastTool({ apiKey: 'wk' }).execute({
            location: 'Rome', days: 5, units: 'metric',
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.location).toBe('Rome');
        expect(r.data?.forecast[0]?.datetime).toBe('2023-01-01 12:00:00');
        expect(r.data?.forecast[0]?.description).toBe('sun');

        globalThis.fetch = vi.fn(async () => json({
            city: { name: 'R' },
            list: [{ dt_txt: 'x', main: { temp: 1, humidity: 1 }, weather: [] }],
        })) as typeof fetch;
        expect((await new OpenWeatherForecastTool({
            apiKey: 'wk',
        }).execute({ location: 'R' }, ctx())).data?.forecast[0]?.description).toBe('');

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        await runFail(new OpenWeatherForecastTool({ apiKey: 'wk' }).execute({ location: 'x' }, ctx()));
    });
});

describe('YouTube tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const cfg = { apiKey: 'yk' };

    it('requires key + toolkit', async () => {
        const prev = process.env['YOUTUBE_API_KEY'];
        delete process.env['YOUTUBE_API_KEY'];
        await runFail(new YouTubeSearchTool({}).execute({ query: 'q' }, ctx()));
        restoreEnv('YOUTUBE_API_KEY', prev);
        expect(new YouTubeToolkit(cfg).tools).toHaveLength(2);
    });

    it('search with channel + thumbnails variants', async () => {
        globalThis.fetch = vi.fn(async () => json({
            pageInfo: { totalResults: 1 },
            items: [{
                id: { videoId: 'v1' },
                snippet: {
                    title: 'T', description: 'd', channelTitle: 'C', publishedAt: '2023-01-01',
                    thumbnails: { medium: { url: 'thumb' } },
                },
            }],
        })) as typeof fetch;
        const r = await new YouTubeSearchTool(cfg).execute({
            query: 'q', maxResults: 5, order: 'date', videoDuration: 'short', channelId: 'ch1',
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.videos[0]?.id).toBe('v1');
        expect(r.data?.videos[0]?.thumbnailUrl).toBe('thumb');
        expect(r.data?.totalResults).toBe(1);

        globalThis.fetch = vi.fn(async () => json({
            items: [{
                id: { videoId: 'v2' },
                snippet: { title: 'T', description: 'd', channelTitle: 'C', publishedAt: 'x' },
            }],
        })) as typeof fetch;
        const min = await new YouTubeSearchTool(cfg).execute({ query: 'q' }, ctx());
        expect(min.data?.videos[0]?.thumbnailUrl).toBeUndefined();
        expect(min.data?.totalResults).toBe(1);  // pageInfo missing -> videos.length

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 403 })) as typeof fetch;
        await runFail(new YouTubeSearchTool(cfg).execute({ query: 'q' }, ctx()));
    });

    it('get video url extraction + details + null', async () => {
        let lastUrl = '';
        globalThis.fetch = vi.fn(async (url) => {
            lastUrl = String(url);
            return json({
                items: [{
                    id: 'v1',
                    snippet: {
                        title: 'T', description: 'd', channelTitle: 'C', publishedAt: 'x',
                        thumbnails: { medium: { url: 't' } },
                    },
                    contentDetails: { duration: 'PT1M' },
                    statistics: { viewCount: '10', likeCount: '2' },
                }],
            });
        }) as typeof fetch;

        const r = await new YouTubeGetVideoTool(cfg).execute({
            videoId: 'https://www.youtube.com/watch?v=abc123&x=1',
        }, ctx());
        expect(r.success).toBe(true);
        expect(lastUrl).toContain('id=abc123');
        expect(r.data?.duration).toBe('PT1M');
        expect(r.data?.viewCount).toBe('10');
        expect(r.data?.likeCount).toBe('2');
        expect(r.data?.thumbnailUrl).toBe('t');

        await new YouTubeGetVideoTool(cfg).execute({ videoId: 'https://youtu.be/short' }, ctx());
        expect(lastUrl).toContain('id=short');

        globalThis.fetch = vi.fn(async () => json({ items: [] })) as typeof fetch;
        const none = await new YouTubeGetVideoTool(cfg).execute({ videoId: 'plain' }, ctx());
        expect(none.data).toBeNull();

        globalThis.fetch = vi.fn(async () => json({
            items: [{
                id: 'v2',
                snippet: { title: 'T', description: 'd', channelTitle: 'C', publishedAt: 'x' },
                contentDetails: {},
                statistics: {},
            }],
        })) as typeof fetch;
        const sparse = await new YouTubeGetVideoTool(cfg).execute({ videoId: 'v2' }, ctx());
        expect(sparse.data?.duration).toBeUndefined();
        expect(sparse.data?.viewCount).toBeUndefined();
        expect(sparse.data?.likeCount).toBeUndefined();
        expect(sparse.data?.thumbnailUrl).toBeUndefined();

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        await runFail(new YouTubeGetVideoTool(cfg).execute({ videoId: 'v' }, ctx()));
    });
});

describe('Remaining branch coverage (direct performExecute + missing response fields)', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('arxiv: nullish defaults in search params', async () => {
        globalThis.fetch = vi.fn(async () => new Response('<feed></feed>', { status: 200 })) as typeof fetch;
        const r = await (new ArxivSearchTool() as any).performExecute({ query: 'x' }, ctx());
        expect(r.total).toBe(0);
    });

    it('brave: config/default fallbacks + missing web/news result fields', async () => {
        globalThis.fetch = vi.fn(async () => json({ web: { results: [] } })) as typeof fetch;
        await (new BraveSearchTool({ apiKey: 'bk', maxResults: 7 } as any) as any).performExecute({ query: 'q' }, ctx());
        await (new BraveSearchTool({ apiKey: 'bk', language: 'fr' } as any) as any).performExecute({ query: 'q' }, ctx());
        await (new BraveSearchTool({ apiKey: 'bk' } as any) as any).performExecute({ query: 'q' }, ctx());
        await (new BraveNewsSearchTool({ apiKey: 'bk', maxResults: 7 } as any) as any).performExecute({ query: 'q' }, ctx());
        await (new BraveNewsSearchTool({ apiKey: 'bk' } as any) as any).performExecute({ query: 'q' }, ctx());

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await new BraveSearchTool({ apiKey: 'bk' }).execute({ query: 'q' }, ctx())).data?.totalResults).toBe(0);
        expect((await new BraveNewsSearchTool({ apiKey: 'bk' }).execute({ query: 'q' }, ctx())).data?.newsResults).toEqual([]);
    });

    it('exa: optional defaults + missing results', async () => {
        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        await (new ExaSearchTool({ apiKey: 'ek' }) as any).performExecute({ query: 'q' }, ctx());
        await (new ExaSearchTool({ apiKey: 'ek' }) as any).performExecute({ query: 'q', includeHighlights: true }, ctx());
        await (new ExaFindSimilarTool({ apiKey: 'ek' }) as any).performExecute({ url: 'https://x.com' }, ctx());
        await (new ExaGetContentsTool({ apiKey: 'ek' }) as any).performExecute({ urls: ['u'] }, ctx());

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await new ExaSearchTool({ apiKey: 'ek' }).execute({ query: 'q' }, ctx())).data?.count).toBe(0);
        expect((await new ExaFindSimilarTool({ apiKey: 'ek' }).execute({ url: 'https://x.com' }, ctx())).data?.count).toBe(0);
        expect((await new ExaGetContentsTool({ apiKey: 'ek' }).execute({ urls: ['u'] }, ctx())).data?.contents).toEqual([]);
    });

    it('firecrawl: optional defaults + crawl page without html', async () => {
        globalThis.fetch = vi.fn(async () => json({ data: {} })) as typeof fetch;
        await (new FirecrawlScrapeTool({ apiKey: 'fk' }) as any).performExecute({ url: 'https://x.com' }, ctx());
        globalThis.fetch = vi.fn(async () => json({ data: [] })) as typeof fetch;
        await (new FirecrawlCrawlTool({ apiKey: 'fk' }) as any).performExecute({ url: 'https://x.com' }, ctx());
        globalThis.fetch = vi.fn(async () => json({ data: {} })) as typeof fetch;
        await (new FirecrawlMapTool({ apiKey: 'fk' }) as any).performExecute({ url: 'https://x.com' }, ctx());

        globalThis.fetch = vi.fn(async () => json({
            jobId: 'j2', data: [{ url: 'u1', markdown: 'md' }],
        })) as typeof fetch;
        const r = await new FirecrawlCrawlTool({ apiKey: 'fk' }).execute({ url: 'https://x.com' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.pages[0]?.html).toBeUndefined();
        expect(r.data?.pages[0]?.markdown).toBe('md');
    });

    it('google-maps: optional defaults + missing results/error_message', async () => {
        globalThis.fetch = vi.fn(async () => json({
            status: 'OK',
            routes: [{
                summary: 'S',
                legs: [{ distance: { text: '1' }, duration: { text: '2' }, steps: [{ html_instructions: 'x', distance: { text: '1' }, duration: { text: '2' } }] }],
            }],
        })) as typeof fetch;
        await (new GoogleMapsSearchPlacesTool({ apiKey: 'gk' }) as any).performExecute({ query: 'q' }, ctx());
        await (new GoogleMapsDirectionsTool({ apiKey: 'gk' }) as any).performExecute({ origin: 'a', destination: 'b' }, ctx());
        await (new GoogleMapsPlaceDetailsTool({ apiKey: 'gk' }) as any).performExecute({ placeId: 'p' }, ctx());

        globalThis.fetch = vi.fn(async () => json({ status: 'OK' })) as typeof fetch;
        expect((await new GoogleMapsSearchPlacesTool({ apiKey: 'gk' }).execute({ query: 'q' }, ctx())).data?.places).toEqual([]);

        globalThis.fetch = vi.fn(async () => json({ status: 'NOT_FOUND' })) as typeof fetch;
        const bad = await new GoogleMapsGeocodeTool({ apiKey: 'gk' }).execute({ address: 'x' }, ctx());
        expect(bad.success).toBe(false);
        expect(bad.error?.message).toContain('NOT_FOUND');
    });

    it('jina: optional defaults + missing content-type + missing data', async () => {
        const plain = new Response('plain', { status: 200 });
        plain.headers.delete('content-type');
        globalThis.fetch = vi.fn(async () => plain) as typeof fetch;
        const reader = await (new JinaReaderTool({ apiKey: 'jk' }) as any).performExecute({ url: 'https://x.com' }, ctx());
        expect(reader.content).toBe('plain');

        globalThis.fetch = vi.fn(async () => json({ data: [] })) as typeof fetch;
        await (new JinaSearchTool({ apiKey: 'jk' }) as any).performExecute({ query: 'q' }, ctx());
        globalThis.fetch = vi.fn(async () => json({ results: [{ document: { text: 'd' }, relevance_score: 1, index: 0 }] })) as typeof fetch;
        await (new JinaRerankTool({ apiKey: 'jk' }) as any).performExecute({ query: 'q', documents: ['a'] }, ctx());

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await new JinaSearchTool({ apiKey: 'jk' }).execute({ query: 'q' }, ctx())).data?.results).toEqual([]);
        expect((await new JinaRerankTool({ apiKey: 'jk' }).execute({ query: 'q', documents: ['a'] }, ctx())).data?.results).toEqual([]);
    });

    it('linkup: optional defaults + missing results', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const r = await (new LinkupSearchTool({ apiKey: 'lk' }) as any).performExecute({ query: 'q' }, ctx());
        expect(r.results).toEqual([]);
    });

    it('newspaper: optional defaults + missing totals/articles', async () => {
        globalThis.fetch = vi.fn(async () => json({ articles: [] })) as typeof fetch;
        await (new SearchNewsTool({ newsApiKey: 'nk' }) as any).performExecute({ query: 'q' }, ctx());
        await (new GetTopHeadlinesTool({ newsApiKey: 'nk' }) as any).performExecute({}, ctx());
        expect((await new SearchNewsTool({ newsApiKey: 'nk' }).execute({ query: 'q' }, ctx())).data?.totalResults).toBe(0);
        expect((await new GetTopHeadlinesTool({ newsApiKey: 'nk' }).execute({}, ctx())).data?.totalResults).toBe(0);

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await new SearchNewsTool({ newsApiKey: 'nk' }).execute({ query: 'q' }, ctx())).data?.articles).toEqual([]);
        expect((await new GetTopHeadlinesTool({ newsApiKey: 'nk' }).execute({}, ctx())).data?.articles).toEqual([]);
    });

    it('perplexity: config + default model fallbacks', async () => {
        globalThis.fetch = vi.fn(async () => json({ choices: [] })) as typeof fetch;
        await (new PerplexitySearchTool({ apiKey: 'pk', model: 'pmodel' }) as any).performExecute({ query: 'q' }, ctx());
        await (new PerplexitySearchTool({ apiKey: 'pk' }) as any).performExecute({ query: 'q' }, ctx());
    });

    it('pubmed: missing esearch/efetch fields', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('esearch.fcgi')) return json({ esearchresult: {} });
            return json({});
        }) as typeof fetch;
        const r = await new PubMedSearchTool({ apiKey: 'pk' }).execute({ query: 'q' }, ctx());
        expect(r.data?.totalCount).toBe(0);
        expect(r.data?.pmids).toEqual([]);

        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('esearch.fcgi')) return json({ esearchresult: { count: '1', idlist: ['1'] } });
            return json({});
        }) as typeof fetch;
        const r2 = await new PubMedSearchTool({ apiKey: 'pk' }).execute({ query: 'q' }, ctx());
        expect(r2.data?.articles).toEqual([]);

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await new PubMedGetArticleTool({ apiKey: 'pk' }).execute({ pmids: ['1'] }, ctx())).data?.articles).toEqual([]);
    });

    it('reddit: default fallbacks', async () => {
        globalThis.fetch = vi.fn(async () => json({ data: { children: [] } })) as typeof fetch;
        await (new RedditSearchTool({}) as any).performExecute({ query: 'q' }, ctx());
        await (new RedditSearchTool({ clientId: 'cid', clientSecret: 'csec' }) as any).performExecute({ query: 'q' }, ctx());
        await (new RedditGetPostsTool({}) as any).performExecute({ subreddit: 'tech' }, ctx());
    });

    it('searxng: default fallbacks', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        await (new SearXNGSearchTool({}) as any).performExecute({ query: 'q' }, ctx());
    });

    it('serper: num/markdown fallbacks', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        await (new SerperWebSearchTool({ apiKey: 'sk', numResults: 7 }) as any).performExecute({ query: 'q' }, ctx());
        await (new SerperWebSearchTool({ apiKey: 'sk' }) as any).performExecute({ query: 'q' }, ctx());
        await (new SerperNewsSearchTool({ apiKey: 'sk', numResults: 7 }) as any).performExecute({ query: 'q' }, ctx());
        await (new SerperNewsSearchTool({ apiKey: 'sk' }) as any).performExecute({ query: 'q' }, ctx());
        await (new SerperScholarSearchTool({ apiKey: 'sk', numResults: 7 }) as any).performExecute({ query: 'q' }, ctx());
        await (new SerperScholarSearchTool({ apiKey: 'sk' }) as any).performExecute({ query: 'q' }, ctx());
        await (new SerperScrapeTool({ apiKey: 'sk' }) as any).performExecute({ url: 'https://example.com' }, ctx());
    });

    it('tavily: search/extract fallbacks + missing results', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const r = await (new TavilySearchTool({ apiKey: 'tk' }) as any).performExecute({ query: 'q' }, ctx());
        expect(r.results).toEqual([]);
        await (new TavilyExtractTool({ apiKey: 'tk' }) as any).performExecute({ urls: ['https://a.com'] }, ctx());
        expect((await new TavilyExtractTool({ apiKey: 'tk' }).execute({ urls: ['https://a.com'] }, ctx())).data?.results).toEqual([]);
    });

    it('weather: forecast days default', async () => {
        globalThis.fetch = vi.fn(async () => json({ city: { name: 'R' }, list: [] })) as typeof fetch;
        const r = await (new OpenWeatherForecastTool({ apiKey: 'wk' }) as any).performExecute({ location: 'R' }, ctx());
        expect(r.forecast).toEqual([]);
    });

    it('youtube: search defaults + missing items', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        await (new YouTubeSearchTool({ apiKey: 'yk' }) as any).performExecute({ query: 'q' }, ctx());
        expect((await new YouTubeSearchTool({ apiKey: 'yk' }).execute({ query: 'q' }, ctx())).data?.videos).toEqual([]);
    });
});
