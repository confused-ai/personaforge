/**
 * Shared validate/parse helpers over Standard Schema V1 (+ legacy safeParse).
 */

import { ValidationError } from '../contracts/errors.js';
import { normalizeSchema } from './normalize.js';
import type {
    InferSchemaOutput,
    SafeValidateResult,
    SchemaInput,
    SchemaIssue,
} from './types.js';

function formatIssues(issues: readonly SchemaIssue[]): string {
    if (issues.length === 0) return 'validation failed';
    return issues
        .map((issue) => {
            const path = issue.path
                ?.map((segment) =>
                    typeof segment === 'object' && segment !== null && 'key' in segment
                        ? String(segment.key)
                        : String(segment),
                )
                .join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}

function toSchemaIssues(issues: ReadonlyArray<{ message: string; path?: SchemaIssue['path'] }>): SchemaIssue[] {
    return issues.map((issue) => ({
        message: issue.message,
        ...(issue.path !== undefined ? { path: issue.path } : {}),
    }));
}

/**
 * Synchronously validate input against a schema.
 * Throws if the schema's validate() returns a Promise — use `safeValidateAsync` instead.
 */
export function safeValidate<T extends SchemaInput>(
    schema: T,
    input: unknown,
): SafeValidateResult<InferSchemaOutput<T>> {
    const normalized = normalizeSchema(schema);
    const result = normalized['~standard'].validate(input);

    if (result instanceof Promise) {
        throw new TypeError(
            'Schema validate() returned a Promise; use safeValidateAsync() for async schemas',
        );
    }

    if (result.issues) {
        const issues = toSchemaIssues(result.issues);
        return {
            success: false,
            error: { message: formatIssues(issues) },
            issues,
        };
    }

    return { success: true, data: result.value as InferSchemaOutput<T> };
}

/** Async-capable validate (handles sync or async Standard Schema validate). */
export async function safeValidateAsync<T extends SchemaInput>(
    schema: T,
    input: unknown,
): Promise<SafeValidateResult<InferSchemaOutput<T>>> {
    const normalized = normalizeSchema(schema);
    let result = normalized['~standard'].validate(input);
    if (result instanceof Promise) {
        result = await result;
    }

    if (result.issues) {
        const issues = toSchemaIssues(result.issues);
        return {
            success: false,
            error: { message: formatIssues(issues) },
            issues,
        };
    }

    return { success: true, data: result.value as InferSchemaOutput<T> };
}

/**
 * Validate and return data, or throw ValidationError.
 * Sync only — use `parseAsync` for async schemas.
 */
export function parse<T extends SchemaInput>(
    schema: T,
    input: unknown,
    detail = 'schema validation failed',
): InferSchemaOutput<T> {
    const result = safeValidate(schema, input);
    if (!result.success) {
        throw new ValidationError(detail, {
            message: result.error.message,
            issues: result.issues,
        });
    }
    return result.data;
}

/** Async parse — throws ValidationError on failure. */
export async function parseAsync<T extends SchemaInput>(
    schema: T,
    input: unknown,
    detail = 'schema validation failed',
): Promise<InferSchemaOutput<T>> {
    const result = await safeValidateAsync(schema, input);
    if (!result.success) {
        throw new ValidationError(detail, {
            message: result.error.message,
            issues: result.issues,
        });
    }
    return result.data;
}

/** Alias for parse (throws on failure). */
export const validate = parse;
