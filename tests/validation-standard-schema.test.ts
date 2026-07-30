/**
 * Standard Schema validation — happy paths + edge coverage.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import * as v from 'valibot';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
    isSafeParseSchema,
    isStandardSchema,
    normalizeSchema,
    parse,
    parseAsync,
    safeValidate,
    safeValidateAsync,
    schemaToJsonSchema,
    fromSafeParseSchema,
    validate,
} from '../src/validation/index.js';
import { tool } from '../src/tools/core/tool-helper.js';
import { createStep, createWorkflow } from '../src/execution/workflow.js';
import {
    validateStructuredOutput,
    buildStructuredOutputPrompt,
} from '../src/agentic/_structured-output.js';
import { ValidationError } from '../src/contracts/errors.js';

describe('validation core', () => {
    it('detects Standard Schema on Zod 4', () => {
        expect(isStandardSchema(z.string())).toBe(true);
        expect(isStandardSchema(z.object({ a: z.number() }))).toBe(true);
    });

    it('detects Standard Schema on Valibot', () => {
        expect(isStandardSchema(v.string())).toBe(true);
        expect(isStandardSchema(v.object({ a: v.number() }))).toBe(true);
    });

    it('safeValidate works with Zod', () => {
        const schema = z.object({ name: z.string(), age: z.number().int() });
        const ok = safeValidate(schema, { name: 'Ada', age: 36 });
        expect(ok.success).toBe(true);
        if (ok.success) expect(ok.data).toEqual({ name: 'Ada', age: 36 });

        const bad = safeValidate(schema, { name: 'Ada', age: 'x' });
        expect(bad.success).toBe(false);
        if (!bad.success) expect(bad.error.message.length).toBeGreaterThan(0);
    });

    it('safeValidate works with Valibot', () => {
        const schema = v.object({
            name: v.string(),
            age: v.pipe(v.number(), v.integer()),
        });
        const ok = safeValidate(schema, { name: 'Ada', age: 36 });
        expect(ok.success).toBe(true);
        if (ok.success) expect(ok.data).toEqual({ name: 'Ada', age: 36 });

        const bad = safeValidate(schema, { name: 1 });
        expect(bad.success).toBe(false);
    });

    it('parse throws ValidationError on failure', () => {
        expect(() => parse(z.string(), 123)).toThrow(ValidationError);
    });

    it('validate is an alias for parse', () => {
        expect(validate(z.number(), 7)).toBe(7);
        expect(() => validate(z.number(), 'x')).toThrow(ValidationError);
    });

    it('wraps legacy safeParse schemas via normalizeSchema', () => {
        const legacy = {
            safeParse(input: unknown) {
                if (typeof input === 'string') return { success: true as const, data: input };
                return { success: false as const, error: { message: 'expected string' } };
            },
        };
        const normalized = normalizeSchema(legacy);
        expect(isStandardSchema(normalized)).toBe(true);
        expect(safeValidate(normalized, 'hi').success).toBe(true);
        expect(safeValidate(fromSafeParseSchema(legacy), 1).success).toBe(false);
    });

    it('schemaToJsonSchema converts Zod objects', () => {
        const schema = z.object({
            location: z.string().describe('City'),
            unit: z.enum(['c', 'f']).optional(),
        });
        const json = schemaToJsonSchema(schema);
        expect(json['type']).toBe('object');
        expect(json['properties']).toBeDefined();
    });
});

describe('validation edges — detectors & normalize', () => {
    it('isStandardSchema rejects null/primitive/empty object', () => {
        expect(isStandardSchema(null)).toBe(false);
        expect(isStandardSchema(undefined)).toBe(false);
        expect(isStandardSchema(42)).toBe(false);
        expect(isStandardSchema('x')).toBe(false);
        expect(isStandardSchema({})).toBe(false);
        expect(isStandardSchema({ '~standard': null })).toBe(false);
        expect(isStandardSchema({ '~standard': { validate: 'nope' } })).toBe(false);
    });

    it('isSafeParseSchema rejects non-objects and missing safeParse', () => {
        expect(isSafeParseSchema(null)).toBe(false);
        expect(isSafeParseSchema({})).toBe(false);
        expect(isSafeParseSchema({ safeParse: 1 })).toBe(false);
        expect(isSafeParseSchema({ safeParse: () => ({ success: true, data: 1 }) })).toBe(true);
    });

    it('normalizeSchema throws on invalid schema', () => {
        expect(() => normalizeSchema({} as never)).toThrow(/Invalid schema/);
        expect(() => normalizeSchema(null as never)).toThrow(/Invalid schema/);
    });

    it('fromSafeParseSchema is idempotent when ~standard already exists', () => {
        const legacy = {
            safeParse(input: unknown) {
                return typeof input === 'number'
                    ? { success: true as const, data: input }
                    : { success: false as const, error: { message: 'num' } };
            },
        };
        const once = fromSafeParseSchema(legacy);
        const twice = fromSafeParseSchema(once);
        expect(twice).toBe(once);
        expect(safeValidate(twice, 3).success).toBe(true);
    });

    it('fromSafeParseSchema passes through real Standard Schema', () => {
        const zod = z.string();
        expect(fromSafeParseSchema(zod as never)).toBe(zod);
    });
});

describe('validation edges — async & Promise schemas', () => {
    function makeAsyncSchema(okValue: unknown): StandardSchemaV1 {
        return {
            '~standard': {
                version: 1,
                vendor: 'test-async',
                validate(value: unknown) {
                    return Promise.resolve(
                        value === okValue
                            ? { value }
                            : { issues: [{ message: 'async mismatch' }] },
                    );
                },
            },
        };
    }

    it('safeValidate throws when validate() returns a Promise', () => {
        const schema = makeAsyncSchema('ok');
        expect(() => safeValidate(schema, 'ok')).toThrow(/safeValidateAsync/);
    });

    it('safeValidateAsync handles Promise validate success/failure', async () => {
        const schema = makeAsyncSchema('ok');
        const ok = await safeValidateAsync(schema, 'ok');
        expect(ok.success).toBe(true);
        if (ok.success) expect(ok.data).toBe('ok');

        const bad = await safeValidateAsync(schema, 'no');
        expect(bad.success).toBe(false);
        if (!bad.success) expect(bad.error.message).toContain('async mismatch');
    });

    it('safeValidateAsync works with sync Standard Schema too', async () => {
        const ok = await safeValidateAsync(z.string(), 'hi');
        expect(ok.success).toBe(true);
    });

    it('parseAsync throws ValidationError on failure', async () => {
        await expect(parseAsync(z.number(), 'x')).rejects.toBeInstanceOf(ValidationError);
        await expect(parseAsync(makeAsyncSchema(1), 2)).rejects.toBeInstanceOf(ValidationError);
        await expect(parseAsync(makeAsyncSchema(1), 1)).resolves.toBe(1);
    });
});

describe('validation edges — issue path formatting', () => {
    it('formats nested property paths from Zod', () => {
        const schema = z.object({
            user: z.object({ email: z.string().email() }),
        });
        const bad = safeValidate(schema, { user: { email: 'not-an-email' } });
        expect(bad.success).toBe(false);
        if (!bad.success) {
            expect(bad.issues.length).toBeGreaterThan(0);
            expect(bad.error.message).toMatch(/email|user/i);
        }
    });

    it('formats PathSegment { key } objects', async () => {
        const schema: StandardSchemaV1 = {
            '~standard': {
                version: 1,
                vendor: 'test-path',
                validate() {
                    return {
                        issues: [
                            {
                                message: 'required',
                                path: [{ key: 'a' }, { key: 'b' }, 'c'],
                            },
                        ],
                    };
                },
            },
        };
        const bad = safeValidate(schema, {});
        expect(bad.success).toBe(false);
        if (!bad.success) {
            expect(bad.error.message).toBe('a.b.c: required');
        }
    });

    it('formats empty issues as validation failed', () => {
        const schema: StandardSchemaV1 = {
            '~standard': {
                version: 1,
                vendor: 'test-empty',
                validate() {
                    return { issues: [] };
                },
            },
        };
        const bad = safeValidate(schema, 1);
        expect(bad.success).toBe(false);
        if (!bad.success) expect(bad.error.message).toBe('validation failed');
    });
});

describe('validation edges — schemaToJsonSchema', () => {
    it('strips $schema/$id meta', () => {
        const schema = {
            safeParse: () => ({ success: true as const, data: {} }),
            toJSONSchema: () => ({
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                $id: 'x',
                type: 'object',
                properties: { a: { type: 'string' } },
            }),
        };
        const json = schemaToJsonSchema(schema);
        expect(json['$schema']).toBeUndefined();
        expect(json['$id']).toBeUndefined();
        expect(json['type']).toBe('object');
    });

    it('prefers Standard JSON Schema input/output (value or thunk)', () => {
        const withInput = {
            '~standard': {
                version: 1 as const,
                vendor: 'test',
                validate: () => ({ value: null }),
                jsonSchema: {
                    input: { type: 'string', title: 'in' },
                },
            },
        };
        expect(schemaToJsonSchema(withInput as never)['title']).toBe('in');

        const withThunk = {
            '~standard': {
                version: 1 as const,
                vendor: 'test',
                validate: () => ({ value: null }),
                jsonSchema: {
                    output: () => ({ type: 'number', title: 'out' }),
                },
            },
        };
        expect(schemaToJsonSchema(withThunk as never)['title']).toBe('out');
    });

    it('uses duck-typed toJsonSchema when toJSONSchema missing', () => {
        const schema = {
            safeParse: () => ({ success: true as const, data: 1 }),
            toJsonSchema: () => ({ type: 'boolean', title: 'boolish' }),
        };
        expect(schemaToJsonSchema(schema)['title']).toBe('boolish');
    });

    it('converts Zod v3 object with lazy shape function', () => {
        const schema = z3.object({
            orderId: z3.string().describe('Order id like W1001'),
        });
        const json = schemaToJsonSchema(schema as never) as {
            type?: string;
            properties?: Record<string, { type?: string; description?: string }>;
            required?: string[];
        };
        expect(json.type).toBe('object');
        expect(json.properties?.orderId?.type).toBe('string');
        expect(json.properties?.orderId?.description).toBe('Order id like W1001');
        expect(json.required).toContain('orderId');
    });

    it('throws when conversion is impossible', () => {
        const bare: StandardSchemaV1 = {
            '~standard': {
                version: 1,
                vendor: 'no-json',
                validate: () => ({ value: 1 }),
            },
        };
        expect(() => schemaToJsonSchema(bare)).toThrow(/Unable to convert schema/);
    });
});

describe('tool() with multiple schema libraries', () => {
    it('validates input/output with Zod', async () => {
        const t = tool({
            name: 'addZod',
            description: 'add',
            parameters: z.object({ a: z.number(), b: z.number() }),
            outputSchema: z.object({ sum: z.number() }),
            execute: async ({ a, b }) => ({ sum: a + b }),
        });
        const ok = await t.execute({ a: 1, b: 2 });
        expect(ok.success).toBe(true);
        expect(ok.data).toEqual({ sum: 3 });

        const bad = await t.execute({ a: 'x', b: 2 } as never);
        expect(bad.success).toBe(false);
        expect(bad.error?.code).toBe('VALIDATION_ERROR');
    });

    it('validates input/output with Valibot', async () => {
        const t = tool({
            name: 'addValibot',
            description: 'add',
            parameters: v.object({ a: v.number(), b: v.number() }),
            outputSchema: v.object({ sum: v.number() }),
            execute: async (params) => {
                const { a, b } = params as { a: number; b: number };
                return { sum: a + b };
            },
        });
        const ok = await t.execute({ a: 2, b: 3 } as never);
        expect(ok.success).toBe(true);
        expect(ok.data).toEqual({ sum: 5 });

        const badOut = tool({
            name: 'badOut',
            description: 'bad',
            parameters: v.object({ x: v.number() }),
            outputSchema: v.object({ sum: v.number() }),
            execute: async () => ({ sum: 'nope' as unknown as number }),
        });
        const result = await badOut.execute({ x: 1 } as never);
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('OUTPUT_VALIDATION_ERROR');
    });
});

describe('tool() edges', () => {
    it('validate() returns success/failure without executing', () => {
        const t = tool({
            name: 'v',
            description: 'v',
            parameters: z.object({ n: z.number() }),
            execute: async () => {
                throw new Error('should not run');
            },
        });
        expect(t.validate({ n: 1 }).success).toBe(true);
        expect(t.validate({ n: 'x' }).success).toBe(false);
    });

    it('toJSONSchema wraps Zod parameters for LLM function calling', () => {
        const t = tool({
            name: 'lookup',
            description: 'Look up',
            parameters: z.object({ id: z.string() }),
            execute: async ({ id }) => ({ id }),
        });
        const json = t.toJSONSchema() as {
            type: string;
            function: { name: string; parameters: { type?: string; properties?: Record<string, unknown> } };
        };
        expect(json.type).toBe('function');
        expect(json.function.name).toBe('lookup');
        expect(json.function.parameters.properties).toBeDefined();
    });

    it('beforeExecute cancel still returns CANCELLED after input validation', async () => {
        const t = tool({
            name: 'c',
            description: 'c',
            parameters: z.object({ x: z.number() }),
            beforeExecute: async () => false,
            execute: async () => ({ ok: true }),
        });
        const result = await t.execute({ x: 1 });
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('CANCELLED');
    });

    it('accepts legacy safeParse-only parameter schema', async () => {
        const legacy = {
            safeParse(input: unknown) {
                if (input && typeof input === 'object' && 'q' in (input as object)) {
                    return { success: true as const, data: input as { q: string } };
                }
                return { success: false as const, error: { message: 'need q' } };
            },
        };
        const t = tool({
            name: 'legacy',
            description: 'legacy',
            parameters: legacy as never,
            execute: async (p) => p,
        });
        const ok = await t.execute({ q: 'hi' } as never);
        expect(ok.success).toBe(true);
        const bad = await t.execute({} as never);
        expect(bad.success).toBe(false);
        expect(bad.error?.code).toBe('VALIDATION_ERROR');
    });
});

describe('workflow edges — Standard Schema I/O', () => {
    it('rejects invalid workflow input', async () => {
        const step = createStep({
            id: 'echo',
            inputSchema: z.object({ n: z.number() }),
            outputSchema: z.object({ n: z.number() }),
            execute: async ({ input }) => input,
        });
        const wf = createWorkflow({
            id: 'wf-in',
            inputSchema: z.object({ n: z.number() }),
        })
            .then(step)
            .commit();

        const result = await wf.execute({ n: 'bad' } as never);
        expect(result.status).toBe('failed');
        expect(result.error?.message).toMatch(/input validation failed/i);
    });

    it('rejects invalid step output', async () => {
        const step = createStep({
            id: 'bad-out',
            inputSchema: z.object({ n: z.number() }),
            outputSchema: z.object({ n: z.number() }),
            execute: async () => ({ n: 'nope' as unknown as number }),
        });
        const wf = createWorkflow({
            id: 'wf-out',
            inputSchema: z.object({ n: z.number() }),
        })
            .then(step)
            .commit();

        const result = await wf.execute({ n: 1 });
        expect(result.status).toBe('failed');
        expect(result.error?.message).toMatch(/output validation failed/i);
    });

    it('accepts Valibot schemas on steps', async () => {
        const step = createStep({
            id: 'double',
            inputSchema: v.object({ n: v.number() }),
            outputSchema: v.object({ n: v.number() }),
            execute: async ({ input }) => {
                const { n } = input as { n: number };
                return { n: n * 2 };
            },
        });
        const wf = createWorkflow({
            id: 'wf-valibot',
            inputSchema: v.object({ n: v.number() }),
        })
            .then(step as never)
            .commit();

        const result = await wf.execute({ n: 4 } as never);
        expect(result.status).toBe('success');
        expect(result.result).toEqual({ n: 8 });
    });
});

describe('structured output edges', () => {
    it('validates JSON from fenced code blocks', () => {
        const result = validateStructuredOutput(
            'Here you go:\n```json\n{"ok":true}\n```',
            { schema: z.object({ ok: z.boolean() }) },
        );
        expect(result.validated).toBe(true);
        expect(result.data).toEqual({ ok: true });
    });

    it('returns validated=false with issues on schema mismatch', () => {
        const result = validateStructuredOutput('{"ok":1}', {
            schema: z.object({ ok: z.boolean() }),
        });
        expect(result.validated).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns validated=false when JSON cannot be extracted', () => {
        const result = validateStructuredOutput('not json at all', {
            schema: z.object({ ok: z.boolean() }),
        });
        expect(result.validated).toBe(false);
        expect(result.errors[0]).toMatch(/Failed to extract|parse/i);
    });

    it('buildStructuredOutputPrompt embeds JSON Schema', () => {
        const prompt = buildStructuredOutputPrompt({
            schema: z.object({ answer: z.string() }),
            description: 'Reply as JSON',
        });
        expect(prompt).toContain('Reply as JSON');
        expect(prompt).toContain('"answer"');
        expect(prompt).toContain('```json');
    });

    it('validates Valibot response models', () => {
        const result = validateStructuredOutput('{"score":9}', {
            schema: v.object({ score: v.number() }),
        });
        expect(result.validated).toBe(true);
        expect(result.data).toEqual({ score: 9 });
    });
});
