/**
 * Hermetic coverage for src/contracts — result, errors, ids, tenant, agent-contracts.
 * Callers: bunx vitest run tests/coverage-*.test.ts. No production imports.
 */

import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, unwrap, map, tryCatch } from '../src/contracts/result.js';
import {
    ERROR_CODES,
    PersonaForgeError,
    BudgetExceededError,
    CircuitOpenError,
    GuardrailViolatedError,
    ToolTimeoutError,
    ToolValidationError,
    ExecutionTimeoutError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    ToolNotAuthorizedError,
    isPersonaForgeError,
    isRetryable,
} from '../src/contracts/errors.js';
import {
    newId,
    asAgentId,
    asSessionId,
    asRunId,
    asMemoryId,
    asArtifactId,
    asToolCallId,
    asTraceId,
    asTaskId,
    asWorkflowId,
    asExecutionId,
    asScheduleId,
} from '../src/contracts/ids.js';
import {
    tenantScopedKey,
    userScopedKey,
    TenantBudgetEnforcer,
    type TenantContext,
} from '../src/contracts/tenant.js';
import type { CacheStore } from '../src/contracts/adapters.js';
import { generateEntityId, AgentState } from '../src/contracts/agent-contracts.js';

describe('contracts/result', () => {
    it('constructs Ok and Err', () => {
        expect(ok('v')).toEqual({ ok: true, value: 'v' });
        const e = err(new ValidationError('no'));
        expect(e.ok).toBe(false);
        if (!e.ok) expect(e.error).toBeInstanceOf(ValidationError);
    });

    it('narrows with isOk / isErr', () => {
        const good = ok(1);
        const bad = err(new ValidationError('x'));
        expect(isOk(good)).toBe(true);
        expect(isErr(good)).toBe(false);
        expect(isOk(bad)).toBe(false);
        expect(isErr(bad)).toBe(true);
    });

    it('unwrap returns value or throws error', () => {
        expect(unwrap(ok(7))).toBe(7);
        expect(() => unwrap(err(new ValidationError('boom')))).toThrow(ValidationError);
    });

    it('map transforms Ok and passes Err through', () => {
        expect(map(ok(3), (n) => n + 1)).toEqual(ok(4));
        const bad = err(new ValidationError('e'));
        expect(map(bad, (n: number) => n + 1)).toBe(bad);
    });

    it('tryCatch wraps sync/async success and failure', async () => {
        await expect(tryCatch(() => 42, () => new ValidationError('x'))).resolves.toEqual(ok(42));
        await expect(
            tryCatch(
                async () => {
                    throw new Error('fail');
                },
                (e) => new ValidationError(String(e)),
            ),
        ).resolves.toMatchObject({ ok: false });
    });
});

describe('contracts/errors', () => {
    it('ERROR_CODES has expected keys', () => {
        expect(ERROR_CODES.BUDGET_EXCEEDED).toBe('BUDGET_EXCEEDED');
        expect(ERROR_CODES.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
        expect(ERROR_CODES.CIRCUIT_OPEN).toBe('CIRCUIT_OPEN');
    });

    it('PersonaForgeError defaults retryable/context and serializes', () => {
        const e = new PersonaForgeError({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'bad',
            cause: new Error('root'),
        });
        expect(e.retryable).toBe(false);
        expect(e.context).toEqual({});
        expect(e.timestamp).toMatch(/T/);
        expect(e.toJSON()).toMatchObject({
            name: 'PersonaForgeError',
            code: 'VALIDATION_FAILED',
            message: 'bad',
            retryable: false,
        });

        const r = new PersonaForgeError({
            code: ERROR_CODES.CIRCUIT_OPEN,
            message: 'open',
            retryable: true,
            context: { s: 1 },
        });
        expect(r.retryable).toBe(true);
        expect(r.context).toEqual({ s: 1 });
    });

    it('constructs every typed subclass', () => {
        expect(new BudgetExceededError({ limitUsd: 1, spentUsd: 2.5, scope: 'user:u' }).message).toMatch(
            /Budget exceeded/,
        );
        expect(new CircuitOpenError('svc', 250).retryable).toBe(true);
        expect(new GuardrailViolatedError('pii', 'ssn').name).toBe('GuardrailViolatedError');
        expect(new ToolTimeoutError('t', 100).name).toBe('ToolTimeoutError');
        expect(new ToolValidationError('t', 'bad', { field: 'a' }).context).toMatchObject({
            toolName: 't',
            field: 'a',
        });
        expect(new ExecutionTimeoutError(5, 'run').name).toBe('ExecutionTimeoutError');
        expect(new ValidationError('v', { path: 'x' }).name).toBe('ValidationError');
        expect(new UnauthorizedError().message).toBe('Authentication required');
        expect(new UnauthorizedError('nope').message).toBe('nope');
        expect(new ForbiddenError('denied', 'admin').context).toEqual({ requiredRole: 'admin' });
        expect(new ForbiddenError('denied').context).toEqual({});
        expect(new ToolNotAuthorizedError('x', 'ten').context).toEqual({ toolName: 'x', tenantId: 'ten' });
        expect(new ToolNotAuthorizedError('y').context).toEqual({ toolName: 'y' });
    });

    it('isPersonaForgeError / isRetryable guards', () => {
        expect(isPersonaForgeError(new ValidationError('x'))).toBe(true);
        expect(isPersonaForgeError(new Error('x'))).toBe(false);
        expect(isRetryable(new CircuitOpenError('s', 1))).toBe(true);
        expect(isRetryable(new ValidationError('x'))).toBe(false);
        expect(isRetryable('no')).toBe(false);
    });
});

describe('contracts/ids', () => {
    it('newId with and without prefix', () => {
        const plain = newId();
        expect(plain).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        expect(newId('run')).toMatch(/^run_/);
    });

    it('brand cast helpers return same string', () => {
        expect(asAgentId('a')).toBe('a');
        expect(asSessionId('s')).toBe('s');
        expect(asRunId('r')).toBe('r');
        expect(asMemoryId('m')).toBe('m');
        expect(asArtifactId('art')).toBe('art');
        expect(asToolCallId('tc')).toBe('tc');
        expect(asTraceId('tr')).toBe('tr');
        expect(asTaskId('tk')).toBe('tk');
        expect(asWorkflowId('wf')).toBe('wf');
        expect(asExecutionId('ex')).toBe('ex');
        expect(asScheduleId('sch')).toBe('sch');
    });
});

describe('contracts/tenant', () => {
    it('tenantScopedKey builds and rejects colon segments', () => {
        expect(tenantScopedKey('t1', 'session', 's1')).toBe('tenant:t1:session:s1');
        expect(() => tenantScopedKey('bad:id', 'x')).toThrow(/tenantId must not contain/);
        expect(() => tenantScopedKey('t1', 'bad:part')).toThrow(/key part must not contain/);
    });

    it('userScopedKey nests under user', () => {
        expect(userScopedKey('t1', 'u1', 'budget')).toBe('tenant:t1:user:u1:budget');
    });

    function memoryCache(): CacheStore & { data: Map<string, unknown> } {
        const data = new Map<string, unknown>();
        return {
            data,
            async get(key) {
                return data.has(key) ? data.get(key)! : null;
            },
            async set(key, value) {
                data.set(key, value);
            },
            async del(key) {
                data.delete(key);
            },
            async flush() {
                return 0;
            },
        };
    }

    it('TenantBudgetEnforcer check/record with limits', async () => {
        const store = memoryCache();
        const ctx: TenantContext = {
            tenantId: 't1',
            userId: 'u1',
            roles: ['user'],
            budget: { maxUsdPerUser: 1, maxUsdPerTenant: 5, windowSeconds: 60 },
        };
        const enforcer = new TenantBudgetEnforcer(ctx, store);

        await enforcer.check(0.5);
        await enforcer.record(0.5);
        expect(store.data.get('tenant:t1:user:u1:budget')).toBe(0.5);
        expect(store.data.get('tenant:t1:budget')).toBe(0.5);

        await expect(enforcer.check(0.6)).rejects.toBeInstanceOf(BudgetExceededError);

        const store2 = memoryCache();
        store2.data.set('tenant:t2:budget', 4.9);
        const ctx2: TenantContext = {
            tenantId: 't2',
            userId: 'u2',
            roles: [],
            budget: { maxUsdPerTenant: 5 },
        };
        const e2 = new TenantBudgetEnforcer(ctx2, store2);
        await expect(e2.check(0.2)).rejects.toBeInstanceOf(BudgetExceededError);
    });

    it('TenantBudgetEnforcer allows Infinity when no limits', async () => {
        const store = memoryCache();
        const enforcer = new TenantBudgetEnforcer(
            { tenantId: 't', userId: 'u', roles: [] },
            store,
        );
        await enforcer.check(999);
        await enforcer.record(999);
        expect(store.data.get('tenant:t:budget')).toBe(999);
    });
});

describe('contracts/agent-contracts', () => {
    it('generateEntityId and AgentState', () => {
        expect(generateEntityId()).toBeTruthy();
        expect(AgentState.IDLE).toBe('idle');
        expect(AgentState.FAILED).toBe('failed');
    });
});
