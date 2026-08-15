import { describe, it, expect } from 'vitest';
import {
    FrameworkError,
    TransientError,
    PermanentError,
    RateLimitError,
    TimeoutError,
    NetworkError,
    AuthError,
    ValidationError,
    NotFoundError,
    ConfigError,
    TenantError,
    TenantQuotaExceededError,
    TenantBudgetExceededError,
    GuardrailError,
    InternalError,
    ErrorCode,
} from '../src/production/errors.js';

describe('Error taxonomy', () => {
    it('base errors use UNKNOWN code', () => {
        const err = new FrameworkError('boom');
        expect(err.code).toBe(ErrorCode.UNKNOWN);
        expect(err.name).toBe('FrameworkError');
        expect(err.isTransient).toBe(false);
        expect(err.statusCode).toBe(500);
    });

    it('transient errors are retryable and map to 503', () => {
        const err = new TransientError('transient');
        expect(err.isTransient).toBe(true);
        expect(err.statusCode).toBe(503);
        expect(err.severity).toBe('warning');
    });

    it('rate limit error maps to 429 and code RATE_LIMITED', () => {
        const err = new RateLimitError();
        expect(err.code).toBe(ErrorCode.RATE_LIMITED);
        expect(err.statusCode).toBe(429);
        expect(err.isTransient).toBe(true);
    });

    it('timeout error maps to 503', () => {
        const err = new TimeoutError('slow');
        expect(err.code).toBe(ErrorCode.TIMEOUT);
        expect(err.isTransient).toBe(true);
        expect(err.statusCode).toBe(503);
        expect(err.severity).toBe('error');
    });

    it('network error has NETWORK code', () => {
        const err = new NetworkError();
        expect(err.code).toBe(ErrorCode.NETWORK);
        expect(err.isTransient).toBe(true);
    });

    it('auth error maps to 401', () => {
        const err = new AuthError();
        expect(err.code).toBe(ErrorCode.AUTH_FAILED);
        expect(err.statusCode).toBe(401);
        expect(err.isTransient).toBe(false);
        expect(err instanceof PermanentError).toBe(true);
    });

    it('validation error maps to 400', () => {
        const err = new ValidationError();
        expect(err.code).toBe(ErrorCode.VALIDATION);
        expect(err.statusCode).toBe(400);
        expect(err.severity).toBe('warning');
    });

    it('not found maps to 404', () => {
        const err = new NotFoundError();
        expect(err.code).toBe(ErrorCode.NOT_FOUND);
        expect(err.statusCode).toBe(404);
    });

    it('config errors are critical severity', () => {
        const err = new ConfigError();
        expect(err.code).toBe(ErrorCode.CONFIG);
        expect(err.severity).toBe('critical');
    });

    it('tenant quota error has correct code and maps to 500', () => {
        const err = new TenantQuotaExceededError();
        expect(err.code).toBe(ErrorCode.TENANT_QUOTA_EXCEEDED);
        expect(err instanceof TenantError).toBe(true);
        expect(err.statusCode).toBe(500);
    });

    it('tenant budget error has correct code', () => {
        const err = new TenantBudgetExceededError();
        expect(err.code).toBe(ErrorCode.TENANT_BUDGET_EXCEEDED);
    });

    it('guardrail error has GUARDRAIL_VIOLATION code', () => {
        const err = new GuardrailError();
        expect(err.code).toBe(ErrorCode.GUARDRAIL_VIOLATION);
    });

    it('internal errors are critical', () => {
        const err = new InternalError();
        expect(err.code).toBe(ErrorCode.INTERNAL);
        expect(err.severity).toBe('critical');
    });

    it('forbidden error maps to 403', () => {
        const err = new FrameworkError('nope', { code: ErrorCode.FORBIDDEN });
        expect(err.statusCode).toBe(403);
    });

    it('hitl rejected maps to 403', () => {
        const err = new FrameworkError('rejected', { code: ErrorCode.HITL_REJECTED });
        expect(err.statusCode).toBe(403);
    });

    it('supports cause chaining', () => {
        const cause = new Error('underlying');
        const err = new NetworkError('outer', { cause });
        expect(err.cause).toBe(cause);
        expect(err.message).toBe('outer');
    });

    it('supports structured context', () => {
        const err = new FrameworkError('ctx error', {
            context: { runId: 'run_1', step: 3 },
        });
        expect(err.context).toEqual({ runId: 'run_1', step: 3 });
    });

    it('serializes to a structured JSON payload', () => {
        const err = new RateLimitError('too many requests', { context: { limit: 10 } });
        const json = err.toJSON() as Record<string, unknown>;
        expect(json.code).toBe(ErrorCode.RATE_LIMITED);
        expect(json.statusCode).toBe(429);
        expect(json.isTransient).toBe(true);
        expect((json.context as Record<string, unknown>).limit).toBe(10);
    });

    it('class hierarchy is preserved for instanceof checks', () => {
        expect(new RateLimitError() instanceof TransientError).toBe(true);
        expect(new RateLimitError() instanceof FrameworkError).toBe(true);
        expect(new AuthError() instanceof PermanentError).toBe(true);
        expect(new AuthError() instanceof FrameworkError).toBe(true);
        expect(new TenantBudgetExceededError() instanceof FrameworkError).toBe(true);
    });
});
