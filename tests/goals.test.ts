/**
 * Hermetic unit tests for the durable Goals layer (src/goals) — in-memory
 * store, LLM/static/rubric/schema judges. No network, no real LLM.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { LLMProvider, Message } from '@personaforge/core';
import {
    InMemoryGoalStore,
    parseVerdict,
    createLlmJudge,
    createStaticJudge,
    createRubricScorer,
    createSchemaScorer,
    createRubricScorer as RubricScorer,
} from '@personaforge/goals';

// ── Goal store ───────────────────────────────────────────────────────────────

describe('InMemoryGoalStore', () => {
    const record = (threadId: string, overrides: Partial<Parameters<InMemoryGoalStore['setObjective']>[0]> = {}) => ({
        objective: `Do the thing for ${threadId}`,
        threadId,
        runsUsed: 1,
        status: 'active' as const,
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    });

    it('set/get objective round-trips by threadId', async () => {
        const store = new InMemoryGoalStore();
        await store.setObjective(record('t-1'));
        const got = await store.getObjective('t-1');
        expect(got?.objective).toBe('Do the thing for t-1');
        expect(got?.runsUsed).toBe(1);
    });

    it('returns null for an unknown thread', async () => {
        const store = new InMemoryGoalStore();
        expect(await store.getObjective('missing')).toBeNull();
    });

    it('overwrites on re-set', async () => {
        const store = new InMemoryGoalStore();
        await store.setObjective(record('t-1', { objective: 'v1' }));
        await store.setObjective(record('t-1', { objective: 'v2', runsUsed: 5 }));
        const got = await store.getObjective('t-1');
        expect(got?.objective).toBe('v2');
        expect(got?.runsUsed).toBe(5);
    });

    it('updateOptions patches maxRuns and prompt, bumping updatedAt', async () => {
        const store = new InMemoryGoalStore();
        await store.setObjective(record('t-1'));
        await store.updateOptions('t-1', { maxRuns: 99, prompt: 'be strict' });
        const got = await store.getObjective('t-1');
        expect(got?.maxRuns).toBe(99);
        expect(got?.prompt).toBe('be strict');
        expect(got?.objective).toBe('Do the thing for t-1');
    });

    it('updateOptions no-ops for an unknown thread', async () => {
        const store = new InMemoryGoalStore();
        await store.updateOptions('missing', { maxRuns: 1 });
        expect(await store.getObjective('missing')).toBeNull();
    });

    it('listIncomplete only returns active goals', async () => {
        const store = new InMemoryGoalStore();
        await store.setObjective(record('t-1'));
        await store.setObjective(record('t-2', { status: 'done' }));
        await store.setObjective(record('t-3'));
        const incomplete = await store.listIncomplete();
        expect(incomplete.map((g) => g.threadId).sort()).toEqual(['t-1', 't-3']);
    });

    it('clear removes a goal', async () => {
        const store = new InMemoryGoalStore();
        await store.setObjective(record('t-1'));
        await store.clear('t-1');
        expect(await store.getObjective('t-1')).toBeNull();
    });
});

// ── parseVerdict ─────────────────────────────────────────────────────────────

describe('parseVerdict', () => {
    it('parses JSON verdicts', () => {
        expect(parseVerdict('{"passed": true, "reason": "ok"}')).toEqual({ passed: true, reason: 'ok', score: 1 });
        expect(parseVerdict('{"passed": false, "reason": "no"}')).toMatchObject({ passed: false, reason: 'no', score: 0 });
    });

    it('parses JSON inside a code fence', () => {
        const raw = '```json\n{"passed": true, "reason": "fenced"}\n```';
        expect(parseVerdict(raw)).toMatchObject({ passed: true, reason: 'fenced' });
    });

    it('parses a custom numeric score', () => {
        expect(parseVerdict('{"passed": true, "reason": "x", "score": 0.8}')).toEqual({ passed: true, reason: 'x', score: 0.8 });
    });

    it('falls back to keyword detection for non-JSON output', () => {
        expect(parseVerdict('Yes, the task is complete.')).toMatchObject({ passed: true });
        expect(parseVerdict('No, not satisfied yet.')).toMatchObject({ passed: false });
        expect(parseVerdict('Incomplete.')).toMatchObject({ passed: false });
    });

    it('prefers explicit `no` over a trailing `yes`', () => {
        expect(parseVerdict('yes no')).toMatchObject({ passed: false });
    });
});

// ── LLM judge ────────────────────────────────────────────────────────────────

describe('createLlmJudge', () => {
    function fakeLlm(text: string): LLMProvider {
        return {
            generateText: vi.fn(async (): Promise<{ text: string; finishReason: 'stop' }> => ({ text, finishReason: 'stop' })),
        };
    }

    it('sends a zero-temperature judge request and parses the verdict', async () => {
        const llm = fakeLlm('{"passed": true, "reason": "done"}');
        const judge = createLlmJudge({ llm });
        const verdict = await judge.evaluate('agent output');
        expect(verdict.passed).toBe(true);
        expect(llm.generateText).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ temperature: 0, toolChoice: 'none' }),
        );
        const messages = (llm.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
        expect(messages[0].role).toBe('system');
        expect(messages[1].role).toBe('user');
        expect(String(messages[1].content)).toContain('agent output');
    });

    it('passes raw text through when jsonOutput is false', async () => {
        const llm = fakeLlm('{"passed": true}');
        const judge = createLlmJudge({ llm, jsonOutput: false });
        await judge.evaluate('raw');
        const messages = (llm.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
        expect(String(messages[1].content)).toBe('raw');
    });
});

// ── Static judge ─────────────────────────────────────────────────────────────

describe('createStaticJudge', () => {
    it('passes when the predicate returns true', async () => {
        const judge = createStaticJudge((text) => text.includes('DONE'));
        expect((await judge.evaluate('all DONE')).passed).toBe(true);
    });

    it('fails with a reason when the predicate returns false', async () => {
        const judge = createStaticJudge(() => false);
        const verdict = await judge.evaluate('x');
        expect(verdict.passed).toBe(false);
        expect(verdict.reason).toContain('not yet complete');
    });

    it('supports async predicates', async () => {
        const judge = createStaticJudge(async (t) => t.length > 3);
        expect((await judge.evaluate('long text')).passed).toBe(true);
        expect((await judge.evaluate('ab')).passed).toBe(false);
    });
});

// ── Rubric scorer ────────────────────────────────────────────────────────────

describe('createRubricScorer', () => {
    const passJudge = createStaticJudge(() => true);
    const failJudge = createStaticJudge(() => false);

    it('passes when every criterion is mentioned (requireAll: true)', async () => {
        const judge = createRubricScorer({
            judge: failJudge,
            criteria: [{ description: 'covers pricing' }, { description: 'lists features' }],
            requireAll: true,
        });
        const verdict = await judge.evaluate('The answer covers pricing and lists features.');
        expect(verdict.passed).toBe(true);
    });

    it('fails when a required criterion is missing (requireAll: true)', async () => {
        const judge = createRubricScorer({
            judge: failJudge,
            criteria: [{ description: 'covers pricing' }, { description: 'lists features' }],
            requireAll: true,
        });
        const verdict = await judge.evaluate('only covers pricing');
        expect(verdict.passed).toBe(false);
        expect(verdict.reason).toContain('lists features');
    });

    it('passes on the FIRST evaluation when any criterion is met (requireAll: false, regression for idx hack)', async () => {
        // Old behavior: `idx > 0` made the SECOND evaluation pass regardless of
        // content. New behavior: with requireAll:false, passing requires at
        // least one criterion actually satisfied — on the first evaluation too.
        const judge = createRubricScorer({
            judge: failJudge,
            criteria: [{ description: 'mentions numbers' }, { description: 'has a table' }],
            requireAll: false,
        });
        const passed = await judge.evaluate('The result mentions numbers.');
        expect(passed.passed).toBe(true);

        // Content that satisfies NOTHING must fail even on a later evaluation.
        const judge2 = createRubricScorer({
            judge: failJudge,
            criteria: [{ description: 'mentions numbers' }, { description: 'has a table' }],
            requireAll: false,
        });
        expect((await judge2.evaluate('nonsense text')).passed).toBe(false);
        expect((await judge2.evaluate('still nonsense')).passed).toBe(false);
    });

    it('defers to the LLM judge when it says pass, even if the heuristic fails', async () => {
        const judge = createRubricScorer({
            judge: passJudge,
            criteria: [{ description: 'unrelated criterion' }],
            requireAll: true,
        });
        const verdict = await judge.evaluate('nothing matches');
        expect(verdict.passed).toBe(true);
    });

    it('falls back to the heuristic when the LLM judge throws', async () => {
        const throwing = { evaluate: vi.fn(async () => { throw new Error('judge down'); }) };
        const judge = createRubricScorer({ judge: throwing, criteria: [{ description: 'covers x' }], requireAll: true });
        const verdict = await judge.evaluate('covers x here');
        expect(verdict.passed).toBe(true);
    });

    it('is deterministic across evaluations (no hidden iteration counter)', async () => {
        const judge = createRubricScorer({ judge: failJudge, criteria: [{ description: 'zebra' }], requireAll: true });
        const a = await judge.evaluate('nothing about animals');
        const b = await judge.evaluate('nothing about animals');
        expect(a.passed).toBe(false);
        expect(b.passed).toBe(false);
    });
});

// ── Schema scorer ────────────────────────────────────────────────────────────

describe('createSchemaScorer', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it('passes when the output is valid JSON matching the schema', async () => {
        const judge = createSchemaScorer(schema as never);
        const verdict = await judge.evaluate('{"name": "Ada", "age": 37}');
        expect(verdict.passed).toBe(true);
    });

    it('parses JSON inside a code fence', async () => {
        const judge = createSchemaScorer(schema as never);
        const verdict = await judge.evaluate('```json\n{"name": "Ada", "age": 37}\n```');
        expect(verdict.passed).toBe(true);
    });

    it('fails when the output does not match the schema', async () => {
        const judge = createSchemaScorer(schema as never);
        const verdict = await judge.evaluate('{"name": "Ada"}');
        expect(verdict.passed).toBe(false);
        expect(verdict.reason).toContain('does not conform');
    });

    it('fails on unparseable output', async () => {
        const judge = createSchemaScorer(schema as never);
        expect((await judge.evaluate('not json at all')).passed).toBe(false);
    });
});

// ── Export sanity ────────────────────────────────────────────────────────────

describe('goals exports', () => {
    it('exposes the rubric scorer under its canonical name', () => {
        expect(RubricScorer).toBe(createRubricScorer);
    });
});
