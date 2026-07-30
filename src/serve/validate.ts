/**
 * Framework-agnostic request-body validation helpers (Standard Schema).
 *
 * Accepts Zod, Valibot, ArkType, or any Standard Schema / safeParse schema.
 * The package does not take a hard dependency on Express — instead we expose
 * a small `validateBody` function plus thin Express/Fastify-style adapters.
 *
 * @module
 */
import type { InferSchemaOutput, SchemaInput } from '../validation/index.js';
import { safeValidate } from '../validation/index.js';
import { ValidationError } from '../contracts/index.js';

export interface ValidationFailure {
  readonly ok: false;
  readonly error: ValidationError;
  readonly issues: unknown;
}

export interface ValidationSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

export type ValidationOutcome<T> = ValidationSuccess<T> | ValidationFailure;

export function validateBody<S extends SchemaInput>(
  schema: S,
  body: unknown,
): ValidationOutcome<InferSchemaOutput<S>> {
  const parsed = safeValidate(schema, body);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    error: new ValidationError('request body failed schema validation', {
      message: parsed.error.message,
      issues: parsed.issues,
    }),
    issues: parsed.issues,
  };
}

// --- Express-style middleware --------------------------------------------

interface ExpressLikeReq { body: unknown }
interface ExpressLikeRes {
  status(code: number): ExpressLikeRes;
  json(payload: unknown): unknown;
}
type NextFn = (err?: unknown) => void;

export type ExpressMiddleware = (req: ExpressLikeReq, res: ExpressLikeRes, next: NextFn) => void;

/**
 * Returns an Express-compatible middleware that validates `req.body`,
 * replacing it with the parsed/typed value or responding with 400.
 */
export function validate(schema: SchemaInput): ExpressMiddleware {
  return (req, res, next) => {
    const result = validateBody(schema, req.body);
    if (result.ok) {
      req.body = result.data;
      next();
      return;
    }
    res.status(400).json({
      error: 'VALIDATION_FAILED',
      message: result.error.message,
      issues: result.issues,
    });
  };
}
