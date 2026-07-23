/**
 * Tests for LearningMachine, ReasoningManager, CompressionManager,
 * ContextProvider/ContextBackend, and the Scheduler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Learning ─────────────────────────────────────────────────────────────────
import { LearningMachine } from '@personaforge/learning';
import {
    InMemoryUserMemoryStore,
    InMemorySessionContextStore,
    InMemoryLearnedKnowledgeStore,
    InMemoryEntityMemoryStore,
} from '@personaforge/learning';
import { LearningMode } from '@personaforge/learning';

// ── Reasoning ─────────────────────────────────────────────────────────────────
import { ReasoningManager } from '@personaforge/reasoning';
import { NextAction, ReasoningEventType } from '@personaforge/reasoning';

// ── Compression ───────────────────────────────────────────────────────────────
import { CompressionManager } from '@personaforge/compression';

// ── Context ───────────────────────────────────────────────────────────────────
import { ContextMode } from '@personaforge/context';
import { ContextProvider } from '@personaforge/context';
import { ContextBackend } from '@personaforge/context';
import type { Answer, QueryOptions } from '@personaforge/context';

// ── Scheduler ─────────────────────────────────────────────────────────────────
import { ScheduleManager } from '@personaforge/scheduler';
import { computeNextRun, validateCronExpr } from '@personaforge/scheduler';

// ─────────────────────────────────────────────────────────────────────────────
// Learning
// ─────────────────────────────────────────────────────────────────────────────

describe('LearningMode enum', () => {
    it('has all four values', () => {
        expect(LearningMode.ALWAYS).toBe('always');
        expect(LearningMode.AGENTIC).toBe('agentic');
        expect(LearningMode.PROPOSE).toBe('propose');
        expect(LearningMode.HITL).toBe('hitl');
    });
});

describe('InMemoryUserMemoryStore', () => {
    it('add and retrieve memories', async () => {
        const store = new InMemoryUserMemoryStore();
        const id = await store.addMemory('u1', 'User prefers dark mode');
        expect(typeof id).toBe('string');

        const mem = await store.get('u1');
        expect(mem).not.toBeNull();
        expect(mem!.memories).toHaveLength(1);
        expect(mem!.memories[0]!.content).toBe('User prefers dark mode');
    });

    it('update and delete memories', async () => {
        const store = new InMemoryUserMemoryStore();
        const id = await store.addMemory('u2', 'original');
        await store.updateMemory('u2', id, 'updated');
        const mem = await store.get('u2');
        expect(mem!.memories[0]!.content).toBe('updated');

        const deleted = await store.deleteMemory('u2', id);
        expect(deleted).toBe(true);
        const after = await store.get('u2');
        expect(after!.memories).toHaveLength(0);
    });

    it('scopes by agentId', async () => {
        const store = new InMemoryUserMemoryStore();
        await store.addMemory('u3', 'agent-a memory', 'agent-a');
        await store.addMemory('u3', 'agent-b memory', 'agent-b');

        const a = await store.get('u3', 'agent-a');
        const b = await store.get('u3', 'agent-b');
        expect(a!.memories[0]!.content).toBe('agent-a memory');
        expect(b!.memories[0]!.content).toBe('agent-b memory');
    });
});

describe('InMemorySessionContextStore', () => {
    it('set and retrieve', async () => {
        const store = new InMemorySessionContextStore();
        await store.set({ sessionId: 's1', goal: 'Fix bug #42', plan: ['Reproduce', 'Fix', 'Test'] });
        const ctx = await store.get('s1');
        expect(ctx!.goal).toBe('Fix bug #42');
        expect(ctx!.plan).toEqual(['Reproduce', 'Fix', 'Test']);
    });

    it('clear removes context', async () => {
        const store = new InMemorySessionContextStore();
        await store.set({ sessionId: 's2', summary: 'Test session' });
        const removed = await store.clear('s2');
        expect(removed).toBe(true);
        expect(await store.get('s2')).toBeNull();
    });
});

describe('InMemoryLearnedKnowledgeStore', () => {
    it('save and search by text', async () => {
        const store = new InMemoryLearnedKnowledgeStore();
        await store.save({ title: 'Rate limiting', learning: 'Use token bucket algorithm for API rate limits' });
        await store.save({ title: 'Database indexing', learning: 'Composite indexes should match query column order' });

        const hits = await store.search('rate');
        expect(hits).toHaveLength(1);
        expect(hits[0]!.title).toBe('Rate limiting');
    });

    it('overwrite on same title+namespace', async () => {
        const store = new InMemoryLearnedKnowledgeStore();
        await store.save({ title: 'tip', learning: 'v1', namespace: 'ns' });
        await store.save({ title: 'tip', learning: 'v2', namespace: 'ns' });
        const hits = await store.search('tip', 'ns');
        expect(hits).toHaveLength(1);
        expect(hits[0]!.learning).toBe('v2');
    });

    it('delete by title+namespace', async () => {
        const store = new InMemoryLearnedKnowledgeStore();
        await store.save({ title: 'temp', learning: 'delete me', namespace: 'x' });
        const deleted = await store.delete('temp', 'x');
        expect(deleted).toBe(true);
        expect(await store.search('temp', 'x')).toHaveLength(0);
    });
});

describe('InMemoryEntityMemoryStore', () => {
    it('add facts and retrieve entity', async () => {
        const store = new InMemoryEntityMemoryStore();
        await store.addFact('acme-corp', 'Founded in 1985');
        await store.addFact('acme-corp', 'HQ in San Francisco');
        const entity = await store.get('acme-corp');
        expect(entity!.facts).toHaveLength(2);
    });

    it('add events', async () => {
        const store = new InMemoryEntityMemoryStore();
        const id = await store.addEvent('project-x', 'Sprint 1 started', '2025-01-01');
        expect(typeof id).toBe('string');
        const entity = await store.get('project-x');
        expect(entity!.events[0]!.date).toBe('2025-01-01');
    });

    it('search by query string', async () => {
        const store = new InMemoryEntityMemoryStore();
        await store.addFact('postgres', 'PostgreSQL is a relational DB');
        await store.addFact('redis', 'Redis is an in-memory cache');
        const results = await store.search('relational');
        expect(results.some(e => e.entityId === 'postgres')).toBe(true);
    });

    it('namespaced isolation', async () => {
        const store = new InMemoryEntityMemoryStore();
        await store.addFact('shared-id', 'fact in ns-a', 'ns-a');
        await store.addFact('shared-id', 'fact in ns-b', 'ns-b');

        const a = await store.get('shared-id', 'ns-a');
        const b = await store.get('shared-id', 'ns-b');
        expect(a!.facts[0]!.content).toBe('fact in ns-a');
        expect(b!.facts[0]!.content).toBe('fact in ns-b');
    });
});

describe('LearningMachine', () => {
    it('buildContext with no stores returns empty string', async () => {
        const machine = new LearningMachine();
        const ctx = await machine.buildContext({ userId: 'u1' });
        expect(ctx).toBe('');
    });

    it('buildContext surfaces user memories', async () => {
        const userMemory = new InMemoryUserMemoryStore();
        await userMemory.addMemory('u1', 'Prefers TypeScript over JavaScript');
        const machine = new LearningMachine({ userMemory });

        const ctx = await machine.buildContext({ userId: 'u1' });
        expect(ctx).toContain('TypeScript');
    });

    it('buildContext surfaces session context', async () => {
        const sessionContext = new InMemorySessionContextStore();
        await sessionContext.set({ sessionId: 's1', goal: 'Ship v2', plan: ['code', 'test', 'deploy'] });
        const machine = new LearningMachine({ sessionContext });

        const ctx = await machine.buildContext({ sessionId: 's1' });
        expect(ctx).toContain('Ship v2');
        expect(ctx).toContain('code');
    });

    it('getTools with userMemory produces addMemory/updateMemory/deleteMemory', () => {
        const machine = new LearningMachine({
            userMemory: new InMemoryUserMemoryStore(),
        });
        const tools = machine.getTools({ userId: 'u1' });
        expect(tools).toHaveLength(3);
    });

    it('addMemory tool works', async () => {
        const userMemory = new InMemoryUserMemoryStore();
        const machine = new LearningMachine({ userMemory });
        const [addTool] = machine.getTools({ userId: 'u1' });
        const result = await (addTool as Function)('Remember: user timezone is EST');
        expect(result).toMatch(/Memory added/);
        const mem = await userMemory.get('u1');
        expect(mem!.memories[0]!.content).toBe('Remember: user timezone is EST');
    });

    it('toJSON lists enabled stores', () => {
        const machine = new LearningMachine({ userMemory: new InMemoryUserMemoryStore() });
        const json = machine.toJSON();
        expect(json.userMemory).toBe(true);
        expect(json.sessionContext).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reasoning
// ─────────────────────────────────────────────────────────────────────────────

describe('ReasoningManager', () => {
    function makeStep(nextAction: NextAction = NextAction.FINAL_ANSWER) {
        return JSON.stringify({
            title: 'Step',
            action: 'Think',
            result: 'Done',
            reasoning: 'Because',
            nextAction,
            confidence: 0.95,
        });
    }

    it('run() returns success with one step', async () => {
        const generate = vi.fn().mockResolvedValueOnce(makeStep());
        const manager = new ReasoningManager({ generate, minSteps: 1 });
        const result = await manager.run([{ role: 'user', content: 'hello' }]);
        expect(result.success).toBe(true);
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]!.nextAction).toBe(NextAction.FINAL_ANSWER);
    });

    it('run() continues until FINAL_ANSWER', async () => {
        const generate = vi.fn()
            .mockResolvedValueOnce(makeStep(NextAction.CONTINUE))
            .mockResolvedValueOnce(makeStep(NextAction.VALIDATE))
            .mockResolvedValueOnce(makeStep(NextAction.FINAL_ANSWER));
        const manager = new ReasoningManager({ generate, minSteps: 1 });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(true);
        expect(result.steps).toHaveLength(3);
    });

    it('yields ReasoningEvents in correct order', async () => {
        const generate = vi.fn().mockResolvedValueOnce(makeStep());
        const manager = new ReasoningManager({ generate, minSteps: 1 });
        const events: ReasoningEventType[] = [];
        for await (const e of manager.reason([{ role: 'user', content: 'x' }])) {
            events.push(e.eventType);
        }
        expect(events[0]).toBe(ReasoningEventType.STARTED);
        expect(events[1]).toBe(ReasoningEventType.STEP);
        expect(events[2]).toBe(ReasoningEventType.COMPLETED);
    });

    it('emits ERROR event when generate throws', async () => {
        const generate = vi.fn().mockRejectedValue(new Error('LLM down'));
        const manager = new ReasoningManager({ generate });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/LLM down/);
    });

    it('emits ERROR event on unparseable JSON', async () => {
        const generate = vi.fn().mockResolvedValue('not json at all');
        const manager = new ReasoningManager({ generate });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Could not parse/);
    });

    it('respects maxSteps hard cap', async () => {
        const generate = vi.fn().mockResolvedValue(makeStep(NextAction.CONTINUE));
        const manager = new ReasoningManager({ generate, maxSteps: 3 });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.steps.length).toBeLessThanOrEqual(3);
        expect(generate).toHaveBeenCalledTimes(3);
    });

    it('parses step wrapped in markdown fences', async () => {
        const generate = vi.fn().mockResolvedValueOnce(
            '```json\n' + makeStep() + '\n```'
        );
        const manager = new ReasoningManager({ generate, minSteps: 1 });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(true);
        expect(result.steps[0]!.confidence).toBe(0.95);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CompressionManager
// ─────────────────────────────────────────────────────────────────────────────

describe('CompressionManager', () => {
    const BIG = 'x'.repeat(20_000); // ~5000 tokens

    it('shouldCompress() — count trigger', () => {
        const cm = new CompressionManager({
            generate: vi.fn(),
            compressToolResults: true,
            compressToolResultsLimit: 2,
        });
        const messages = [
            { role: 'tool', content: 'r1' },
            { role: 'tool', content: 'r2' },
        ];
        expect(cm.shouldCompress(messages)).toBe(true);
    });

    it('shouldCompress() — token trigger', () => {
        const cm = new CompressionManager({
            generate: vi.fn(),
            compressToolResults: false,
            compressTokenLimit: 100,
        });
        expect(cm.shouldCompress([{ role: 'assistant', content: BIG }])).toBe(true);
    });

    it('shouldCompress() — false when below threshold', () => {
        const cm = new CompressionManager({
            generate: vi.fn(),
            compressToolResultsLimit: 5,
            compressTokenLimit: 0,
        });
        expect(cm.shouldCompress([{ role: 'user', content: 'hi' }])).toBe(false);
    });

    it('compress() sets compressedContent on tool messages', async () => {
        const generate = vi.fn().mockResolvedValue('COMPRESSED');
        const cm = new CompressionManager({ generate, compressToolResults: true, compressToolResultsLimit: 1 });
        const messages = [{ role: 'tool', content: 'verbose tool output' }];
        await cm.compress(messages);
        expect(messages[0]!.compressedContent).toBe('COMPRESSED');
        expect(cm.compressionCount).toBe(1);
    });

    it('acompress() runs in parallel', async () => {
        const delays: number[] = [];
        const generate = vi.fn().mockImplementation(async () => {
            delays.push(Date.now());
            await new Promise(r => setTimeout(r, 10));
            return 'C';
        });
        const cm = new CompressionManager({ generate, compressToolResults: true, compressToolResultsLimit: 1 });
        const messages = [
            { role: 'tool', content: 'r1' },
            { role: 'tool', content: 'r2' },
        ];
        await cm.acompress(messages);
        expect(messages[0]!.compressedContent).toBe('C');
        expect(messages[1]!.compressedContent).toBe('C');
        expect(cm.compressionCount).toBe(2);
    });

    it('does not re-compress already-compressed messages', async () => {
        const generate = vi.fn().mockResolvedValue('NEW');
        const cm = new CompressionManager({ generate, compressToolResults: true, compressTokenLimit: 0 });
        const messages = [{ role: 'tool', content: 'original', compressedContent: 'ALREADY' }];
        await cm.compress(messages);
        expect(generate).not.toHaveBeenCalled();
        expect(messages[0]!.compressedContent).toBe('ALREADY');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ContextProvider / ContextBackend
// ─────────────────────────────────────────────────────────────────────────────

describe('ContextProvider', () => {
    class StaticProvider extends ContextProvider {
        readonly docs = [
            { id: '1', name: 'Doc 1', content: 'TypeScript is great' },
            { id: '2', name: 'Doc 2', content: 'Python is versatile' },
        ];

        async query(q: string, _opts?: QueryOptions): Promise<Answer> {
            const results = this.docs.filter(d => d.content.toLowerCase().includes(q.toLowerCase()));
            return { results, text: `Found ${results.length} documents` };
        }
    }

    it('query returns matching documents', async () => {
        const provider = new StaticProvider({ name: 'static' });
        const answer = await provider.query('TypeScript');
        expect(answer.results).toHaveLength(1);
        expect(answer.results[0]!.id).toBe('1');
    });

    it('default mode is DEFAULT', () => {
        const provider = new StaticProvider({ name: 'p1' });
        expect(provider.mode).toBe(ContextMode.DEFAULT);
    });

    it('getTools returns a query tool', () => {
        const provider = new StaticProvider({ name: 'p2', mode: ContextMode.TOOLS });
        const tools = provider.getTools();
        expect(tools).toHaveLength(1);
        expect(tools[0]!.name).toBe('p2_query');
    });

    it('query tool calls query()', async () => {
        const provider = new StaticProvider({ name: 'p3', mode: ContextMode.TOOLS });
        const [queryTool] = provider.getTools();
        const result = await queryTool!.fn('Python');
        expect((result as Answer).results[0]!.id).toBe('2');
    });

    it('update() throws by default', async () => {
        const provider = new StaticProvider({ name: 'p4' });
        await expect(provider.update([])).rejects.toThrow();
    });

    it('status() is ok by default', () => {
        const provider = new StaticProvider({ name: 'p5' });
        expect(provider.status().ok).toBe(true);
    });

    it('setup/close lifecycle', async () => {
        const provider = new StaticProvider({ name: 'p6' });
        await provider.setup();
        expect(provider.status().detail).toContain('ready=true');
        await provider.close();
        expect(provider.status().detail).toContain('ready=false');
    });

    it('instructions returns configured string', () => {
        const provider = new StaticProvider({ name: 'p7', instructions: 'Use this for docs' });
        expect(provider.instructions()).toBe('Use this for docs');
    });
});

describe('ContextBackend', () => {
    class PingBackend extends ContextBackend {
        readonly name = 'ping';
        override status() { return { ok: true, detail: 'pong' }; }
    }

    it('status returns ok', () => {
        const backend = new PingBackend();
        expect(backend.status().ok).toBe(true);
        expect(backend.status().detail).toBe('pong');
    });

    it('astatus delegates to status', async () => {
        const backend = new PingBackend();
        const s = await backend.astatus();
        expect(s.detail).toBe('pong');
    });

    it('getTools returns empty by default', () => {
        const backend = new PingBackend();
        expect(backend.getTools()).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cron utilities
// ─────────────────────────────────────────────────────────────────────────────

describe('validateCronExpr', () => {
    it('accepts valid expressions', () => {
        expect(validateCronExpr('* * * * *')).toBe(true);
        expect(validateCronExpr('0 9 * * 1-5')).toBe(true);
        expect(validateCronExpr('0 0 1 1 0')).toBe(true);
        expect(validateCronExpr('30 18 * * 1,3,5')).toBe(true);
    });

    it('rejects invalid expressions', () => {
        expect(validateCronExpr('')).toBe(false);
        expect(validateCronExpr('* * * *')).toBe(false);      // 4 fields
        expect(validateCronExpr('* * * * * *')).toBe(false);  // 6 fields
        expect(validateCronExpr('abc * * * *')).toBe(false);  // non-numeric
    });
});

describe('computeNextRun', () => {
    it('returns a Date in the future', () => {
        const next = computeNextRun('* * * * *');
        expect(next).toBeInstanceOf(Date);
        expect(next!.getTime()).toBeGreaterThan(Date.now());
    });

    it('every-minute cron fires within 2 minutes', () => {
        const next = computeNextRun('* * * * *');
        expect(next!.getTime() - Date.now()).toBeLessThan(2 * 60 * 1000);
    });

    it('returns null for invalid expr', () => {
        expect(computeNextRun('bad expr')).toBeNull();
    });

    it('hour-aligned cron lands on a 0-minute boundary', () => {
        // "0 * * * *" fires at the top of every hour
        const next = computeNextRun('0 * * * *');
        expect(next!.getUTCMinutes()).toBe(0);
    });

    it('respects the after parameter', () => {
        // Fire at minute 30 of every hour
        const base = new Date('2025-06-01T12:00:00Z').getTime();
        const next = computeNextRun('30 * * * *', 'UTC', base);
        expect(next!.getUTCMinutes()).toBe(30);
        expect(next!.getTime()).toBeGreaterThan(base);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ScheduleManager
// ─────────────────────────────────────────────────────────────────────────────

describe('ScheduleManager', () => {
    let manager: ScheduleManager;

    beforeEach(() => {
        manager = new ScheduleManager();
    });

    it('create and get a schedule', async () => {
        const id = await manager.create({
            name: 'Daily report',
            cronExpr: '0 8 * * *',
            endpoint: 'report',
            enabled: true,
        });
        const s = await manager.get(id);
        expect(s).not.toBeNull();
        expect(s!.name).toBe('Daily report');
        expect(s!.nextRunAt).toBeDefined();
    });

    it('throws on invalid cron expression', async () => {
        await expect(
            manager.create({ name: 'bad', cronExpr: 'not-cron', endpoint: 'x', enabled: true })
        ).rejects.toThrow(/Invalid cron/);
    });

    it('list returns all schedules', async () => {
        await manager.create({ name: 'A', cronExpr: '* * * * *', endpoint: 'a', enabled: true });
        await manager.create({ name: 'B', cronExpr: '* * * * *', endpoint: 'b', enabled: false });
        const all = await manager.list();
        expect(all).toHaveLength(2);
    });

    it('list(enabledOnly=true) filters disabled', async () => {
        await manager.create({ name: 'on', cronExpr: '* * * * *', endpoint: 'x', enabled: true });
        await manager.create({ name: 'off', cronExpr: '* * * * *', endpoint: 'y', enabled: false });
        const enabled = await manager.list(true);
        expect(enabled).toHaveLength(1);
        expect(enabled[0]!.name).toBe('on');
    });

    it('update changes fields', async () => {
        const id = await manager.create({ name: 'old', cronExpr: '* * * * *', endpoint: 'e', enabled: true });
        await manager.update(id, { name: 'new' });
        const s = await manager.get(id);
        expect(s!.name).toBe('new');
    });

    it('enable / disable toggle', async () => {
        const id = await manager.create({ name: 'tog', cronExpr: '* * * * *', endpoint: 'e', enabled: true });
        await manager.disable(id);
        expect((await manager.get(id))!.enabled).toBe(false);
        await manager.enable(id);
        expect((await manager.get(id))!.enabled).toBe(true);
    });

    it('delete removes schedule', async () => {
        const id = await manager.create({ name: 'temp', cronExpr: '* * * * *', endpoint: 'e', enabled: true });
        await manager.delete(id);
        expect(await manager.get(id)).toBeNull();
    });

    it('trigger calls registered handler', async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true });
        manager.register('ping', handler);
        const id = await manager.create({ name: 'ping', cronExpr: '* * * * *', endpoint: 'ping', enabled: true });
        const run = await manager.trigger(id);
        expect(run.status).toBe('success');
        expect(handler).toHaveBeenCalledOnce();
    });

    it('trigger records failed run when handler throws', async () => {
        manager.register('fail', async () => { throw new Error('boom'); });
        const id = await manager.create({ name: 'f', cronExpr: '* * * * *', endpoint: 'fail', enabled: true });
        const run = await manager.trigger(id);
        expect(run.status).toBe('failed');
        expect(run.error).toMatch(/boom/);
    });

    it('getRuns returns run history', async () => {
        manager.register('ep', vi.fn().mockResolvedValue('ok'));
        const id = await manager.create({ name: 'h', cronExpr: '* * * * *', endpoint: 'ep', enabled: true });
        await manager.trigger(id);
        await manager.trigger(id);
        const runs = await manager.getRuns(id);
        expect(runs).toHaveLength(2);
    });

    it('trigger fails for unknown endpoint', async () => {
        const id = await manager.create({ name: 'x', cronExpr: '* * * * *', endpoint: 'ghost', enabled: true });
        const run = await manager.trigger(id);
        expect(run.status).toBe('failed');
        expect(run.error).toMatch(/No handler registered/);
    });

    it('start/stop controls the polling loop', () => {
        expect(manager.isRunning).toBe(false);
        manager.start();
        expect(manager.isRunning).toBe(true);
        manager.start(); // idempotent
        expect(manager.isRunning).toBe(true);
        manager.stop();
        expect(manager.isRunning).toBe(false);
    });
});
