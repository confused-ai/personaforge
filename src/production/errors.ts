/**
 * Structured error taxonomy for personaforge.
 *
 * Every error thrown by the framework carries a stable error code,
 * a severity classification, and structured context. This enables
 * consistent error handling, monitoring, and troubleshooting.
 *
 * Hierarchy:
 *   FrameworkError (base)
 *   ├── TransientError       (retryable — network, rate-limit, timeout)
 *   │   ├── RateLimitError
 *   │   ├── TimeoutError
 *   │   └── NetworkError
 *   ├── PermanentError       (non-retryable — auth, validation, not-found)
 *   │   ├── AuthError
 *   │   ├── ValidationError
 *   │   ├── NotFoundError
 *   │   └── ConfigError
 *   ├── TenantError          (tenant-scoped failures)
 *   │   ├── TenantQuotaExceededError
 *   │   └── TenantAuthError
 *   ├── GuardrailError       (policy violations)
 *   └── InternalError        (framework bugs)
 */

// ── Error codes ──────────────────────────────────────────────────────────────

export const ErrorCode = {
    // Transient
    RATE_LIMITED: 'RATE_LIMITED',
    TIMEOUT: 'TIMEOUT',
    NETWORK: 'NETWORK',
    PROVIDER_OVERLOADED: 'PROVIDER_OVERLOADED',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

    // Permanent
    AUTH_FAILED: 'AUTH_FAILED',
    FORBIDDEN: 'FORBIDDEN',
    VALIDATION: 'VALIDATION',
    NOT_FOUND: 'NOT_FOUND',
    CONFIG: 'CONFIG',
    UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',

    // Tenant
    TENANT_QUOTA_EXCEEDED: 'TENANT_QUOTA_EXCEEDED',
    TENANT_BUDGET_EXCEEDED: 'TENANT_BUDGET_EXCEEDED',
    TENANT_RATE_LIMITED: 'TENANT_RATE_LIMITED',
    TENANT_AUTH: 'TENANT_AUTH',
    TENANT_DISABLED: 'TENANT_DISABLED',

    // Guardrails
    GUARDRAIL_VIOLATION: 'GUARDRAIL_VIOLATION',
    CONTENT_MODERATION: 'CONTENT_MODERATION',
    TOOL_BLOCKED: 'TOOL_BLOCKED',
    PROMPT_INJECTION_DETECTED: 'PROMPT_INJECTION_DETECTED',
    HITL_REJECTED: 'HITL_REJECTED',

    // Internal
    INTERNAL: 'INTERNAL',
    UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Error severity ───────────────────────────────────────────────────────────

export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';

// ── Base error ───────────────────────────────────────────────────────────────

export class FrameworkError extends Error {
    public readonly code: ErrorCode;
    public readonly severity: ErrorSeverity;
    public readonly cause?: unknown;
    public readonly context?: Record<string, unknown>;

    constructor(
        message: string,
        options?: {
            code?: ErrorCode;
            severity?: ErrorSeverity;
            cause?: unknown;
            context?: Record<string, unknown>;
        },
    ) {
        super(message);
        this.name = 'FrameworkError';
        this.code = options?.code ?? ErrorCode.UNKNOWN;
        this.severity = options?.severity ?? 'error';
        this.cause = options?.cause;
        this.context = options?.context;
    }

    /** Whether this error is safe to retry. */
    get isTransient(): boolean {
        return this instanceof TransientError;
    }

    /** HTTP status code mapping. */
    get statusCode(): number {
        if (this.code === ErrorCode.AUTH_FAILED || this.code === ErrorCode.TENANT_AUTH) return 401;
        if (this.code === ErrorCode.FORBIDDEN || this.code === ErrorCode.HITL_REJECTED) return 403;
        if (this.code === ErrorCode.NOT_FOUND) return 404;
        if (this.code === ErrorCode.RATE_LIMITED || this.code === ErrorCode.TENANT_RATE_LIMITED) return 429;
        if (this.code === ErrorCode.VALIDATION) return 400;
        if (this.code === ErrorCode.CONFIG) return 500;
        if (this.isTransient) return 503;
        return 500;
    }

    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            severity: this.severity,
            isTransient: this.isTransient,
            statusCode: this.statusCode,
            ...(this.context ? { context: this.context } : {}),
        };
    }
}

// ── Transient errors (safe to retry) ─────────────────────────────────────────

export class TransientError extends FrameworkError {
    constructor(
        message: string,
        options?: {
            code?: ErrorCode;
            severity?: ErrorSeverity;
            cause?: unknown;
            context?: Record<string, unknown>;
        },
    ) {
        super(message, { ...options, severity: options?.severity ?? 'warning' });
        this.name = 'TransientError';
    }
}

export class RateLimitError extends TransientError {
    constructor(
        message = 'Rate limit exceeded',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.RATE_LIMITED, severity: 'warning' });
        this.name = 'RateLimitError';
    }
}

export class TimeoutError extends TransientError {
    constructor(
        message = 'Request timed out',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.TIMEOUT, severity: 'error' });
        this.name = 'TimeoutError';
    }
}

export class NetworkError extends TransientError {
    constructor(
        message = 'Network request failed',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.NETWORK, severity: 'error' });
        this.name = 'NetworkError';
    }
}

// ── Permanent errors ─────────────────────────────────────────────────────────

export class PermanentError extends FrameworkError {
    constructor(
        message: string,
        options?: {
            code?: ErrorCode;
            severity?: ErrorSeverity;
            cause?: unknown;
            context?: Record<string, unknown>;
        },
    ) {
        super(message, { ...options, severity: options?.severity ?? 'error' });
        this.name = 'PermanentError';
    }
}

export class AuthError extends PermanentError {
    constructor(
        message = 'Authentication failed',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.AUTH_FAILED, severity: 'error' });
        this.name = 'AuthError';
    }
}

export class ValidationError extends PermanentError {
    constructor(
        message = 'Validation failed',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.VALIDATION, severity: 'warning' });
        this.name = 'ValidationError';
    }
}

export class NotFoundError extends PermanentError {
    constructor(
        message = 'Resource not found',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.NOT_FOUND, severity: 'warning' });
        this.name = 'NotFoundError';
    }
}

export class ConfigError extends PermanentError {
    constructor(
        message = 'Configuration error',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.CONFIG, severity: 'critical' });
        this.name = 'ConfigError';
    }
}

// ── Tenant errors ────────────────────────────────────────────────────────────

export class TenantError extends FrameworkError {
    constructor(
        message: string,
        options?: {
            code?: ErrorCode;
            severity?: ErrorSeverity;
            cause?: unknown;
            context?: Record<string, unknown>;
        },
    ) {
        super(message, { ...options, severity: options?.severity ?? 'error' });
        this.name = 'TenantError';
    }
}

export class TenantQuotaExceededError extends TenantError {
    constructor(
        message = 'Tenant quota exceeded',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.TENANT_QUOTA_EXCEEDED, severity: 'error' });
        this.name = 'TenantQuotaExceededError';
    }
}

export class TenantBudgetExceededError extends TenantError {
    constructor(
        message = 'Tenant budget exceeded',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.TENANT_BUDGET_EXCEEDED, severity: 'error' });
        this.name = 'TenantBudgetExceededError';
    }
}

// ── Guardrail errors ─────────────────────────────────────────────────────────

export class GuardrailError extends FrameworkError {
    constructor(
        message = 'Guardrail violation',
        options?: {
            code?: ErrorCode;
            severity?: ErrorSeverity;
            cause?: unknown;
            context?: Record<string, unknown>;
        },
    ) {
        super(message, {
            code: ErrorCode.GUARDRAIL_VIOLATION,
            ...options,
            severity: options?.severity ?? 'error',
        });
        this.name = 'GuardrailError';
    }
}

// ── Internal errors ──────────────────────────────────────────────────────────

export class InternalError extends FrameworkError {
    constructor(
        message = 'Internal framework error',
        options?: { cause?: unknown; context?: Record<string, unknown> },
    ) {
        super(message, { ...options, code: ErrorCode.INTERNAL, severity: 'critical' });
        this.name = 'InternalError';
    }
}
