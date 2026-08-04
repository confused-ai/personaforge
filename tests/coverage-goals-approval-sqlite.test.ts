/**
 * Hermetic coverage for sqlite-backed goals + approval stores (better-sqlite3,
 * :memory:). Callers: vitest only.
 */

import { describe, it, expect } from 'vitest';
import { createSqliteGoalStore } from '../src/goals/store.js';
import { createSqliteSuspendedRunStore } from '../src/approval/store.js';
import type { SuspendedRun } from '../src/approval/store.js';

describe('goals/sqlite-store', () => {
    it('set/get/updateOptions/clear/listIncomplete', async () => {
        const store = createSqliteGoalStore(':memory:');
        expect(await store.getObjective('t1')).toBeNull();

        await store.setObjective({
            objective: 'ship it',
            threadId: 't1',
            resourceId: 'r1',
            maxRuns: 10,
            runsUsed: 1,
            status: 'active',
            activeDurationMs: 5000,
            prompt: 'be strict',
            updatedAt: '2026-01-01',
        });
        const got = await store.getObjective('t1');
        expect(got?.objective).toBe('ship it');
        expect(got?.resourceId).toBe('r1');
        expect(got?.maxRuns).toBe(10);
        expect(got?.runsUsed).toBe(1);
        expect(got?.activeDurationMs).toBe(5000);
        expect(got?.prompt).toBe('be strict');

        await store.updateOptions('t1', { maxRuns: 99 });
        expect((await store.getObjective('t1'))?.maxRuns).toBe(99);
        await store.updateOptions('missing', { maxRuns: 1 }); // no-op

        await store.setObjective({ objective: 'second', threadId: 't2', runsUsed: 0, status: 'active', updatedAt: '2026-01-02' });
        expect((await store.listIncomplete()).length).toBe(2);

        await store.clear('t1');
        expect(await store.getObjective('t1')).toBeNull();
        expect((await store.listIncomplete()).length).toBe(1);
    });

    it('round-trips nullable fields', async () => {
        const store = createSqliteGoalStore(':memory:');
        await store.setObjective({ objective: 'minimal', threadId: 't3', runsUsed: 0, status: 'active', updatedAt: 'x' });
        const got = await store.getObjective('t3');
        expect(got?.resourceId).toBeUndefined();
        expect(got?.maxRuns).toBeUndefined();
        expect(got?.prompt).toBeUndefined();
        expect(got?.status).toBe('active');
    });
});

describe('approval/sqlite-store', () => {
    function makeRun(runId: string, overrides: Partial<SuspendedRun> = {}): SuspendedRun {
        return {
            runId,
            agentId: 'a1',
            threadId: 't1',
            resourceId: 'r1',
            status: 'approval',
            toolCalls: [{ toolCallId: 'c1', toolName: 'check', args: { q: 1 }, requiresApproval: true }],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
            ...overrides,
        };
    }

    it('save/get/list/markResolved/delete', async () => {
        const store = createSqliteSuspendedRunStore(':memory:');
        expect(await store.getByRunId('r1')).toBeNull();

        await store.save(makeRun('r1'));
        await store.save(makeRun('r2', { threadId: 't2', status: 'suspended', resolved: false }));
        await store.save(makeRun('r3', { agentId: 'a2', threadId: 't1' }));

        expect((await store.getByRunId('r1'))?.status).toBe('approval');

        // list filters
        expect((await store.list({})).length).toBe(3);
        expect((await store.list({ agentId: 'a1' })).length).toBe(2);
        expect((await store.list({ threadId: 't1', agentId: 'a1' })).length).toBe(1);
        expect((await store.list({ includeResolved: true })).length).toBe(3);

        // markResolved
        await store.markResolved('r1', { status: 'approved' });
        const resolved = await store.getByRunId('r1');
        expect(resolved?.resolved).toBe(true);
        expect(resolved?.status).toBe('approved');
        expect((await store.list({}))).toHaveLength(2); // r1 excluded by default

        await expect(store.markResolved('missing')).rejects.toThrow(/No suspended run/);

        await store.delete('r2');
        expect(await store.getByRunId('r2')).toBeNull();
    });

    it('upsert on conflict + list ordering by updated_at desc', async () => {
        const store = createSqliteSuspendedRunStore(':memory:');
        await store.save(makeRun('r1', { updatedAt: '2026-01-01' }));
        await store.save(makeRun('r1', { updatedAt: '2026-02-01', status: 'suspended' }));
        expect((await store.getByRunId('r1'))?.updatedAt).toBe('2026-02-01');

        await store.save(makeRun('r2', { updatedAt: '2026-03-01' }));
        const list = await store.list({ includeResolved: true });
        expect(list[0]?.runId).toBe('r2'); // newest first
    });
});
