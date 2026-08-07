import { describe, it, expect, vi } from 'vitest';
import { createHarness } from '../src/harness/create-harness.js';
import { withResilience } from '../src/production/resilient-agent.js';
import { TimeoutError, CancellationError } from '../src/shared/errors.js';
import { RateLimitError } from '../src/production/rate-limiter.js';

const flushable = (ms: number, signal?: AbortSignal) =>
    new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ text: 'slow' }), ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
        });
    });

describe('resilient agent — per-call timeout', () => {
    it('enforces callTimeoutMs and aborts the underlying agent', async () => {
        const seen: AbortSignal[] = [];
        const agent = {
            name: 'slow',
            instructions: '',
            run: async (_p: string, o?: { signal?: AbortSignal }) => {
                if (o?.signal) seen.push(o.signal);
                return flushable(5_000, o?.signal);
            },
        };
        const resilient = withResilience(agent, {
            circuitBreaker: { callTimeoutMs: 50 },
            rateLimit: false,
            retry: false,
        });

        await expect(resilient.run('hi')).rejects.toBeInstanceOf(TimeoutError);
        // the signal handed to the agent must have been aborted on timeout
        expect(seen[0]?.aborted).toBe(true);
    });

    it('propagates an external AbortSignal to the underlying agent', async () => {
        const controller = new AbortController();
        const agent = {
            name: 'abortable',
            instructions: '',
            run: async (_p: string, o?: { signal?: AbortSignal }) => flushable(5_000, o?.signal),
        };
        const resilient = withResilience(agent, { rateLimit: false, retry: false });
        const p = resilient.run('hi', { signal: controller.signal });
        controller.abort();
        await expect(p).rejects.toThrow();
    });
});

describe('resilient agent — retry + rate limit', () => {
    it('retries transient errors and succeeds', async () => {
        let calls = 0;
        const agent = {
            name: 'flaky',
            instructions: '',
            run: async () => {
                calls++;
                if (calls < 3) {
                    const e = new Error('boom') as Error & { status: number };
                    e.status = 503; // transient
                    throw e;
                }
                return { text: 'ok' };
            },
        };
        const resilient = withResilience(agent, {
            rateLimit: false,
            retry: { maxRetries: 3, backoffMs: 1, maxBackoffMs: 2 },
        });
        await expect(resilient.run('go')).resolves.toEqual({ text: 'ok' });
        expect(calls).toBe(3);
    });

    it('does NOT retry a non-transient 400 error', async () => {
        let calls = 0;
        const agent = {
            name: 'bad-request',
            instructions: '',
            run: async () => {
                calls++;
                const e = new Error('bad input') as Error & { status: number };
                e.status = 400;
                throw e;
            },
        };
        const resilient = withResilience(agent, {
            rateLimit: false,
            retry: { maxRetries: 3, backoffMs: 1 },
        });
        await expect(resilient.run('go')).rejects.toThrow('bad input');
        expect(calls).toBe(1);
    });

    it('rejects with RateLimitError before reaching the agent', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'ok' });
        const agent = { name: 'limited', instructions: '', run };
        const resilient = withResilience(agent, {
            rateLimit: { maxRpm: 1 },
            retry: false,
            circuitBreaker: false,
        });
        await resilient.run('one');
        const before = run.mock.calls.length;
        await expect(resilient.run('two')).rejects.toBeInstanceOf(RateLimitError);
        // agent was never invoked for the rejected call
        expect(run.mock.calls.length).toBe(before);
    });
});

describe('harness — hooks compose inside resilience', () => {
    it('runs hooks on every retry attempt, not once around the ladder', async () => {
        let attempts = 0;
        const beforeRun = vi.fn();
        const agent = {
            name: 'hooked',
            instructions: 'i',
            createSession: async () => 's',
            run: async (_p: string, o?: { hooks?: unknown }) => {
                attempts++;
                if (o?.hooks) beforeRun();
                if (attempts < 3) {
                    const e = new Error('flaky') as Error & { status: number };
                    e.status = 503;
                    throw e;
                }
                return { text: 'done' };
            },
        };
        const harness = createHarness({
            agent: agent as never,
            hooks: { beforeRun: () => undefined },
            resilience: { rateLimit: false, retry: { maxRetries: 3, backoffMs: 1 } },
        });
        await expect(harness.run('go')).resolves.toEqual({ text: 'done' });
        expect(attempts).toBe(3);
        // hooks were attached on each of the 3 underlying attempts
        expect(beforeRun).toHaveBeenCalledTimes(3);
    });
});

describe('harness — deadline, idempotency, budget', () => {
    it('aborts the run once deadlineMs elapses', async () => {
        const harness = createHarness({
            agent: {
                name: 'slow',
                run: async (_i: unknown, o?: { signal?: AbortSignal }) => flushable(5_000, o?.signal),
            } as never,
            resilience: false,
        });
        await expect(harness.run('hi', { deadlineMs: 30 })).rejects.toBeInstanceOf(CancellationError);
    });

    it('de-duplicates identical idempotency keys', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'once' });
        const harness = createHarness({
            agent: { name: 'idem', run } as never,
            resilience: false,
            idempotency: true,
        });
        const a = await harness.run('x', { idempotencyKey: 'k1' });
        const b = await harness.run('x', { idempotencyKey: 'k1' });
        expect(a).toEqual({ text: 'once' });
        expect(b).toEqual({ text: 'once' });
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('releases the idempotency reservation on failure so retries can proceed', async () => {
        const run = vi
            .fn()
            .mockRejectedValueOnce(new Error('nope'))
            .mockResolvedValue({ text: 'second' });
        const harness = createHarness({
            agent: { name: 'idem2', run } as never,
            resilience: false,
            idempotency: true,
        });
        await expect(harness.run('x', { idempotencyKey: 'k2' })).rejects.toThrow('nope');
        await expect(harness.run('x', { idempotencyKey: 'k2' })).resolves.toEqual({ text: 'second' });
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('enforces a per-run budget cap', async () => {
        const harness = createHarness({
            agent: {
                name: 'spendy',
                run: async () => ({
                    text: 'expensive',
                    model: 'gpt-4o',
                    usage: { promptTokens: 5_000_000, completionTokens: 5_000_000 },
                }),
            } as never,
            resilience: false,
            budget: { maxUsdPerRun: 0.01, onExceeded: 'throw' },
        });
        await expect(harness.run('go')).rejects.toThrow(/budget/i);
    });

    it('writes an audit entry for successful and failed runs', async () => {
        const entries: unknown[] = [];
        const audit = {
            append: async (e: unknown) => { entries.push(e); },
            query: async () => [],
        };
        const harness = createHarness({
            agent: { name: 'audited', run: async () => ({ text: 'ok' }) } as never,
            resilience: false,
            audit: audit as never,
        });
        await harness.run('go');
        await new Promise(r => setTimeout(r, 5));
        expect(entries).toHaveLength(1);
        expect((entries[0] as { outcome: string }).outcome).toBe('success');
    });
});
