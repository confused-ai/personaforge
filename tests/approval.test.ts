/**
 * Hermetic unit tests for the approval layer (src/approval) — the suspended-run
 * stores and the human-in-the-loop signal types. No network, no LLM.
 */

import { describe, it, expect } from 'vitest';
import {
    InMemorySuspendedRunStore,
    ApprovalRequiredError,
    ToolSuspendedError,
    isApprovalRequiredError,
    isToolSuspendedError,
    type SuspendedRun,
    type SuspendedRunStore,
} from '@personaforge/approval';

function makeRun(runId: string, overrides: Partial<SuspendedRun> = {}): SuspendedRun {
    return {
        runId,
        agentId: 'agent-1',
        threadId: 'thread-1',
        resourceId: 'res-1',
        status: 'approval',
        toolCalls: [
            {
                toolCallId: 'call-1',
                toolName: 'check',
                args: { q: 1 },
                requiresApproval: true,
            },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

// ── Store CRUD ───────────────────────────────────────────────────────────────

describe('InMemorySuspendedRunStore', () => {
    it('save + getByRunId round-trips a run', async () => {
        const store = new InMemorySuspendedRunStore();
        await store.save(makeRun('r-1'));
        const got = await store.getByRunId('r-1');
        expect(got?.runId).toBe('r-1');
        expect(got?.toolCalls[0].toolCallId).toBe('call-1');
        expect(got?.status).toBe('approval');
    });

    it('getByRunId returns null for an unknown run', async () => {
        const store = new InMemorySuspendedRunStore();
        expect(await store.getByRunId('missing')).toBeNull();
    });

    it('list filters by agentId, threadId, resourceId', async () => {
        const store = new InMemorySuspendedRunStore();
        await store.save(makeRun('r-1'));
        await store.save(makeRun('r-2', { agentId: 'agent-2', threadId: 'thread-2' }));
        await store.save(makeRun('r-3', { threadId: 'thread-1', resourceId: 'res-9' }));

        expect((await store.list()).map((r) => r.runId).sort()).toEqual(['r-1', 'r-2', 'r-3']);
        expect((await store.list({ agentId: 'agent-2' })).map((r) => r.runId)).toEqual(['r-2']);
        expect((await store.list({ threadId: 'thread-1', resourceId: 'res-1' })).map((r) => r.runId)).toEqual(['r-1']);
    });

    it('list excludes resolved runs unless includeResolved is set', async () => {
        const store = new InMemorySuspendedRunStore();
        await store.save(makeRun('r-1'));
        await store.save(makeRun('r-2', { resolved: true }));
        expect((await store.list()).map((r) => r.runId)).toEqual(['r-1']);
        expect((await store.list({ includeResolved: true })).map((r) => r.runId).sort()).toEqual(['r-1', 'r-2']);
    });

    it('list sorts by updatedAt descending', async () => {
        const store = new InMemorySuspendedRunStore();
        await store.save(makeRun('old', { updatedAt: '2026-01-01T00:00:00.000Z' }));
        await store.save(makeRun('new', { updatedAt: '2026-02-01T00:00:00.000Z' }));
        expect((await store.list()).map((r) => r.runId)).toEqual(['new', 'old']);
    });

    it('delete removes a run', async () => {
        const store = new InMemorySuspendedRunStore();
        await store.save(makeRun('r-1'));
        await store.delete('r-1');
        expect(await store.getByRunId('r-1')).toBeNull();
    });
});

// ── markResolved ─────────────────────────────────────────────────────────────

describe('InMemorySuspendedRunStore.markResolved', () => {
    it('marks a run resolved and bumps updatedAt', async () => {
        const store = new InMemorySuspendedRunStore();
        await store.save(makeRun('r-1'));
        await store.markResolved('r-1');
        const got = await store.getByRunId('r-1');
        expect(got?.resolved).toBe(true);
        expect(got?.status).toBe('approval'); // unchanged
        expect(got?.toolCalls).toHaveLength(1); // preserved
    });

    it('preserves toolCalls even when the update carries stale ones (regression)', async () => {
        const store = new InMemorySuspendedRunStore();
        await store.save(makeRun('r-1'));
        await store.markResolved('r-1', {
            // A stale update attempting to overwrite the record's tool calls.
            toolCalls: [],
        } as Partial<SuspendedRun>);
        const got = await store.getByRunId('r-1');
        expect(got?.toolCalls).toHaveLength(1);
        expect(got?.toolCalls[0].toolCallId).toBe('call-1');
        expect(got?.resolved).toBe(true);
    });

    it('throws on an unknown runId instead of silently no-oping (regression)', async () => {
        const store = new InMemorySuspendedRunStore();
        await expect(store.markResolved('missing')).rejects.toThrow(/No suspended run found for "missing"/);
    });

    it('honors an explicit status in the update', async () => {
        const store = new InMemorySuspendedRunStore();
        await store.save(makeRun('r-1'));
        await store.markResolved('r-1', { status: 'suspended' } as Partial<SuspendedRun>);
        const got = await store.getByRunId('r-1');
        expect(got?.status).toBe('suspended');
        expect(got?.resolved).toBe(true);
    });
});

// ── Signals ──────────────────────────────────────────────────────────────────

describe('approval signals', () => {
    it('ApprovalRequiredError carries tool call details and step', () => {
        const err = new ApprovalRequiredError(
            { id: 'c1', name: 'pay', arguments: { amount: 100 } },
            3,
        );
        expect(err.name).toBe('ApprovalRequiredError');
        expect(err.message).toContain('requires approval');
        expect(err.toolCallId).toBe('c1');
        expect(err.toolName).toBe('pay');
        expect(err.args).toEqual({ amount: 100 });
        expect(err.step).toBe(3);
        expect(isApprovalRequiredError(err)).toBe(true);
        expect(isApprovalRequiredError(new Error('x'))).toBe(false);
    });

    it('ToolSuspendedError carries the payload and optional info', () => {
        const err = new ToolSuspendedError({ ask: 'more input' }, { toolName: 'ask', toolCallId: 'c2' });
        expect(err.name).toBe('ToolSuspendedError');
        expect(err.payload).toEqual({ ask: 'more input' });
        expect(err.toolName).toBe('ask');
        expect(err.toolCallId).toBe('c2');
        expect(isToolSuspendedError(err)).toBe(true);
        expect(isToolSuspendedError(null)).toBe(false);
    });

    it('ToolSuspendedError works with no info', () => {
        const err = new ToolSuspendedError('data');
        expect(err.toolName).toBe('');
        expect(err.toolCallId).toBeUndefined();
        expect(err.message).toBe('Tool suspended awaiting input');
    });
});

// ── Interface conformance ────────────────────────────────────────────────────

describe('store interface', () => {
    it('InMemorySuspendedRunStore satisfies SuspendedRunStore', () => {
        const store: SuspendedRunStore = new InMemorySuspendedRunStore();
        expect(typeof store.save).toBe('function');
        expect(typeof store.getByRunId).toBe('function');
        expect(typeof store.list).toBe('function');
        expect(typeof store.markResolved).toBe('function');
        expect(typeof store.delete).toBe('function');
    });
});
