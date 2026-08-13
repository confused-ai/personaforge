import { describe, it, expect, beforeEach } from 'vitest';
import {
    InMemoryRunStore,
    type RunRecord,
} from '../src/production/run-store.js';

describe('InMemoryRunStore', () => {
    let store: InMemoryRunStore;
    const run: RunRecord = {
        runId: 'run_001',
        tenantId: 'acme',
        userId: 'user_1',
        agentId: 'support-agent',
        sessionId: 'sess_001',
        status: 'completed',
        input: 'Hello',
        output: 'Hi there!',
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-01-01T00:00:05.000Z',
        durationMs: 5000,
        promptTokens: 50,
        completionTokens: 100,
        totalTokens: 150,
        costUsd: 0.001,
        model: 'gpt-4o-mini',
        finishReason: 'stop',
    };

    beforeEach(() => {
        store = new InMemoryRunStore();
    });

    it('saves and retrieves a run record', async () => {
        await store.save(run);
        const retrieved = await store.get('run_001');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.runId).toBe('run_001');
        expect(retrieved!.tenantId).toBe('acme');
        expect(retrieved!.costUsd).toBe(0.001);
        expect(retrieved!.finishReason).toBe('stop');
    });

    it('returns null for missing run', async () => {
        const retrieved = await store.get('nonexistent');
        expect(retrieved).toBeNull();
    });

    it('updates an existing run record', async () => {
        await store.save(run);
        const updated: RunRecord = {
            ...run,
            status: 'failed',
            error: 'LLM call failed',
            errorCode: 'PROVIDER_OVERLOADED',
            endTime: '2025-01-01T00:00:03.000Z',
            durationMs: 3000,
        };
        await store.save(updated);
        const retrieved = await store.get('run_001');
        expect(retrieved!.status).toBe('failed');
        expect(retrieved!.error).toBe('LLM call failed');
        expect(retrieved!.errorCode).toBe('PROVIDER_OVERLOADED');
    });

    it('lists runs sorted by startTime descending', async () => {
        const run1 = { ...run, runId: 'run_001', startTime: '2025-01-01T00:00:01.000Z' };
        const run2 = { ...run, runId: 'run_002', startTime: '2025-01-01T00:00:02.000Z' };
        const run3 = { ...run, runId: 'run_003', startTime: '2025-01-01T00:00:03.000Z' };
        await store.save(run1);
        await store.save(run2);
        await store.save(run3);
        const all = await store.list();
        expect(all.map((r) => r.runId)).toEqual(['run_003', 'run_002', 'run_001']);
    });

    it('filters by tenantId', async () => {
        const acmeRun = { ...run, runId: 'run_001', tenantId: 'acme' };
        const otherRun = { ...run, runId: 'run_002', tenantId: 'other' };
        await store.save(acmeRun);
        await store.save(otherRun);
        const acmeRuns = await store.list({ tenantId: 'acme' });
        expect(acmeRuns).toHaveLength(1);
        expect(acmeRuns[0]!.runId).toBe('run_001');
    });

    it('filters by status', async () => {
        const completed = { ...run, runId: 'run_001', status: 'completed' as const };
        const failed = { ...run, runId: 'run_002', status: 'failed' as const };
        await store.save(completed);
        await store.save(failed);
        const failedRuns = await store.list({ status: 'failed' });
        expect(failedRuns).toHaveLength(1);
        expect(failedRuns[0]!.runId).toBe('run_002');
    });

    it('filters by multiple statuses', async () => {
        const running = { ...run, runId: 'run_001', status: 'running' as const };
        const paused = { ...run, runId: 'run_002', status: 'paused' as const };
        const done = { ...run, runId: 'run_003', status: 'completed' as const };
        await store.save(running);
        await store.save(paused);
        await store.save(done);
        const active = await store.list({ status: ['running', 'paused'] });
        expect(active).toHaveLength(2);
    });

    it('lists incomplete runs for recovery', async () => {
        const running = { ...run, runId: 'run_001', status: 'running' as const };
        const paused = { ...run, runId: 'run_002', status: 'paused' as const };
        const awaiting = { ...run, runId: 'run_003', status: 'awaiting_approval' as const };
        const done = { ...run, runId: 'run_004', status: 'completed' as const };
        await store.save(running);
        await store.save(paused);
        await store.save(awaiting);
        await store.save(done);
        const incomplete = await store.listIncomplete();
        expect(incomplete).toHaveLength(3);
    });

    it('deletes a run record', async () => {
        await store.save(run);
        await store.delete('run_001');
        const retrieved = await store.get('run_001');
        expect(retrieved).toBeNull();
    });

    it('counts records with filter', async () => {
        const agentA = { ...run, runId: 'run_001', agentId: 'support' };
        const agentB = { ...run, runId: 'run_002', agentId: 'billing' };
        await store.save(agentA);
        await store.save(agentB);
        const count = await store.count({ agentId: 'support' });
        expect(count).toBe(1);
    });

    it('handles pagination (offset/limit)', async () => {
        for (let i = 1; i <= 10; i++) {
            await store.save({ ...run, runId: `run_${String(i).padStart(3, '0')}`, startTime: `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z` });
        }
        const page1 = await store.list({ limit: 3 });
        expect(page1).toHaveLength(3);
        expect(page1[0]!.runId).toBe('run_010');
        const page2 = await store.list({ limit: 3, offset: 3 });
        expect(page2).toHaveLength(3);
        expect(page2[0]!.runId).toBe('run_007');
    });

    it('supports metadata', async () => {
        const withMeta: RunRecord = {
            ...run,
            metadata: { source: 'web', priority: 'high', tags: ['urgent'] },
        };
        await store.save(withMeta);
        const retrieved = await store.get('run_001');
        expect(retrieved!.metadata).toEqual({ source: 'web', priority: 'high', tags: ['urgent'] });
    });

    it('handles traceId', async () => {
        const traced: RunRecord = { ...run, traceId: 'trace_abc123' };
        await store.save(traced);
        const retrieved = await store.get('run_001');
        expect(retrieved!.traceId).toBe('trace_abc123');
    });
});
