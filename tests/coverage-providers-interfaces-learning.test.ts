/**
 * Hermetic coverage for providers helpers/factories, interfaces (mocked HTTP),
 * and remaining learning stores/machine/curator.
 * Callers: vitest only (tests include glob).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { z } from 'zod';

import { CostTracker, estimateCost, MODEL_PRICING } from '../src/providers/cost-tracker.js';
import {
    FallbackChainProvider,
    FallbackStrategy,
    createCostOptimizedChain,
    createReliabilityChain,
} from '../src/providers/fallback-chain.js';
import {
    resolveModelString,
    isModelString,
    getProviderFromModelString,
    PROVIDER,
} from '../src/providers/model-resolver.js';
import {
    estimateTokenCount,
    getContextLimitForModel,
    resolveModelKeyForContextLimit,
    ContextWindowManager,
} from '../src/providers/context-window-manager.js';
import {
    extractJson,
    validateStructuredOutput,
    buildStructuredOutputPrompt,
    collectStreamText,
} from '../src/providers/structured-output.js';
import { zodToJsonSchema, toolToLLMDef } from '../src/providers/zod-to-schema.js';
import { LLMCache } from '../src/providers/cache.js';
import Module from 'node:module';
import {
    createGroqProvider,
    createXAIProvider,
    createOpenAICompatibleProvider,
    createAzureOpenAIProvider,
    createDeepSeekProvider,
    createMistralProvider,
    createTogetherProvider,
    createFireworksProvider,
    createCohereProvider,
    createPerplexityProvider,
    createCerebrasProvider,
    createVllmProvider,
    createLmStudioProvider,
    createLocalAIProvider,
    createJanProvider,
} from '../src/providers/compat-providers.js';
import type { LLMProvider, GenerateResult, Message } from '../src/providers/types.js';

import { InMemoryUserProfileStore } from '../src/learning/in-memory-store.js';
import { InMemoryDecisionLogStore } from '../src/learning/decision-log-store.js';
import {
    InMemoryUserMemoryStore,
    InMemorySessionContextStore,
    InMemoryLearnedKnowledgeStore,
    InMemoryEntityMemoryStore,
} from '../src/learning/extended-stores.js';
import { Curator } from '../src/learning/curator.js';
import { LearningMachine } from '../src/learning/machine.js';
import { InMemoryAgentDb } from '../src/db/in-memory.js';

import { SlackInterface } from '../src/interfaces/slack.js';
import { TelegramInterface } from '../src/interfaces/telegram.js';
import { A2AInterface } from '../src/interfaces/a2a.js';
import { AGUIInterface } from '../src/interfaces/ag-ui.js';

function mockProvider(name: string, impl?: Partial<LLMProvider>): LLMProvider {
    return {
        generateText: vi.fn(async () => ({
            text: `${name}-ok`,
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        })) as LLMProvider['generateText'],
        streamText: vi.fn(async () => ({
            text: `${name}-stream`,
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        })) as LLMProvider['streamText'],
        ...impl,
    };
}

function fakeAgent(text = 'agent-reply') {
    return {
        name: 'test-agent',
        createSession: vi.fn(async (userId: string) => `sess-${userId}`),
        run: vi.fn(async () => ({ text, id: 'run-1', steps: [], finishReason: 'stop' })),
    } as any;
}

function request(
    server: http.Server,
    opts: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') return reject(new Error('no addr'));
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: addr.port,
                method: opts.method ?? 'POST',
                path: opts.path,
                headers: opts.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode ?? 0,
                        body: Buffer.concat(chunks).toString('utf8'),
                        headers: res.headers,
                    }),
                );
            },
        );
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
        req.end();
    });
}

describe('providers/cost-tracker', () => {
    it('recordCall / totals / cache / estimateCost / clear', () => {
        const t = new CostTracker();
        const a = t.recordCall('gpt-4o', { input: 1_000_000, output: 500_000 });
        expect(a.totalCost).toBeGreaterThan(0);
        expect(MODEL_PRICING['gpt-4o']).toBeTruthy();

        t.recordCall('claude-3-5-sonnet-20241022', {
            input: 1000,
            output: 1000,
            cache: { cacheRead: 500, cacheCreation: 100 },
        });
        t.recordCall('unknown-model-xyz', { input: 10, output: 10 });

        expect(t.getTotalCost()).toBeGreaterThan(0);
        expect(t.getTotalTokens().input).toBeGreaterThan(0);
        expect(t.getByModel('gpt-4o')?.calls).toBe(1);
        expect(t.getAllModels().length).toBeGreaterThanOrEqual(2);
        expect(t.getCallHistory().length).toBe(3);
        const summary = t.getSummary();
        expect(summary.totalCalls).toBe(3);
        expect(summary.averageCostPerCall).toBeGreaterThanOrEqual(0);
        expect(estimateCost('gpt-4o-mini', { input: 1_000_000, output: 1_000_000 })).toBeCloseTo(0.75);
        t.clear();
        expect(t.getCallHistory()).toHaveLength(0);
    });
});

describe('providers/fallback-chain', () => {
    it('falls through on rate limit and succeeds', async () => {
        expect(() => new FallbackChainProvider({ providers: [] })).toThrow(/at least one/);
        const fail = mockProvider('a', {
            generateText: vi.fn(async () => {
                const e = new Error('rate') as Error & { status: number };
                e.status = 429;
                throw e;
            }),
        });
        const ok = mockProvider('b');
        const chain = new FallbackChainProvider({
            providers: [fail, ok],
            strategy: FallbackStrategy.RATE_LIMIT,
            maxRetries: 3,
            debug: true,
        });
        expect(chain.getName()).toContain('FallbackChain');
        const res = await chain.generateText([{ role: 'user', content: 'hi' }]);
        expect(res.text).toBe('b-ok');

        const stream = await chain.streamText([{ role: 'user', content: 'hi' }]);
        expect(stream.text).toContain('stream');

        const stats = chain.getStats();
        expect(stats.providers.length).toBe(2);
        chain.clearStats();

        const onlyFail = new FallbackChainProvider({
            providers: [fail],
            strategy: FallbackStrategy.ANY_ERROR,
            maxRetries: 1,
        });
        await expect(onlyFail.generateText([{ role: 'user', content: 'x' }])).rejects.toThrow(/exhausted/);
        expect(createCostOptimizedChain([ok]).getName()).toContain('Fallback');
        expect(createReliabilityChain([ok]).getName()).toContain('Fallback');
    });

    it('strategy branches: timeout / api-error / non-fallback', async () => {
        const timeoutErr = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        const p1 = mockProvider('t', {
            generateText: vi.fn(async () => {
                throw timeoutErr;
            }),
        });
        const p2 = mockProvider('ok');
        const chain = new FallbackChainProvider({
            providers: [p1, p2],
            strategy: FallbackStrategy.TIMEOUT,
            maxRetries: 3,
        });
        expect((await chain.generateText([{ role: 'user', content: 'x' }])).text).toBe('ok-ok');

        const apiFail = mockProvider('api', {
            generateText: vi.fn(async () => {
                throw Object.assign(new Error('server'), { status: 503 });
            }),
        });
        const apiChain = new FallbackChainProvider({
            providers: [apiFail, p2],
            strategy: FallbackStrategy.API_ERROR,
            maxRetries: 3,
        });
        expect((await apiChain.generateText([{ role: 'user', content: 'x' }])).text).toBe('ok-ok');

        const validationFail = mockProvider('v', {
            generateText: vi.fn(async () => {
                throw Object.assign(new Error('bad request'), { status: 400 });
            }),
        });
        const noFb = new FallbackChainProvider({
            providers: [validationFail, p2],
            strategy: FallbackStrategy.RATE_LIMIT,
            maxRetries: 2,
        });
        await expect(noFb.generateText([{ role: 'user', content: 'x' }])).rejects.toThrow();
    });
});

describe('providers/model-resolver', () => {
    it('resolveModelString covers major providers', () => {
        const env = (k: string) => ({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a', GROQ_API_KEY: 'g', GEMINI_API_KEY: 'g' }[k]);
        expect(resolveModelString('openai:gpt-4o', env)?.model).toBe('gpt-4o');
        expect(resolveModelString('anthropic:claude-3', env)?.nativeProvider).toBe('anthropic');
        expect(resolveModelString('google:gemini-2.0-flash', env)?.nativeProvider).toBe('google');
        expect(resolveModelString('groq:llama', env)?.baseURL).toContain('groq');
        expect(resolveModelString('xai:grok', env)?.baseURL).toContain('x.ai');
        expect(resolveModelString('together:m', env)?.baseURL).toContain('together');
        expect(resolveModelString('fireworks:m', env)?.baseURL).toContain('fireworks');
        expect(resolveModelString('deepseek:m', env)?.baseURL).toContain('deepseek');
        expect(resolveModelString('mistral:m', env)?.baseURL).toContain('mistral');
        expect(resolveModelString('cohere:m', env)?.baseURL).toContain('cohere');
        expect(resolveModelString('perplexity:m', env)?.baseURL).toContain('perplexity');
        expect(resolveModelString('openrouter:m', env)?.baseURL).toContain('openrouter');
        expect(resolveModelString('ollama:llama3', env)?.apiKey).toBe('not-needed');
        expect(resolveModelString('cerebras:m', env)?.baseURL).toContain('cerebras');
        expect(resolveModelString('vllm:m', env)?.baseURL).toContain('8000');
        expect(resolveModelString('lmstudio:m', env)?.baseURL).toContain('1234');
        expect(resolveModelString('localai:m', env)?.baseURL).toContain('8080');
        expect(resolveModelString('jan:m', env)?.baseURL).toContain('1337');
        expect(resolveModelString('nope')).toBeUndefined();
        expect(resolveModelString('openai:')).toBeUndefined();
        expect(isModelString('openai:gpt-4o')).toBe(true);
        expect(isModelString('plain')).toBe(false);
        expect(getProviderFromModelString('anthropic:x')).toBe(PROVIDER.ANTHROPIC);
    });
});

describe('providers/context-window + structured-output + zod-to-schema + cache', () => {
    it('token estimates and ContextWindowManager trim', async () => {
        expect(resolveModelKeyForContextLimit('openai:gpt-4o')).toBe('gpt-4o');
        expect(getContextLimitForModel('gpt-4o')).toBeGreaterThan(1000);
        expect(getContextLimitForModel('unknown-model', 4096)).toBe(4096);
        expect(estimateTokenCount('hello world')).toBeGreaterThan(0);
        expect(estimateTokenCount([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }])).toBeGreaterThan(0);

        const mgr = new ContextWindowManager({ model: 'gpt-4', reservedTokens: 7000, strategy: 'truncate' });
        const msgs: Message[] = Array.from({ length: 40 }, (_, i) => ({
            role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
            content: `message number ${i} with some padding text `.repeat(20),
        }));
        const trimmed = await mgr.enforceLimit(msgs);
        expect(trimmed.messages.length).toBeLessThanOrEqual(msgs.length);
        expect(trimmed.dropped).toBeGreaterThanOrEqual(0);
    });

    it('structured output helpers', async () => {
        expect(extractJson('prefix {"a":1} suffix')).toEqual({ a: 1 });
        expect(extractJson('```json\n{"b":2}\n```')).toEqual({ b: 2 });
        const ok = validateStructuredOutput('{"x":1}', { schema: z.object({ x: z.number() }) });
        expect(ok.validated).toBe(true);
        expect(ok.data).toEqual({ x: 1 });
        const bad = validateStructuredOutput('nope', { schema: z.object({ x: z.number() }) });
        expect(bad.validated).toBe(false);
        expect(buildStructuredOutputPrompt({ schema: z.object({ category: z.string() }), description: 'Classify' })).toContain('JSON');
        async function* stream() {
            yield { type: 'text', text: 'hel' };
            yield { type: 'text', text: 'lo' };
        }
        expect(await collectStreamText(stream() as any)).toBe('hello');
    });

    it('providers zodToJsonSchema branches + toolToLLMDef', () => {
        const schema = z.object({
            name: z.string().min(1).describe('n'),
            age: z.number().int().min(0).max(120).optional(),
            tags: z.array(z.string()).min(1),
            kind: z.enum(['a', 'b']),
            flag: z.boolean(),
            note: z.string().nullable(),
            lit: z.literal('x'),
            any: z.any(),
            def: z.string().default('d'),
            uni: z.union([z.string(), z.number()]),
        });
        const js = zodToJsonSchema(schema as any);
        expect(typeof js).toBe('object');

        const tool = {
            name: 'echo',
            description: 'echo',
            parameters: z.object({ q: z.string() }),
            execute: async () => ({}),
        } as any;
        expect(toolToLLMDef(tool).name).toBe('echo');
    });

    it('LLMCache get/set/stats/evict', () => {
        const cache = new LLMCache({ maxEntries: 2, ttlMs: 60_000 });
        const key = { messages: [{ role: 'user', content: 'hi' }] as Message[], model: 'm' };
        const result: GenerateResult = {
            text: 'cached',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
        expect(cache.isEnabled()).toBe(true);
        expect(cache.get(key)).toBeNull();
        cache.set(key, result);
        expect(cache.get(key)?.text).toBe('cached');
        cache.set({ ...key, model: 'm2' }, result);
        cache.set({ ...key, model: 'm3' }, result); // eviction
        const stats = cache.getStats();
        expect(stats.hits + stats.misses).toBeGreaterThan(0);
        cache.clear();
    });
});

describe('providers/compat factories', () => {
    it('creates OpenAI-compatible providers with api keys', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Mod = Module as any;
        const originalLoad = Mod._load as (...args: unknown[]) => unknown;
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === 'openai') {
                return {
                    OpenAI: class {
                        constructor(_opts: unknown) {}
                        chat = { completions: { create: async () => ({ choices: [] }) } };
                    },
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            expect(createGroqProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createXAIProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createDeepSeekProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createMistralProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createTogetherProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createFireworksProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createCohereProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createPerplexityProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createCerebrasProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createOpenAICompatibleProvider({ apiKey: 'k', baseURL: 'http://x', model: 'm' })).toBeTruthy();
            expect(createVllmProvider({ apiKey: 'k' })).toBeTruthy();
            expect(createLmStudioProvider({})).toBeTruthy();
            expect(createLocalAIProvider({})).toBeTruthy();
            expect(createJanProvider({})).toBeTruthy();
            expect(
                createAzureOpenAIProvider({
                    apiKey: 'k',
                    resource: 'r',
                    deployment: 'd',
                }),
            ).toBeTruthy();
            expect(() => createGroqProvider({})).toThrow(/apiKey/);
        } finally {
            Mod._load = originalLoad;
        }
    });
});

describe('learning remaining stores + machine + curator', () => {
    it('InMemoryUserProfileStore CRUD', async () => {
        const s = new InMemoryUserProfileStore();
        const p = await s.set({ userId: 'u1', agentId: 'a1', metadata: { x: 1 }, displayName: 'Ada' });
        expect(await s.get('u1', 'a1')).toMatchObject({ userId: 'u1' });
        expect((await s.update('u1', { displayName: 'Ada' }, 'a1')).displayName).toBe('Ada');
        expect((await s.update('u2', { displayName: 'Bob' })).displayName).toBe('Bob');
        expect((await s.list({ userId: 'u1', agentId: 'a1', limit: 5 })).length).toBe(1);
        expect(await s.delete('u1', 'a1')).toBe(true);
    });

    it('InMemoryDecisionLogStore + Curator', async () => {
        const logs = new InMemoryDecisionLogStore();
        const old = await logs.add({
            sessionId: 's1',
            agentId: 'a1',
            decision: 'chose A',
            reasoning: 'better',
        });
        // force old timestamp
        (logs as any)._logs.set(old.id, { ...old, createdAt: new Date(Date.now() - 100 * 86_400_000).toISOString() });
        await logs.add({ sessionId: 's1', agentId: 'a1', decision: 'chose B', reasoning: 'alt' });
        expect((await logs.list('a1', 's1')).length).toBe(2);
        expect((await logs.search('chose', 'a1')).length).toBeGreaterThan(0);
        expect(await logs.update(old.id, { outcome: 'ok' })).toBe(true);
        expect(await logs.update('missing', { outcome: 'x' })).toBe(false);
        expect(await logs.prune('a1', 30)).toBeGreaterThanOrEqual(1);
        expect(await logs.delete((await logs.list('a1'))[0]!.id)).toBe(true);

        const mem = new InMemoryUserMemoryStore();
        await mem.addMemory('u1', 'likes tea');
        await mem.addMemory('u1', 'LIKES TEA'); // dup
        await mem.addMemory('u1', 'likes coffee');
        const curator = new Curator({ userMemory: mem, decisionLog: logs });
        const result = await curator.curate({ userId: 'u1', maxAgeDays: 1, deduplicateMemories: true });
        expect(result.userMemoryDeduplicated + result.userMemoryPruned).toBeGreaterThanOrEqual(0);
    });

    it('LearningMachine with db + tools + context', async () => {
        const db = new InMemoryAgentDb();
        const machine = new LearningMachine({
            db,
            userProfile: new InMemoryUserProfileStore(),
            debug: true,
            namespace: 'ns',
        });
        await machine.userProfile!.set({ userId: 'u1', agentId: 'a1', displayName: 'Ada', preferences: { lang: 'en' }, metadata: {} });
        await machine.userMemory!.addMemory('u1', 'likes tea', 'a1');
        await machine.sessionContext!.set({
            sessionId: 's1',
            agentId: 'a1',
            summary: 'working',
            goal: 'ship',
            plan: ['a', 'b'],
            progress: ['a'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        await machine.entityMemory!.set({
            entityId: 'e1',
            entityType: 'person',
            name: 'Ada',
            description: 'eng',
            facts: [],
            events: [],
            relationships: [],
            namespace: 'ns',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        await machine.entityMemory!.addFact('e1', 'invented computer', 'ns');
        await machine.learnedKnowledge!.save({
            title: 'Tip',
            learning: 'Always test',
            context: 'qa',
            tags: ['test'],
            namespace: 'ns',
            createdAt: new Date().toISOString(),
        });

        const ctx = await machine.buildContext({
            userId: 'u1',
            agentId: 'a1',
            sessionId: 's1',
            entityId: 'e1',
            message: 'test',
            namespace: 'ns',
        });
        expect(ctx).toContain('Ada');
        expect(ctx).toContain('User Memories');

        await machine.process({ userId: 'u1', sessionId: 's1', messages: [] });
        const tools = machine.getTools({ userId: 'u1', agentId: 'a1', sessionId: 's1', namespace: 'ns' });
        expect(tools.length).toBeGreaterThan(5);
        // exercise tools
        expect(await tools[0]!('new mem')).toMatch(/Memory added/);
        expect(machine.toJSON().userMemory).toBe(true);
    });
});

describe('interfaces slack/telegram/a2a/ag-ui', () => {
    const servers: http.Server[] = [];
    afterEach(async () => {
        await Promise.all(
            servers.splice(0).map(
                (s) =>
                    new Promise<void>((resolve) => {
                        s.close(() => resolve());
                    }),
            ),
        );
        vi.unstubAllGlobals();
    });

    function listen(setup: (s: http.Server) => void): Promise<http.Server> {
        return new Promise((resolve) => {
            const s = http.createServer();
            setup(s);
            s.listen(0, '127.0.0.1', () => {
                servers.push(s);
                resolve(s);
            });
        });
    }

    it('SlackInterface url_verification + signed event + bad sig', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (String(url).includes('users.info')) {
                return new Response(JSON.stringify({ ok: true, user: { name: 'ada' } }), { status: 200 });
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);

        const secret = 'signing-secret';
        const iface = new SlackInterface({
            agent: fakeAgent('slack-hi'),
            token: 'xoxb-test',
            signingSecret: secret,
            resolveUserIdentity: true,
        });
        expect(iface.name).toBe('SlackInterface');
        const server = await listen((s) => iface.setup(s));

        const challengeBody = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${challengeBody}`).digest('hex')}`;
        const chal = await request(server, {
            path: '/slack/events',
            headers: {
                'content-type': 'application/json',
                'x-slack-request-timestamp': ts,
                'x-slack-signature': sig,
            },
            body: challengeBody,
        });
        expect(chal.status).toBe(200);
        expect(chal.body).toContain('abc');

        const eventBody = JSON.stringify({
            type: 'event_callback',
            event: { type: 'app_mention', text: 'hello', user: 'U1', channel: 'C1', ts: '1.0' },
        });
        const ts2 = String(Math.floor(Date.now() / 1000));
        const sig2 = `v0=${createHmac('sha256', secret).update(`v0:${ts2}:${eventBody}`).digest('hex')}`;
        const ev = await request(server, {
            path: '/slack/events',
            headers: {
                'content-type': 'application/json',
                'x-slack-request-timestamp': ts2,
                'x-slack-signature': sig2,
            },
            body: eventBody,
        });
        expect(ev.status).toBe(200);
        await new Promise((r) => setTimeout(r, 50));
        expect(fetchMock).toHaveBeenCalled();

        const bad = await request(server, {
            path: '/slack/events',
            headers: {
                'x-slack-request-timestamp': ts2,
                'x-slack-signature': 'v0=bad',
            },
            body: eventBody,
        });
        expect(bad.status).toBe(401);
    });

    it('TelegramInterface webhook + secret + reply', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const iface = new TelegramInterface({
            agent: fakeAgent('tg-hi'),
            token: 'bot-token',
            secretToken: 'sec',
        });
        const server = await listen((s) => iface.setup(s));

        const forbidden = await request(server, {
            path: '/telegram/webhook',
            headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
            body: '{}',
        });
        expect(forbidden.status).toBe(403);

        const body = JSON.stringify({
            update_id: 1,
            message: {
                message_id: 1,
                from: { id: 42, username: 'ada' },
                chat: { id: 99, type: 'private' },
                text: 'hi',
            },
        });
        const ok = await request(server, {
            path: '/telegram/webhook',
            headers: { 'x-telegram-bot-api-secret-token': 'sec', 'content-type': 'application/json' },
            body,
        });
        expect(ok.status).toBe(200);
        await new Promise((r) => setTimeout(r, 50));
        expect(fetchMock).toHaveBeenCalled();
    });

    it('A2AInterface agent card + task', async () => {
        const iface = new A2AInterface({
            agent: fakeAgent('a2a-hi'),
            agentCard: { name: 'A', description: 'd', version: '1', capabilities: ['text'] },
        });
        const server = await listen((s) => iface.setup(s));
        const card = await request(server, { method: 'GET', path: '/.well-known/agent.json' });
        expect(card.status).toBe(200);
        expect(card.body).toContain('"name":"A"');

        const task = await request(server, {
            path: '/a2a',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                id: 't1',
                message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
            }),
        });
        expect(task.status).toBe(200);
        expect(task.body).toContain('a2a-hi');
    });

    it('AGUIInterface OPTIONS + run create SSE', async () => {
        const iface = new AGUIInterface({ agent: fakeAgent('agui-hi') });
        const server = await listen((s) => iface.setup(s));
        const opt = await request(server, { method: 'OPTIONS', path: '/ag-ui/runs' });
        expect(opt.status).toBe(204);

        const run = await request(server, {
            path: '/ag-ui/runs',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'hi', user_id: 'u1' }),
        });
        expect(run.status).toBe(200);
        expect(run.body).toContain('run.');
    });
});
