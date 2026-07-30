/**
 * Normalize any accepted schema into Standard Schema V1.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AnySchema, SafeParseSchemaLike, SchemaInput } from './types.js';

/** True when the value implements Standard Schema V1. */
export function isStandardSchema(value: unknown): value is AnySchema {
    if (value === null || typeof value !== 'object') return false;
    const standard = (value as { '~standard'?: unknown })['~standard'];
    if (standard === null || typeof standard !== 'object') return false;
    return typeof (standard as { validate?: unknown }).validate === 'function';
}

/** True when the value has a Zod-like safeParse method. */
export function isSafeParseSchema(value: unknown): value is SafeParseSchemaLike {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { safeParse?: unknown }).safeParse === 'function'
    );
}

/**
 * Wrap a legacy `safeParse` schema as Standard Schema V1.
 * Preserves the original object identity for JSON Schema conversion helpers.
 */
export function fromSafeParseSchema<TData>(
    schema: SafeParseSchemaLike<TData>,
): AnySchema<unknown, TData> & SafeParseSchemaLike<TData> {
    if (isStandardSchema(schema)) {
        return schema as AnySchema<unknown, TData> & SafeParseSchemaLike<TData>;
    }

    const wrapped = schema as SafeParseSchemaLike<TData> & {
        '~standard'?: StandardSchemaV1.Props<unknown, TData>;
    };

    if (!wrapped['~standard']) {
        wrapped['~standard'] = {
            version: 1,
            vendor: 'personaforge-safeparse',
            validate(value: unknown): StandardSchemaV1.Result<TData> {
                const result = schema.safeParse(value);
                if (result.success) {
                    return { value: result.data };
                }
                return {
                    issues: [{ message: result.error.message }],
                };
            },
        };
    }

    return wrapped as AnySchema<unknown, TData> & SafeParseSchemaLike<TData>;
}

/**
 * Ensure a schema input is Standard Schema–compatible.
 * Passes through real Standard Schema objects; wraps safeParse duck-types.
 */
export function normalizeSchema<TInput = unknown, TOutput = TInput>(
    schema: SchemaInput<TInput, TOutput>,
): AnySchema<TInput, TOutput> {
    if (isStandardSchema(schema)) {
        return schema as AnySchema<TInput, TOutput>;
    }
    if (isSafeParseSchema(schema)) {
        return fromSafeParseSchema(schema) as AnySchema<TInput, TOutput>;
    }
    throw new TypeError(
        'Invalid schema: expected a Standard Schema (`~standard`) or a safeParse-compatible schema',
    );
}
