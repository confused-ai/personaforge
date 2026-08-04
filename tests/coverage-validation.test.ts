/**
 * Hermetic coverage for src/validation — normalize, validate, to-json-schema, zod-json-schema.
 * Callers: bunx vitest run tests/coverage-*.test.ts. No production imports.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    isStandardSchema,
    isSafeParseSchema,
    fromSafeParseSchema,
    normalizeSchema,
    safeValidate,
    safeValidateAsync,
    parse,
    parseAsync,
    validate,
    schemaToJsonSchema,
    zodToJsonSchema,
} from '../src/validation/index.js';
import { ValidationError } from '../src/contracts/errors.js';

describe('validation/normalize', () => {
    it('isStandardSchema / isSafeParseSchema guards', () => {
        expect(isStandardSchema(null)).toBe(false);
        expect(isStandardSchema({})).toBe(false);
        expect(isStandardSchema({ '~standard': null })).toBe(false);
        expect(isStandardSchema({ '~standard': {} })).toBe(false);
        expect(isSafeParseSchema(null)).toBe(false);
        expect(isSafeParseSchema({})).toBe(false);

        const std = {
            '~standard': { version: 1 as const, vendor: 't', validate: () => ({ value: 1 }) },
        };
        expect(isStandardSchema(std)).toBe(true);
        expect(isSafeParseSchema({ safeParse: () => ({ success: true, data: 1 }) })).toBe(true);
    });

    it('fromSafeParseSchema wraps once and passes Standard through', () => {
        const legacy = {
            safeParse(input: unknown) {
                if (typeof input === 'string') return { success: true as const, data: input };
                return { success: false as const, error: { message: 'need string' } };
            },
        };
        const wrapped = fromSafeParseSchema(legacy);
        expect(wrapped['~standard']?.vendor).toBe('personaforge-safeparse');
        expect(wrapped['~standard']!.validate('hi')).toEqual({ value: 'hi' });
        expect(wrapped['~standard']!.validate(1)).toEqual({
            issues: [{ message: 'need string' }],
        });
        expect(fromSafeParseSchema(wrapped)['~standard']).toBe(wrapped['~standard']);

        const already = z.string();
        expect(fromSafeParseSchema(already as never)).toBe(already);
    });

    it('normalizeSchema accepts Standard / safeParse and rejects invalid', () => {
        expect(normalizeSchema(z.number())).toBeTruthy();
        expect(
            normalizeSchema({
                safeParse: () => ({ success: true as const, data: 1 }),
            }),
        ).toBeTruthy();
        expect(() => normalizeSchema({} as never)).toThrow(/Invalid schema/);
    });
});

describe('validation/validate', () => {
    it('safeValidate success and failure with path formatting', () => {
        const schema = z.object({ user: z.object({ email: z.string().email() }) });
        expect(safeValidate(schema, { user: { email: 'a@b.co' } }).success).toBe(true);
        const bad = safeValidate(schema, { user: { email: 'nope' } });
        expect(bad.success).toBe(false);
        if (!bad.success) {
            expect(bad.error.message.length).toBeGreaterThan(0);
            expect(bad.issues.length).toBeGreaterThan(0);
        }
    });

    it('formatIssues path segments as objects and empty issues', () => {
        const schema = {
            '~standard': {
                version: 1 as const,
                vendor: 't',
                validate: () => ({
                    issues: [
                        { message: 'x', path: [{ key: 'a' }, 'b'] },
                        { message: 'y' },
                    ],
                }),
            },
        };
        const bad = safeValidate(schema as never, {});
        expect(bad.success).toBe(false);
        if (!bad.success) expect(bad.error.message).toContain('a.b: x');

        const empty = {
            '~standard': {
                version: 1 as const,
                vendor: 't',
                validate: () => ({ issues: [] }),
            },
        };
        const emptyBad = safeValidate(empty as never, 1);
        expect(emptyBad.success).toBe(false);
        if (!emptyBad.success) expect(emptyBad.error.message).toBe('validation failed');
    });

    it('safeValidate rejects Promise validate; async handles both', async () => {
        const asyncSchema = {
            '~standard': {
                version: 1 as const,
                vendor: 't',
                validate: async (v: unknown) =>
                    typeof v === 'string' ? { value: v } : { issues: [{ message: 'no' }] },
            },
        };
        expect(() => safeValidate(asyncSchema as never, 'ok')).toThrow(/safeValidateAsync/);
        expect((await safeValidateAsync(asyncSchema as never, 'ok')).success).toBe(true);
        expect((await safeValidateAsync(asyncSchema as never, 1)).success).toBe(false);
        expect((await safeValidateAsync(z.string(), 'hi')).success).toBe(true);
    });

    it('parse / parseAsync / validate throw ValidationError', async () => {
        expect(parse(z.string(), 'hi')).toBe('hi');
        expect(validate(z.number(), 3)).toBe(3);
        expect(() => parse(z.string(), 1)).toThrow(ValidationError);
        expect(() => parse(z.string(), 1, 'custom detail')).toThrow(/custom detail/);
        await expect(parseAsync(z.string(), 'ok')).resolves.toBe('ok');
        await expect(parseAsync(z.string(), 1)).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('validation/schemaToJsonSchema', () => {
    it('uses Standard jsonSchema input/output and duck-typed converters', () => {
        expect(
            schemaToJsonSchema({
                '~standard': {
                    version: 1,
                    vendor: 't',
                    validate: () => ({ value: null }),
                    jsonSchema: { input: { type: 'string', $schema: 'x', $id: 'y' } },
                },
            } as never),
        ).toEqual({ type: 'string' });

        expect(
            schemaToJsonSchema({
                '~standard': {
                    version: 1,
                    vendor: 't',
                    validate: () => ({ value: null }),
                    jsonSchema: { output: () => ({ type: 'number' }) },
                },
            } as never),
        ).toEqual({ type: 'number' });

        expect(
            schemaToJsonSchema({
                toJSONSchema: () => ({ type: 'boolean', $schema: 'x' }),
            } as never),
        ).toEqual({ type: 'boolean' });

        expect(
            schemaToJsonSchema({
                toJsonSchema: () => ({ type: 'integer' }),
            } as never),
        ).toEqual({ type: 'integer' });
    });

    it('falls back to zod converter for safeParse+_def and throws otherwise', () => {
        const json = schemaToJsonSchema(z.object({ n: z.number() }));
        expect(json['type']).toBe('object');

        expect(() =>
            schemaToJsonSchema({
                '~standard': { version: 1, vendor: 't', validate: () => ({ value: 1 }) },
            } as never),
        ).toThrow(/Unable to convert/);
    });
});

describe('validation/zodToJsonSchema branches', () => {
    function withDef(typeName: string, extra: Record<string, unknown> = {}) {
        return {
            _def: { typeName, ...extra },
            safeParse: () => ({ success: true as const, data: null }),
        } as never;
    }

    it('prefers native toJSONSchema when present', () => {
        const schema = {
            toJSONSchema: () => ({ type: 'string', $schema: 'draft' }),
        } as never;
        expect(zodToJsonSchema(schema)).toEqual({ type: 'string' });
    });

    it('covers primitive and composite Zod3-style defs', () => {
        expect(zodToJsonSchema(withDef('ZodString', {
            description: 's',
            checks: [
                { kind: 'min', value: 1 },
                { kind: 'max', value: 9 },
                { kind: 'email' },
                { kind: 'url' },
                { kind: 'regex', regex: { source: 'a+' } },
            ],
        }))).toMatchObject({
            type: 'string',
            minLength: 1,
            maxLength: 9,
            format: 'uri',
            pattern: 'a+',
        });

        expect(zodToJsonSchema(withDef('ZodNumber', {
            description: 'n',
            checks: [
                { kind: 'min', value: 0 },
                { kind: 'max', value: 10 },
                { kind: 'int' },
            ],
        }))).toMatchObject({ type: 'integer', minimum: 0, maximum: 10 });

        expect(zodToJsonSchema(withDef('ZodBoolean', { description: 'b' }))).toEqual({
            type: 'boolean',
            description: 'b',
        });
        expect(zodToJsonSchema(withDef('ZodBigInt'))).toEqual({ type: 'number' });
        expect(zodToJsonSchema(withDef('ZodDate'))).toEqual({ type: 'string', format: 'date-time' });

        const item = withDef('ZodString');
        expect(zodToJsonSchema(withDef('ZodArray', {
            type: item,
            minLength: { value: 1 },
            maxLength: { value: 3 },
            description: 'arr',
        }))).toMatchObject({ type: 'array', minItems: 1, maxItems: 3 });

        const shape = {
            req: withDef('ZodString'),
            opt: withDef('ZodOptional', { innerType: withDef('ZodString') }),
            nul: withDef('ZodNullable', { innerType: withDef('ZodNumber') }),
        };
        const obj = zodToJsonSchema(withDef('ZodObject', {
            shape,
            description: 'obj',
        })) as { required?: string[]; properties: Record<string, unknown>; type?: string };
        expect(obj.type).toBe('object');
        expect(obj.required).toContain('req');
        expect(obj.required).not.toContain('opt');

        const lazy = zodToJsonSchema(withDef('ZodObject', {
            shape: () => ({ a: withDef('ZodString') }),
        })) as { properties: Record<string, unknown> };
        expect(lazy.properties['a']).toBeTruthy();

        expect(zodToJsonSchema(withDef('ZodEnum', { values: ['a', 'b'] }))).toMatchObject({
            type: 'string',
            enum: ['a', 'b'],
        });
        expect(zodToJsonSchema(withDef('ZodLiteral', { value: 3 }))).toEqual({ const: 3 });

        expect(zodToJsonSchema(withDef('ZodOptional'))).toEqual({
            type: 'object',
            additionalProperties: true,
        });
        expect(zodToJsonSchema(withDef('ZodOptional', { innerType: withDef('ZodBoolean') }))).toEqual({
            type: 'boolean',
        });

        expect(zodToJsonSchema(withDef('ZodUnion', {
            options: [withDef('ZodString'), withDef('ZodNumber')],
        }))).toMatchObject({ oneOf: expect.any(Array) });

        expect(zodToJsonSchema(withDef('ZodDiscriminatedUnion', {
            _innerTypes: [withDef('ZodString')],
        }))).toMatchObject({ oneOf: expect.any(Array) });

        expect(zodToJsonSchema(withDef('ZodRecord', {
            valueType: withDef('ZodNumber'),
        }))).toMatchObject({ type: 'object' });
        expect(zodToJsonSchema(withDef('ZodRecord'))).toMatchObject({
            type: 'object',
            additionalProperties: true,
        });

        expect(zodToJsonSchema(withDef('ZodTuple', {
            items: [withDef('ZodString'), withDef('ZodNumber')],
        }))).toMatchObject({ type: 'array', minItems: 2, maxItems: 2 });

        expect(zodToJsonSchema(withDef('ZodAny', { description: 'any' }))).toEqual({
            description: 'any',
        });
        expect(zodToJsonSchema(withDef('ZodUnknown'))).toEqual({});

        expect(zodToJsonSchema(withDef('ZodDefault', {
            innerType: withDef('ZodString'),
            defaultValue: () => 'x',
        }))).toMatchObject({ type: 'string', default: expect.any(Function) });

        expect(zodToJsonSchema(withDef('ZodDefault'))).toMatchObject({
            default: undefined,
        });

        expect(zodToJsonSchema(withDef('ZodMystery'))).toEqual({
            type: 'object',
            additionalProperties: true,
        });
    });
});

describe('validation to-json-schema additional edges', () => {
    it('Standard schema without jsonSchema falls through to duck-typed converters', () => {
        const schema = {
            '~standard': { version: 1 as const, vendor: 't', validate: () => ({ value: 1 }) },
            toJSONSchema: () => ({ type: 'number', $id: 'x' }),
        } as never;
        // line 68: jsonSchema is undefined → skip, then toJSONSchema() → stripMeta removes $id
        expect(schemaToJsonSchema(schema)).toEqual({ type: 'number' });
    });
});
