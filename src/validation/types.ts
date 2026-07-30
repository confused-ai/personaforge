/**
 * Vendor-neutral schema types based on Standard Schema V1.
 *
 * Accept Zod, Valibot, ArkType, or any library that implements `~standard`.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';

export type { StandardSchemaV1 };

/** Any Standard Schema–compatible validator. */
export type AnySchema<TInput = unknown, TOutput = TInput> = StandardSchemaV1<TInput, TOutput>;

/** Infer the input type of a schema. */
export type InferInput<T extends AnySchema> = StandardSchemaV1.InferInput<T>;

/** Infer the output type of a schema. */
export type InferOutput<T extends AnySchema> = StandardSchemaV1.InferOutput<T>;

/** Normalized issue from any schema library. */
export interface SchemaIssue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

/** Success result from safeValidate. */
export interface SafeValidateSuccess<TData> {
    readonly success: true;
    readonly data: TData;
}

/** Failure result from safeValidate. */
export interface SafeValidateFailure {
    readonly success: false;
    readonly error: { readonly message: string };
    readonly issues: readonly SchemaIssue[];
}

export type SafeValidateResult<TData> = SafeValidateSuccess<TData> | SafeValidateFailure;

/**
 * Legacy duck-typed schema with Zod-like `safeParse`.
 * @deprecated Prefer Standard Schema (`~standard`). Still accepted via normalizeSchema().
 */
export interface SafeParseSchemaLike<TData = unknown> {
    readonly description?: string;
    readonly shape?: Record<string, SafeParseSchemaLike<unknown>>;
    readonly _def?: {
        typeName?: string;
        type?: unknown;
        innerType?: unknown;
        values?: unknown;
        defaultValue?: unknown;
    };
    safeParse(input: unknown):
        | { success: true; data: TData }
        | { success: false; error: { message: string; issues?: unknown } };
    strict?(): SafeParseSchemaLike<Record<string, unknown>>;
    isOptional?(): boolean;
    isNullable?(): boolean;
    parse?(input: unknown): TData;
    toJSONSchema?(): Record<string, unknown>;
}

/** Anything the framework can validate: Standard Schema or legacy safeParse. */
export type SchemaInput<TInput = unknown, TOutput = TInput> =
    | AnySchema<TInput, TOutput>
    | SafeParseSchemaLike<TOutput>;

/** Infer output from AnySchema or legacy safeParse schemas. */
export type InferSchemaOutput<T> =
    T extends AnySchema<infer _I, infer O> ? O :
        T extends SafeParseSchemaLike<infer D> ? D :
            unknown;
