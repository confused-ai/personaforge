/**
 * @personaforge/core — shared error classes.
 *
 * Kept separate from the runner so consumers who only import types
 * do not pull in any runtime code.
 */

import {
    PersonaForgeError as CanonicalError,
    type ErrorCode as CanonicalCode,
} from '../contracts/errors.js';

/**
 * Base class for all framework errors.
 *
 * Extends the canonical contracts error so `instanceof` checks against
 * either class succeed. Legacy `code` strings are preserved verbatim
 * (tests and consumers match on them).
 */
export class PersonaForgeError extends CanonicalError {
    constructor(message: string, opts?: { code?: string; context?: Record<string, unknown> }) {
        super({
            message,
            code: (opts?.code ?? 'CONFUSED_AI_ERROR') as CanonicalCode,
            ...(opts?.context !== undefined ? { context: opts.context } : {}),
        });
        this.name = 'PersonaForgeError';
        // Preserve the legacy shape: context stays undefined unless provided
        // (the canonical base defaults it to {}).
        if (opts?.context === undefined) {
            (this as { context?: Record<string, unknown> }).context = undefined;
        }
    }
}

function errorOptions(code: string, context?: Record<string, unknown>): { code: string; context?: Record<string, unknown> } {
    return context !== undefined ? { code, context } : { code };
}

/** Configuration / validation errors — thrown before any LLM call. */
export class ConfigError extends PersonaForgeError {
    constructor(message: string, opts?: { context?: Record<string, unknown> }) {
        super(message, errorOptions('CONFIG_ERROR', opts?.context));
        this.name = 'ConfigError';
    }
}

/** LLM / provider errors — thrown when the upstream API call fails. */
export class LLMError extends PersonaForgeError {
    constructor(message: string, opts?: { context?: Record<string, unknown> }) {
        super(message, errorOptions('LLM_ERROR', opts?.context));
        this.name = 'LLMError';
    }
}

/** Budget exceeded — thrown when spend cap is hit. */
export class BudgetExceededError extends PersonaForgeError {
    constructor(message: string, opts?: { context?: Record<string, unknown> }) {
        super(message, errorOptions('BUDGET_EXCEEDED', opts?.context));
        this.name = 'BudgetExceededError';
    }
}

/** Load shed — thrown when admission control rejects a run (map to HTTP 503). */
export class LoadShedError extends PersonaForgeError {
    /** Suggested client back-off in milliseconds (feeds `Retry-After`). */
    readonly retryAfterMs?: number;
    constructor(message: string, opts?: { context?: Record<string, unknown>; retryAfterMs?: number }) {
        super(message, errorOptions('LOAD_SHED', { ...opts?.context, ...(opts?.retryAfterMs !== undefined && { retryAfterMs: opts.retryAfterMs }) }));
        this.name = 'LoadShedError';
        if (opts?.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    }
}
