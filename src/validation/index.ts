/**
 * Vendor-neutral validation — Standard Schema V1 (+ legacy safeParse adapters).
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import * as v from 'valibot';
 * import { safeValidate, schemaToJsonSchema } from 'personaforge';
 *
 * const zodSchema = z.object({ name: z.string() });
 * const valibotSchema = v.object({ name: v.string() });
 *
 * safeValidate(zodSchema, { name: 'Ada' });
 * safeValidate(valibotSchema, { name: 'Ada' });
 * ```
 */

export type {
    AnySchema,
    InferInput,
    InferOutput,
    InferSchemaOutput,
    SafeParseSchemaLike,
    SafeValidateFailure,
    SafeValidateResult,
    SafeValidateSuccess,
    SchemaInput,
    SchemaIssue,
    StandardSchemaV1,
} from './types.js';

export {
    fromSafeParseSchema,
    isSafeParseSchema,
    isStandardSchema,
    normalizeSchema,
} from './normalize.js';

export {
    parse,
    parseAsync,
    safeValidate,
    safeValidateAsync,
    validate,
} from './validate.js';

export { schemaToJsonSchema } from './to-json-schema.js';

export { zodToJsonSchema } from './zod-json-schema.js';
