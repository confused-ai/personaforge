/**
 * Framework-agnostic Zod validation helpers for HTTP request bodies.
 *
 * The package does not take a hard dependency on Express — instead we expose
 * a small `validateBody` function plus thin Express/Fastify-style adapters.
 * This keeps `@personaforge/serve` usable from any HTTP runtime.
 *
 * @module
 */
import type { ZodTypeAny, infer as zInfer } from 'zod';
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

export function validateBody<S extends ZodTypeAny>(
  schema: S,
  body: unknown,
): ValidationOutcome<zInfer<S>> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data as zInfer<S> };
  const flattened = parsed.error.flatten();
  return {
    ok: false,
    error: new ValidationError('request body failed schema validation', { issues: flattened }),
    issues: flattened,
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
export function validate(schema: ZodTypeAny): ExpressMiddleware {
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
