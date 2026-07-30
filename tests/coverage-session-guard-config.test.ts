/**
 * Hermetic coverage for session fallback, guard, config loader, plugins, crushers.
 * Callers: vitest only (tests include glob).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    FallbackSessionStore,
    createFallbackSessionStore,
} from '../src/session/fallback-store.js';
import { InMemorySessionStore } from '../src/session/in-memory.js';
import type { SessionStore } from '../src/session/types.js';
import { runToolWithTimeout, createDeadline } from '../src/guard/timeout.js';
import { withRetry, isTransientLLMError, DEFAULT_RETRY_POLICY } from '../src/guard/retry.js';
import { PersonaForgeError } from '../src/contracts/index.js';
import { loadConfig, loadConfigWithDefaults, logConfig } from '../src/config/loader.js';
import {
    createPluginRegistry,
    createLoggingPlugin,
    createRateLimitPlugin,
    createTelemetryPlugin,
} from '../src/plugins/plugins.js';
import { hooksToPlugin, INTERCEPTION_ORDER } from '../src/plugins/hooks-adapter.js';
import { crushLog, crushXml, crushCsv } from '../src/compression/mastermind/specialized-crushers.js';

describe('FallbackSessionStore', () => {
    it('uses primary until failure then degrades', async () => {
        let fail = false;
        const primary: SessionStore = {
            get: async (id) => {
                if (fail) throw new Error('down');
                return { id, agentId: 'a', messages: [], createdAt: 1, updatedAt: 1 };
            },
            create: async (data) => {
                if (fail) throw new Error('down');
                const id = typeof data === 'string' ? data : 'p1';
                return {
                    id,
                    agentId: typeof data === 'string' ? 'unknown' : data.agentId,
                    messages: typeof data === 'string' ? [] : (data.messages ?? []),
                    createdAt: 1,
                    updatedAt: 1,
                };
            },
            update: async () => {
                if (fail) throw new Error('down');
            },
            getMessages: async () => {
                if (fail) throw new Error('down');
                return [];
            },
            appendMessage: async () => {
                if (fail) throw new Error('down');
            },
            delete: async () => {
                if (fail) throw new Error('down');
            },
        };
        const onFallback = vi.fn();
        const store = createFallbackSessionStore(primary, {
            fallback: 'in-memory',
            onFallback,
        });

        const s = await store.create({ agentId: 'a1' });
        expect(s.agentId).toBe('a1');
        expect(store.isDegraded()).toBe(false);

        fail = true;
        const s2 = await store.create({ agentId: 'a2' });
        expect(store.isDegraded()).toBe(true);
        expect(onFallback).toHaveBeenCalledTimes(1);
        await store.appendMessage(s2.id, { role: 'user', content: 'hi' });
        expect((await store.getMessages(s2.id)).length).toBe(1);
        await store.update(s2.id, { messages: [] });
        await store.delete(s2.id);

        store.recover();
        expect(store.isDegraded()).toBe(false);
        fail = false;
        expect(await store.get(s.id)).toBeTruthy();
    });

    it('routes to fallback when already degraded', async () => {
        const primary: SessionStore = {
            get: async () => {
                throw new Error('always');
            },
            create: async () => {
                throw new Error('always');
            },
            update: async () => {
                throw new Error('always');
            },
            getMessages: async () => {
                throw new Error('always');
            },
            appendMessage: async () => {
                throw new Error('always');
            },
            delete: async () => {
                throw new Error('always');
            },
        };
        const store = new FallbackSessionStore(primary, { fallback: 'in-memory' });
        const s = await store.create({ agentId: 'x' });
        expect(s.id).toBeTruthy();
        expect(await store.get(s.id)).toBeTruthy();
    });
});

describe('guard timeout + retry', () => {
    it('runToolWithTimeout resolves and times out', async () => {
        await expect(runToolWithTimeout(async () => 42, 1000, 't')).resolves.toBe(42);
        await expect(
            runToolWithTimeout(async () => new Promise(() => {}), 10, 'slow'),
        ).rejects.toThrow(/timed out|timeout/i);

        const ac = new AbortController();
        ac.abort();
        await expect(runToolWithTimeout(async () => 1, 1000, 'aborted', ac.signal)).rejects.toThrow();
    });

    it('createDeadline assert/expired/remaining', () => {
        let now = 1000;
        const d = createDeadline(50, 'run', () => now);
        expect(d.expired()).toBe(false);
        expect(d.remainingMs()).toBe(50);
        d.assert();
        now = 1060;
        expect(d.expired()).toBe(true);
        expect(d.remainingMs()).toBe(0);
        expect(() => d.assert()).toThrow();
    });

    it('isTransientLLMError + withRetry', async () => {
        expect(isTransientLLMError({ status: 429 })).toBe(true);
        expect(isTransientLLMError({ statusCode: 500 })).toBe(true);
        expect(isTransientLLMError({ response: { status: 503 } })).toBe(true);
        expect(isTransientLLMError({ context: { status: 408 } })).toBe(true);
        expect(isTransientLLMError({ status: 400 })).toBe(false);
        expect(isTransientLLMError({ code: 'ECONNRESET' })).toBe(true);
        expect(isTransientLLMError({ message: 'fetch failed' })).toBe(true);
        expect(
            isTransientLLMError(
                new PersonaForgeError({ code: 'LLM_PROVIDER_ERROR', message: 'x', retryable: true }),
            ),
        ).toBe(true);

        let n = 0;
        const sleeps: number[] = [];
        const result = await withRetry(
            async () => {
                n++;
                if (n < 3) {
                    throw Object.assign(new Error('rate'), {
                        status: 429,
                        headers: { 'retry-after': '0.01' },
                    });
                }
                return 'ok';
            },
            {
                maxAttempts: 3,
                initialDelayMs: 1,
                maxDelayMs: 10,
                multiplier: 2,
                jitter: false,
                retryOn: isTransientLLMError,
                sleep: async (ms) => {
                    sleeps.push(ms);
                },
            },
        );
        expect(result).toBe('ok');
        expect(sleeps.length).toBe(2);

        await expect(
            withRetry(
                async () => {
                    throw new Error('fatal');
                },
                { ...DEFAULT_RETRY_POLICY, maxAttempts: 2, retryOn: () => false, sleep: async () => {} },
            ),
        ).rejects.toThrow('fatal');

        await expect(
            withRetry(
                async () => {
                    throw 'string-err';
                },
                { maxAttempts: 1, retryOn: () => true, sleep: async () => {} },
            ),
        ).rejects.toThrow(/Retry exhausted|string-err/);
    });
});

describe('config loader', () => {
    const keys = [
        'LLM_PROVIDER',
        'OPENAI_API_KEY',
        'OPENAI_MODEL',
        'OPENROUTER_API_KEY',
        'OPENROUTER_MODEL',
        'DB_TYPE',
        'DB_HOST',
        'DB_NAME',
        'DB_USER',
        'DB_PASSWORD',
        'PORT',
        'NODE_ENV',
        'LOG_LEVEL',
    ] as const;
    const saved: Record<string, string | undefined> = {};

    afterEach(() => {
        for (const k of keys) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k]!;
            delete saved[k];
        }
    });

    function snapshotEnv() {
        for (const k of keys) saved[k] = process.env[k];
    }

    it('loadConfig for openai/memory defaults and overrides', () => {
        snapshotEnv();
        process.env['LLM_PROVIDER'] = 'openai';
        process.env['OPENAI_API_KEY'] = 'sk-test';
        process.env['OPENAI_MODEL'] = 'gpt-4o-mini';
        process.env['DB_TYPE'] = 'memory';
        process.env['PORT'] = '4099';
        process.env['NODE_ENV'] = 'test';

        const cfg = loadConfig();
        expect(cfg.llm.provider).toBe('openai');
        expect(cfg.database.type).toBe('memory');
        expect(cfg.server.port).toBe(4099);

        const withOverrides = loadConfigWithDefaults({
            llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' },
            server: { port: 5000, corsOrigins: [], nodeEnv: 'test', maxRequestSize: '1mb' },
        });
        expect(withOverrides.server.port).toBe(5000);

        const lines: string[] = [];
        logConfig(cfg, { log: (m) => lines.push(m) });
        expect(lines.join('')).toMatch(/Agent Framework Configuration/);
    });

    it('loadConfig providers openrouter/ollama + postgres', () => {
        snapshotEnv();
        process.env['LLM_PROVIDER'] = 'ollama';
        process.env['DB_TYPE'] = 'postgres';
        process.env['DB_HOST'] = 'localhost';
        process.env['DB_NAME'] = 'db';
        process.env['DB_USER'] = 'u';
        process.env['DB_PASSWORD'] = 'p';
        process.env['OPENAI_API_KEY'] = 'unused';
        const cfg = loadConfig();
        expect(cfg.llm.provider).toBe('ollama');
        expect(cfg.database.type).toBe('postgres');

        process.env['LLM_PROVIDER'] = 'openrouter';
        process.env['OPENROUTER_API_KEY'] = 'or-key';
        process.env['OPENROUTER_MODEL'] = 'm';
        process.env['DB_TYPE'] = 'sqlite';
        const cfg2 = loadConfig();
        expect(cfg2.llm.provider).toBe('openrouter');
        expect(cfg2.database.type).toBe('sqlite');
    });
});

describe('plugins registry + builtins', () => {
    it('hooks, middleware, rate limit, telemetry', async () => {
        const reg = createPluginRegistry();
        const logs: string[] = [];
        const logging = createLoggingPlugin({
            debug: (m) => logs.push(m),
            info: (m) => logs.push(m),
            warn: (m) => logs.push(m),
            error: (m) => logs.push(m),
        });
        reg.register(logging);
        expect(() => reg.register(logging)).toThrow(/already registered/);

        const input = await reg.runBeforeHooks(
            { prompt: 'hello world' } as never,
            { agentId: 'a1' } as never,
        );
        expect(input.prompt).toBe('hello world');

        const output = await reg.runAfterHooks(
            {
                state: 'complete',
                metadata: { durationMs: 10, tokensUsed: 5 },
            } as never,
            { agentId: 'a1' } as never,
        );
        expect(output.state).toBe('complete');

        const mw = reg.getToolMiddleware();
        expect(mw.length).toBe(1);
        const obj = mw[0] as {
            beforeExecute?: (t: unknown, p: unknown) => void;
            afterExecute?: (t: unknown, r: unknown, c: unknown) => void;
            onError?: (t: unknown, e: Error, c: unknown) => void;
        };
        obj.beforeExecute?.({ name: 't' }, {});
        obj.afterExecute?.(
            { name: 't' },
            { success: true, executionTimeMs: 1 },
            { agentId: 'a1' },
        );
        obj.onError?.({ name: 't' }, new Error('boom'), { agentId: 'a1' });

        await reg.runErrorHooks(new Error('e'), { agentId: 'a1' } as never);
        reg.register({
            id: 'bad-error',
            name: 'Bad',
            version: '1',
            onError: async () => {
                throw new Error('hook fail');
            },
        });
        await reg.runErrorHooks(new Error('e'), { agentId: 'a1' } as never);

        const rl = createRateLimitPlugin({ maxRpm: 1 });
        const rlReg = createPluginRegistry();
        rlReg.register(rl);
        await rlReg.runBeforeHooks({ prompt: 'a' } as never, { agentId: 'x' } as never);
        await expect(
            rlReg.runBeforeHooks({ prompt: 'b' } as never, { agentId: 'x' } as never),
        ).rejects.toThrow(/Rate limit/);

        const metrics = {
            counter: vi.fn(),
            gauge: vi.fn(),
            histogram: vi.fn(),
            incrementCounter: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
        };
        const tel = createTelemetryPlugin(metrics as never);
        const tReg = createPluginRegistry();
        tReg.register(tel);
        await tReg.runBeforeHooks({ prompt: 'p' } as never, { agentId: 'a' } as never);
        await tReg.runAfterHooks(
            { state: 'ok', metadata: { durationMs: 3, tokensUsed: 2 } } as never,
            { agentId: 'a' } as never,
        );
        expect(metrics.counter).toHaveBeenCalled();
        expect(metrics.histogram).toHaveBeenCalled();

        const plugin = hooksToPlugin(
            {
                beforeRun: async (p: string) => p,
                afterRun: async (r: unknown) => r,
            } as never,
            'agent-x',
        );
        expect(plugin.id).toContain('agent-x');
        expect(INTERCEPTION_ORDER.AGENTIC_LOOP).toBe(3);
        expect(new InMemorySessionStore().size).toBe(0);
    });
});

describe('specialized crushers', () => {
    it('crushLog dedups and keeps errors', () => {
        const lines = [
            'info ok',
            'info ok',
            'info ok',
            'ERROR boom',
            ...Array.from({ length: 80 }, (_, i) => `line ${i}`),
        ].join('\n');
        const out = crushLog(lines, { maxLines: 20 });
        expect(out).toMatch(/ERROR boom/);
        expect(out).toMatch(/repeated|sampled|lines/i);

        expect(crushLog('a\nb', { dedup: false, maxLines: 10 })).toContain('a');
    });

    it('crushXml strips comments/empty and truncates', () => {
        const xml = `<!-- c -->
<root>
  <item>1</item>
  <item>2</item>
  <item>3</item>
  <item>4</item>
  <item>5</item>
  <item>6</item>
  <item>7</item>
  <empty></empty>
  <self/>
</root>`;
        const out = crushXml(xml, { maxChars: 200, maxRepeat: 3 });
        expect(out).not.toMatch(/<!-- c -->/);
        expect(out.length).toBeLessThanOrEqual(250);
    });

    it('crushCsv keeps head/tail and truncates wide cols', () => {
        const header = 'a,b';
        const rows = Array.from({ length: 40 }, (_, i) => `${i},${'x'.repeat(100)}`);
        const out = crushCsv([header, ...rows].join('\n'), { maxRows: 10, maxColWidth: 20 });
        expect(out).toMatch(/omitted/);
        expect(out.split('\n')[0]).toBe('a,b');

        const small = crushCsv('h1,h2\nv1,v2\n');
        expect(small).toContain('v1');
    });
});
