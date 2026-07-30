/**
 * Hermetic coverage for providers (zod/bedrock/embeddings) + playground.
 * tests include glob: tests/coverage-remaining-*.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import Module from 'node:module';
import { zodToJsonSchema, toolToLLMDef } from '../src/providers/zod-to-schema.js';
import { BedrockConverseProvider } from '../src/providers/bedrock-provider.js';
import { OpenAIEmbeddingProvider } from '../src/providers/openai-embedding-provider.js';
import { createPlayground } from '../src/playground/server.js';
import { getPlaygroundHtml } from '../src/playground/_ui.js';

describe('zodToJsonSchema + toolToLLMDef', () => {
    it('uses toJSONSchema when present and strips $schema', () => {
        const schema = {
            toJSONSchema: () => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' }),
        } as any;
        expect(zodToJsonSchema(schema)).toEqual({ type: 'string' });
    });

    it('covers Zod3-style _def branches', () => {
        const str = {
            _def: {
                typeName: 'ZodString',
                description: 's',
                checks: [
                    { kind: 'min', value: 1 },
                    { kind: 'max', value: 9 },
                    { kind: 'email' },
                    { kind: 'url' },
                    { kind: 'regex', regex: /ab+/ },
                ],
            },
        };
        expect(zodToJsonSchema(str as any)).toMatchObject({
            type: 'string',
            format: 'uri',
            minLength: 1,
            maxLength: 9,
            pattern: 'ab+',
        });

        expect(
            zodToJsonSchema({
                _def: {
                    typeName: 'ZodNumber',
                    description: 'n',
                    checks: [{ kind: 'min', value: 0 }, { kind: 'max', value: 10 }, { kind: 'int' }],
                },
            } as any),
        ).toMatchObject({ type: 'integer', minimum: 0, maximum: 10 });

        expect(zodToJsonSchema({ _def: { typeName: 'ZodBoolean', description: 'b' } } as any).type).toBe(
            'boolean',
        );
        expect(zodToJsonSchema({ _def: { typeName: 'ZodBigInt' } } as any).type).toBe('number');
        expect(zodToJsonSchema({ _def: { typeName: 'ZodDate', description: 'd' } } as any).format).toBe(
            'date-time',
        );

        const inner = { _def: { typeName: 'ZodString' } };
        expect(
            zodToJsonSchema({
                _def: { typeName: 'ZodArray', type: inner, description: 'arr', minLength: { value: 1 }, maxLength: { value: 3 } },
            } as any),
        ).toMatchObject({ type: 'array', minItems: 1, maxItems: 3 });

        const opt = { _def: { typeName: 'ZodOptional', innerType: inner } };
        const obj = zodToJsonSchema({
            _def: {
                typeName: 'ZodObject',
                description: 'o',
                shape: {
                    a: inner,
                    b: opt,
                },
            },
        } as any);
        expect(obj.required).toEqual(['a']);
        expect((obj.properties as any).a.type).toBe('string');

        expect(
            zodToJsonSchema({ _def: { typeName: 'ZodEnum', values: ['x', 'y'], description: 'e' } } as any),
        ).toMatchObject({ enum: ['x', 'y'] });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodLiteral', value: 3 } } as any).const).toBe(3);
        expect(zodToJsonSchema({ _def: { typeName: 'ZodNullable', innerType: inner } } as any).type).toBe(
            'string',
        );
        expect(
            zodToJsonSchema({
                _def: { typeName: 'ZodUnion', options: [inner, { _def: { typeName: 'ZodNumber' } }] },
            } as any).oneOf,
        ).toHaveLength(2);
        expect(
            zodToJsonSchema({
                _def: { typeName: 'ZodRecord', valueType: inner, description: 'r' },
            } as any).additionalProperties,
        ).toEqual({ type: 'string' });
        expect(
            zodToJsonSchema({
                _def: { typeName: 'ZodTuple', items: [inner, { _def: { typeName: 'ZodBoolean' } }] },
            } as any),
        ).toMatchObject({ minItems: 2, maxItems: 2 });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodAny', description: 'any' } } as any)).toEqual({
            description: 'any',
        });
        expect(
            zodToJsonSchema({
                _def: { typeName: 'ZodDefault', innerType: inner, defaultValue: 'x' },
            } as any).default,
        ).toBe('x');
        expect(zodToJsonSchema({ _def: { typeName: 'ZodUnknownCustom' } } as any)).toEqual({
            type: 'object',
            additionalProperties: true,
        });
        expect(zodToJsonSchema({} as any)).toEqual({ type: 'object', additionalProperties: true });

        const def = toolToLLMDef({
            name: 't',
            description: 'd',
            parameters: { _def: { typeName: 'ZodObject', shape: { q: inner } } },
            execute: async () => null,
        } as any);
        expect(def.name).toBe('t');
        expect(def.parameters.type).toBe('object');
    });
});

describe('BedrockConverseProvider', () => {
    it('generateText and streamText with injected client', async () => {
        const client = {
            send: vi.fn(async (cmd: any) => {
                const name = cmd?.constructor?.name ?? '';
                if (name.includes('Stream') || cmd?.__stream) {
                    return {
                        stream: (async function* () {
                            yield { contentBlockDelta: { delta: { text: 'hi' } } };
                            yield { contentBlockDelta: { delta: { text: '!' } } };
                        })(),
                    };
                }
                return {
                    output: { message: { content: [{ text: 'hello' }] } },
                    usage: { inputTokens: 1, outputTokens: 2 },
                    stopReason: 'end_turn',
                };
            }),
        };

        // Inject fake AWS SDK module via dynamic import mock is hard; use client + stub import
        // by constructing with client and mocking the command classes on the module cache.
        const Mod = Module as any;
        const originalLoad = Mod._load;
        Mod._load = function (request: string, parent: unknown, isMain: boolean) {
            if (request === '@aws-sdk/client-bedrock-runtime') {
                class ConverseCommand {
                    constructor(public input: unknown) {}
                }
                class ConverseStreamCommand {
                    __stream = true;
                    constructor(public input: unknown) {}
                }
                class BedrockRuntimeClient {
                    constructor(_cfg: unknown) {}
                    send = client.send;
                }
                return { ConverseCommand, ConverseStreamCommand, BedrockRuntimeClient };
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        try {
            const p = new BedrockConverseProvider({
                region: 'us-east-1',
                modelId: 'm',
                client: client as any,
            });
            const out = await p.generateText([
                { role: 'system', content: 'sys' },
                { role: 'user', content: 'u' },
                { role: 'assistant', content: 'a' },
                { role: 'tool', content: 'tool-out', tool_call_id: '1' } as any,
                { role: 'user', content: [{ type: 'text', text: 'parts' }] as any },
            ]);
            expect(out.text).toBe('hello');
            expect(out.usage?.totalTokens).toBe(3);

            const chunks: string[] = [];
            client.send.mockImplementationOnce(async () => ({
                stream: (async function* () {
                    yield { contentBlockDelta: { delta: { text: 'hi' } } };
                    yield { contentBlockDelta: { delta: { text: '!' } } };
                })(),
            }));
            const streamed = await p.streamText([{ role: 'user', content: 'x' }], {
                onChunk: (c) => chunks.push(c),
            });
            expect(streamed.text).toBe('hi!');
            expect(chunks.join('')).toBe('hi!');
        } finally {
            Mod._load = originalLoad;
        }
    });
});

describe('OpenAIEmbeddingProvider', () => {
    it('embed / embedBatch / getDimension with injected client', async () => {
        const client = {
            embeddings: {
                create: vi.fn(async ({ input }: { input: string | string[] }) => {
                    if (Array.isArray(input)) {
                        return {
                            data: input.map((_, i) => ({ embedding: [i, 1], index: i })),
                            model: 'text-embedding-3-small',
                            usage: { prompt_tokens: 1, total_tokens: 1 },
                        };
                    }
                    return {
                        data: [{ embedding: [0.1, 0.2] }],
                        model: 'text-embedding-3-small',
                        usage: { prompt_tokens: 1, total_tokens: 1 },
                    };
                }),
            },
        };
        const p = new OpenAIEmbeddingProvider({ client: client as any, model: 'text-embedding-3-small' });
        expect(p.getDimension()).toBe(1536);
        expect(await p.embed('hi')).toEqual([0.1, 0.2]);
        expect(await p.embedBatch([])).toEqual([]);
        expect(await p.embedBatch(['a'])).toEqual([[0.1, 0.2]]);
        expect(await p.embedBatch(['a', 'b'])).toEqual([
            [0, 1],
            [1, 1],
        ]);

        const large = new OpenAIEmbeddingProvider({
            client: client as any,
            model: 'text-embedding-3-large',
            debug: true,
        });
        expect(large.getDimension()).toBe(3072);

        client.embeddings.create.mockRejectedValueOnce(new Error('fail'));
        await expect(p.embed('x')).rejects.toThrow('fail');

        expect(() => new OpenAIEmbeddingProvider({})).toThrow(/apiKey/);
    });
});

describe('playground', () => {
    it('getPlaygroundHtml escapes title and embeds agent names', () => {
        const html = getPlaygroundHtml('T <script>', ['agent-a', 'agent-b']);
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('agent-a');
    });

    it('createPlayground serves UI, chat, agents, metrics, health', async () => {
        await expect(createPlayground([])).rejects.toThrow(/at least one agent/);

        const svc = await createPlayground(
            [
                { name: 'alpha', run: async (p) => `echo:${p}` },
                {
                    name: 'boom',
                    run: async () => {
                        throw new Error('nope');
                    },
                },
            ],
            { port: 0, host: '127.0.0.1', title: 'Test PG', enableWebSocket: false },
        );

        const base = `http://127.0.0.1:${svc.port}`;
        try {
            const ui = await fetch(`${base}/`);
            expect(ui.status).toBe(200);
            expect(await ui.text()).toContain('Test PG');

            const agents = await fetch(`${base}/api/agents`);
            expect((await agents.json()).agents).toEqual(['alpha', 'boom']);

            const chat = await fetch(`${base}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent: 'alpha', message: ' hi ' }),
            });
            expect(await chat.json()).toEqual({ agent: 'alpha', text: 'echo:hi' });

            expect(
                (
                    await fetch(`${base}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: '{',
                    })
                ).status,
            ).toBe(400);
            expect(
                (
                    await fetch(`${base}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ agent: 'missing', message: 'x' }),
                    })
                ).status,
            ).toBe(400);
            expect(
                (
                    await fetch(`${base}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ agent: 'alpha', message: '   ' }),
                    })
                ).status,
            ).toBe(400);
            expect(
                (
                    await fetch(`${base}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ agent: 'boom', message: 'x' }),
                    })
                ).status,
            ).toBe(500);

            const metrics = await fetch(`${base}/metrics`);
            expect(await metrics.text()).toContain('playground_requests_total');

            expect((await fetch(`${base}/health`)).status).toBe(200);
            expect((await fetch(`${base}/nope`)).status).toBe(404);
        } finally {
            await svc.stop();
        }
    });
});
