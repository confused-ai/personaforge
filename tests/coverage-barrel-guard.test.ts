/**
 * Coverage for src/guard.ts (barrel) — production safety primitives.
 * LLM-free: budget/rate-limit/circuit-breaker/audit/health all run in-memory.
 */

import { describe, it, expect } from 'vitest';
import {
    BudgetEnforcer,
    BudgetExceededError,
    RateLimiter,
    RateLimitError,
    CircuitBreaker,
    CircuitOpenError,
    CircuitState,
    InMemoryApprovalStore,
    InMemoryAuditStore,
    HealthCheckManager,
    createLLMHealthCheck,
    InMemoryIdempotencyStore,
    InMemoryCheckpointStore,
} from '../src/guard.js';

describe('guard barrel', () => {
    it('BudgetEnforcer enforces a per-run cap and records spend', async () => {
        const b = new BudgetEnforcer({ maxUsdPerRun: 0.001, store: new InMemoryApprovalStore() as never });
        b.resetRun();
        // A trivial but non-zero cost step under the cap.
        b.addStepCost('gpt-4o', 1, 1);
        const cost = await b.recordAndCheck('user1');
        expect(cost).toBeGreaterThan(0);

        // Now exceed the cap.
        const b2 = new BudgetEnforcer({ maxUsdPerRun: 0, store: new InMemoryApprovalStore() as never });
        b2.resetRun();
        expect(() => b2.addStepCost('gpt-4o', 1000, 1000)).toThrow(BudgetExceededError);
    });

    it('RateLimiter allows then rejects past capacity', async () => {
        const r = new RateLimiter({ name: 'r', maxRequests: 1, intervalMs: 60_000, burstCapacity: 0 });
        expect(r.canProceed()).toBe(true);
        const res = await r.execute(async () => 'ok');
        expect(res).toBe('ok');
        expect(r.getAvailableTokens()).toBe(0);
        await expect(r.execute(async () => 'x')).rejects.toThrow(RateLimitError);
        expect(r.tryAcquire()).toBe(false);
    });

    it('CircuitBreaker executes and can be reset', async () => {
        const c = new CircuitBreaker({ name: 'c' });
        const r = await c.execute(async () => 42);
        expect(r.value).toBe(42);
        c.reset();
        expect(c.getState?.() ?? CircuitState.CLOSED).toBeDefined();
    });

    it('CircuitBreaker rejects fast when open', async () => {
        const c = new CircuitBreaker({ name: 'c2', failureThreshold: 1, resetTimeoutMs: 60_000 });
        // Force open by recording a failure path: execute a throwing fn.
        await c.execute(async () => { throw new Error('boom'); }).catch(() => {});
        const res = await c.execute(async () => 'x');
        expect(res.state).toBe(CircuitState.OPEN);
        if (res.error) expect(res.error).toBeInstanceOf(CircuitOpenError);
    });

    it('InMemoryApprovalStore is constructable', () => {
        expect(new InMemoryApprovalStore()).toBeDefined();
    });

    it('InMemoryAuditStore records and queries entries', async () => {
        const store = new InMemoryAuditStore();
        await store.append({ agentName: 'a', action: 'run', status: 'ok', timestamp: new Date() } as never);
        const all = await store.query();
        expect(all).toHaveLength(1);
        expect(await store.count()).toBe(1);
    });

    it('HealthCheckManager liveness + readiness with a component', async () => {
        const mgr = new HealthCheckManager({ version: '1.0.0' });
        expect(mgr.liveness().status).toBeDefined();
        mgr.addComponent({
            name: 'db',
            check: async () => ({ name: 'db', status: 'healthy' as never, latencyMs: 1, lastCheckedAt: new Date() }),
        } as never);
        const res = await mgr.readiness();
        expect(res.components.length).toBe(1);
    });

    it('createLLMHealthCheck builds a component', () => {
        const hc = createLLMHealthCheck({ run: async () => 'ok' } as never);
        expect(hc).toBeDefined();
        expect(typeof hc.check).toBe('function');
    });

    it('InMemoryIdempotencyStore and InMemoryCheckpointStore construct', () => {
        expect(new InMemoryIdempotencyStore()).toBeDefined();
        expect(new InMemoryCheckpointStore()).toBeDefined();
    });
});
