/**
 * Hermetic coverage for src/observe (logger, request-context, tracing, prometheus)
 * and src/config (secret-manager adapters, validator, file-loader edges).
 * No external SDKs, no network. Callers: vitest only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    maskSecrets,
    ConsoleLogger,
    createLogger,
    withTraceContext,
} from '../src/observe/logger.js';
import { RequestContext } from '../src/observe/request-context.js';
import {
    getTracer,
    genAiAttributes,
    inferGenAiSystem,
    withSpan,
    TRACER_NAME,
} from '../src/observe/tracing.js';
import {
    PROMETHEUS_CONTENT_TYPE,
    scrapePrometheusMetrics,
    createPrometheusHandler,
} from '../src/observe/prometheus.js';
import { Metrics, recordLlmUsage } from '../src/observe/metrics.js';
import { SpanName } from '../src/observe/spans.js';
import {
    createSecretManager,
    EnvSecretManagerAdapter,
} from '../src/config/secret-manager.js';
import { getConfigErrorHelp, validateConfig } from '../src/config/validator.js';
import { loadConfigFile } from '../src/config/file-loader.js';
import { PersonaForgeError } from '../src/contracts/errors.js';

// ── logger ──────────────────────────────────────────────────────────────────

describe('observe/logger maskSecrets', () => {
    it('redacts API keys, AWS keys, bearer tokens, and JSON secret fields', () => {
        expect(maskSecrets('key sk-proj-abcDEF1234567890123456789')).toContain('[REDACTED_API_KEY]');
        expect(maskSecrets('sk-ant-abcdefghijklmnopqrstuvwxyz123456')).toContain('[REDACTED_API_KEY]');
        expect(maskSecrets('AIzaSyD1234567890123456789012345678901234')).toContain('[REDACTED_API_KEY]');
        expect(maskSecrets('AKIAIOSFODNN7EXAMPLE')).toContain('[REDACTED_AWS_KEY]');
        expect(maskSecrets('Authorization: Bearer abc.def.ghi')).toContain('Bearer [REDACTED]');
        expect(maskSecrets('{"api_key":"supersecretvalue"}')).toContain('[REDACTED]');
        expect(maskSecrets('{"password":"supersecretvalue"}')).toContain('[REDACTED]');
        expect(maskSecrets('{"authorization":"Bearer abc.def"}')).toContain('[REDACTED]');
        expect(maskSecrets('plain text, nothing to hide')).toBe('plain text, nothing to hide');
    });
});

describe('observe/logger ConsoleLogger', () => {
    it('filters by level and writes JSON with bindings and ctx', () => {
        const lines: string[] = [];
        const log = new ConsoleLogger({ level: 'warn', write: (l) => lines.push(l) });
        log.debug('d');
        log.info('i');
        log.warn('w', { agent: 'a1' });
        log.error('e');
        expect(lines.length).toBe(2);
        const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(parsed.level).toBe('warn');
        expect(parsed.message).toBe('w');
        expect(parsed.agent).toBe('a1');
        expect(typeof parsed.timestamp).toBe('string');
    });

    it('child inherits level/bindings and avoids double masking', () => {
        const lines: string[] = [];
        const parent = new ConsoleLogger({ level: 'info', write: (l) => lines.push(l) });
        const child = parent.child({ runId: 'r1' });
        child.info('hello sk-abcdefghijklmnopqrstuvwxyz123456', { tenant: 't1' });
        expect(lines.length).toBe(1);
        const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(parsed.runId).toBe('r1');
        expect(parsed.tenant).toBe('t1');
        expect(JSON.stringify(parsed)).toContain('[REDACTED_API_KEY]');
    });

    it('createLogger + disableSecretMasking + env LOG_LEVEL', () => {
        const lines: string[] = [];
        const log = createLogger({ level: 'debug', write: (l) => lines.push(l) });
        log.debug('d');
        expect(lines.length).toBe(1);

        const raw: string[] = [];
        const unmasked = new ConsoleLogger({
            level: 'info',
            disableSecretMasking: true,
            write: (l) => raw.push(l),
        });
        unmasked.info('sk-abcdefghijklmnopqrstuvwxyz123456');
        expect(raw[0]).toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    });

    it('withTraceContext injects nothing without OTEL and passes through', () => {
        const lines: string[] = [];
        const base = new ConsoleLogger({ level: 'info', write: (l) => lines.push(l) });
        const wrapped = withTraceContext(base);
        wrapped.info('msg', { a: 1 });
        const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(parsed.a).toBe(1);
        expect(parsed.traceId).toBeUndefined();

        const child = wrapped.child({ x: 1 });
        child.info('c');
        const parsed2 = JSON.parse(lines[1]) as Record<string, unknown>;
        expect(parsed2.x).toBe(1);
    });

    it('withTraceContext injects trace/span ids when OTEL span is active', async () => {
        const { trace, isSpanContextValid } = await import('@opentelemetry/api');
        const activeSpanMock = vi.fn().mockReturnValue({
            spanContext: () => ({ traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef' }),
        });
        const isValidMock = vi.fn().mockReturnValue(true);
        const spyActive = vi.spyOn(trace, 'getActiveSpan').mockImplementation(activeSpanMock);
        const spyValid = vi.spyOn(await import('@opentelemetry/api'), 'isSpanContextValid').mockImplementation(isValidMock);

        const lines: string[] = [];
        const base = new ConsoleLogger({ level: 'info', write: (l) => lines.push(l) });
        const wrapped = withTraceContext(base);
        wrapped.info('msg', { a: 1 });
        const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(parsed.traceId).toBe('0123456789abcdef0123456789abcdef');
        expect(parsed.spanId).toBe('0123456789abcdef');

        spyActive.mockRestore();
        spyValid.mockRestore();
    });
});

// ── request-context ─────────────────────────────────────────────────────────

describe('observe/request-context', () => {
    it('propagates values through async-local storage', async () => {
        let inside: unknown = null;
        await RequestContext.run({ requestId: 'r1', traceId: 't1', tenantId: 'ten', userId: 'u1' }, async () => {
            inside = {
                req: RequestContext.getRequestId(),
                trace: RequestContext.getTraceId(),
                tenant: RequestContext.getTenantId(),
                full: RequestContext.get(),
            };
            await Promise.resolve();
            expect(RequestContext.getRequestId()).toBe('r1');
        });
        expect(inside).toMatchObject({ req: 'r1', trace: 't1', tenant: 'ten' });
        expect(RequestContext.get()).toBeUndefined();
    });
});

// ── tracing ─────────────────────────────────────────────────────────────────

describe('observe/tracing', () => {
    it('getTracer uses TRACER_NAME and version fallbacks', () => {
        expect(typeof getTracer('1.2.3')).toBe('object');
        expect(typeof getTracer()).toBe('object');
        expect(TRACER_NAME).toBe('personaforge');
    });

    it('genAiAttributes builds gen_ai + legacy aliases', () => {
        expect(genAiAttributes({})).toEqual({ 'gen_ai.operation.name': 'chat' });
        expect(genAiAttributes({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, operation: 'generate' }))
            .toMatchObject({
                'gen_ai.operation.name': 'generate',
                'gen_ai.system': 'openai',
                'gen_ai.request.model': 'gpt-4o',
                'gen_ai.usage.input_tokens': 10,
                'gen_ai.usage.output_tokens': 5,
            });
    });

    it('inferGenAiSystem covers provider prefixes and model keywords', () => {
        expect(inferGenAiSystem()).toBeUndefined();
        expect(inferGenAiSystem('anthropic:claude')).toBe('anthropic');
        expect(inferGenAiSystem('openai:gpt')).toBe('openai');
        expect(inferGenAiSystem('google:gemini')).toBe('google');
        expect(inferGenAiSystem('gemini:foo')).toBe('google');
        expect(inferGenAiSystem('vertex:foo')).toBe('vertex');
        expect(inferGenAiSystem('azure:foo')).toBe('azure');
        expect(inferGenAiSystem('grok:foo')).toBe('xai');
        expect(inferGenAiSystem('claude-sonnet-4')).toBe('anthropic');
        expect(inferGenAiSystem('gpt-4o')).toBe('openai');
        expect(inferGenAiSystem('o1-mini')).toBe('openai');
        expect(inferGenAiSystem('o3-mini')).toBe('openai');
        expect(inferGenAiSystem('gemini-pro')).toBe('google');
        expect(inferGenAiSystem('mistral-large')).toBe('mistral');
        expect(inferGenAiSystem('mixtral-8x7b')).toBe('mistral');
        expect(inferGenAiSystem('deepseek-coder')).toBe('deepseek');
        expect(inferGenAiSystem('grok-2')).toBe('xai');
        expect(inferGenAiSystem('command-r')).toBe('cohere');
        expect(inferGenAiSystem('cohere-embed')).toBe('cohere');
        expect(inferGenAiSystem('unknown-model')).toBeUndefined();
    });

    it('withSpan succeeds, records PersonaForgeError, and throws', async () => {
        await expect(
            withSpan('run', { agent: 'a1', skip: undefined }, async () => 'ok'),
        ).resolves.toBe('ok');

        await expect(
            withSpan('fail', {}, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');

        const pfErr = new PersonaForgeError({
            code: 'LLM_PROVIDER_ERROR',
            message: 'pf',
            retryable: true,
        });
        await expect(
            withSpan('pf', {}, async () => {
                throw pfErr;
            }),
        ).rejects.toThrow('pf');
    });
});

// ── prometheus ──────────────────────────────────────────────────────────────

describe('observe/prometheus', () => {
    it('scrape returns comment-only body when exporter not wired', async () => {
        const body = await scrapePrometheusMetrics({ service: 'x' });
        expect(body).toContain('exporter not wired');
    });

    it('handler: path check, method check, HEAD vs GET', async () => {
        const h = createPrometheusHandler({ path: '/metrics' });
        const wrong = await h(new Request('http://x/other'));
        expect(wrong.status).toBe(404);

        const method = await h(new Request('http://x/metrics', { method: 'POST' }));
        expect(method.status).toBe(405);

        const head = await h(new Request('http://x/metrics', { method: 'HEAD' }));
        expect(head.status).toBe(200);
        expect(head.headers.get('content-type')).toBe(PROMETHEUS_CONTENT_TYPE);
        expect(await head.text()).toBe('');

        const get = await h(new Request('http://x/metrics'));
        expect(get.status).toBe(200);
        expect(await get.text()).toContain('exporter not wired');

        const bare = createPrometheusHandler();
        const b = await bare(new Request('http://x/anything', { method: 'GET' }));
        expect(b.status).toBe(200);
    });
});

// ── metrics ─────────────────────────────────────────────────────────────────

describe('observe/metrics', () => {
    it('exposes metric instruments and recordLlmUsage guards', () => {
        expect(Metrics.agentRunsTotal).toBeTruthy();
        expect(SpanName.AGENT_RUN).toBe('agent.run');
        expect(() =>
            recordLlmUsage({ model: 'gpt-4o', inputTokens: 5, outputTokens: 7, costUsd: 0.001, agentName: 'a' }),
        ).not.toThrow();
        expect(() => recordLlmUsage({ model: 'm' })).not.toThrow();
    });
});

// ── config secret-manager ───────────────────────────────────────────────────

// Mock tryImport (exported from src/shared) so the lazy-loaded SDK modules can
// be injected without installing the optional peer deps.
const awsSendMock = vi.fn();
const azureGetSecretMock = vi.fn();
const gcpAccessMock = vi.fn();
let tryImportImpl = vi.fn(async () => null);

vi.mock('../src/shared/index.js', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../src/shared/index.js')>();
    return {
        ...mod,
        tryImport: vi.fn((spec: string) => tryImportImpl(spec)),
    };
});

// ensure the mock is applied before importing the module under test
import { tryImport as _mockProbe } from '../src/shared/index.js';
void _mockProbe;

describe('config/secret-manager env adapter', () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        saved['MYAPP_KEY'] = process.env['MYAPP_KEY'];
        process.env['MYAPP_KEY'] = 'topsecret';
        saved['PLAIN'] = process.env['PLAIN'];
        process.env['PLAIN'] = 'plain-value';
    });

    afterEach(() => {
        if (saved['MYAPP_KEY'] === undefined) delete process.env['MYAPP_KEY'];
        else process.env['MYAPP_KEY'] = saved['MYAPP_KEY'];
        if (saved['PLAIN'] === undefined) delete process.env['PLAIN'];
        else process.env['PLAIN'] = saved['PLAIN'];
    });

    it('reads prefixed env, throws on missing, watches with polling', async () => {
        const mgr = createSecretManager({ provider: 'env', prefix: 'MYAPP_' });
        expect(await mgr.getSecret('KEY')).toBe('topsecret');

        await expect(mgr.getSecret('MISSING')).rejects.toThrow(/Secret not found in environment/);

        const envAdapter = new EnvSecretManagerAdapter({ prefix: '' });
        expect(await envAdapter.getSecret('PLAIN')).toBe('plain-value');
        await expect(envAdapter.getSecret('NOPE')).rejects.toThrow(/not found/);

        // watch: prime + change detection
        const cb = vi.fn();
        const w = mgr.watch('KEY', cb, 10);
        await new Promise((r) => setTimeout(r, 30));
        expect(cb).not.toHaveBeenCalled(); // value unchanged from prime
        process.env['MYAPP_KEY'] = 'rotated';
        await new Promise((r) => setTimeout(r, 30));
        expect(cb).toHaveBeenCalledWith('rotated');
        w.stop();
    });

    it('factory throws on unknown provider', () => {
        expect(() => createSecretManager({ provider: 'nope' } as never)).toThrow(/Unknown secret manager provider/);
    });
});

describe('config/secret-manager cloud adapters (mocked SDKs)', () => {
    beforeEach(() => {
        awsSendMock.mockReset();
        azureGetSecretMock.mockReset();
        gcpAccessMock.mockReset();
        tryImportImpl = vi.fn(async () => null);
    });

    it('aws: string, binary, version, and error paths', async () => {
        tryImportImpl = vi.fn(async (spec: string) => {
            if (spec.includes('client-secrets-manager')) {
                return {
                    SecretsManagerClient: class {
                        send = awsSendMock;
                    },
                    GetSecretValueCommand: class {
                        opts: object;
                        constructor(opts: object) {
                            this.opts = opts;
                        }
                    },
                };
            }
            return null;
        });
        const aws = createSecretManager({ provider: 'aws', region: 'us-east-1' });
        awsSendMock.mockResolvedValueOnce({ SecretString: 'str-val' });
        expect(await aws.getSecret('db/pass')).toBe('str-val');

        awsSendMock.mockResolvedValueOnce({ SecretBinary: new Uint8Array([104, 105]) });
        expect(await aws.getSecret('db/key')).toBe('hi');

        // version pass-through
        awsSendMock.mockResolvedValueOnce({ SecretString: 'v' });
        await aws.getSecret('s', 'v1');

        awsSendMock.mockResolvedValueOnce({});
        await expect(aws.getSecret('s')).rejects.toThrow(/no string or binary value/);

        // factory also constructs with credentials
        const aws2 = createSecretManager({
            provider: 'aws',
            region: 'x',
            credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
        });
        awsSendMock.mockResolvedValue({ SecretString: 'x' });
        expect(await aws2.getSecret('s')).toBe('x');
    });

    it('aws: missing module throws', async () => {
        const aws = createSecretManager({ provider: 'aws', region: 'us-east-1' });
        await expect(aws.getSecret('s')).rejects.toThrow(/requires @aws-sdk\/client-secrets-manager/);
    });

    it('azure: value, missing value, explicit creds, default cred, and missing mod', async () => {
        tryImportImpl = vi.fn(async (spec: string) => {
            if (spec.includes('keyvault-secrets')) {
                return {
                    SecretClient: class {
                        getSecret = azureGetSecretMock;
                    },
                };
            }
            if (spec.includes('@azure/identity')) {
                return {
                    ClientSecretCredential: class {
                        kind = 'client';
                        constructor(
                            public t: string,
                            public c: string,
                            public s: string,
                        ) {}
                    },
                    DefaultAzureCredential: class {
                        kind = 'default';
                    },
                };
            }
            return null;
        });
        const azure = createSecretManager({
            provider: 'azure',
            vaultUrl: 'https://vault.azure.net',
            credentials: { tenantId: 't', clientId: 'c', clientSecret: 's' },
        });
        azureGetSecretMock.mockResolvedValueOnce({ value: 'secret-val' });
        expect(await azure.getSecret('my-secret')).toBe('secret-val');

        azureGetSecretMock.mockResolvedValueOnce({ value: undefined });
        await expect(azure.getSecret('empty')).rejects.toThrow(/has no value/);

        // default credential path
        const azure2 = createSecretManager({ provider: 'azure', vaultUrl: 'https://v.azure.net' });
        azureGetSecretMock.mockResolvedValue({ value: 'd' });
        expect(await azure2.getSecret('x', '2')).toBe('d');
    });

    it('azure: missing keyvault/identity modules throw', async () => {
        const azure = createSecretManager({ provider: 'azure', vaultUrl: 'https://v.azure.net' });
        await expect(azure.getSecret('s')).rejects.toThrow(/requires @azure\/keyvault-secrets/);

        // credentials path with missing identity module
        tryImportImpl = vi.fn(async (spec: string) => {
            if (spec.includes('keyvault-secrets')) {
                return { SecretClient: vi.fn().mockImplementation(() => ({ getSecret: azureGetSecretMock })) };
            }
            return null;
        });
        const azure2 = createSecretManager({
            provider: 'azure',
            vaultUrl: 'https://v.azure.net',
            credentials: { tenantId: 't', clientId: 'c', clientSecret: 's' },
        });
        await expect(azure2.getSecret('s')).rejects.toThrow(/explicit credentials require @azure\/identity/);
    });

    it('vault: fetch-based with token, version, 404, error, no-data, key resolution', async () => {
        const origFetch = globalThis.fetch;
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as never;

        const vault = createSecretManager({ provider: 'vault', endpoint: 'http://v:8200', token: 'tok' });

        // has "value" key
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { data: { value: 'v1' } } }), { status: 200 }));
        expect(await vault.getSecret('a')).toBe('v1');

        // falls back to key matching last path segment
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { data: { 'b/c': 'nope', 'c': 'v2' } } }), { status: 200 }));
        expect(await vault.getSecret('a/b/c')).toBe('v2');

        // single key fallback
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { data: { only: 'v3' } } }), { status: 200 }));
        expect(await vault.getSecret('x')).toBe('v3');

        // 404
        fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
        await expect(vault.getSecret('missing')).rejects.toThrow(/not found/);

        // !ok with body
        fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
        await expect(vault.getSecret('x')).rejects.toThrow(/Vault request failed \(403\)/);

        // no data
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }));
        await expect(vault.getSecret('x')).rejects.toThrow(/has no data/);

        // multiple keys without a match
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { data: { k1: 'a', k2: 'b' } } }), { status: 200 }));
        await expect(vault.getSecret('x')).rejects.toThrow(/multiple keys/);

        // version query
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { data: { value: 'v4' } } }), { status: 200 }));
        expect(await vault.getSecret('s', '3')).toBe('v4');

        globalThis.fetch = origFetch;
    });

    it('vault: no token throws; env-var defaults apply', async () => {
        const savedAddr = process.env.VAULT_ADDR;
        const savedToken = process.env.VAULT_TOKEN;
        process.env.VAULT_ADDR = 'http://default:8200';
        process.env.VAULT_TOKEN = 'envtok';
        try {
            const v = createSecretManager({ provider: 'vault' });
            const origFetch = globalThis.fetch;
            const fetchMock = vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ data: { data: { value: 'e' } } }), { status: 200 }),
            );
            globalThis.fetch = fetchMock as never;
            expect(await v.getSecret('k')).toBe('e');
            globalThis.fetch = origFetch;
        } finally {
            if (savedAddr === undefined) delete process.env.VAULT_ADDR;
            else process.env.VAULT_ADDR = savedAddr;
            if (savedToken === undefined) delete process.env.VAULT_TOKEN;
            else process.env.VAULT_TOKEN = savedToken;
        }

        const noTok = createSecretManager({ provider: 'vault', endpoint: 'http://x' });
        await expect(noTok.getSecret('k')).rejects.toThrow(/no token/);
    });

    it('gcp: full name, short name, no payload, missing project', async () => {
        tryImportImpl = vi.fn(async (spec: string) => {
            if (spec.includes('@google-cloud/secret-manager')) {
                return {
                    SecretManagerServiceClient: class {
                        accessSecretVersion = gcpAccessMock;
                    },
                };
            }
            return null;
        });
        const gcp = createSecretManager({ provider: 'gcp', projectId: 'proj' });
        gcpAccessMock.mockResolvedValueOnce([{ payload: { data: Buffer.from('gv1') } }]);
        expect(await gcp.getSecret('my-secret')).toBe('gv1');

        gcpAccessMock.mockResolvedValueOnce([{ payload: { data: Buffer.from('gv2') } }]);
        expect(await gcp.getSecret('projects/other/secrets/s')).toBe('gv2');

        gcpAccessMock.mockResolvedValueOnce([{ payload: {} }]);
        await expect(gcp.getSecret('empty')).rejects.toThrow(/has no payload data/);

        const gcpNoProj = createSecretManager({ provider: 'gcp' });
        await expect(gcpNoProj.getSecret('x')).rejects.toThrow(/no project ID/);

        // missing module
        tryImportImpl = vi.fn(async () => null);
        const gcpNoMod = createSecretManager({ provider: 'gcp', projectId: 'p' });
        await expect(gcpNoMod.getSecret('x')).rejects.toThrow(/requires @google-cloud\/secret-manager/);
    });

    it('env adapter watch: swallows errors and fires on change', async () => {
        const savedKey = process.env['WATCH_KEY'];
        process.env['WATCH_KEY'] = 'one';
        try {
            const env = createSecretManager({ provider: 'env', prefix: '' });
            const cb = vi.fn();
            const w = env.watch('WATCH_KEY', cb, 10);
            await new Promise((r) => setTimeout(r, 20));
            process.env['WATCH_KEY'] = 'two';
            await new Promise((r) => setTimeout(r, 20));
            expect(cb).toHaveBeenCalledWith('two');
            w.stop();

            // error-swallowing watch (missing secret)
            const cb2 = vi.fn();
            const w2 = env.watch('DOES_NOT_EXIST', cb2, 10);
            await new Promise((r) => setTimeout(r, 25));
            expect(cb2).not.toHaveBeenCalled();
            w2.stop();
        } finally {
            if (savedKey === undefined) delete process.env['WATCH_KEY'];
            else process.env['WATCH_KEY'] = savedKey;
        }
    });
});

// ── config validator + file-loader edges ────────────────────────────────────

describe('config getConfigErrorHelp', () => {
    it('matches OPENAI, Database, and generic fallback', () => {
        expect(getConfigErrorHelp(new Error('OPENAI_API_KEY missing'))).toMatch(/OpenAI Configuration/);
        expect(getConfigErrorHelp(new Error('Database configuration error'))).toMatch(/Database Configuration Error/);
        expect(getConfigErrorHelp(new Error('random'))).toMatch(/Configuration Error/);
    });

    it('validateConfig reports postgres host/database and bad server port', () => {
        expect(() =>
            validateConfig({
                llm: { provider: 'openai', apiKey: 'k', model: 'm' },
                database: { type: 'postgres' },
                server: { port: 0, corsOrigins: [], nodeEnv: 'development', maxRequestSize: '1mb' },
                logging: { level: 'info', logRequests: true, enableMetrics: true },
                guardrails: { enabled: true, rateLimitingEnabled: true, rateLimitRequests: 1, rateLimitWindowMs: 1, maxMessageLength: 1 },
                resilience: { circuitBreakerEnabled: true, circuitBreakerFailureThreshold: 1, circuitBreakerResetTimeoutMs: 1, streamTimeoutMs: 1, maxAgentSteps: 1 },
                session: { timeoutMs: 1, cleanupIntervalMs: 1 },
            } as never),
        ).toThrow(/database.host/);

        expect(() =>
            validateConfig({
                llm: { provider: 'openai', apiKey: 'k', model: 'm' },
                database: { type: 'postgres', host: 'h' },
                server: { port: 70000, corsOrigins: [], nodeEnv: 'development', maxRequestSize: '1mb' },
                logging: { level: 'info', logRequests: true, enableMetrics: true },
                guardrails: { enabled: true, rateLimitingEnabled: true, rateLimitRequests: 1, rateLimitWindowMs: 1, maxMessageLength: 1 },
                resilience: { circuitBreakerEnabled: true, circuitBreakerFailureThreshold: 1, circuitBreakerResetTimeoutMs: 1, streamTimeoutMs: 1, maxAgentSteps: 1 },
                session: { timeoutMs: 1, cleanupIntervalMs: 1 },
            } as never),
        ).toThrow(/database.database/);

        expect(() =>
            validateConfig({
                llm: { provider: 'openai', apiKey: 'k', model: 'm' },
                database: { type: 'sqlite', sqlitePath: ':memory:' },
                server: { port: 99999, corsOrigins: [], nodeEnv: 'development', maxRequestSize: '1mb' },
                logging: { level: 'info', logRequests: true, enableMetrics: true },
                guardrails: { enabled: true, rateLimitingEnabled: true, rateLimitRequests: 1, rateLimitWindowMs: 1, maxMessageLength: 1 },
                resilience: { circuitBreakerEnabled: true, circuitBreakerFailureThreshold: 1, circuitBreakerResetTimeoutMs: 1, streamTimeoutMs: 1, maxAgentSteps: 1 },
                session: { timeoutMs: 1, cleanupIntervalMs: 1 },
            } as never),
        ).toThrow(/Server port must be between/);
    });
});

describe('config file-loader parse edge', () => {
    it('surfaces parse error detail for malformed JSONC', () => {
        // Temporarily redirect to a real file with a syntax error that jsonc-parser
        // reports as a ParseError (e.g. unterminated string) rather than throwing.
        const dir = mkdtempSync(join(tmpdir(), 'pf-parse-'));
        const file = join(dir, 'bad.jsonc');
        writeFileSync(file, '{"a": "unterminated}', 'utf8');
        try {
            expect(() => loadConfigFile(file)).toThrow(/not valid JSON\/JSONC/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
