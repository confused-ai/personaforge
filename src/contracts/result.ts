/**
 * Result<T, E> — explicit success/failure type so tools and agents can return
 * errors without throwing. Inspired by Rust's `Result` and Effect-TS.
 *
 * @module
 */
import { PersonaForgeError } from './errors.js';

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E extends PersonaForgeError = PersonaForgeError> = {
  readonly ok: false;
  readonly error: E;
};

export type Result<T, E extends PersonaForgeError = PersonaForgeError> = Ok<T> | Err<E>;

/** Construct a successful `Result`. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Construct a failed `Result`. */
export function err<E extends PersonaForgeError>(error: E): Err<E> {
  return { ok: false, error };
}

/** Narrow a `Result` to `Ok<T>`. */
export function isOk<T, E extends PersonaForgeError>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

/** Narrow a `Result` to `Err<E>`. */
export function isErr<T, E extends PersonaForgeError>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/**
 * Unwrap a `Result`, throwing the inner error if it is an `Err`.
 * Use sparingly — prefer pattern matching at boundary points.
 */
export function unwrap<T, E extends PersonaForgeError>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error;
}

/** Transform the value inside an `Ok`, passing `Err` through unchanged. */
export function map<T, U, E extends PersonaForgeError>(
  r: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/**
 * Run `fn`, catching any thrown value and converting it to `Err` via
 * `onError`. Returns `Ok<T>` on success.
 */
export async function tryCatch<T>(
  fn: () => T | Promise<T>,
  onError: (e: unknown) => PersonaForgeError,
): Promise<Result<T>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (e) {
    return err(onError(e));
  }
}
