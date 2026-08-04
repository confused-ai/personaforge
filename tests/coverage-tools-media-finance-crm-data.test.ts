/**
 * Hermetic 100% coverage for media / finance / crm / data tools.
 * fetch() is stubbed for HTTP tools; SDK `require()` calls (stripe, ioredis,
 * pg, mysql2, better-sqlite3) are stubbed via Module._load; `yahoo-finance2`
 * is stubbed via vi.mock (dynamic import).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Module from 'node:module';

import { UnsplashSearchPhotosTool, UnsplashGetPhotoTool, UnsplashGetRandomPhotoTool, UnsplashSearchCollectionsTool, UnsplashListCollectionPhotosTool, UnsplashToolkit } from '../src/tools/media/unsplash.js';
import { GiphySearchTool, GiphyTrendingTool, GiphyGetGifTool, GiphyRandomTool, GiphyTranslateTool, GiphyToolkit } from '../src/tools/media/giphy.js';
import { ElevenLabsTTSTool, ElevenLabsListVoicesTool, ElevenLabsGetVoiceTool, ElevenLabsSoundEffectTool, ElevenLabsToolkit } from '../src/tools/media/elevenlabs.js';
import { FalGenerateImageTool, FalGenerateVideoTool, FalImageToImageTool, FalRemoveBackgroundTool, FalToolkit } from '../src/tools/media/fal.js';
import { ReplicateGenerateImageTool, ReplicateGenerateVideoTool, ReplicateTranscribeAudioTool, ReplicateGetPredictionTool, ReplicateToolkit } from '../src/tools/media/replicate.js';
import { OpenBBStockQuoteTool, OpenBBStockHistoricalTool, OpenBBStockNewsTool, OpenBBStockFundamentalsTool, OpenBBCryptoQuoteTool, OpenBBForexTool, OpenBBToolkit } from '../src/tools/finance/openbb.js';
import { StripeCreateCustomerTool, StripeGetCustomerTool, StripeCreatePaymentIntentTool, StripeCreateSubscriptionTool, StripeCancelSubscriptionTool, StripeRefundTool, StripeToolkit } from '../src/tools/finance/stripe.js';
import { YFinanceTool } from '../src/tools/finance/yfinance.js';
import { SalesforceQueryTool, SalesforceGetRecordTool, SalesforceCreateRecordTool, SalesforceUpdateRecordTool, SalesforceSearchTool, SalesforceToolkit } from '../src/tools/crm/salesforce.js';
import { ShopifyListProductsTool, ShopifyGetProductTool, ShopifyListOrdersTool, ShopifyGetOrderTool, ShopifyListCustomersTool, ShopifyGetCustomerTool, ShopifyToolkit } from '../src/tools/crm/shopify.js';
import { ZendeskListTicketsTool, ZendeskGetTicketTool, ZendeskCreateTicketTool, ZendeskUpdateTicketTool, ZendeskSearchTicketsTool, ZendeskToolkit } from '../src/tools/crm/zendesk.js';
import { BigQueryQueryTool, BigQueryListDatasetsTool, BigQueryListTablesTool, BigQueryGetTableTool, BigQueryToolkit } from '../src/tools/data/bigquery.js';
import { CsvParseTool, CsvFilterTool, CsvSelectColumnsTool, CsvSortTool, CsvAggregateTool, CsvToJsonTool, CsvToolkit } from '../src/tools/data/csv.js';
import { PostgreSQLQueryTool, PostgreSQLInsertTool, MySQLQueryTool, SQLiteQueryTool, DatabaseToolkit } from '../src/tools/data/database.js';
import { Neo4jRunCypherTool, Neo4jCreateNodeTool, Neo4jCreateRelationshipTool, Neo4jFindNodesTool, Neo4jDeleteNodeTool, Neo4jGetSchemaTool, Neo4jToolkit } from '../src/tools/data/neo4j.js';
import { RedisGetTool, RedisSetTool, RedisDeleteTool, RedisKeysTool, RedisHashGetTool, RedisIncrTool, RedisToolkit } from '../src/tools/data/redis.js';
import type { ToolContext } from '../src/tools/core/types.js';

// ── helpers ────────────────────────────────────────────────────────────────

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

function callRaw(tool: any, input: unknown, tc: ToolContext = ctx()) {
    const t: any = tool;
    return t.performExecute.call(tool, input, tc);
}

function withEnv(key: string, value: string | undefined, fn: () => Promise<unknown>): Promise<unknown> {
    const prev = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            if (prev === undefined) delete process.env[key];
            else process.env[key] = prev;
        });
}

const originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
});

// ── SDK mocks (stripe, ioredis, pg, mysql2, better-sqlite3) ────────────────

const redisClient = {
    get: vi.fn(async (_k: string) => 'v'),
    set: vi.fn(async (..._a: unknown[]) => 'OK'),
    del: vi.fn(async (..._keys: string[]) => 2),
    keys: vi.fn(async (_pattern: string) => ['a', 'b']),
    hgetall: vi.fn(async () => ({ f: 'x' })),
    hset: vi.fn(async () => 1),
    incr: vi.fn(async (_k: string) => 7),
    incrby: vi.fn(async (_k: string, n: number) => n),
    quit: vi.fn(async () => 'OK' as const),
};
const Redis = vi.fn(function (_url: string) { return redisClient; });

const pgPool = {
    query: vi.fn(async (_q: string, _p?: unknown[]) => ({
        rows: [{ id: 1, name: 'a' }],
        rowCount: 1,
        fields: [{ name: 'id' }, { name: 'name' }],
    })),
};
const Pool = vi.fn(function (_opts: object) { return pgPool; });

const mysqlConn = {
    execute: vi.fn(async (_q: string, _p?: unknown[]) => [[{ id: 1 }, { id: 2 }], []]),
    end: vi.fn(async () => {}),
};
const mysqlModule = { createConnection: vi.fn(async () => mysqlConn) };

const sqliteDb = {
    prepare: vi.fn((_q: string) => ({
        all: vi.fn((..._a: unknown[]) => [{ id: 1 }, { id: 2 }]),
    })),
};
const Sqlite = vi.fn((_path: string) => sqliteDb);

const stripeClient = {
    customers: {
        create: vi.fn(async (p: object) => ({ ...p, id: 'cus_1' })),
        retrieve: vi.fn(async (id: string) => ({ id })),
    },
    paymentIntents: {
        create: vi.fn(async (p: object) => ({ ...p, id: 'pi_1' })),
        retrieve: vi.fn(async (id: string) => ({ id })),
    },
    subscriptions: {
        create: vi.fn(async (p: object) => ({ ...p, id: 'sub_1' })),
        cancel: vi.fn(async (id: string) => ({ id })),
    },
    refunds: {
        create: vi.fn(async (p: object) => ({ ...p, id: 're_1' })),
    },
};
const StripeFactory = vi.fn((_k: string, _o: object) => stripeClient);

const Mod: any = Module;
const originalLoad = Mod._load as (...args: unknown[]) => unknown;

beforeEach(() => {
    Mod._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
        if (request === 'ioredis') return Redis;
        if (request === 'stripe') return StripeFactory;
        if (request === 'pg') return { Pool };
        if (request === 'mysql2/promise') return mysqlModule;
        if (request === 'better-sqlite3') return Sqlite;
        return originalLoad.call(this, request, parent, isMain);
    };
});

afterEach(() => {
    Mod._load = originalLoad;
});

vi.mock('yahoo-finance2', () => ({
    default: { quote: vi.fn(async (s: string) => ({ symbol: s, regularMarketPrice: 120.5 })) },
}));

// ── Media: Unsplash ────────────────────────────────────────────────────────

describe('Unsplash tools', () => {
    const cfg = { accessKey: 'u-key' };
    const photo = {
        id: 'p1', description: 'desc', alt_description: 'alt', width: 100, height: 200, likes: 3,
        urls: { full: 'f', regular: 'r', small: 's', thumb: 't' },
        user: { name: 'N', username: 'U' },
        links: { html: 'h', download: 'd' },
    };

    it('search photos: success (full + sparse photos), params via callRaw, error, missing key', async () => {
        globalThis.fetch = vi.fn(async () => json({ results: [photo, { id: 'p2' }], total: 2, total_pages: 1 })) as typeof fetch;
        const ok = await new UnsplashSearchPhotosTool(cfg).execute({ query: 'cats', orientation: 'landscape', color: 'blue' }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.photos[0]?.description).toBe('desc');
        expect(ok.data?.photos[0]?.altDescription).toBe('alt');
        expect(ok.data?.photos[1]?.urls.full).toBe('');
        expect(ok.data?.total).toBe(2);

        const raw = await callRaw(new UnsplashSearchPhotosTool(cfg), { query: 'x' });
        expect(raw.photos).toHaveLength(2);

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const rawEmpty = await callRaw(new UnsplashSearchPhotosTool(cfg), { query: 'x' });
        expect(rawEmpty.total).toBe(0);
        expect(rawEmpty.totalPages).toBe(0);

        globalThis.fetch = vi.fn(async () => json({ error: 'x' }, 500)) as typeof fetch;
        const bad = await new UnsplashSearchPhotosTool(cfg).execute({ query: 'cats' }, ctx());
        expect(bad.success).toBe(false);

        const r = await withEnv('UNSPLASH_ACCESS_KEY', undefined, async () =>
            new UnsplashSearchPhotosTool({}).execute({ query: 'cats' }, ctx()));
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/UNSPLASH_ACCESS_KEY/);
    });

    it('get photo: success + error + env key path', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 'p1' })) as typeof fetch;
        const ok = await new UnsplashGetPhotoTool(cfg).execute({ photoId: 'p1' }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.id).toBe('p1');

        globalThis.fetch = vi.fn(async () => json({}, 404)) as typeof fetch;
        const bad = await new UnsplashGetPhotoTool(cfg).execute({ photoId: 'p1' }, ctx());
        expect(bad.success).toBe(false);

        const envOk = await withEnv('UNSPLASH_ACCESS_KEY', 'env-key', async () => {
            globalThis.fetch = vi.fn(async () => json({ id: 'p1' })) as typeof fetch;
            return new UnsplashGetPhotoTool({}).execute({ photoId: 'p1' }, ctx());
        });
        expect(envOk.success).toBe(true);
    });

    it('get random photo: all branches', async () => {
        globalThis.fetch = vi.fn(async () => json([photo])) as typeof fetch;
        const ok = await new UnsplashGetRandomPhotoTool(cfg).execute({ query: 'q', orientation: 'squarish', collections: 'c1' }, ctx());
        expect(ok.success).toBe(true);

        const raw = await callRaw(new UnsplashGetRandomPhotoTool(cfg), {});
        expect(raw).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        const bad = await new UnsplashGetRandomPhotoTool(cfg).execute({}, ctx());
        expect(bad.success).toBe(false);
    });

    it('search collections + list collection photos: branches', async () => {
        globalThis.fetch = vi.fn(async () => json({ total: 1, results: [] })) as typeof fetch;
        const ok1 = await new UnsplashSearchCollectionsTool(cfg).execute({ query: 'nat' }, ctx());
        expect(ok1.success).toBe(true);
        const raw1 = await callRaw(new UnsplashSearchCollectionsTool(cfg), { query: 'nat' });
        expect(raw1).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json([photo])) as typeof fetch;
        const ok2 = await new UnsplashListCollectionPhotosTool(cfg).execute({ collectionId: 'col1', orientation: 'portrait' }, ctx());
        expect(ok2.success).toBe(true);
        const raw2 = await callRaw(new UnsplashListCollectionPhotosTool(cfg), { collectionId: 'col1' });
        expect(raw2).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({}, 429)) as typeof fetch;
        expect((await new UnsplashSearchCollectionsTool(cfg).execute({ query: 'nat' }, ctx())).success).toBe(false);
        expect((await new UnsplashListCollectionPhotosTool(cfg).execute({ collectionId: 'col1' }, ctx())).success).toBe(false);
    });

    it('toolkit', () => {
        const tk = new UnsplashToolkit(cfg);
        expect(tk.getTools()).toHaveLength(5);
        expect(tk.searchPhotos).toBeInstanceOf(UnsplashSearchPhotosTool);
    });
});

// ── Media: GIPHY ───────────────────────────────────────────────────────────

describe('GIPHY tools', () => {
    const cfg = { apiKey: 'g-key' };

    it('search: success (with/without images), rating levels, error, missing key, callRaw', async () => {
        globalThis.fetch = vi.fn(async () => json({
            data: [
                { id: 'g1', title: 'T', url: 'u', images: { original: { url: 'o', width: '1', height: '2' } } },
                { id: 'g2', title: 'T2', url: 'u2' },
            ],
            pagination: { total_count: 2 },
        })) as typeof fetch;
        const ok = await new GiphySearchTool({ ...cfg, rating: 'r' }).execute({ query: 'dog', rating: 'g' }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.gifs[0]?.gifUrl).toBe('o');
        expect(ok.data?.gifs[1]?.width).toBe('0');

        const raw = await callRaw(new GiphySearchTool(cfg), { query: 'dog' });
        expect(raw.gifs).toHaveLength(2);

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const rawEmpty = await callRaw(new GiphySearchTool(cfg), { query: 'dog' });
        expect(rawEmpty.total).toBe(0);

        globalThis.fetch = vi.fn(async () => json({}, 400)) as typeof fetch;
        expect((await new GiphySearchTool(cfg).execute({ query: 'dog' }, ctx())).success).toBe(false);

        const r = await withEnv('GIPHY_API_KEY', undefined, async () => new GiphySearchTool({}).execute({ query: 'dog' }, ctx()));
        expect(r.success).toBe(false);
    });

    it('trending: branches', async () => {
        globalThis.fetch = vi.fn(async () => json({ data: [] })) as typeof fetch;
        expect((await new GiphyTrendingTool(cfg).execute({}, ctx())).success).toBe(true);
        const raw = await callRaw(new GiphyTrendingTool(cfg), {});
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new GiphyTrendingTool(cfg).execute({}, ctx())).success).toBe(false);
    });

    it('get gif: success/error', async () => {
        globalThis.fetch = vi.fn(async () => json({ data: { id: 'g1' } })) as typeof fetch;
        expect((await new GiphyGetGifTool(cfg).execute({ gifId: 'g1' }, ctx())).success).toBe(true);
        globalThis.fetch = vi.fn(async () => json({}, 404)) as typeof fetch;
        expect((await new GiphyGetGifTool(cfg).execute({ gifId: 'g1' }, ctx())).success).toBe(false);
    });

    it('random: tag present/absent, error, callRaw', async () => {
        globalThis.fetch = vi.fn(async () => json({ data: { id: 'g9' } })) as typeof fetch;
        expect((await new GiphyRandomTool(cfg).execute({ tag: 'cat', rating: 'pg-13' }, ctx())).success).toBe(true);
        const raw = await callRaw(new GiphyRandomTool(cfg), {});
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new GiphyRandomTool(cfg).execute({}, ctx())).success).toBe(false);
    });

    it('translate: success/error/callRaw', async () => {
        globalThis.fetch = vi.fn(async () => json({ data: { id: 'g3' } })) as typeof fetch;
        expect((await new GiphyTranslateTool(cfg).execute({ phrase: 'wow' }, ctx())).success).toBe(true);
        const raw = await callRaw(new GiphyTranslateTool(cfg), { phrase: 'wow' });
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 400)) as typeof fetch;
        expect((await new GiphyTranslateTool(cfg).execute({ phrase: 'wow' }, ctx())).success).toBe(false);
    });

    it('toolkit', () => {
        expect(new GiphyToolkit(cfg).getTools()).toHaveLength(5);
    });
});

// ── Media: ElevenLabs ──────────────────────────────────────────────────────

describe('ElevenLabs tools', () => {
    const cfg = { apiKey: 'e-key', defaultVoiceId: 'vcfg', defaultModelId: 'mcfg' };

    it('tts: voiceSettings full/absent/partial, returnBase64 true/false, error, callRaw', async () => {
        globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch;
        const ok = await new ElevenLabsTTSTool(cfg).execute({
            text: 'hello',
            voiceSettings: { stability: 0.1, useSpeakerBoost: false },
        }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.audioBase64).toBeTruthy();
        expect(ok.data?.characterCount).toBe(5);

        const noB64 = await new ElevenLabsTTSTool({ apiKey: 'x' }).execute({ text: 'bye', returnBase64: false }, ctx());
        expect(noB64.success).toBe(true);
        expect(noB64.data?.audioBase64).toBeUndefined();

        const emptySettings = await new ElevenLabsTTSTool(cfg).execute({ text: 'hi', voiceSettings: {} }, ctx());
        expect(emptySettings.success).toBe(true);

        const raw = await callRaw(new ElevenLabsTTSTool(cfg), { text: 'r' });
        expect(raw.audioBase64).toBeTruthy();

        const rawDefault = await callRaw(new ElevenLabsTTSTool({ apiKey: 'x' }), { text: 'd' });
        expect(rawDefault.voiceId).toBe('JBFqnCBsd6RMkjVDRZzb');

        globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch;
        const rawSettings = await callRaw(new ElevenLabsTTSTool(cfg), { text: 'r', voiceSettings: {} });
        expect(rawSettings.audioBase64).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({}, 401)) as typeof fetch;
        expect((await new ElevenLabsTTSTool(cfg).execute({ text: 'x' }, ctx())).success).toBe(false);

        const envOk = await withEnv('ELEVEN_LABS_API_KEY', 'env-key', async () => {
            globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch;
            return new ElevenLabsTTSTool({}).execute({ text: 'x' }, ctx());
        });
        expect(envOk.success).toBe(true);

        const missing = await withEnv('ELEVEN_LABS_API_KEY', undefined, async () =>
            new ElevenLabsTTSTool({}).execute({ text: 'x' }, ctx()));
        expect(missing.success).toBe(false);
        expect(missing.error?.message).toMatch(/ELEVEN_LABS_API_KEY/);
    });

    it('list voices: description/preview present & absent, error, callRaw', async () => {
        globalThis.fetch = vi.fn(async () => json({
            voices: [
                { voice_id: 'v1', name: 'George', category: 'premade', description: 'd', preview_url: 'p' },
                { voice_id: 'v2', name: 'Bella', category: 'premade' },
            ],
        })) as typeof fetch;
        const ok = await new ElevenLabsListVoicesTool(cfg).execute({}, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.voices[0]?.description).toBe('d');
        expect(ok.data?.voices[1]?.description).toBeUndefined();
        const raw = await callRaw(new ElevenLabsListVoicesTool(cfg), {});
        expect(raw.voices).toHaveLength(2);
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const rawEmpty = await callRaw(new ElevenLabsListVoicesTool(cfg), {});
        expect(rawEmpty.voices).toEqual([]);
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new ElevenLabsListVoicesTool(cfg).execute({}, ctx())).success).toBe(false);
    });

    it('get voice: success/error', async () => {
        globalThis.fetch = vi.fn(async () => json({ voice_id: 'v1' })) as typeof fetch;
        expect((await new ElevenLabsGetVoiceTool(cfg).execute({ voiceId: 'v1' }, ctx())).success).toBe(true);
        globalThis.fetch = vi.fn(async () => json({}, 404)) as typeof fetch;
        expect((await new ElevenLabsGetVoiceTool(cfg).execute({ voiceId: 'v1' }, ctx())).success).toBe(false);
    });

    it('sound effect: success/error/callRaw', async () => {
        globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 })) as typeof fetch;
        const ok = await new ElevenLabsSoundEffectTool(cfg).execute({ text: 'boom', durationSeconds: 2 }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.audioBase64).toBeTruthy();
        const raw = await callRaw(new ElevenLabsSoundEffectTool(cfg), { text: 'boom' });
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 429)) as typeof fetch;
        expect((await new ElevenLabsSoundEffectTool(cfg).execute({ text: 'boom' }, ctx())).success).toBe(false);
    });

    it('toolkit', () => {
        expect(new ElevenLabsToolkit(cfg).getTools()).toHaveLength(4);
    });
});

// ── Media: fal ─────────────────────────────────────────────────────────────

describe('fal tools', () => {
    const cfg = { apiKey: 'f-key' };

    it('generate image: success, callRaw, error, missing key', async () => {
        globalThis.fetch = vi.fn(async () => json({ images: [{ url: 'u' }] })) as typeof fetch;
        const ok = await new FalGenerateImageTool(cfg).execute({
            prompt: 'cat', imageSize: 'square_hd', numImages: 2, seed: 1, numInferenceSteps: 4, guidanceScale: 7, model: 'fal-ai/flux/dev',
        }, ctx());
        expect(ok.success).toBe(true);
        const raw = await callRaw(new FalGenerateImageTool(cfg), { prompt: 'x' });
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new FalGenerateImageTool(cfg).execute({ prompt: 'x' }, ctx())).success).toBe(false);
        const r = await withEnv('FAL_KEY', undefined, async () => new FalGenerateImageTool({}).execute({ prompt: 'x' }, ctx()));
        expect(r.success).toBe(false);
    });

    it('generate video: success, callRaw, error', async () => {
        globalThis.fetch = vi.fn(async () => json({ video: { url: 'u' } })) as typeof fetch;
        const ok = await new FalGenerateVideoTool(cfg).execute({ prompt: 'x', duration: '10', aspectRatio: '1:1' }, ctx());
        expect(ok.success).toBe(true);
        const raw = await callRaw(new FalGenerateVideoTool(cfg), { prompt: 'x' });
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new FalGenerateVideoTool(cfg).execute({ prompt: 'x' }, ctx())).success).toBe(false);
    });

    it('image-to-image: success, callRaw, error', async () => {
        globalThis.fetch = vi.fn(async () => json({ images: [] })) as typeof fetch;
        const ok = await new FalImageToImageTool(cfg).execute({ prompt: 'x', imageUrl: 'https://e.com/i.png', strength: 0.5, numInferenceSteps: 20 }, ctx());
        expect(ok.success).toBe(true);
        const raw = await callRaw(new FalImageToImageTool(cfg), { prompt: 'x', imageUrl: 'https://e.com/i.png' });
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new FalImageToImageTool(cfg).execute({ prompt: 'x', imageUrl: 'https://e.com/i.png' }, ctx())).success).toBe(false);
    });

    it('remove background: success/error', async () => {
        globalThis.fetch = vi.fn(async () => json({ images: [] })) as typeof fetch;
        expect((await new FalRemoveBackgroundTool(cfg).execute({ imageUrl: 'https://e.com/i.png' }, ctx())).success).toBe(true);
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new FalRemoveBackgroundTool(cfg).execute({ imageUrl: 'https://e.com/i.png' }, ctx())).success).toBe(false);
    });

    it('toolkit', () => {
        expect(new FalToolkit(cfg).getTools()).toHaveLength(4);
    });
});

// ── Media: Replicate ───────────────────────────────────────────────────────

describe('Replicate tools', () => {
    const cfg = { apiToken: 'r-key' };

    it('generate image: full opts, minimal, callRaw, error, missing key', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 'pred1', status: 'succeeded', output: ['u'] })) as typeof fetch;
        const ok = await new ReplicateGenerateImageTool(cfg).execute({
            prompt: 'x', width: 512, height: 512, numOutputs: 2, negativePrompt: 'blur', numInferenceSteps: 30, guidanceScale: 7,
        }, ctx());
        expect(ok.success).toBe(true);
        const okMin = await new ReplicateGenerateImageTool(cfg).execute({ prompt: 'x' }, ctx());
        expect(okMin.success).toBe(true);
        const raw = await callRaw(new ReplicateGenerateImageTool(cfg), { prompt: 'x' });
        expect(raw.id).toBe('pred1');
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new ReplicateGenerateImageTool(cfg).execute({ prompt: 'x' }, ctx())).success).toBe(false);
        const r = await withEnv('REPLICATE_API_TOKEN', undefined, async () => new ReplicateGenerateImageTool({}).execute({ prompt: 'x' }, ctx()));
        expect(r.success).toBe(false);
    });

    it('generate video: opts present/absent, callRaw, error', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 'v1', status: 'starting' })) as typeof fetch;
        expect((await new ReplicateGenerateVideoTool(cfg).execute({ prompt: 'x', duration: 5, fps: 24 }, ctx())).success).toBe(true);
        const raw = await callRaw(new ReplicateGenerateVideoTool(cfg), { prompt: 'x' });
        expect(raw.id).toBe('v1');
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new ReplicateGenerateVideoTool(cfg).execute({ prompt: 'x' }, ctx())).success).toBe(false);
    });

    it('transcribe audio: language present/absent, callRaw, error', async () => {
        globalThis.fetch = vi.fn(async () => json({ output: 'text' })) as typeof fetch;
        expect((await new ReplicateTranscribeAudioTool(cfg).execute({ audioUrl: 'https://e.com/a.mp3', language: 'en' }, ctx())).success).toBe(true);
        const raw = await callRaw(new ReplicateTranscribeAudioTool(cfg), { audioUrl: 'https://e.com/a.mp3' });
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new ReplicateTranscribeAudioTool(cfg).execute({ audioUrl: 'https://e.com/a.mp3' }, ctx())).success).toBe(false);
    });

    it('get prediction: success/error', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 'p9', status: 'succeeded' })) as typeof fetch;
        expect((await new ReplicateGetPredictionTool(cfg).execute({ predictionId: 'p9' }, ctx())).success).toBe(true);
        globalThis.fetch = vi.fn(async () => json({}, 404)) as typeof fetch;
        expect((await new ReplicateGetPredictionTool(cfg).execute({ predictionId: 'p9' }, ctx())).success).toBe(false);
    });

    it('toolkit', () => {
        expect(new ReplicateToolkit(cfg).getTools()).toHaveLength(4);
    });
});

// ── Finance: OpenBB ────────────────────────────────────────────────────────

describe('OpenBB tools', () => {
    const cfg = { pat: 'o-pat', host: 'https://openbb.example.com/' };

    it('stock quote / crypto / forex: success, callRaw, error', async () => {
        globalThis.fetch = vi.fn(async () => json({ symbol: 'AAPL', price: 150 })) as typeof fetch;
        expect((await new OpenBBStockQuoteTool(cfg).execute({ symbol: 'AAPL' }, ctx())).success).toBe(true);
        const rawQuote = await callRaw(new OpenBBStockQuoteTool(cfg), { symbol: 'AAPL' });
        expect(rawQuote).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({ symbol: 'BTCUSD', price: 1 })) as typeof fetch;
        expect((await new OpenBBCryptoQuoteTool(cfg).execute({ symbol: 'BTCUSD' }, ctx())).success).toBe(true);
        const rawCrypto = await callRaw(new OpenBBCryptoQuoteTool(cfg), { symbol: 'BTCUSD' });
        expect(rawCrypto).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({ symbol: 'EURUSD', price: 1.1 })) as typeof fetch;
        expect((await new OpenBBForexTool(cfg).execute({ symbol: 'EURUSD', provider: 'fmp' }, ctx())).success).toBe(true);
        const rawForex = await callRaw(new OpenBBForexTool(cfg), { symbol: 'EURUSD' });
        expect(rawForex).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new OpenBBStockQuoteTool(cfg).execute({ symbol: 'AAPL' }, ctx())).success).toBe(false);
        expect((await new OpenBBCryptoQuoteTool(cfg).execute({ symbol: 'BTCUSD' }, ctx())).success).toBe(false);
        expect((await new OpenBBForexTool(cfg).execute({ symbol: 'EURUSD' }, ctx())).success).toBe(false);
    });

    it('stock historical: dates present/absent, callRaw, error', async () => {
        globalThis.fetch = vi.fn(async () => json({ data: [] })) as typeof fetch;
        expect((await new OpenBBStockHistoricalTool(cfg).execute({ symbol: 'AAPL', startDate: '2024-01-01', endDate: '2024-02-01' }, ctx())).success).toBe(true);
        expect((await new OpenBBStockHistoricalTool(cfg).execute({ symbol: 'AAPL' }, ctx())).success).toBe(true);
        const raw = await callRaw(new OpenBBStockHistoricalTool(cfg), { symbol: 'AAPL' });
        expect(raw).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new OpenBBStockHistoricalTool(cfg).execute({ symbol: 'AAPL' }, ctx())).success).toBe(false);
    });

    it('stock news + fundamentals: success, callRaw, error', async () => {
        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        expect((await new OpenBBStockNewsTool(cfg).execute({ symbols: 'AAPL,MSFT' }, ctx())).success).toBe(true);
        const rawNews = await callRaw(new OpenBBStockNewsTool(cfg), { symbols: 'AAPL' });
        expect(rawNews).toBeTruthy();
        expect((await new OpenBBStockFundamentalsTool(cfg).execute({ symbol: 'AAPL', period: 'quarter' }, ctx())).success).toBe(true);
        const rawFund = await callRaw(new OpenBBStockFundamentalsTool(cfg), { symbol: 'AAPL' });
        expect(rawFund).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new OpenBBStockNewsTool(cfg).execute({ symbols: 'AAPL' }, ctx())).success).toBe(false);
        expect((await new OpenBBStockFundamentalsTool(cfg).execute({ symbol: 'AAPL' }, ctx())).success).toBe(false);
    });

    it('auth: missing pat throw, host env fallback, host default', async () => {
        const r = await withEnv('OPENBB_PAT', undefined, async () =>
            new OpenBBStockQuoteTool({}).execute({ symbol: 'AAPL' }, ctx()));
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/OPENBB_PAT/);

        const envHost = await withEnv('OPENBB_HOST', 'https://env.openbb.io', async () => {
            globalThis.fetch = vi.fn(async () => json({ symbol: 'AAPL' })) as typeof fetch;
            return new OpenBBStockQuoteTool({ pat: 'p' }).execute({ symbol: 'AAPL' }, ctx());
        });
        expect(envHost.success).toBe(true);

        const defHost = await withEnv('OPENBB_HOST', undefined, async () => {
            globalThis.fetch = vi.fn(async () => json({ symbol: 'AAPL' })) as typeof fetch;
            return new OpenBBStockQuoteTool({ pat: 'p' }).execute({ symbol: 'AAPL' }, ctx());
        });
        expect(defHost.success).toBe(true);

        expect(new OpenBBToolkit(cfg).getTools()).toHaveLength(6);
        expect(new OpenBBToolkit().getTools()).toHaveLength(6);
    });
});

// ── Finance: Stripe (require("stripe")) ────────────────────────────────────

describe('Stripe tools', () => {
    const cfg = { secretKey: 'sk_test_1' };

    it('touches every tool: success + reject + env key + missing key + toolkit', async () => {
        (stripeClient.customers.create as any).mockResolvedValueOnce({ id: 'cus_1' });
        const c = await new StripeCreateCustomerTool(cfg).execute({ email: 'a@b.com', name: 'A', metadata: { k: 'v' } }, ctx());
        expect(c.success).toBe(true);
        expect(c.data?.id).toBe('cus_1');

        (stripeClient.customers.retrieve as any).mockRejectedValueOnce(new Error('nope'));
        const g = await new StripeGetCustomerTool(cfg).execute({ customerId: 'cus_1' }, ctx());
        expect(g.success).toBe(false);
        (stripeClient.customers.retrieve as any).mockResolvedValueOnce({ id: 'cus_1' });
        expect((await new StripeGetCustomerTool(cfg).execute({ customerId: 'cus_1' }, ctx())).success).toBe(true);

        (stripeClient.paymentIntents.create as any).mockResolvedValueOnce({ id: 'pi_1' });
        const pi = await new StripeCreatePaymentIntentTool(cfg).execute({ amount: 100, currency: 'usd', customerId: 'cus_1', description: 'd' }, ctx());
        expect(pi.success).toBe(true);
        (stripeClient.paymentIntents.create as any).mockRejectedValueOnce(new Error('bad'));
        expect((await new StripeCreatePaymentIntentTool(cfg).execute({ amount: 100, currency: 'usd' }, ctx())).success).toBe(false);

        (stripeClient.subscriptions.create as any).mockResolvedValueOnce({ id: 'sub_1' });
        expect((await new StripeCreateSubscriptionTool(cfg).execute({ customerId: 'cus_1', priceId: 'price_1', trialDays: 7 }, ctx())).success).toBe(true);

        (stripeClient.subscriptions.cancel as any).mockResolvedValueOnce({ id: 'sub_1' });
        expect((await new StripeCancelSubscriptionTool(cfg).execute({ subscriptionId: 'sub_1' }, ctx())).success).toBe(true);
        (stripeClient.subscriptions.cancel as any).mockRejectedValueOnce(new Error('gone'));
        expect((await new StripeCancelSubscriptionTool(cfg).execute({ subscriptionId: 'sub_1' }, ctx())).success).toBe(false);

        (stripeClient.refunds.create as any).mockResolvedValueOnce({ id: 're_1' });
        expect((await new StripeRefundTool(cfg).execute({ paymentIntentId: 'pi_1', amount: 50 }, ctx())).success).toBe(true);
        (stripeClient.refunds.create as any).mockRejectedValueOnce(new Error('x'));
        expect((await new StripeRefundTool(cfg).execute({ paymentIntentId: 'pi_1' }, ctx())).success).toBe(false);

        const envOk = await withEnv('STRIPE_SECRET_KEY', 'sk_env', async () => {
            (stripeClient.customers.create as any).mockResolvedValueOnce({ id: 'cus_env' });
            return new StripeCreateCustomerTool({}).execute({ email: 'a@b.com' }, ctx());
        });
        expect(envOk.success).toBe(true);

        const missing = await withEnv('STRIPE_SECRET_KEY', undefined, async () =>
            new StripeCreateCustomerTool({}).execute({ email: 'a@b.com' }, ctx()));
        expect(missing.success).toBe(false);
        expect(missing.error?.message).toMatch(/STRIPE_SECRET_KEY/);

        expect(new StripeToolkit(cfg).tools).toHaveLength(6);
        expect(StripeFactory).toHaveBeenCalledWith('sk_test_1', expect.anything());
    });
});

// ── Finance: YFinance ──────────────────────────────────────────────────────

describe('YFinance tool', () => {
    it('success + sdk throw', async () => {
        const ok = await new YFinanceTool().execute({ symbol: 'AAPL' }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.symbol).toBe('AAPL');

        const { default: yahoo } = await import('yahoo-finance2');
        (yahoo.quote as any).mockRejectedValueOnce(new Error('quote failed'));
        const bad = await new YFinanceTool().execute({ symbol: 'AAPL' }, ctx());
        expect(bad.success).toBe(false);
        expect(bad.error?.message).toMatch(/quote failed/);
        (yahoo.quote as any).mockResolvedValueOnce({ symbol: 'MSFT' });
        expect((await new YFinanceTool().execute({ symbol: 'MSFT' }, ctx())).success).toBe(true);
    });
});

// ── CRM: Salesforce ────────────────────────────────────────────────────────

describe('Salesforce tools', () => {
    const cfg = { instanceUrl: 'https://my.salesforce.com/', accessToken: 'tok', apiVersion: 'v60.0' };

    it('query/search/get/update: success, error, 204, fields present/absent, auth throws', async () => {
        globalThis.fetch = vi.fn(async () => json({ records: [{ Id: '1' }], totalSize: 1 })) as typeof fetch;
        expect((await new SalesforceQueryTool(cfg).execute({ query: 'SELECT Id FROM Contact' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async (url: string, init: any) => {
            if (init?.method === 'POST') return new Response(null, { status: 204 });
            return json({ Id: '1', Name: 'A' });
        }) as typeof fetch;
        expect((await new SalesforceCreateRecordTool(cfg).execute({ objectType: 'Contact', fields: { Name: 'A' } }, ctx())).data?.success).toBe(true);
        expect((await new SalesforceUpdateRecordTool(cfg).execute({ objectType: 'Contact', recordId: '1', fields: { Name: 'B' } }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({ Id: '1' })) as typeof fetch;
        expect((await new SalesforceGetRecordTool(cfg).execute({ objectType: 'Contact', recordId: '1', fields: ['Id', 'Name'] }, ctx())).success).toBe(true);
        expect((await new SalesforceGetRecordTool(cfg).execute({ objectType: 'Contact', recordId: '1' }, ctx())).success).toBe(true);
        expect((await new SalesforceGetRecordTool(cfg).execute({ objectType: 'Contact', recordId: '1', fields: [] }, ctx())).success).toBe(true);
        expect((await new SalesforceSearchTool(cfg).execute({ query: 'FIND {John}' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new SalesforceQueryTool(cfg).execute({ query: 'SELECT' }, ctx())).success).toBe(false);
        expect((await new SalesforceGetRecordTool(cfg).execute({ objectType: 'Contact', recordId: '1' }, ctx())).success).toBe(false);
        expect((await new SalesforceUpdateRecordTool(cfg).execute({ objectType: 'Contact', recordId: '1', fields: { Name: 'B' } }, ctx())).success).toBe(false);
        expect((await new SalesforceSearchTool(cfg).execute({ query: 'FIND' }, ctx())).success).toBe(false);
        expect((await new SalesforceCreateRecordTool(cfg).execute({ objectType: 'Contact', fields: { Name: 'A' } }, ctx())).success).toBe(false);

        const r1 = await withEnv('SALESFORCE_INSTANCE_URL', undefined, async () =>
            new SalesforceQueryTool({}).execute({ query: 'SELECT' }, ctx()));
        expect(r1.success).toBe(false);
        expect(r1.error?.message).toMatch(/SALESFORCE_INSTANCE_URL/);

        const r2 = await withEnv('SALESFORCE_ACCESS_TOKEN', undefined, async () =>
            new SalesforceQueryTool({ instanceUrl: 'https://x.salesforce.com' }).execute({ query: 'SELECT' }, ctx()));
        expect(r2.success).toBe(false);
        expect(r2.error?.message).toMatch(/SALESFORCE_ACCESS_TOKEN/);

        globalThis.fetch = vi.fn(async () => json({ records: [] })) as typeof fetch;
        expect((await new SalesforceQueryTool({ instanceUrl: 'https://x.salesforce.com', accessToken: 't' }).execute({ query: 'SELECT' }, ctx())).success).toBe(true);

        expect(new SalesforceToolkit(cfg).getTools()).toHaveLength(5);
    });
});

// ── CRM: Shopify ───────────────────────────────────────────────────────────

describe('Shopify tools', () => {
    const cfg = { storeUrl: 'https://shop.myshopify.com/', accessToken: 'tok', apiVersion: '2024-04' };

    it('all list/get tools: success, optional opts, error, callRaw, auth throws', async () => {
        globalThis.fetch = vi.fn(async () => json({ products: [{ id: 1 }] })) as typeof fetch;
        expect((await new ShopifyListProductsTool(cfg).execute({ limit: 20, status: 'active', title: 'T', collection: 'c' }, ctx())).success).toBe(true);
        const raw1 = await callRaw(new ShopifyListProductsTool(cfg), {});
        expect(raw1).toBeTruthy();
        expect((await new ShopifyGetProductTool(cfg).execute({ productId: 1 }, ctx())).success).toBe(true);
        expect((await new ShopifyGetProductTool(cfg).execute({ productId: '1' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({ orders: [{ id: 1 }] })) as typeof fetch;
        expect((await new ShopifyListOrdersTool(cfg).execute({ limit: 10, financialStatus: 'paid', fulfillmentStatus: 'shipped' }, ctx())).success).toBe(true);
        expect((await new ShopifyListOrdersTool(cfg).execute({}, ctx())).success).toBe(true);
        const rawOrder = await callRaw(new ShopifyListOrdersTool(cfg), {});
        expect(rawOrder).toBeTruthy();
        expect((await new ShopifyGetOrderTool(cfg).execute({ orderId: 1 }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({ customers: [{ id: 1 }] })) as typeof fetch;
        expect((await new ShopifyListCustomersTool(cfg).execute({ limit: 5, email: 'a@b.com', query: 'A' }, ctx())).success).toBe(true);
        expect((await new ShopifyListCustomersTool(cfg).execute({}, ctx())).success).toBe(true);
        const rawCust = await callRaw(new ShopifyListCustomersTool(cfg), {});
        expect(rawCust).toBeTruthy();
        expect((await new ShopifyGetCustomerTool(cfg).execute({ customerId: 1 }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new ShopifyListProductsTool(cfg).execute({}, ctx())).success).toBe(false);
        expect((await new ShopifyGetProductTool(cfg).execute({ productId: 1 }, ctx())).success).toBe(false);
        expect((await new ShopifyListOrdersTool(cfg).execute({}, ctx())).success).toBe(false);
        expect((await new ShopifyGetOrderTool(cfg).execute({ orderId: 1 }, ctx())).success).toBe(false);
        expect((await new ShopifyListCustomersTool(cfg).execute({}, ctx())).success).toBe(false);
        expect((await new ShopifyGetCustomerTool(cfg).execute({ customerId: 1 }, ctx())).success).toBe(false);

        const r1 = await withEnv('SHOPIFY_STORE_URL', undefined, async () =>
            new ShopifyListProductsTool({}).execute({}, ctx()));
        expect(r1.success).toBe(false);
        expect(r1.error?.message).toMatch(/SHOPIFY_STORE_URL/);

        const r2 = await withEnv('SHOPIFY_ACCESS_TOKEN', undefined, async () =>
            new ShopifyListProductsTool({ storeUrl: 'shop.myshopify.com' }).execute({}, ctx()));
        expect(r2.success).toBe(false);
        expect(r2.error?.message).toMatch(/SHOPIFY_ACCESS_TOKEN/);

        globalThis.fetch = vi.fn(async () => json({ products: [] })) as typeof fetch;
        expect((await new ShopifyListProductsTool({ storeUrl: 'shop.myshopify.com', accessToken: 't' }).execute({}, ctx())).success).toBe(true);

        expect(new ShopifyToolkit(cfg).getTools()).toHaveLength(6);
    });
});

// ── CRM: Zendesk ───────────────────────────────────────────────────────────

describe('Zendesk tools', () => {
    const cfg = { subdomain: 'co', email: 'agent@co.com', apiToken: 'tok' };

    it('list/search/update: success, opts present/absent, callRaw, error, 204, auth throws', async () => {
        globalThis.fetch = vi.fn(async () => json({ tickets: [{ id: 1 }] })) as typeof fetch;
        expect((await new ZendeskListTicketsTool(cfg).execute({ status: 'open', perPage: 10, page: 2 }, ctx())).success).toBe(true);
        expect((await new ZendeskListTicketsTool(cfg).execute({}, ctx())).success).toBe(true);
        const rawList = await callRaw(new ZendeskListTicketsTool(cfg), {});
        expect(rawList).toBeTruthy();
        expect((await new ZendeskGetTicketTool(cfg).execute({ ticketId: 1 }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({ ticket: { id: 1 } })) as typeof fetch;
        expect((await new ZendeskCreateTicketTool(cfg).execute({
            subject: 'S', body: 'B', requesterEmail: 'r@x.com', requesterName: 'R', priority: 'high', type: 'incident', tags: ['a'],
        }, ctx())).success).toBe(true);
        expect((await new ZendeskCreateTicketTool(cfg).execute({ subject: 'S', body: 'B' }, ctx())).success).toBe(true);
        const rawCreate = await callRaw(new ZendeskCreateTicketTool(cfg), { subject: 'S', body: 'B' });
        expect(rawCreate).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({ ticket: { id: 1 } })) as typeof fetch;
        expect((await new ZendeskUpdateTicketTool(cfg).execute({
            ticketId: 1, status: 'solved', priority: 'low', comment: 'done', tags: ['t'],
        }, ctx())).success).toBe(true);
        expect((await new ZendeskUpdateTicketTool(cfg).execute({ ticketId: 1, comment: 'note' }, ctx())).success).toBe(true);
        const rawUpdate = await callRaw(new ZendeskUpdateTicketTool(cfg), { ticketId: 1, comment: 'note' });
        expect(rawUpdate).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        expect((await new ZendeskSearchTicketsTool(cfg).execute({ query: 'status:open' }, ctx())).success).toBe(true);
        const rawSearch = await callRaw(new ZendeskSearchTicketsTool(cfg), { query: 'q' });
        expect(rawSearch).toBeTruthy();

        globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
        expect((await new ZendeskCreateTicketTool(cfg).execute({ subject: 'S', body: 'B' }, ctx())).data?.success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new ZendeskListTicketsTool(cfg).execute({}, ctx())).success).toBe(false);
        expect((await new ZendeskGetTicketTool(cfg).execute({ ticketId: 1 }, ctx())).success).toBe(false);
        expect((await new ZendeskCreateTicketTool(cfg).execute({ subject: 'S', body: 'B' }, ctx())).success).toBe(false);
        expect((await new ZendeskUpdateTicketTool(cfg).execute({ ticketId: 1 }, ctx())).success).toBe(false);
        expect((await new ZendeskSearchTicketsTool(cfg).execute({ query: 'q' }, ctx())).success).toBe(false);

        const r1 = await withEnv('ZENDESK_SUBDOMAIN', undefined, async () =>
            new ZendeskListTicketsTool({}).execute({}, ctx()));
        expect(r1.success).toBe(false);
        expect(r1.error?.message).toMatch(/ZENDESK_SUBDOMAIN/);

        const r2 = await withEnv('ZENDESK_EMAIL', undefined, async () =>
            new ZendeskListTicketsTool({ subdomain: 'co' }).execute({}, ctx()));
        expect(r2.success).toBe(false);
        expect(r2.error?.message).toMatch(/ZENDESK_EMAIL/);

        const r3 = await withEnv('ZENDESK_API_TOKEN', undefined, async () =>
            new ZendeskListTicketsTool({ subdomain: 'co', email: 'a@b.com' }).execute({}, ctx()));
        expect(r3.success).toBe(false);
        expect(r3.error?.message).toMatch(/ZENDESK_API_TOKEN/);

        expect(new ZendeskToolkit(cfg).getTools()).toHaveLength(5);
    });
});

// ── Data: BigQuery ─────────────────────────────────────────────────────────

describe('BigQuery tools', () => {
    const cfg = { accessToken: 'tok', projectId: 'proj', defaultDataset: 'ds' };

    it('query: full + minimal + callRaw + error + auth, list/get tools', async () => {
        globalThis.fetch = vi.fn(async () => json({
            jobReference: { jobId: 'job1' },
            totalRows: '2',
            schema: { fields: [{ name: 'a', type: 'STRING', mode: 'NULLABLE' }] },
            rows: [{ f: [{ v: 'x' }, { v: 'y' }] }, {}],
        })) as typeof fetch;
        const ok = await new BigQueryQueryTool(cfg).execute({
            query: 'SELECT 1',
            parameters: [{ name: 'p', parameterType: { type: 'STRING' }, parameterValue: { value: 'v' } }],
        }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.rows[0]?.a).toBe('x');
        expect(ok.data?.rows[0]?.field_1).toBe('y');

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const minimal = await new BigQueryQueryTool(cfg).execute({ query: 'SELECT 1' }, ctx());
        expect(minimal.success).toBe(true);
        expect(minimal.data?.jobId).toBe('');
        expect(minimal.data?.totalRows).toBe('0');
        expect(minimal.data?.rows).toEqual([]);
        expect(minimal.data?.schema).toBeUndefined();

        const raw = await callRaw(new BigQueryQueryTool(cfg), { query: 'SELECT 1' });
        expect(raw).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new BigQueryQueryTool(cfg).execute({ query: 'SELECT 1' }, ctx())).success).toBe(false);

        globalThis.fetch = vi.fn(async () => json({ datasets: [] })) as typeof fetch;
        expect((await new BigQueryListDatasetsTool(cfg).execute({ filter: 'x' }, ctx())).success).toBe(true);
        expect((await new BigQueryListDatasetsTool(cfg).execute({}, ctx())).success).toBe(true);
        const rawDs = await callRaw(new BigQueryListDatasetsTool(cfg), {});
        expect(rawDs).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({ tables: [] })) as typeof fetch;
        expect((await new BigQueryListTablesTool(cfg).execute({ datasetId: 'ds' }, ctx())).success).toBe(true);
        const rawTables = await callRaw(new BigQueryListTablesTool(cfg), { datasetId: 'ds' });
        expect(rawTables).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({ schema: { fields: [] } })) as typeof fetch;
        expect((await new BigQueryGetTableTool(cfg).execute({ datasetId: 'ds', tableId: 't' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new BigQueryListDatasetsTool(cfg).execute({}, ctx())).success).toBe(false);
        expect((await new BigQueryListTablesTool(cfg).execute({ datasetId: 'ds' }, ctx())).success).toBe(false);
        expect((await new BigQueryGetTableTool(cfg).execute({ datasetId: 'ds', tableId: 't' }, ctx())).success).toBe(false);

        const r1 = await withEnv('GOOGLE_ACCESS_TOKEN', undefined, async () =>
            new BigQueryQueryTool({}).execute({ query: 'SELECT 1' }, ctx()));
        expect(r1.success).toBe(false);
        expect(r1.error?.message).toMatch(/GOOGLE_ACCESS_TOKEN/);

        const r2 = await withEnv('GOOGLE_CLOUD_PROJECT', undefined, async () =>
            new BigQueryQueryTool({ accessToken: 'tok' }).execute({ query: 'SELECT 1' }, ctx()));
        expect(r2.success).toBe(false);
        expect(r2.error?.message).toMatch(/GOOGLE_CLOUD_PROJECT/);

        const gcloud = await withEnv('GCLOUD_PROJECT', 'gproj', async () => {
            globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
            return new BigQueryQueryTool({ accessToken: 'tok' }).execute({ query: 'SELECT 1' }, ctx());
        });
        expect(gcloud.success).toBe(true);

        expect(new BigQueryToolkit(cfg).getTools()).toHaveLength(4);
    });
});

// ── Data: CSV ──────────────────────────────────────────────────────────────

describe('CSV tools', () => {
    const SAMPLE = 'name,age,city\nAlice,30,NYC\nBob,25,LA\nCarol,30,"San, Francisco"\n';

    it('parse', async () => {
        const ok = await new CsvParseTool().execute({ csv: SAMPLE }, ctx());
        expect(ok.data?.rowCount).toBe(3);
        expect(ok.data?.columns).toEqual(['name', 'age', 'city']);
        expect(ok.data?.rows[2]?.city).toBe('San, Francisco');

        const empty = await new CsvParseTool().execute({ csv: '   ' }, ctx());
        expect(empty.data?.rowCount).toBe(0);
        expect(empty.data?.columns).toEqual([]);

        const quoted = await new CsvParseTool().execute({ csv: 'a,b\n"he""llo",x\n' }, ctx());
        expect(quoted.data?.rows[0]?.a).toBe('he"llo');

        expect((await new CsvParseTool().execute({ csv: 'a\r\nb\r\n', delimiter: ',' }, ctx())).data?.rowCount).toBe(1);
        const raw = await callRaw(new CsvParseTool(), { csv: 'a,b\n1,2\n' });
        expect(raw.rowCount).toBe(1);

        const blank = await new CsvParseTool().execute({ csv: 'a,b\n1,2\n\n3,4\n' }, ctx());
        expect(blank.data?.rowCount).toBe(2);

        const short = await new CsvParseTool().execute({ csv: 'a,b,c\n1,2\n' }, ctx());
        expect(short.data?.rows[0]).toEqual({ a: '1', b: '2', c: '' });
    });

    it('filter: every operator + default + numeric/lexical', async () => {
        const t = new CsvFilterTool();
        const base = { csv: SAMPLE };
        expect((await t.execute({ ...base, column: 'name', operator: 'eq', value: 'Alice' }, ctx())).data?.rowCount).toBe(1);
        expect((await t.execute({ ...base, column: 'name', operator: 'ne', value: 'Alice' }, ctx())).data?.rowCount).toBe(2);
        expect((await t.execute({ ...base, column: 'age', operator: 'gt', value: '25' }, ctx())).data?.rowCount).toBe(2);
        expect((await t.execute({ ...base, column: 'age', operator: 'lt', value: '30' }, ctx())).data?.rowCount).toBe(1);
        expect((await t.execute({ ...base, column: 'age', operator: 'gte', value: '30' }, ctx())).data?.rowCount).toBe(2);
        expect((await t.execute({ ...base, column: 'age', operator: 'lte', value: '25' }, ctx())).data?.rowCount).toBe(1);
        expect((await t.execute({ ...base, column: 'city', operator: 'contains', value: 'San' }, ctx())).data?.rowCount).toBe(1);
        expect((await t.execute({ ...base, column: 'name', operator: 'startsWith', value: 'A' }, ctx())).data?.rowCount).toBe(1);
        expect((await t.execute({ ...base, column: 'name', operator: 'endsWith', value: 'e' }, ctx())).data?.rowCount).toBe(1);
        expect((await t.execute({ ...base, column: 'name', operator: 'gt', value: 'A' }, ctx())).data?.rowCount).toBe(3);
        expect((await t.execute({ ...base, column: 'name', operator: 'lt', value: 'M' }, ctx())).data?.rowCount).toBe(3);
        expect((await t.execute({ ...base, column: 'name', operator: 'gte', value: 'A' }, ctx())).data?.rowCount).toBe(3);
        expect((await t.execute({ ...base, column: 'name', operator: 'lte', value: 'M' }, ctx())).data?.rowCount).toBe(3);
        expect((await t.execute({ ...base, column: 'missing', operator: 'eq', value: 'x' }, ctx())).data?.rowCount).toBe(0);
        const raw = await callRaw(t, { csv: 'a,b\n1,2\n', column: 'a', operator: 'bogus', value: 'x' });
        expect(raw.rowCount).toBe(1);
    });

    it('select/sort/aggregate/toJson incl. escaping and defaults', async () => {
        const sel = await new CsvSelectColumnsTool().execute({ csv: SAMPLE, columns: ['name', 'age'] }, ctx());
        expect(sel.data?.rowCount).toBe(3);
        const selEmpty = await new CsvSelectColumnsTool().execute({ csv: 'a\n', columns: ['a'] }, ctx());
        expect(selEmpty.data?.rowCount).toBe(0);
        expect(selEmpty.data?.csv).toBe('');
        const escaped = await new CsvSelectColumnsTool().execute({ csv: 'a\n"x""y",z\n', columns: ['a'] }, ctx());
        expect(escaped.data?.csv).toContain('"');
        const missingCol = await new CsvSelectColumnsTool().execute({ csv: SAMPLE, columns: ['nope'] }, ctx());
        expect(missingCol.data?.csv).toContain('nope');
        const rawSel = await callRaw(new CsvSelectColumnsTool(), { csv: SAMPLE, columns: ['name'] });
        expect(rawSel.csv).toBeTruthy();

        expect((await new CsvSortTool().execute({ csv: SAMPLE, column: 'age', order: 'asc' }, ctx())).data?.csv.split('\n')[1]).toMatch(/^Bob/);
        expect((await new CsvSortTool().execute({ csv: SAMPLE, column: 'name', order: 'desc' }, ctx())).data?.csv).toBeTruthy();
        const wild = await new CsvSortTool().execute({ csv: SAMPLE, column: 'city', order: 'asc' }, ctx());
        expect(wild.success).toBe(true);
        const rawSort = await callRaw(new CsvSortTool(), { csv: SAMPLE, column: 'age' });
        expect(rawSort.csv).toBeTruthy();
        const missingSort = await new CsvSortTool().execute({ csv: SAMPLE, column: 'nope' }, ctx());
        expect(missingSort.success).toBe(true);

        const agg = new CsvAggregateTool();
        expect((await agg.execute({ csv: SAMPLE, column: 'age', operation: 'sum' }, ctx())).data?.result).toBe(85);
        expect((await agg.execute({ csv: SAMPLE, column: 'age', operation: 'avg' }, ctx())).data?.result).toBeCloseTo(85 / 3);
        expect((await agg.execute({ csv: SAMPLE, column: 'age', operation: 'min' }, ctx())).data?.result).toBe(25);
        expect((await agg.execute({ csv: SAMPLE, column: 'age', operation: 'max' }, ctx())).data?.result).toBe(30);
        expect((await agg.execute({ csv: SAMPLE, column: 'age', operation: 'count' }, ctx())).data?.result).toBe(3);
        expect((await agg.execute({ csv: 'x\n', column: 'x', operation: 'avg' }, ctx())).data?.result).toBe(0);
        const rawAgg = await callRaw(agg, { csv: SAMPLE, column: 'age', operation: 'bogus' });
        expect(rawAgg.result).toBe(0);
        const missingAgg = await new CsvAggregateTool().execute({ csv: SAMPLE, column: 'nope', operation: 'count' }, ctx());
        expect(missingAgg.data?.result).toBe(0);

        const json = await new CsvToJsonTool().execute({ csv: SAMPLE }, ctx());
        expect(JSON.parse(json.data!.json)).toHaveLength(3);
        const rawJson = await callRaw(new CsvToJsonTool(), { csv: 'a\n1\n' });
        expect(JSON.parse(rawJson.json)).toHaveLength(1);

        expect(new CsvToolkit().tools).toHaveLength(6);
    });
});

// ── Data: database (pg / mysql / sqlite) ───────────────────────────────────

describe('Database tools', () => {
    it('postgres query + insert: both branches of maxRows, checkTable, rows[0]', async () => {
        const cfg = { connectionString: 'postgres://u:p@h/db' };

        (pgPool.query as any).mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2, fields: [{ name: 'a' }, { name: 'b' }] });
        const q = await new PostgreSQLQueryTool({ ...cfg, maxRows: 1 }).execute({ query: 'SELECT *', params: [] }, ctx());
        expect(q.data?.rows).toHaveLength(1);
        expect(q.data?.fields).toEqual(['a', 'b']);

        (pgPool.query as any).mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, fields: [{ name: 'a' }] });
        const q2 = await new PostgreSQLQueryTool(cfg).execute({ query: 'SELECT *' }, ctx());
        expect(q2.data?.rows).toHaveLength(1);

        (pgPool.query as any).mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1, fields: [] });
        const ins = await new PostgreSQLInsertTool({ ...cfg, allowedTables: ['users'] }).execute({ table: 'users', record: { name: 'A' } }, ctx());
        expect(ins.data?.id).toBe(42);
        expect(ins.data?.success).toBe(true);

        (pgPool.query as any).mockResolvedValueOnce({ rows: [], rowCount: 0, fields: [] });
        const ins2 = await new PostgreSQLInsertTool(cfg).execute({ table: 'users', record: { name: 'A' } }, ctx());
        expect(ins2.data?.id).toBeUndefined();

        const denied = await new PostgreSQLInsertTool({ ...cfg, allowedTables: ['users'] }).execute({ table: 'orders', record: { name: 'A' } }, ctx());
        expect(denied.success).toBe(false);
        expect(denied.error?.message).toMatch(/allowed list/);

        const rawQ = await callRaw(new PostgreSQLQueryTool(cfg), { query: 'SELECT 1' });
        expect(rawQ.rows).toBeDefined();
    });

    it('mysql query: params present/absent, non-array rows, maxRows', async () => {
        const cfg = { connectionString: 'mysql://u:p@h/db' };

        (mysqlConn.execute as any).mockResolvedValueOnce([[{ id: 1 }, { id: 2 }, { id: 3 }], []]);
        const q = await new MySQLQueryTool({ ...cfg, maxRows: 2 }).execute({ query: 'SELECT *', params: [1] }, ctx());
        expect(q.data?.rows).toHaveLength(2);

        (mysqlConn.execute as any).mockResolvedValueOnce([42, []]);
        const q2 = await new MySQLQueryTool(cfg).execute({ query: 'SELECT *' }, ctx());
        expect(q2.data?.rows).toEqual([]);
        expect(q2.data?.rowCount).toBe(0);

        const raw = await callRaw(new MySQLQueryTool(cfg), { query: 'SELECT *' });
        expect(raw).toBeTruthy();
        expect(mysqlConn.end).toHaveBeenCalled();
    });

    it('sqlite query: params present/absent, maxRows', async () => {
        const cfg = { connectionString: 'file.db' };
        const q = await new SQLiteQueryTool({ ...cfg, maxRows: 1 }).execute({ query: 'SELECT *', params: [1] }, ctx());
        expect(q.data?.rows).toHaveLength(1);
        const q2 = await new SQLiteQueryTool(cfg).execute({ query: 'SELECT *' }, ctx());
        expect(q2.data?.rowCount).toBe(2);
        const raw = await callRaw(new SQLiteQueryTool(cfg), { query: 'SELECT *' });
        expect(raw.rows).toHaveLength(2);
    });

    it('toolkit type routing', () => {
        expect(new DatabaseToolkit({ connectionString: 'p', type: 'postgres' }).tools).toHaveLength(2);
        expect(new DatabaseToolkit({ connectionString: 'm', type: 'mysql' }).tools).toHaveLength(1);
        expect(new DatabaseToolkit({ connectionString: 's', type: 'sqlite' as any }).tools).toHaveLength(1);
    });
});

// ── Data: Neo4j ────────────────────────────────────────────────────────────

describe('Neo4j tools', () => {
    const cfg = { url: 'http://neo4j.test/', username: 'neo4j', password: 'secret', database: 'neo4j' };

    function okResults(columns: string[], rows: unknown[][]) {
        return { results: [{ columns, data: rows.map((row) => ({ row })) }], errors: [] };
    }

    it('run cypher: success/data errors/http errors/missing password/empty results', async () => {
        globalThis.fetch = vi.fn(async () => json(okResults(['n'], [[1]]))) as typeof fetch;
        const ok = await new Neo4jRunCypherTool(cfg).execute({ cypher: 'RETURN 1', parameters: {} }, ctx());
        expect(ok.data?.rows).toEqual([{ n: 1 }]);

        const raw = await callRaw(new Neo4jRunCypherTool(cfg), { cypher: 'RETURN 1' });
        expect(raw.rows).toEqual([{ n: 1 }]);

        globalThis.fetch = vi.fn(async () => json({ results: [], errors: [{ code: 'E', message: 'bad cypher' }] })) as typeof fetch;
        const err = await new Neo4jRunCypherTool(cfg).execute({ cypher: 'X' }, ctx());
        expect(err.success).toBe(false);
        expect(err.error?.message).toMatch(/bad cypher/);

        globalThis.fetch = vi.fn(async () => json({ results: [], errors: [{ code: 'E' }] })) as typeof fetch;
        const errNoMsg = await new Neo4jRunCypherTool(cfg).execute({ cypher: 'X' }, ctx());
        expect(errNoMsg.success).toBe(false);
        expect(errNoMsg.error?.message).toMatch(/Unknown error/);

        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await new Neo4jRunCypherTool(cfg).execute({ cypher: 'X' }, ctx())).success).toBe(false);

        globalThis.fetch = vi.fn(async () => json({ results: [], errors: [] })) as typeof fetch;
        const empty = await new Neo4jRunCypherTool(cfg).execute({ cypher: 'RETURN 1' }, ctx());
        expect(empty.data?.rows).toEqual([]);

        const r = await withEnv('NEO4J_PASSWORD', undefined, async () =>
            new Neo4jRunCypherTool({}).execute({ cypher: 'X' }, ctx()));
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/NEO4J_PASSWORD/);
    });

    it('create node: full + empty results', async () => {
        globalThis.fetch = vi.fn(async () => json(okResults(['id', 'labels', 'props'], [[42, ['Person'], { name: 'Ada' }]]))) as typeof fetch;
        const n = await new Neo4jCreateNodeTool(cfg).execute({ labels: ['Person'], properties: { name: 'Ada' } }, ctx());
        expect(n.data?.id).toBe(42);

        globalThis.fetch = vi.fn(async () => json({ results: [], errors: [] })) as typeof fetch;
        const n2 = await new Neo4jCreateNodeTool(cfg).execute({ labels: ['Person'], properties: {} }, ctx());
        expect(n2.data?.id).toBeUndefined();
    });

    it('create relationship: id match + property match + empty results', async () => {
        globalThis.fetch = vi.fn(async () => json(okResults(['type', 'props'], [['KNOWS', { since: 1 }]]))) as typeof fetch;
        const r1 = await new Neo4jCreateRelationshipTool(cfg).execute({ fromNodeId: '1', toNodeId: '2', type: 'KNOWS', properties: { since: 1 } }, ctx());
        expect(r1.data?.type).toBe('KNOWS');

        const r2 = await new Neo4jCreateRelationshipTool(cfg).execute({
            fromNodeId: 'a', toNodeId: 'b', type: 'KNOWS', matchByProperty: { label: 'Person', property: 'name' },
        }, ctx());
        expect(r2.data?.type).toBe('KNOWS');

        globalThis.fetch = vi.fn(async () => json({ results: [], errors: [] })) as typeof fetch;
        const r3 = await new Neo4jCreateRelationshipTool(cfg).execute({ fromNodeId: '1', toNodeId: '2', type: 'KNOWS' }, ctx());
        expect(r3.data?.type).toBe('KNOWS');
        expect(r3.data?.properties).toEqual({});

        globalThis.fetch = vi.fn(async () => json(okResults(['type', 'props'], [['KNOWS', { x: 1 }]]))) as typeof fetch;
        const rawProp = await callRaw(new Neo4jCreateRelationshipTool(cfg), {
            fromNodeId: 'a', toNodeId: 'b', type: 'KNOWS', matchByProperty: { label: 'Person', property: 'name' },
        });
        expect(rawProp.type).toBe('KNOWS');
        const rawId = await callRaw(new Neo4jCreateRelationshipTool(cfg), { fromNodeId: '1', toNodeId: '2', type: 'KNOWS' });
        expect(rawId.type).toBe('KNOWS');
    });

    it('find nodes: with/without props, callRaw', async () => {
        globalThis.fetch = vi.fn(async () => json(okResults(['id', 'labels', 'props'], [[1, ['Person'], { name: 'Ada' }]]))) as typeof fetch;
        const f1 = await new Neo4jFindNodesTool(cfg).execute({ label: 'Person', properties: { name: 'Ada' }, limit: 10, skip: 2 }, ctx());
        expect(f1.data?.count).toBe(1);
        const f2 = await new Neo4jFindNodesTool(cfg).execute({ label: 'Person' }, ctx());
        expect(f2.data?.count).toBe(1);
        const raw = await callRaw(new Neo4jFindNodesTool(cfg), { label: 'Person' });
        expect(raw.count).toBe(1);
        const rawProps = await callRaw(new Neo4jFindNodesTool(cfg), { label: 'Person', properties: { a: 1 } });
        expect(rawProps.count).toBe(1);
    });

    it('delete node: detach true/false, empty results', async () => {
        globalThis.fetch = vi.fn(async () => json(okResults(['deleted'], [[1]]))) as typeof fetch;
        expect((await new Neo4jDeleteNodeTool(cfg).execute({ label: 'Person', property: 'name', value: 'Ada', detach: true }, ctx())).data?.deleted).toBe(1);
        globalThis.fetch = vi.fn(async () => json(okResults(['deleted'], [[2]]))) as typeof fetch;
        expect((await new Neo4jDeleteNodeTool(cfg).execute({ label: 'Person', property: 'name', value: 'Ada', detach: false }, ctx())).data?.deleted).toBe(2);
        globalThis.fetch = vi.fn(async () => json({ results: [], errors: [] })) as typeof fetch;
        expect((await new Neo4jDeleteNodeTool(cfg).execute({ label: 'Person', property: 'name', value: 'Ada' }, ctx())).data?.deleted).toBe(0);
    });

    it('get schema: full + empty results', async () => {
        globalThis.fetch = vi.fn(async () => json(okResults(['labels'], [[['Person']]]))) as typeof fetch;
        const s = await new Neo4jGetSchemaTool(cfg).execute({}, ctx());
        expect(s.data?.labels).toEqual(['Person']);

        globalThis.fetch = vi.fn(async () => json({ results: [], errors: [] })) as typeof fetch;
        const s2 = await new Neo4jGetSchemaTool(cfg).execute({}, ctx());
        expect(s2.data?.labels).toEqual([]);
        expect(s2.data?.relationshipTypes).toEqual([]);
        expect(s2.data?.propertyKeys).toEqual([]);

        expect(new Neo4jToolkit(cfg).tools).toHaveLength(6);
    });

    it('neo4j creds: database env fallback and default', async () => {
        const envDb = await withEnv('NEO4J_DATABASE', 'envdb', async () => {
            globalThis.fetch = vi.fn(async () => json(okResults(['n'], [[1]]))) as typeof fetch;
            return new Neo4jRunCypherTool({ url: 'http://n', username: 'u', password: 'p' }).execute({ cypher: 'RETURN 1' }, ctx());
        });
        expect(envDb.success).toBe(true);

        const defDb = await withEnv('NEO4J_DATABASE', undefined, async () => {
            globalThis.fetch = vi.fn(async () => json(okResults(['n'], [[1]]))) as typeof fetch;
            return new Neo4jRunCypherTool({ url: 'http://n', username: 'u', password: 'p' }).execute({ cypher: 'RETURN 1' }, ctx());
        });
        expect(defDb.success).toBe(true);
    });
});

// ── Data: Redis ────────────────────────────────────────────────────────────

describe('Redis tools', () => {
    const cfg = { url: 'redis://fake:1', keyPrefix: 'pfx:', defaultTtl: 60 };

    it('get: value/null, prefix present/absent, url default via config', async () => {
        (redisClient.get as any).mockResolvedValueOnce('hello');
        const g = await new RedisGetTool(cfg).execute({ key: 'k' }, ctx());
        expect(g.data?.value).toBe('hello');
        expect(g.data?.exists).toBe(true);
        expect(g.data).toBeTruthy();

        (redisClient.get as any).mockResolvedValueOnce(null);
        const g2 = await new RedisGetTool({ keyPrefix: 'p:' }).execute({ key: 'k' }, ctx());
        expect(g2.data?.exists).toBe(false);

        (redisClient.get as any).mockResolvedValueOnce('v');
        const g3 = await new RedisGetTool({}).execute({ key: 'k' }, ctx());
        expect(g3.data?.value).toBe('v');
    });

    it('set: ttl from input / config default / none; callRaw', async () => {
        (redisClient.set as any).mockResolvedValueOnce('OK');
        expect((await new RedisSetTool(cfg).execute({ key: 'k', value: 'v', ttl: 10 }, ctx())).data?.success).toBe(true);

        (redisClient.set as any).mockResolvedValueOnce('OK');
        expect((await new RedisSetTool(cfg).execute({ key: 'k', value: 'v' }, ctx())).data?.success).toBe(true);

        (redisClient.set as any).mockResolvedValueOnce('OK');
        const raw = await callRaw(new RedisSetTool({}), { key: 'k', value: 'v' });
        expect(raw.success).toBe(true);
        expect(redisClient.set).toHaveBeenCalledWith('k', 'v');
    });

    it('delete/keys/hashget', async () => {
        (redisClient.del as any).mockResolvedValueOnce(2);
        expect((await new RedisDeleteTool(cfg).execute({ keys: ['a', 'b'] }, ctx())).data?.deleted).toBe(2);

        (redisClient.keys as any).mockResolvedValueOnce(['pfx:s1']);
        const k = await new RedisKeysTool(cfg).execute({ pattern: '*' }, ctx());
        expect(k.data?.count).toBe(1);

        (redisClient.keys as any).mockResolvedValueOnce(['s1']);
        expect((await new RedisKeysTool({}).execute({ pattern: '*' }, ctx())).data?.keys).toEqual(['s1']);

        (redisClient.hgetall as any).mockResolvedValueOnce({ f: 'x' });
        expect((await new RedisHashGetTool(cfg).execute({ key: 'h' }, ctx())).data?.fields).toEqual({ f: 'x' });

        (redisClient.hgetall as any).mockResolvedValueOnce(null);
        expect((await new RedisHashGetTool({}).execute({ key: 'h' }, ctx())).data?.fields).toBeNull();

        expect(new RedisToolkit(cfg).tools).toHaveLength(6);
    });

    it('incr: by 1 -> incr, by other -> incrby, undefined -> incr', async () => {
        (redisClient.incr as any).mockResolvedValueOnce(7);
        expect((await new RedisIncrTool(cfg).execute({ key: 'c', by: 1 }, ctx())).data?.value).toBe(7);

        (redisClient.incrby as any).mockResolvedValueOnce(5);
        expect((await new RedisIncrTool(cfg).execute({ key: 'c', by: 5 }, ctx())).data?.value).toBe(5);

        (redisClient.incr as any).mockResolvedValueOnce(7);
        const raw = await callRaw(new RedisIncrTool(cfg), { key: 'c' });
        expect(raw.value).toBe(7);
    });
});
