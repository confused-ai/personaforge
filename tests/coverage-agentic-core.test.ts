/**
 * Hermetic coverage for src/agentic — structured-agent, zod-to-schema,
 * tool-types. Uses mock LLM; no network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createStructuredAgent, StructuredOutputError } from '../src/agentic/structured-agent.js';
import { zodToJsonSchema, toolToLLMDef } from '../src/agentic/_zod-to-schema.js';
import { toToolRegistry } from '../src/agentic/_tool-types.js';
import type { LLMProvider, Message, GenerateResult } from '../src/providers/types.js';

function queuedLLM(responses: GenerateResult[]): LLMProvider {
    let idx = 0;
    return {
        async generateText(_messages: Message[]): Promise<GenerateResult> {
            const r = responses[idx] ?? responses[responses.length - 1]!;
            if (idx < responses.length - 1) idx++;
            return r;
        },
    };
}

describe('agentic/structured-agent', () => {
    const ReviewSchema = z.object({
        sentiment: z.enum(['positive', 'neutral', 'negative']),
        score: z.number().min(0).max(10),
        summary: z.string().min(1),
    });

    it('returns validated data on first attempt', async () => {
        const agent = createStructuredAgent(ReviewSchema, {
            llm: queuedLLM([{ text: '{"sentiment":"positive","score":9,"summary":"great"}', finishReason: 'stop' }]),
            tools: toToolRegistry([]),
        });
        const { data, raw, attempts, retryErrors } = await agent.run({ prompt: 'Review it' });
        expect(data).toEqual({ sentiment: 'positive', score: 9, summary: 'great' });
        expect(attempts).toBe(1);
        expect(retryErrors).toEqual([]);
        expect(raw).toContain('positive');
        expect(agent.schema).toBe(ReviewSchema);
    });

    it('retries with correction prompt until valid', async () => {
        const agent = createStructuredAgent(ReviewSchema, {
            llm: queuedLLM([
                { text: 'not json', finishReason: 'stop' },
                { text: '{"sentiment":"neutral","score":5,"summary":"ok"}', finishReason: 'stop' },
            ]),
            tools: toToolRegistry([]),
            maxRetries: 3,
        });
        const { data, attempts } = await agent.run({ prompt: 'Review' });
        expect(attempts).toBe(2);
        expect(data).toMatchObject({ sentiment: 'neutral' });
    });

    it('throws StructuredOutputError after exhausting retries', async () => {
        const agent = createStructuredAgent(ReviewSchema, {
            llm: queuedLLM([{ text: 'bad', finishReason: 'stop' }]),
            tools: toToolRegistry([]),
            maxRetries: 1,
        });
        await expect(agent.run({ prompt: 'x' })).rejects.toBeInstanceOf(StructuredOutputError);
        await expect(agent.run({ prompt: 'x' })).rejects.toThrow(/Failed to get valid structured output/);
    });

    it('respects injectSchemaPrompt: false and per-run instructions', async () => {
        const llm = {
            generateText: vi.fn(async () => ({ text: '{"sentiment":"negative","score":1,"summary":"meh"}', finishReason: 'stop' as const })),
        };
        const agent = createStructuredAgent(ReviewSchema, { llm, tools: toToolRegistry([]), injectSchemaPrompt: false, instructions: 'base' });
        const { data } = await agent.run({ prompt: 'x' });
        expect(data.sentiment).toBe('negative');
        const sent = llm.generateText.mock.calls[0]![0] as Message[];
        expect(sent[0]?.content).not.toContain('Respond ONLY');
    });
});

describe('agentic/zod-to-schema', () => {
    it('prefers toJSONSchema', () => {
        const s = { toJSONSchema: () => ({ type: 'string', $schema: 'x' }) } as never;
        expect(zodToJsonSchema(s)).toEqual({ type: 'string' });
    });

    it('handles missing _def and primitive types', () => {
        expect(zodToJsonSchema({} as never)).toEqual({ type: 'object', additionalProperties: true });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodString', checks: [{ kind: 'min', value: 2 }, { kind: 'max', value: 5 }, { kind: 'email' }, { kind: 'url' }, { kind: 'regex', regex: { source: 'a+' } }] } } as never))
            .toMatchObject({ type: 'string', minLength: 2, maxLength: 5, format: 'uri', pattern: 'a+' });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodNumber', checks: [{ kind: 'min', value: 1 }, { kind: 'max', value: 9 }, { kind: 'int' }] } } as never))
            .toMatchObject({ type: 'integer', minimum: 1, maximum: 9 });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodBoolean', description: 'b' } } as never)).toEqual({ type: 'boolean', description: 'b' });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodBigInt' } } as never)).toEqual({ type: 'number' });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodDate' } } as never)).toEqual({ type: 'string', format: 'date-time' });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodUnknown' } } as never)).toEqual({});
        expect(zodToJsonSchema({ _def: { typeName: 'Mystery' } } as never)).toEqual({ type: 'object', additionalProperties: true });
    });

    it('handles array/object/enum/literal/optional/union/record/tuple/default', () => {
        const item = { _def: { typeName: 'ZodString' } };
        expect(zodToJsonSchema({ _def: { typeName: 'ZodArray', type: item, minLength: { value: 1 }, maxLength: { value: 3 }, description: 'arr' } } as never))
            .toMatchObject({ type: 'array', minItems: 1, maxItems: 3 });

        const shape = {
            req: { _def: { typeName: 'ZodString' } },
            opt: { _def: { typeName: 'ZodOptional', innerType: item } },
        };
        const obj = zodToJsonSchema({ _def: { typeName: 'ZodObject', shape, description: 'obj' } } as never) as { required?: string[]; properties: Record<string, unknown> };
        expect(obj.type).toBe('object');
        expect(obj.required).toContain('req');
        expect(obj.required).not.toContain('opt');
        // lazy function shape
        const lazyObj = zodToJsonSchema({ _def: { typeName: 'ZodObject', shape: () => ({ a: item }) } } as never) as { properties: Record<string, unknown> };
        expect(lazyObj.properties['a']).toBeTruthy();

        expect(zodToJsonSchema({ _def: { typeName: 'ZodEnum', values: ['a', 'b'] } } as never)).toMatchObject({ type: 'string', enum: ['a', 'b'] });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodLiteral', value: 7 } } as never)).toEqual({ const: 7 });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodOptional', innerType: item } } as never)).toEqual({ type: 'string' });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodUnion', options: [item, { _def: { typeName: 'ZodNumber' } }] } } as never))
            .toMatchObject({ oneOf: expect.any(Array) });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodDiscriminatedUnion', _innerTypes: [item] } } as never)).toMatchObject({ oneOf: expect.any(Array) });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodRecord', valueType: item } } as never)).toMatchObject({ type: 'object' });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodRecord' } } as never)).toMatchObject({ additionalProperties: true });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodTuple', items: [item, item] } } as never)).toMatchObject({ type: 'array', minItems: 2 });
        expect(zodToJsonSchema({ _def: { typeName: 'ZodDefault', innerType: item, defaultValue: 'x' } } as never)).toMatchObject({ type: 'string', default: 'x' });
    });

    it('toolToLLMDef converts a tool to LLMToolDefinition', () => {
        const def = toolToLLMDef({
            name: 'calc',
            description: 'Adds',
            parameters: { type: 'object', properties: { a: { type: 'number' } } },
        } as never);
        expect(def.name).toBe('calc');
        expect(def.parameters).toMatchObject({ type: 'object' });
    });
});
