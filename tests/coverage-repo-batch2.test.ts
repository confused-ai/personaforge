/**
 * Repo-wide coverage batch 2 — load balancers, event bus, json loader,
 * cascade delete (real API).
 *
 * Callers: vitest include glob only. Hermetic tmpdir + mocks.
 * User instruction: "cover all the repo"
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    RoundRobinLoadBalancer,
    LeastConnectionsLoadBalancer,
    WeightedResponseTimeLoadBalancer,
} from '../src/orchestration/core/load-balancer.js';
import { createAgentEventBus, AgentEventBusTimeoutError } from '../src/orchestration/event-bus.js';
import { loadJson } from '../src/knowledge/loaders/json-loader.js';
import { deleteSession } from '../src/production/cascade-delete.js';
import type { AgentRegistration, DelegationTask } from '../src/orchestration/core/types.js';

function reg(id: string, load: number, max = 2): AgentRegistration {
    return {
        agent: { id, name: id },
        metadata: { currentLoad: load, maxConcurrentTasks: max },
    } as unknown as AgentRegistration;
}

const task = { id: 't1' } as unknown as DelegationTask;

describe('load balancers', () => {
    it('RoundRobinLoadBalancer covers empty/available/capacity/metrics', () => {
        const lb = new RoundRobinLoadBalancer();
        expect(lb.selectAgent([], task)).toBeUndefined();

        const a = reg('a', 0);
        const b = reg('b', 0);
        expect(lb.selectAgent([a, b], task)?.agent.id).toBe('a');
        expect(lb.selectAgent([a, b], task)?.agent.id).toBe('b');

        const full = [reg('x', 5, 1), reg('y', 3, 1)];
        expect(lb.selectAgent(full, task)?.agent.id).toBe('y');

        lb.updateMetrics('a', 10, true);
        lb.updateMetrics('a', 20, false);
        expect(lb.getMetrics('a')).toEqual({
            totalTasks: 2,
            failedTasks: 1,
            averageExecutionTime: 15,
        });
        expect(lb.getMetrics('missing')).toBeUndefined();
    });

    it('LeastConnections + WeightedResponseTime', () => {
        const lc = new LeastConnectionsLoadBalancer();
        expect(lc.selectAgent([], task)).toBeUndefined();
        expect(lc.selectAgent([reg('a', 2), reg('b', 1)], task)?.agent.id).toBe('b');
        lc.updateMetrics('a', 5, true);
        lc.updateMetrics('a', 5, false);

        const wr = new WeightedResponseTimeLoadBalancer();
        expect(wr.selectAgent([], task)).toBeUndefined();
        wr.updateMetrics('a', 100, true);
        wr.updateMetrics('b', 10, true);
        expect(wr.selectAgent([reg('a', 0), reg('b', 0)], task)?.agent.id).toBe('b');
        wr.updateMetrics('b', 1, false);
    });
});

describe('event bus', () => {
    it('on/once/emit/wildcard/replay/waitFor/metrics/errors', async () => {
        type Ev = { ping: { n: number }; boom: { msg: string } };
        const onErr = vi.fn();
        const bus = createAgentEventBus<Ev>({ replayBufferSize: 5, onHandlerError: onErr });

        const seen: number[] = [];
        const sub = bus.on('ping', (p) => {
            seen.push(p.n);
        });
        const wild: string[] = [];
        bus.on('*', (e) => {
            wild.push(e);
        });

        await bus.emit('ping', { n: 1 });
        expect(seen).toEqual([1]);
        expect(wild).toContain('ping');

        const onceVals: number[] = [];
        bus.once('ping', (p) => {
            onceVals.push(p.n);
        });
        await bus.emit('ping', { n: 2 });
        await bus.emit('ping', { n: 3 });
        expect(onceVals).toEqual([2]);

        bus.on('boom', () => {
            throw new Error('handler-fail');
        });
        await bus.emit('boom', { msg: 'x' });
        expect(onErr).toHaveBeenCalled();

        expect(bus.metrics().emitted['ping']).toBeGreaterThan(0);
        sub.unsubscribe();

        const waiter = bus.waitFor('ping', 1000);
        await bus.emit('ping', { n: 99 });
        await expect(waiter).resolves.toEqual({ n: 99 });

        await expect(bus.waitFor('ping', 20)).rejects.toBeInstanceOf(AgentEventBusTimeoutError);

        await bus.emit('ping', { n: 7 });
        const replayed: number[] = [];
        bus.on('ping', (p) => {
            replayed.push(p.n);
        });
        expect(replayed.length).toBeGreaterThan(0);
    });
});

describe('knowledge json loader', () => {
    it('loads json array, object, and jsonl with contentField', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-json-'));
        try {
            const arr = path.join(dir, 'a.json');
            fs.writeFileSync(arr, JSON.stringify([{ text: 'one' }, { text: 'two' }]));
            const docs = await loadJson(arr, { contentField: 'text', metadata: { k: 1 } });
            expect(docs).toHaveLength(2);
            expect(docs[0]!.content).toBe('one');

            const obj = path.join(dir, 'o.json');
            fs.writeFileSync(obj, JSON.stringify({ text: 'solo' }));
            expect((await loadJson(obj))[0]!.content).toContain('solo');

            const jsonl = path.join(dir, 'x.jsonl');
            fs.writeFileSync(jsonl, '{"text":"a"}\n{"text":"b"}\n');
            expect((await loadJson(jsonl, { contentField: 'text' })).map((d) => d.content)).toEqual([
                'a',
                'b',
            ]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('cascade deleteSession', () => {
    it('deletes session and optional memory/audit stores', async () => {
        const sessionStore = { delete: vi.fn(async () => undefined) };
        const memoryStore = {
            retrieve: vi.fn(async () => [{ entry: { id: 'm1' } }, { entry: { id: 'm2' } }]),
            delete: vi.fn(async () => true),
        };
        const auditStore = {
            query: vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]),
        };

        const ok = await deleteSession('s1', {
            sessionStore: sessionStore as never,
            memoryStore: memoryStore as never,
            auditStore: auditStore as never,
        });
        expect(ok.sessionDeleted).toBe(true);
        expect(ok.memoriesDeleted).toBe(2);
        expect(ok.auditEntriesPurged).toBe(3);

        const failSession = await deleteSession('s2', {
            sessionStore: {
                delete: vi.fn(async () => {
                    throw new Error('gone');
                }),
            } as never,
        });
        expect(failSession.sessionDeleted).toBe(false);
    });
});
