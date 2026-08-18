/**
 * @personaforge/core — shared error classes.
 *
 * Kept separate from the runner so consumers who only import types
 * do not pull in any runtime code.
 */

/** Base class for all framework errors. */
export class PersonaForgeError extends Error {
    readonly code: string;
    readonly context?: Record<string, unknown>;

    constructor(message: string, opts?: { code?: string; context?: Record<string, unknown> }) {
        super(message);
        this.name = 'PersonaForgeError';
        this.code = opts?.code ?? 'CONFUSED_AI_ERROR';
        if (opts?.context !== undefined) {
            this.context = opts.context;
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
