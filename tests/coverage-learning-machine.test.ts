/**
 * Hermetic coverage for src/learning/machine.ts — LearningMachine format
 * branches, all learning tools, recall error paths, db-backed constructor.
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import { LearningMachine } from '../src/learning/machine.js';
import type {
    UserMemoryStore,
    SessionContextStore,
    EntityMemoryStore,
    LearnedKnowledgeStore,
    DecisionLogStore,
    UserProfileStore,
} from '../src/learning/types.js';

// Minimal fake stores
const userMemoryStore = (): UserMemoryStore => ({
    get: vi.fn(async () => ({ userId: 'u1', memories: [{ id: 'm1', content: 'hello' }] })),
    set: vi.fn(async (m) => m),
    addMemory: vi.fn(async () => 'new-id'),
    updateMemory: vi.fn(async () => true),
    deleteMemory: vi.fn(async () => true),
    clearMemories: vi.fn(async () => {}),
});

const sessionStore = (): SessionContextStore => ({
    get: vi.fn(async () => ({ sessionId: 's1', summary: 'sum', goal: 'goal', plan: ['a', 'b'], progress: ['x'] })),
    set: vi.fn(async (c) => c),
    clear: vi.fn(async () => true),
});

const entityStore = (): EntityMemoryStore => ({
    get: vi.fn(async () => null),
    search: vi.fn(async () => []),
    set: vi.fn(async (e) => e),
    addFact: vi.fn(async () => 'f1'),
    updateFact: vi.fn(async () => true),
    deleteFact: vi.fn(async () => true),
    addEvent: vi.fn(async () => 'e1'),
    addRelationship: vi.fn(async () => 'r1'),
});

const knowledgeStore = (): LearnedKnowledgeStore => ({
    search: vi.fn(async () => [{ title: 'T', learning: 'L', namespace: 'global' }]),
    save: vi.fn(async (k) => k),
    delete: vi.fn(async () => true),
});

const decisionStore = (): DecisionLogStore => ({
    add: vi.fn(async (d) => ({ id: 'd1', ...d, createdAt: '2026-01-01' })),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    search: vi.fn(async () => [{ id: 'd1', decision: 'chose x', reasoning: 'because', createdAt: '2026-01-01' }]),
    update: vi.fn(async () => true),
    delete: vi.fn(async () => true),
    prune: vi.fn(async () => 0),
});

const profileStore = (): UserProfileStore => ({
    get: vi.fn(async () => ({ userId: 'u1', displayName: 'Alice', preferences: { theme: 'dark' } })),
    set: vi.fn(async (p) => p),
    update: vi.fn(async () => ({ userId: 'u1' })),
    list: vi.fn(async () => []),
    delete: vi.fn(async () => true),
});

describe('learning/machine format branches', () => {
    it('formats user profile name + preferences', async () => {
        const m = new LearningMachine({ userProfile: profileStore() as never });
        const ctx = await m.buildContext({ userId: 'u1' });
        expect(ctx).toContain('User: Alice');
        expect(ctx).toContain('Preferences:');
    });

    it('formats entity memory header/facts/description', async () => {
        const store = entityStore();
        store.get = vi.fn(async () => ({
            entityId: 'acme',
            name: 'Acme',
            entityType: 'company',
            description: 'A company',
            facts: [{ id: 'f1', content: 'makes widgets' }],
        }));
        const m = new LearningMachine({ entityMemory: store as never });
        const ctx = await m.buildContext({ entityId: 'acme' });
        expect(ctx).toContain('Acme (company)');
        expect(ctx).toContain('makes widgets');
    });

    it('formats learned knowledge items', async () => {
        const m = new LearningMachine({ learnedKnowledge: knowledgeStore() as never });
        const ctx = await m.buildContext({ message: 'query' });
        expect(ctx).toContain('Relevant Learnings:');
        expect(ctx).toContain('[T] L');
    });

    it('formats session summary/goal/progress', async () => {
        const m = new LearningMachine({ sessionContext: sessionStore() as never });
        const ctx = await m.buildContext({ sessionId: 's1' });
        expect(ctx).toContain('Session Summary: sum');
        expect(ctx).toContain('Goal: goal');
        expect(ctx).toContain('Completed:');
    });

    it('recall swallows store errors and warns', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const bad = {
            get: vi.fn(async () => { throw new Error('store down'); }),
            set: vi.fn(),
            addMemory: vi.fn(),
            updateMemory: vi.fn(),
            deleteMemory: vi.fn(),
            clearMemories: vi.fn(),
        };
        const m = new LearningMachine({ userMemory: bad as never });
        const result = await m.recall({ userId: 'u1' });
        expect(result.userMemory).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('recall swallows errors from session/entity/knowledge stores', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const failing = { get: vi.fn(async () => { throw new Error('down'); }) };
        const m = new LearningMachine({
            sessionContext: failing as never,
            entityMemory: { ...failing, get: vi.fn(async () => { throw new Error('down'); }), addFact: vi.fn(), addEvent: vi.fn(), updateFact: vi.fn(), deleteFact: vi.fn(), addRelationship: vi.fn(), set: vi.fn(), search: vi.fn() } as never,
            learnedKnowledge: { search: vi.fn(async () => { throw new Error('down'); }), save: vi.fn(), delete: vi.fn() } as never,
        });
        const result = await m.recall({ sessionId: 's1', entityId: 'e1', message: 'q' });
        expect(result.sessionContext).toBeUndefined();
        expect(result.entityMemory).toBeUndefined();
        expect(result.learnedKnowledge).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(3);
        warn.mockRestore();
    });

    it('recall swallows userProfile store errors', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const m = new LearningMachine({
            userProfile: { get: vi.fn(async () => { throw new Error('down'); }) } as never,
        });
        const result = await m.recall({ userId: 'u1' });
        expect(result.userProfile).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('learning/machine tools', () => {
    it('updateMemory / deleteMemory tools + no-userId guards', async () => {
        const store = userMemoryStore();
        const m = new LearningMachine({ userMemory: store });
        const tools = m.getTools({}); // no userId
        expect((await (tools[0] as Function)('x'))).toBe('No userId provided');

        const withUser = m.getTools({ userId: 'u1' });
        const [add, update, del] = withUser as [Function, Function, Function];
        expect(await add('content')).toMatch(/Memory added/);
        expect(await update('m1', 'new')).toMatch(/updated/);
        expect(await del('m1')).toMatch(/deleted/);
    });

    it('updateContext tool creates when missing and updates when present', async () => {
        const store = sessionStore();
        const m = new LearningMachine({ sessionContext: store });
        const tools = m.getTools({});
        expect(await (tools[0] as Function)({ goal: 'g' })).toBe('No sessionId provided');
        const [updater] = m.getTools({ sessionId: 's1' }) as [Function];
        expect(await updater({ goal: 'new-goal' })).toContain('updated');
    });

    it('entity fact/event tools', async () => {
        const store = entityStore();
        const m = new LearningMachine({ entityMemory: store });
        const tools = m.getTools({}) as [Function, Function];
        expect(await tools[0]('acme', 'fact')).toMatch(/Fact added/);
        expect(await tools[1]('acme', 'event', '2026-01-01')).toMatch(/Event added/);
    });

    it('saveKnowledge / searchKnowledge tools', async () => {
        const store = knowledgeStore();
        const m = new LearningMachine({ learnedKnowledge: store });
        const tools = m.getTools({}) as [Function, Function];
        expect(await tools[0]('Title', 'learning', 'ctx', ['a'])).toMatch(/saved/);
        expect(await tools[1]('query')).toContain('[T] L');

        store.search = vi.fn(async () => []);
        const empty = m.getTools({}) as [Function, Function];
        expect(await empty[1]('q')).toBe('No relevant learnings found');
    });

    it('logDecision / searchDecisions tools', async () => {
        const store = decisionStore();
        const m = new LearningMachine({ decisionLog: store });
        const tools = m.getTools({ agentId: 'a1', sessionId: 's1' }) as [Function, Function];
        expect(await tools[0]('decision', 'reason', 'ctx')).toMatch(/Decision logged/);
        expect(await tools[1]('q')).toContain('chose x');

        store.search = vi.fn(async () => []);
        const empty = m.getTools({}) as [Function, Function];
        expect(await empty[1]('q')).toBe('No relevant decisions found');
    });

    it('process is a no-op and debug logging works', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const m = new LearningMachine({ debug: true });
        await m.process({ userId: 'u1', sessionId: 's1' });
        expect(debug).toHaveBeenCalled();
        debug.mockRestore();
        await new LearningMachine().process({ userId: 'u1' });
    });

    it('toJSON with all stores and namespace', () => {
        const m = new LearningMachine({
            userMemory: userMemoryStore(),
            sessionContext: sessionStore(),
            entityMemory: entityStore(),
            learnedKnowledge: knowledgeStore(),
            decisionLog: decisionStore(),
            curator: {} as never,
            namespace: 'ns1',
        });
        const json = m.toJSON();
        expect(json.userMemory).toBe(true);
        expect(json.entityMemory).toBe(true);
        expect(json.namespace).toBe('ns1');
        expect(json.curator).toBe(true);
    });
});
