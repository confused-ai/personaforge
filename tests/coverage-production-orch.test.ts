/**
 * Hermetic coverage for src/production/* and src/orchestration/* zero/partial files.
 * Loaded only by vitest (tests include glob). Temp SQLite under os.tmpdir().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    InMemoryApprovalStore,
    ApprovalRejectedError,
    waitForApproval,
    requireApprovalTool,
    SqliteApprovalStore,
    createSqliteApprovalStore,
} from '../src/production/approval-store.js';
import {
    GracefulShutdown,
    createGracefulShutdown,
    withShutdownGuard,
} from '../src/production/graceful-shutdown.js';
import {
    ResumableStreamManager,
    formatSSE,
    createResumableStream,
} from '../src/production/resumable-stream.js';
import {
    InMemoryCheckpointStore,
    SqliteCheckpointStore,
    createSqliteCheckpointStore,
} from '../src/production/checkpoint.js';
import { deleteSession } from '../src/production/cascade-delete.js';
import { MetricType } from '../src/production/_types.js';

import { createAgentEventBus, AgentEventBusTimeoutError } from '../src/orchestration/event-bus.js';
import {
    RoundRobinLoadBalancer,
    LeastConnectionsLoadBalancer,
    WeightedResponseTimeLoadBalancer,
} from '../src/orchestration/core/load-balancer.js';
import { createToolkit, toolkitsToRegistry } from '../src/orchestration/core/toolkit.js';
import { AgentContextBuilder } from '../src/orchestration/_context-builder.js';
import { createRunnableAgent } from '../src/orchestration/core/agent-adapter.js';
import { createConsensus } from '../src/orchestration/multi-agent/consensus.js';
import { createAgentRouter } from '../src/orchestration/multi-agent/router.js';
import { createPipeline } from '../src/orchestration/multi-agent/pipeline.js';
import { createSupervisor, createRole } from '../src/orchestration/multi-agent/supervisor.js';
import { createHandoff } from '../src/orchestration/multi-agent/handoff.js';
import { Team, createResearchTeam, createDecisionTeam } from '../src/orchestration/multi-agent/team.js';
import {
    createMixtureOfAgents,
    createActorCritic,
    createSocraticAgent,
    createPromptChain,
    createProgramOfThought,
    createSkeletonOfThought,
    createStepBackAgent,
    createRejectionSampling,
    createSelfCorrection,
} from '../src/orchestration/multi-agent/patterns.js';
import {
    textPart,
    dataPart,
    filePart,
    userMessage,
    agentMessage,
    A2A_ERRORS,
} from '../src/orchestration/a2a/types.js';
import { A2AClient, createA2AClient } from '../src/orchestration/a2a/client.js';
import { HttpA2AClient, createHttpA2AClient } from '../src/orchestration/a2a/http-client.js';
import { A2AServer, createA2AServer } from '../src/orchestration/a2a/server.js';
import { AgentState } from '../src/core/index.js';
import { z } from 'zod';
import { DelegationPriority, type AgentRegistration, type DelegationTask } from '../src/orchestration/core/types.js';
import type { EntityId } from '../src/core/index.js';

function makeAgenticResult(text: string, finishReason: string = 'stop') {
    return {
        text,
        markdown: { name: 'r', content: text, mimeType: 'text/markdown', type: 'markdown' as const },
        messages: [],
        steps: 1,
        finishReason,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
}

function makeCoreAgent(name: string, text: string, finishReason: string = 'stop') {
    return {
        id: `agent-${name}`,
        name,
        instructions: `You are ${name}`,
        run: vi.fn(async () => makeAgenticResult(text, finishReason)),
    } as any;
}

function makeOrchestrable(name: string, result: unknown) {
    return createRunnableAgent({
        id: name,
        name,
        run: async () => ({
            result,
            state: AgentState.COMPLETED,
            metadata: { startTime: new Date(), iterations: 1 },
        }),
    });
}

function makeRegistration(
    id: string,
    currentLoad: number,
    maxConcurrentTasks = 2,
): AgentRegistration {
    return {
        agent: makeOrchestrable(id, 'ok'),
        role: createRole(id, ['do stuff']),
        capabilities: ['general'],
        metadata: {
            registeredAt: new Date(),
            currentLoad,
            maxConcurrentTasks,
            totalTasksCompleted: 0,
            totalTasksFailed: 0,
            averageExecutionTimeMs: 100,
        },
    };
}

const dummyTask: DelegationTask = {
    id: 't1',
    description: 'task',
    priority: DelegationPriority.NORMAL,
    requiredCapabilities: [],
    input: { prompt: 'task' },
};

describe('InMemoryApprovalStore', () => {
    it('create/get/decide/list/expire full lifecycle', async () => {
        const store = new InMemoryApprovalStore();
        const req = await store.create({
            runId: 'run-1',
            agentName: 'Safe',
            toolName: 'charge',
            toolArguments: { amount: 10 },
            riskLevel: 'high',
            ttlMs: 50,
            description: 'charge card',
            requestedBy: 'u1',
        });
        expect(req.status).toBe('pending');
        expect(await store.get(req.id)).toMatchObject({ id: req.id });
        expect(await store.get('missing')).toBeNull();
        expect((await store.getByRunId('run-1'))?.id).toBe(req.id);
        expect(await store.getByRunId('nope')).toBeNull();

        const listed = await store.listPending('Safe');
        expect(listed).toHaveLength(1);
        expect(await store.listPending('Other')).toHaveLength(0);

        const approved = await store.decide(req.id, { approved: true, comment: 'ok', decidedBy: 'admin' });
        expect(approved.status).toBe('approved');
        await expect(store.decide(req.id, { approved: false })).rejects.toThrow(/already/);
        await expect(store.decide('x', { approved: true })).rejects.toThrow(/not found/);

        const short = await store.create({
            runId: 'run-2',
            agentName: 'Safe',
            toolName: 'send',
            toolArguments: {},
            riskLevel: 'medium',
            ttlMs: 1,
        });
        await new Promise((r) => setTimeout(r, 5));
        expect(await store.expireStale()).toBeGreaterThanOrEqual(1);
        expect((await store.get(short.id))?.status).toBe('expired');
    });

    it('ApprovalRejectedError sets fields', () => {
        const err = new ApprovalRejectedError({ approvalId: 'a', toolName: 't', comment: 'no' });
        expect(err.approvalId).toBe('a');
        expect(err.toolName).toBe('t');
        expect(err.comment).toBe('no');
        expect(err.message).toContain('no');
        const err2 = new ApprovalRejectedError({ approvalId: 'a', toolName: 't' });
        expect(err2.message).toContain("tool 't'");
    });

    it('waitForApproval resolves / rejects / times out', async () => {
        const store = new InMemoryApprovalStore();
        const req = await store.create({
            runId: 'r',
            agentName: 'a',
            toolName: 't',
            toolArguments: {},
            riskLevel: 'low',
        });
        setTimeout(() => void store.decide(req.id, { approved: true, decidedBy: 'me' }), 20);
        const decided = await waitForApproval(store, req.id, { pollIntervalMs: 5, timeoutMs: 2000 });
        expect(decided.status).toBe('approved');

        const rej = await store.create({
            runId: 'r2',
            agentName: 'a',
            toolName: 't',
            toolArguments: {},
            riskLevel: 'low',
        });
        setTimeout(() => void store.decide(rej.id, { approved: false, comment: 'nope' }), 10);
        await expect(waitForApproval(store, rej.id, { pollIntervalMs: 5, timeoutMs: 2000 })).rejects.toBeInstanceOf(
            ApprovalRejectedError,
        );

        await expect(waitForApproval(store, 'missing', { pollIntervalMs: 5, timeoutMs: 50 })).rejects.toThrow(
            /not found/,
        );

        const e2 = await store.create({
            runId: 'r4',
            agentName: 'a',
            toolName: 'toolX',
            toolArguments: {},
            riskLevel: 'low',
            ttlMs: 1,
        });
        await new Promise((r) => setTimeout(r, 5));
        await store.expireStale();
        await expect(waitForApproval(store, e2.id, { pollIntervalMs: 5, timeoutMs: 100 })).rejects.toBeInstanceOf(
            ApprovalRejectedError,
        );

        const never = await store.create({
            runId: 'r5',
            agentName: 'a',
            toolName: 't',
            toolArguments: {},
            riskLevel: 'low',
        });
        await expect(waitForApproval(store, never.id, { pollIntervalMs: 5, timeoutMs: 30 })).rejects.toBeInstanceOf(
            ApprovalRejectedError,
        );
    });

    it('requireApprovalTool executes and returns approved', async () => {
        const store = new InMemoryApprovalStore();
        const t = requireApprovalTool(store, {
            name: 'ask',
            agentName: 'bot',
            riskLevel: 'critical',
            pollIntervalMs: 5,
            timeoutMs: 2000,
            ttlMs: 5000,
        });
        const decideLater = async () => {
            for (let i = 0; i < 40; i++) {
                const pending = await store.listPending();
                if (pending[0]) {
                    await store.decide(pending[0].id, { approved: true, comment: 'go', decidedBy: 'h' });
                    return;
                }
                await new Promise((r) => setTimeout(r, 10));
            }
        };
        void decideLater();
        const out = await t.execute(
            { action: 'wire', details: { n: 1 }, runId: 'run-x' },
            { sessionId: 's', agentId: 'bot' } as any,
        );
        expect(out).toMatchObject({ success: true, data: { approved: true } });
    });

    it('SqliteApprovalStore CRUD with better-sqlite3', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hitl-'));
        const dbPath = join(dir, 'a.db');
        try {
            const store = createSqliteApprovalStore(dbPath);
            expect(store).toBeInstanceOf(SqliteApprovalStore);
            const req = await store.create({
                runId: 'run',
                agentName: 'A',
                toolName: 't',
                toolArguments: { x: 1 },
                riskLevel: 'low',
                description: 'd',
                requestedBy: 'u',
            });
            expect(await store.get(req.id)).toMatchObject({ id: req.id, toolName: 't' });
            expect(await store.get('no')).toBeNull();
            expect((await store.getByRunId('run'))?.id).toBe(req.id);
            expect(await store.getByRunId('no')).toBeNull();
            expect((await store.listPending('A')).length).toBe(1);
            expect((await store.listPending()).length).toBe(1);
            const decided = await store.decide(req.id, { approved: false, comment: 'no', decidedBy: 'x' });
            expect(decided.status).toBe('rejected');
            await expect(store.decide(req.id, { approved: true })).rejects.toThrow(/already/);
            await expect(store.decide('missing', { approved: true })).rejects.toThrow(/not found/);
            await store.create({
                runId: 'r2',
                agentName: 'A',
                toolName: 't2',
                toolArguments: {},
                riskLevel: 'medium',
                ttlMs: 60_000,
            });
            expect(await store.expireStale()).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('GracefulShutdown', () => {
    it('handlers, replace, remove, drain, guard, and shutdown without exit', async () => {
        const logs: string[] = [];
        const logger = {
            debug: (m: string) => logs.push(`d:${m}`),
            info: (m: string) => logs.push(`i:${m}`),
            warn: (m: string) => logs.push(`w:${m}`),
            error: (m: string) => logs.push(`e:${m}`),
            fatal: (m: string) => logs.push(`f:${m}`),
            child: () => logger,
        };
        const gs = new GracefulShutdown({
            timeoutMs: 500,
            forceExitOnTimeout: false,
            logger,
            signals: [],
        });
        expect(gs.isInProgress()).toBe(false);
        const ok = vi.fn(async () => undefined);
        const bad = vi.fn(async () => {
            throw new Error('boom');
        });
        gs.addHandler('ok', ok);
        gs.addHandler('ok', ok);
        gs.addHandler('bad', bad);
        gs.onDrain(async () => undefined);
        expect(gs.getHandlerNames()).toContain('ok');
        expect(gs.removeHandler('bad')).toBe(true);
        expect(gs.removeHandler('nope')).toBe(false);

        await expect(withShutdownGuard(gs, async () => 'yes')).resolves.toBe('yes');

        const p1 = gs.shutdown({ reason: 'test' });
        const p2 = gs.shutdown();
        await Promise.all([p1, p2]);
        expect(gs.isInProgress()).toBe(true);
        await gs.waitForShutdown();
        await expect(withShutdownGuard(gs, async () => 1)).rejects.toThrow(/shutdown in progress/);

        const gs2 = createGracefulShutdown({ a: async () => undefined }, { forceExitOnTimeout: false, timeoutMs: 200, signals: [] });
        await gs2.shutdown({ signal: 'SIGINT' });

        const slow = new GracefulShutdown({ timeoutMs: 30, forceExitOnTimeout: false, logger, signals: [] });
        slow.addHandler('slow', () => new Promise((r) => setTimeout(r, 200)));
        await slow.shutdown();

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
        const gs3 = new GracefulShutdown({ forceExitOnTimeout: false, timeoutMs: 100, signals: [] });
        gs3.addHandler('x', () => {
            throw new Error('fail');
        });
        await gs3.shutdown();
        exitSpy.mockRestore();
    });

    it('listen registers signal handlers', () => {
        const gs = new GracefulShutdown({ forceExitOnTimeout: false, signals: ['SIGUSR2' as NodeJS.Signals] });
        const spy = vi.spyOn(process, 'on');
        gs.listen();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
        // prevent accidental signal firing from leaving process listeners forever in later runs
        process.removeAllListeners('SIGUSR2');
    });
});

describe('ResumableStreamManager', () => {
    it('create/save/complete/resume/evict/cleanup/formatSSE/wrapper', async () => {
        const mgr = new ResumableStreamManager({ maxAgeMs: 50, cleanupIntervalMs: 10_000, maxStreams: 2 });
        const id = mgr.createStream();
        expect(mgr.getCheckpoint(id)?.position).toBe(0);
        expect(mgr.saveChunk('missing', { type: 'text', content: 'x' })).toBeNull();

        const c1 = mgr.saveChunk(id, { type: 'text', content: 'Hi' });
        expect(c1?.event).toBe('delta');
        mgr.saveChunk(id, { type: 'tool_call', toolCall: { id: 'tc1', name: 'f', arguments: '{}' } });
        expect(mgr.getCheckpoint(id)?.accumulatedContent).toBe('Hi');
        expect(mgr.getCheckpoint(id)?.toolCalls).toHaveLength(1);
        expect(mgr.isStreamActive(id)).toBe(true);
        expect(mgr.getChunksSince(id, 0).length).toBeGreaterThan(0);
        expect(mgr.getAllChunks('no')).toEqual([]);
        expect(mgr.getChunksSince('no', 0)).toEqual([]);

        mgr.completeStream(id, 'stop');
        expect(mgr.isStreamActive(id)).toBe(false);
        mgr.completeStream('missing');

        mgr.createStream();
        const id3 = mgr.createStream();
        expect(mgr.deleteStream(id3)).toBe(true);

        expect(formatSSE(c1!)).toContain('event: delta');

        async function* gen() {
            yield { type: 'text' as const, content: 'a' };
            yield { type: 'tool_call' as const, toolCall: { id: '1', name: 'n', arguments: '{}' } };
        }
        const wrapped = createResumableStream(mgr, gen());
        const chunks: unknown[] = [];
        for await (const c of wrapped.stream) chunks.push(c);
        expect(chunks.length).toBe(2);
        expect(mgr.getCheckpoint(wrapped.streamId)?.isComplete).toBe(true);

        async function* bad() {
            yield { type: 'text' as const, content: 'x' };
            throw new Error('boom');
        }
        const badWrap = createResumableStream(mgr, bad());
        await expect(async () => {
            for await (const _ of badWrap.stream) {
                /* drain */
            }
        }).rejects.toThrow('boom');

        mgr.shutdown();
    });
});

describe('checkpoint stores', () => {
    it('InMemoryCheckpointStore save/load/delete/list', async () => {
        const store = new InMemoryCheckpointStore();
        const state = {
            messages: [],
            step: 2,
            agentName: 'A',
            prompt: 'p',
            startedAt: new Date().toISOString(),
            checkpointAt: new Date().toISOString(),
        };
        await store.save('r1', 2, state);
        expect(await store.load('r1')).toMatchObject({ step: 2 });
        expect(await store.load('no')).toBeNull();
        expect(await store.listIncomplete()).toEqual(['r1']);
        await store.delete('r1');
        expect(await store.load('r1')).toBeNull();
    });

    it('SqliteCheckpointStore with better-sqlite3', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ckpt-'));
        try {
            const store = createSqliteCheckpointStore(join(dir, 'c.db'));
            expect(store).toBeInstanceOf(SqliteCheckpointStore);
            const state = {
                messages: [],
                step: 1,
                agentName: 'A',
                prompt: 'hi',
                startedAt: new Date().toISOString(),
                checkpointAt: new Date().toISOString(),
            };
            await store.save('run', 1, state);
            await store.save('run', 2, { ...state, step: 2 });
            expect((await store.load('run'))?.step).toBe(2);
            expect(await store.load('no')).toBeNull();
            expect(await store.listIncomplete()).toContain('run');
            await store.delete('run');
            expect(await store.load('run')).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('deleteSession + MetricType', () => {
    it('cascades session/memory/audit with best-effort secondary failures', async () => {
        expect(MetricType.COUNTER).toBe('counter');
        const sessionStore = { delete: vi.fn(async () => undefined) };
        const memoryStore = {
            retrieve: vi.fn(async () => [
                { entry: { id: 'm1' }, score: 1 },
                { entry: { id: 'm2' }, score: 1 },
            ]),
            delete: vi.fn(async (id: string) => id === 'm1'),
        };
        const auditStore = {
            query: vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }]),
        };

        const r = await deleteSession('s1', {
            sessionStore: sessionStore as any,
            memoryStore: memoryStore as any,
            auditStore: auditStore as any,
        });
        expect(r.sessionDeleted).toBe(true);
        expect(r.memoriesDeleted).toBe(1);
        expect(r.auditEntriesPurged).toBe(2);

        sessionStore.delete.mockRejectedValueOnce(new Error('gone'));
        memoryStore.retrieve.mockRejectedValueOnce(new Error('mem'));
        auditStore.query.mockRejectedValueOnce(new Error('aud'));
        const r2 = await deleteSession('s2', {
            sessionStore: sessionStore as any,
            memoryStore: memoryStore as any,
            auditStore: auditStore as any,
        });
        expect(r2.sessionDeleted).toBe(false);
        expect(r2.memoriesDeleted).toBe(0);
        expect(r2.auditEntriesPurged).toBe(0);

        const r3 = await deleteSession('s3', { sessionStore: sessionStore as any });
        expect(r3.memoriesDeleted).toBeUndefined();
    });
});

describe('createAgentEventBus', () => {
    type Ev = { 'task:done': { id: string }; 'task:fail': { id: string; err: string } };

    it('on/once/emit/wildcard/replay/metrics/off/waitFor', async () => {
        const onErr = vi.fn();
        const bus = createAgentEventBus<Ev>({ replayBufferSize: 2, onHandlerError: onErr });
        const seen: string[] = [];
        const sub = bus.on('task:done', (p) => {
            seen.push(p.id);
        });
        bus.on('*', () => undefined);
        bus.on('task:done', async () => {
            throw new Error('handler boom');
        });
        bus.on('*', async () => {
            throw new Error('wild boom');
        });

        await bus.emit('task:done', { id: '1' });
        await bus.emit('task:done', { id: '2' });
        await bus.emit('task:fail', { id: '3', err: 'x' });
        expect(seen).toEqual(['1', '2']);
        expect(onErr).toHaveBeenCalled();
        expect(bus.metrics().emitted['task:done']).toBe(2);

        const replayed: string[] = [];
        bus.on('task:done', (p) => {
            replayed.push(p.id);
        });
        expect(replayed.length).toBeGreaterThan(0);

        const onceSeen: string[] = [];
        bus.once('task:fail', (p) => {
            onceSeen.push(p.id);
        });
        await bus.emit('task:fail', { id: '4', err: 'y' });
        await bus.emit('task:fail', { id: '5', err: 'z' });
        expect(onceSeen).toEqual(['4']);

        const waitP = bus.waitFor('task:done', 500);
        await bus.emit('task:done', { id: 'waited' });
        await expect(waitP).resolves.toEqual({ id: 'waited' });

        await expect(bus.waitFor('task:done', 20)).rejects.toBeInstanceOf(AgentEventBusTimeoutError);

        sub.unsubscribe();
        bus.clearBuffer();
        bus.off('task:fail');
        bus.off();
        bus.off('*');
    });
});

describe('load balancers + toolkit + context builder', () => {
    it('RoundRobin / LeastConnections / WeightedResponseTime', () => {
        const rr = new RoundRobinLoadBalancer();
        expect(rr.selectAgent([], dummyTask)).toBeUndefined();
        const a = makeRegistration('a', 0, 1);
        const b = makeRegistration('b', 0, 1);
        expect(rr.selectAgent([a, b], dummyTask)?.agent.name).toBeDefined();
        rr.selectAgent([a, b], dummyTask);
        const fullA = makeRegistration('a', 5, 1);
        const fullB = makeRegistration('b', 3, 1);
        expect(rr.selectAgent([fullA, fullB], dummyTask)?.agent.name).toBe('b');
        rr.updateMetrics('a' as EntityId, 10, true);
        rr.updateMetrics('a' as EntityId, 20, false);
        expect(rr.getMetrics('a' as EntityId)?.totalTasks).toBe(2);
        expect(rr.getMetrics('missing' as EntityId)).toBeUndefined();

        const lc = new LeastConnectionsLoadBalancer();
        expect(lc.selectAgent([], dummyTask)).toBeUndefined();
        expect(lc.selectAgent([fullA, fullB], dummyTask)?.agent.name).toBe('b');
        lc.updateMetrics('x' as EntityId, 5, false);

        const wr = new WeightedResponseTimeLoadBalancer();
        expect(wr.selectAgent([], dummyTask)).toBeUndefined();
        const light = makeRegistration('b', 0, 10);
        const heavy = makeRegistration('a', 0, 10);
        wr.updateMetrics(heavy.agent.id, 100, true);
        wr.updateMetrics(light.agent.id, 10, true);
        expect(wr.selectAgent([heavy, light], dummyTask)?.agent.name).toBe('b');
        wr.updateMetrics('z' as EntityId, 1, true);
    });

    it('createToolkit / toolkitsToRegistry', () => {
        const t = {
            id: 'echo',
            name: 'echo',
            description: 'echo',
            parameters: z.object({ x: z.string() }),
            execute: async () => ({ ok: true }),
            validate: () => ({ success: true, data: {} }),
        } as any;
        const t2 = {
            id: 'ping',
            name: 'ping',
            description: 'ping',
            parameters: z.object({}),
            execute: async () => ({ ok: true }),
            validate: () => ({ success: true, data: {} }),
        } as any;
        const tk = createToolkit('Utils', [t], { description: 'd', version: '1', id: 'u' });
        expect(tk.id).toBe('u');
        const tk2 = createToolkit('My Tools', [t]);
        expect(tk2.id).toContain('my-tools');
        const reg = toolkitsToRegistry([tk, t2]);
        expect(reg.get('echo')).toBeDefined();
        expect(reg.get('ping')).toBeDefined();
    });

    it('AgentContextBuilder fluent + fromContext', () => {
        const ctx = new AgentContextBuilder()
            .withAgentId('a1')
            .withMetadata('k', 1)
            .withMetadataEntries({ b: 2 })
            .build();
        expect(ctx.agentId).toBe('a1');
        expect(ctx.metadata).toMatchObject({ k: 1, b: 2 });
        expect(ctx.memory).toBeDefined();
        expect(ctx.tools).toBeDefined();

        const again = AgentContextBuilder.fromContext(ctx).withAgentId('a2').build();
        expect(again.agentId).toBe('a2');
    });
});

describe('multi-agent protocols', () => {
    it('consensus strategies', async () => {
        const agents = {
            a: makeCoreAgent('a', 'yes'),
            b: makeCoreAgent('b', 'yes'),
            c: makeCoreAgent('c', 'no'),
        };
        const maj = createConsensus({ agents, strategy: 'majority-vote', quorum: 2 });
        const r = await maj.decide('approve?');
        expect(r.decision.toLowerCase()).toContain('yes');
        expect(r.quorumMet).toBe(true);

        const uni = createConsensus({ agents, strategy: 'unanimous' });
        expect((await uni.decide('x')).quorumMet).toBe(false);

        const weighted = createConsensus({
            agents,
            strategy: 'weighted',
            weights: { a: 1, b: 1, c: 10 },
        });
        expect((await weighted.decide('x')).winningAgent).toBe('c');

        const best = createConsensus({
            agents: { a: makeCoreAgent('a', 'short'), b: makeCoreAgent('b', 'much longer answer') },
            strategy: 'best-of-n',
        });
        expect((await best.decide('x')).winningAgent).toBe('b');

        const seq = createConsensus({
            agents: { a: makeCoreAgent('a', 'ok') },
            parallel: false,
            strategy: 'majority-vote',
        });
        expect((await seq.decide('x')).decision).toBe('ok');

        const failAgent = {
            id: 'f',
            name: 'f',
            instructions: '',
            run: vi.fn(async () => {
                throw new Error('fail');
            }),
        } as any;
        const allFail = createConsensus({ agents: { f: failAgent }, agentTimeoutMs: 50 });
        expect((await allFail.decide('x')).confidence).toBe(0);

        const slow = {
            id: 's',
            name: 's',
            instructions: '',
            run: vi.fn(async () => {
                await new Promise((r) => setTimeout(r, 100));
                return makeAgenticResult('late');
            }),
        } as any;
        const timed = createConsensus({ agents: { s: slow }, agentTimeoutMs: 10 });
        expect((await timed.decide('x')).votes[0]?.error).toBeDefined();
    });

    it('router strategies', async () => {
        const researcher = makeOrchestrable('researcher', 'research-out');
        const writer = makeOrchestrable('writer', 'write-out');
        const router = createAgentRouter({
            agents: {
                researcher: { agent: researcher, capabilities: ['search', 'analyze'], description: 'Research specialist' },
                writer: { agent: writer, capabilities: ['write', 'edit'], maxConcurrency: 2 },
            },
            strategy: 'capability-match',
            fallback: 'writer',
        });
        const r = await router.route('Please search and analyze this');
        expect(r.agentName).toBe('researcher');
        expect(router.listAgents().length).toBe(2);
        expect(router.getLoadDistribution().researcher).toBe(0);

        const rr = createAgentRouter({
            agents: {
                researcher: { agent: researcher, capabilities: ['search'] },
                writer: { agent: writer, capabilities: ['write'] },
            },
            strategy: 'round-robin',
        });
        expect((await rr.route('a')).agentName).toBe('researcher');
        expect((await rr.route('b')).agentName).toBe('writer');

        const ll = createAgentRouter({
            agents: {
                researcher: { agent: researcher, capabilities: ['search'] },
                writer: { agent: writer, capabilities: ['write'] },
            },
            strategy: 'least-loaded',
        });
        await ll.route('x');

        const custom = createAgentRouter({
            agents: { writer: { agent: writer, capabilities: ['write'] } },
            strategy: 'custom',
            customRouter: () => 'writer',
        });
        expect((await custom.route('anything')).agentName).toBe('writer');

        const empty = createAgentRouter({ agents: {}, strategy: 'capability-match' });
        await expect(empty.route('no agent')).rejects.toThrow(/No suitable agent/);
    });

    it('pipeline + supervisor + role', async () => {
        const a1 = makeOrchestrable('s1', 'step1');
        const a2 = makeOrchestrable('s2', { ok: true });
        const pipe = createPipeline({ name: 'p', agents: [a1, a2] });
        const out = await pipe.run({ prompt: 'go' }, {
            agentId: 'x',
            memory: {} as any,
            tools: {} as any,
            metadata: {},
        });
        expect(out.state).toBe(AgentState.COMPLETED);

        const single = createPipeline({ name: 'one', agents: [a1], description: 'd' });
        const one = await single.run({ prompt: 'x' }, { agentId: 'x', memory: {} as any, tools: {} as any, metadata: {} });
        expect(one.result).toBe('step1');

        const role = createRole('Analyst', ['analyze'], { description: 'd', canExecuteTools: false });
        expect(role.permissions.canExecuteTools).toBe(false);
        const role2 = createRole('Coder', ['code']);
        expect(role2.name).toBe('Coder');

        const boss = createSupervisor({
            name: 'Boss',
            subAgents: [
                { agent: a1, role },
                { agent: a2, role: role2 },
            ],
            guidelines: ['be fair'],
            coordinationType: 'sequential' as any,
        });
        const supervised = await boss.run(
            { prompt: 'do work' },
            { agentId: 'b', memory: {} as any, tools: {} as any, metadata: {} },
        );
        expect(supervised.result).toBeDefined();
    });

    it('handoff protocol', async () => {
        const from = makeCoreAgent('triage', 'triage');
        const billing = makeCoreAgent('billing', 'invoice fixed');
        const tech = makeCoreAgent('tech', 'bug fixed');
        const handoff = createHandoff({
            from,
            to: { billing, technical: tech },
            router: (ctx) => (ctx.prompt.includes('bill') ? 'billing' : 'technical'),
            transformInput: (input, target) => ({ ...input, prompt: `${target}:${input.prompt}` }),
        });
        const r = await handoff.execute('help with bill');
        expect(r.finalOutput.result).toContain('invoice');
        expect(handoff.getHistory().length).toBe(1);
        handoff.clearHistory();
        expect(handoff.getHistory()).toEqual([]);

        const bad = createHandoff({
            from,
            to: { billing },
            router: () => 'missing',
        });
        await expect(bad.execute('x')).rejects.toThrow(/not found/);
    });

    it('Team parallel/sequential/hierarchical + factories', async () => {
        const runner = {
            run: vi.fn(async ({ prompt }: any) => makeAgenticResult(`out:${String(prompt).slice(0, 10)}`)),
        } as any;
        const agents = [
            { id: 'a1', name: 'A1', runner, instructions: 'research', tags: ['research'] },
            { id: 'a2', name: 'A2', runner, instructions: 'write', tags: ['write'] },
        ];
        expect(() => new Team({ name: 'empty', agents: [] })).toThrow();

        const parallel = new Team({ name: 't', agents, strategy: 'parallel' });
        const pr = await parallel.run('task');
        expect(pr.results).toHaveLength(2);
        expect(pr.allSuccess).toBe(true);

        const seq = new Team({ name: 't', agents, strategy: 'sequential' });
        expect((await seq.run('task')).results).toHaveLength(2);

        const director = {
            id: 'dir',
            name: 'Dir',
            runner: {
                run: vi.fn(async () => makeAgenticResult(JSON.stringify({ a1: 'sub1', a2: 'sub2' }))),
            } as any,
            instructions: 'direct',
        };
        const hier = new Team({ name: 't', agents, strategy: 'hierarchical', directorAgent: director });
        expect((await hier.run('big task')).results).toHaveLength(2);

        const hierNoDir = new Team({ name: 't', agents, strategy: 'hierarchical' });
        expect((await hierNoDir.run('x')).results).toHaveLength(2);

        expect(typeof createResearchTeam).toBe('function');
        expect(typeof createDecisionTeam).toBe('function');
    });
});

describe('multi-agent patterns', () => {
    const ctx = { agentId: 'p', memory: {} as any, tools: {} as any, metadata: {} };
    const a = makeOrchestrable('a', 'answer A');
    const b = makeOrchestrable('b', 'answer B longer');
    const agg = makeOrchestrable('agg', 'final');

    it('MoA / actor-critic / socratic / chain / PoT / SoT / step-back / rejection / self-correct', async () => {
        const moa = createMixtureOfAgents({ name: 'moa', proposers: [a, b], aggregator: agg, rounds: 2 });
        expect((await moa.run({ prompt: 'q' }, ctx)).result).toBe('final');

        const ac = createActorCritic({
            name: 'ac',
            actor: a,
            critic: makeOrchestrable('crit', 'SCORE: 8\nLooks good'),
            maxRefinements: 1,
        });
        expect((await ac.run({ prompt: 'q' }, ctx)).state).toBe(AgentState.COMPLETED);

        const soc = createSocraticAgent({
            name: 'soc',
            agent: makeOrchestrable('tutor', 'What is X?'),
            topic: 'math',
        });
        expect((await soc.run({ prompt: 'learn' }, ctx)).result).toBeDefined();

        const chain = createPromptChain({
            name: 'chain',
            steps: [
                { name: 's1', agent: a },
                { name: 's2', agent: b, template: (input, prev) => `Prev: ${prev.s1}\nQ: ${input}` },
            ],
        });
        expect((await chain.run({ prompt: 'q' }, ctx)).result).toBeDefined();

        const pot = createProgramOfThought({
            name: 'pot',
            agent: makeOrchestrable('code', '```js\nreturn 1+1;\n```'),
            executor: async () => ({ stdout: '2', stderr: '' }),
        });
        expect((await pot.run({ prompt: '1+1' }, ctx)).result).toBeDefined();

        const sot = createSkeletonOfThought({
            name: 'sot',
            planner: makeOrchestrable('sk', '["A","B"]'),
            worker: makeOrchestrable('ex', 'expanded'),
        });
        expect((await sot.run({ prompt: 'topic' }, ctx)).result).toBeDefined();

        const sb = createStepBackAgent({
            name: 'sb',
            stepBackAgent: makeOrchestrable('abs', 'principle'),
            solverAgent: makeOrchestrable('sol', 'solution'),
        });
        expect((await sb.run({ prompt: 'hard' }, ctx)).result).toBe('solution');

        const rej = createRejectionSampling({
            name: 'rej',
            agent: a,
            n: 2,
            judge: (t) => t.length,
        });
        expect((await rej.run({ prompt: 'q' }, ctx)).result).toBeDefined();

        const sc = createSelfCorrection({
            name: 'sc',
            agent: makeOrchestrable('sol', 'first'),
            validator: async (out) =>
                out.includes('fixed') ? { valid: true } : { valid: false, errors: ['need fix'] },
            maxRetries: 1,
        });
        expect((await sc.run({ prompt: 'q' }, ctx)).result).toBeDefined();
    });
});

describe('A2A protocol', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('type helpers', () => {
        expect(textPart('hi').type).toBe('text');
        expect(dataPart({ a: 1 }).data).toEqual({ a: 1 });
        expect(filePart({ name: 'f.txt', data: 'abc' }).type).toBe('file');
        expect(userMessage('u').role).toBe('user');
        expect(agentMessage('a', [dataPart({})]).parts.length).toBe(2);
        expect(A2A_ERRORS.TASK_NOT_FOUND).toBe(-32001);
    });

    it('HttpA2AClient send + subscribe throw + trace headers', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            json: async () => ({ role: 'agent', parts: [{ type: 'text', text: 'ok' }] }),
        })) as any;
        const client = createHttpA2AClient({
            baseUrl: 'http://broker.example/',
            fetchImpl,
            traceContext: { traceId: '0'.repeat(32), spanId: '1'.repeat(16), traceFlags: 1 },
        });
        const msg = await client.send({ role: 'user', parts: [{ type: 'text', text: 'hi' }] });
        expect(msg.parts[0]).toMatchObject({ type: 'text' });
        expect(fetchImpl.mock.calls[0][1].headers.traceparent).toBeDefined();

        const bad = new HttpA2AClient({
            baseUrl: 'http://x',
            fetchImpl: vi.fn(async () => ({ ok: false, text: async () => 'nope' })) as any,
        });
        await expect(bad.send({ role: 'user', parts: [] })).rejects.toThrow(/A2A send failed/);
        expect(() => client.subscribe('a', () => undefined)).toThrow(/outbound-only/);
    });

    it('A2AClient rpc/card/stream with mocked fetch', async () => {
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes('agent.json')) {
                return {
                    ok: true,
                    json: async () => ({
                        name: 'Agent',
                        url: 'http://a',
                        version: '1',
                        capabilities: {},
                        skills: [],
                    }),
                };
            }
            const body = JSON.parse(String(init?.body ?? '{}'));
            if (body.method === 'tasks/sendSubscribe' || body.method === 'tasks/resubscribe') {
                const sse = [
                    'data: {"method":"tasks/statusUpdate","params":{"id":"t1","status":{"state":"working"},"final":false}}\n\n',
                    'data: not-json\n\n',
                    'data: {"method":"tasks/artifactUpdate","params":{"id":"t1","artifact":{"parts":[],"index":0}}}\n\n',
                    'data: {"method":"tasks/statusUpdate","params":{"id":"t1","status":{"state":"completed"},"final":true}}\n\n',
                ].join('');
                return {
                    ok: true,
                    body: new ReadableStream({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode(sse));
                            controller.close();
                        },
                    }),
                };
            }
            if (body.method?.includes('pushNotification')) {
                return { ok: true, json: async () => ({ result: { url: 'http://hook' } }) };
            }
            if (init?.method === 'POST') {
                return {
                    ok: true,
                    json: async () => ({ result: { id: 't1', status: { state: 'completed' } } }),
                };
            }
            return { ok: false, status: 500, text: async () => 'err' };
        });
        vi.stubGlobal('fetch', fetchMock);

        const client = createA2AClient({ url: 'http://agent.example/', headers: { Authorization: 'Bearer x' } });
        expect((await client.getAgentCard()).name).toBe('Agent');
        expect((await client.sendTask({ id: 't1', message: userMessage('hi') })).id).toBe('t1');
        expect((await client.getTask({ id: 't1' })).id).toBe('t1');
        expect((await client.cancelTask({ id: 't1' })).id).toBe('t1');
        expect((await client.setPushNotification({ id: 't1', pushNotificationConfig: { url: 'http://h' } })).url).toBe(
            'http://hook',
        );
        expect((await client.getPushNotification({ id: 't1' })).url).toBe('http://hook');

        const events: string[] = [];
        for await (const e of client.sendTaskStream({ id: 't1', message: userMessage('hi') })) {
            events.push(e.type);
        }
        expect(events).toContain('TaskStatusUpdateEvent');
        expect(events).toContain('TaskArtifactUpdateEvent');

        const events2: string[] = [];
        for await (const e of client.resubscribeTask({ id: 't1' })) {
            events2.push(e.type);
        }
        expect(events2.length).toBeGreaterThan(0);

        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'bad' } as any);
        await expect(new A2AClient({ url: 'http://x' }).sendTask({ id: 't', message: userMessage('x') })).rejects.toThrow(
            /A2A HTTP/,
        );
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ error: { code: 1, message: 'rpc err' } }),
        } as any);
        await expect(new A2AClient({ url: 'http://x' }).getTask({ id: 't' })).rejects.toThrow(/A2A error/);
    });

    it('A2AServer HTTP endpoints hermetically', async () => {
        const server = createA2AServer({
            port: 0,
            host: '127.0.0.1',
            cors: '*',
            auth: { type: 'api-key', key: 'secret', header: 'x-api-key' },
            agentCard: {
                name: 'Test',
                url: 'http://127.0.0.1',
                version: '1',
                capabilities: { streaming: true, pushNotifications: true },
                skills: [{ id: 's', name: 'Skill' }],
            },
            handler: async (msg, ctx) => {
                ctx.emit({ state: 'working' });
                ctx.emitArtifact([{ type: 'text', text: 'chunk' }], { name: 'out' });
                return agentMessage(`echo:${(msg.parts[0] as any).text}`);
            },
            logger: { info: () => undefined, error: () => undefined },
        });

        await server.start();
        const addr = (server as any).httpServer?.address();
        const port = typeof addr === 'object' && addr ? addr.port : 3200;
        const base = `http://127.0.0.1:${port}`;

        const card = await fetch(`${base}/.well-known/agent.json`);
        expect(card.status).toBe(200);

        await fetch(base, { method: 'OPTIONS' });

        const unauth = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tasks/send', params: {} }),
        });
        expect(unauth.status).toBe(401);

        const send = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: { id: 'task-1', message: userMessage('hello') },
            }),
        });
        const sendBody = await send.json();
        expect(sendBody.result.status.state).toBe('completed');

        const get = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tasks/get', params: { id: 'task-1', historyLength: 1 } }),
        });
        expect((await get.json()).result.id).toBe('task-1');

        const cancelDone = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tasks/cancel', params: { id: 'task-1' } }),
        });
        expect((await cancelDone.json()).error.code).toBe(-32002);

        await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 4,
                method: 'tasks/pushNotificationConfig/set',
                params: { id: 'task-1', pushNotificationConfig: { url: 'http://hook' } },
            }),
        });
        const pushGet = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 5,
                method: 'tasks/pushNotificationConfig/get',
                params: { id: 'task-1' },
            }),
        });
        expect((await pushGet.json()).result.url).toBe('http://hook');

        const unk = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'nope', params: {} }),
        });
        expect((await unk.json()).error.code).toBe(-32601);

        const parse = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
            body: 'not-json',
        });
        expect(parse.status).toBe(400);

        const streamRes = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret', accept: 'text/event-stream' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 7,
                method: 'tasks/sendSubscribe',
                params: { id: 'task-stream', message: userMessage('stream') },
            }),
        });
        const streamText = await streamRes.text();
        expect(streamText).toContain('tasks/statusUpdate');

        const resub = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 8,
                method: 'tasks/resubscribe',
                params: { id: 'task-stream' },
            }),
        });
        expect(await resub.text()).toContain('tasks/statusUpdate');

        expect((await fetch(base, { method: 'GET', headers: { 'x-api-key': 'secret' } })).status).toBe(405);

        await server.start(); // idempotent
        await server.stop();
        await server.stop();

        const slowServer = createA2AServer({
            port: 0,
            cors: ['http://allowed.test'],
            auth: { type: 'bearer', token: 'tok' },
            agentCard: {
                name: 'S',
                url: 'http://x',
                version: '1',
                capabilities: {},
                skills: [],
            },
            handler: async () => agentMessage('late'),
        });
        await slowServer.start();
        const addr2 = (slowServer as any).httpServer.address();
        const base2 = `http://127.0.0.1:${addr2.port}`;

        const opt = await fetch(base2, {
            method: 'OPTIONS',
            headers: { origin: 'http://allowed.test' },
        });
        expect(opt.status).toBe(204);

        const okAuth = await fetch(base2, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: { id: 't-slow', message: userMessage('x') },
            }),
        });
        expect((await okAuth.json()).result.status.state).toBe('completed');

        const missing = await fetch(base2, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tasks/get', params: { id: 'nope' } }),
        });
        expect((await missing.json()).error.code).toBe(-32001);

        await slowServer.stop();
    }, 20_000);
});
