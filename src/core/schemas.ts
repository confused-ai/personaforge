/**
 * Type-safe I/O: input_schema and output_schema for agent runs.
 * Accepts any Standard Schema (Zod, Valibot, ArkType, …) or legacy safeParse schemas.
 */

import type { AnySchema, SchemaInput } from '../validation/index.js';

/** Input schema for agent run (e.g. prompt + optional structured fields) */
export type InputSchema<T = unknown> = SchemaInput<unknown, T>;

/** Output schema for agent run (e.g. structured response) */
export type OutputSchema<T = unknown> = SchemaInput<unknown, T>;

/** Parsed input from user when inputSchema is used */
export type ParsedInput<T> = T;

/** Parsed output from agent when outputSchema is used */
export type ParsedOutput<T> = T;

/** @deprecated Prefer AnySchema / SchemaInput from validation */
export type Schema = AnySchema;
