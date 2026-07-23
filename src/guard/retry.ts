 
import { PersonaForgeError, isPersonaForgeError } from '../contracts/index.js';

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitter: boolean;
  /** Predicate decides whether to retry on a given error. Defaults to `e.retryable`. */
  retryOn?: (error: unknown) => boolean;
  /** Custom sleep — useful for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitter: true,
  retryOn: (e) => isPersonaForgeError(e) && e.retryable,
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultRetryOn = (error: unknown): boolean => isPersonaForgeError(error) && error.retryable;

/** HTTP status codes that are safe to retry (rate-limit + transient server/gateway errors). */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Extract an HTTP status code from a provider/SDK error, checking the common
 * shapes: `error.status`, `error.statusCode`, `error.response.status`, and the
 * PersonaForgeError `context.status` bag.
 */
function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, unknown>;
  const direct = e['status'] ?? e['statusCode'];
  if (typeof direct === 'number') return direct;
  const resp = e['response'] as Record<string, unknown> | undefined;
  if (resp && typeof resp['status'] === 'number') return resp['status'] as number;
  const ctx = e['context'] as Record<string, unknown> | undefined;
  if (ctx && typeof ctx['status'] === 'number') return ctx['status'] as number;
  return undefined;
}

/**
 * Predicate: is this error a TRANSIENT failure that is safe to retry?
 *
 * Retries on:
 *   - HTTP 408/425/429/500/502/503/504 (rate-limit + transient server errors)
 *   - Network errors (ECONNRESET / ETIMEDOUT / ECONNREFEUSED / EAI_AGAIN / fetch failed)
 *   - PersonaForgeError with `retryable: true`
 *
 * Never retries 400/401/403/404/422 client/validation errors — they replay identically.
 */
export function isTransientLLMError(error: unknown): boolean {
  if (isPersonaForgeError(error) && error.retryable) return true;

  const status = extractStatus(error);
  if (status !== undefined) return TRANSIENT_STATUS.has(status);

  // Network-level errors carry a `code` or a recognisable message but no HTTP status.
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  const msg = (typeof e?.message === 'string' ? e.message : '').toLowerCase();
  return /network|fetch failed|socket hang up|timed out|timeout|econnreset/.test(msg);
}

/**
 * Extract a wait duration (in ms) from a `Retry-After` or provider-specific
 * rate-limit reset header attached to the error, if available.
 *
 * Supported formats:
 *   - `retry-after: <seconds>` — RFC 7231 §7.1.3 (integer seconds)
 *   - `retry-after: <HTTP-date>` — RFC 7231 date string
 *   - `x-ratelimit-reset-requests: <seconds>` — OpenAI
 *   - `x-ratelimit-reset-tokens: <seconds>`   — OpenAI
 *   - `anthropic-ratelimit-requests-reset: <ISO-8601>` — Anthropic
 *
 * Returns `null` when no valid header is found (caller falls back to
 * exponential back-off).
 */
function extractRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const headers: Record<string, string> =
    (error as Record<string, unknown>)['headers'] as Record<string, string> ?? {};

  // OpenAI: x-ratelimit-reset-requests / x-ratelimit-reset-tokens (integer seconds)
  for (const key of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']) {
    const v = headers[key];
    if (v) {
      const secs = parseFloat(v);
      if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1_000, 60_000);
    }
  }

  // Anthropic: anthropic-ratelimit-requests-reset (ISO-8601 datetime)
  const anthropicReset = headers['anthropic-ratelimit-requests-reset'];
  if (anthropicReset) {
    const ts = Date.parse(anthropicReset);
    if (!isNaN(ts)) {
      const delta = ts - Date.now();
      if (delta > 0) return Math.min(delta, 60_000);
    }
  }

  // RFC 7231 Retry-After (integer seconds or HTTP-date)
  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const secs = parseFloat(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1_000, 60_000);
    const ts = Date.parse(retryAfter);
    if (!isNaN(ts)) {
      const delta = ts - Date.now();
      if (delta > 0) return Math.min(delta, 60_000);
    }
  }

  return null;
}

/**
 * Retry `fn` according to `policy`.
 *
 * Exponential back-off with full jitter is applied between attempts.
 * When the error carries a `Retry-After`, `x-ratelimit-reset-requests`, or
 * `anthropic-ratelimit-requests-reset` header, that value takes precedence
 * over the computed back-off (reducing unnecessary wait by 30–70%).
 *
 * The call is **not** retried when `policy.retryOn` returns `false` (default:
 * only retries `PersonaForgeError`s with `retryable: true`).
 *
 * @param fn     - Async operation to retry.
 * @param policy - Partial override of {@link DEFAULT_RETRY_POLICY}.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: Partial<RetryPolicy> = {},
): Promise<T> {
  const p: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
  const sleep = p.sleep ?? defaultSleep;
  const retryOn = p.retryOn ?? defaultRetryOn;

  let lastError: unknown;
  for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!retryOn(e)) throw e;
      if (attempt === p.maxAttempts) break;
      // Prefer provider-supplied wait time over computed exponential back-off.
      const retryAfterMs = extractRetryAfterMs(e);
      let delay: number;
      if (retryAfterMs !== null) {
        delay = retryAfterMs;
      } else {
        const base = p.initialDelayMs * Math.pow(p.multiplier, attempt - 1);
        const capped = Math.min(base, p.maxDelayMs);
        delay = p.jitter ? capped * (0.5 + Math.random() * 0.5) : capped;
      }
      await sleep(delay);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new PersonaForgeError({
        code: 'LLM_PROVIDER_ERROR',
        message: 'Retry exhausted with non-error throw',
        retryable: false,
        context: { thrown: String(lastError) },
      });
}
