/**
 * Convert any accepted schema to JSON Schema for LLM tool calling.
 *
 * Resolution order:
 * 1. Standard JSON Schema (`~standard.jsonSchema`)
 * 2. Zod 4 / duck-typed `toJSONSchema()` / `toJsonSchema()`
 * 3. Legacy Zod 3 `_def` walk via zodToJsonSchema
 * 4. Throw if conversion is impossible
 */

import type { ZodType } from 'zod';
import { zodToJsonSchema } from './zod-json-schema.js';
import { isSafeParseSchema, isStandardSchema } from './normalize.js';
import type { SchemaInput } from './types.js';

type JsonSchemaCapable = {
    toJSONSchema?: () => Record<string, unknown>;
    toJsonSchema?: () => Record<string, unknown>;
};

type StandardWithJsonSchema = {
    '~standard': {
        jsonSchema?: {
            input?: Record<string, unknown> | (() => Record<string, unknown>);
            output?: Record<string, unknown> | (() => Record<string, unknown>);
        };
        vendor?: string;
    };
};

function stripMeta(schema: Record<string, unknown>): Record<string, unknown> {
    const out = { ...schema };
    delete out['$schema'];
    delete out['$id'];
    return out;
}

function resolveJsonSchemaValue(
    value: Record<string, unknown> | (() => Record<string, unknown>) | undefined,
): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    return typeof value === 'function' ? value() : value;
}

/**
 * Convert a schema to a JSON Schema object suitable for LLM function calling.
 */
export function schemaToJsonSchema(schema: SchemaInput): Record<string, unknown> {
    // 1. Standard JSON Schema (when implemented by the library)
    if (isStandardSchema(schema)) {
        const standard = (schema as StandardWithJsonSchema)['~standard'];
        const jsonSchema = standard.jsonSchema;
        if (jsonSchema) {
            const resolved =
                resolveJsonSchemaValue(jsonSchema.input) ??
                resolveJsonSchemaValue(jsonSchema.output);
            if (resolved) return stripMeta(resolved);
        }
    }

    // 2. Duck-typed toJSONSchema / toJsonSchema (Zod 4 and others)
    const capable = schema as JsonSchemaCapable;
    if (typeof capable.toJSONSchema === 'function') {
        return stripMeta(capable.toJSONSchema());
    }
    if (typeof capable.toJsonSchema === 'function') {
        return stripMeta(capable.toJsonSchema());
    }

    // 3. Legacy Zod 3 `_def` walk (also covers Zod types without toJSONSchema)
    if (isSafeParseSchema(schema) && (schema as { _def?: unknown })._def !== undefined) {
        return zodToJsonSchema(schema as unknown as ZodType);
    }

    // Vendor hint: Zod always has safeParse; try zod converter as last resort for Zod-shaped objects
    if (isSafeParseSchema(schema)) {
        try {
            return zodToJsonSchema(schema as unknown as ZodType);
        } catch {
            // fall through
        }
    }

    throw new TypeError(
        'Unable to convert schema to JSON Schema. Use a library that exposes ' +
            'Standard JSON Schema, toJSONSchema(), or pass a Zod schema.',
    );
}
