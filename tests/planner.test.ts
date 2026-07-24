/**
 * Tests for ClassicalPlanner and PlanValidator — pure planning logic, no LLM.
 */

import { describe, it, expect } from 'vitest';
import { ClassicalPlanner } from '../src/planner/classical-planner.js';
import { PlanValidator } from '../src/planner/validator.js';
import { PlanningAlgorithm, TaskPriority, TaskStatus } from '../src/planner/types.js';
import type { Plan, Task, PlanFeedback } from '../src/planner/types.js';

function makePlanner() {
    return new ClassicalPlanner({ algorithm: PlanningAlgorithm.HIERARCHICAL });
}

describe('ClassicalPlanner', () => {
    it('creates a plan from a goal string', async () => {
        const planner = makePlanner();
        const plan = await planner.plan('analyze sales data');
        expect(plan.id).toBeDefined();
        expect(plan.goal).toBe('analyze sales data');
        expect(plan.tasks.length).toBeGreaterThan(0);
        expect(plan.metadata.plannerType).toBe('classical');
    });

    it('returns config via getConfig()', () => {
        const planner = makePlanner();
        const cfg = planner.getConfig();
        expect(cfg.algorithm).toBe(PlanningAlgorithm.HIERARCHICAL);
        expect(cfg.maxIterations).toBeGreaterThan(0);
    });

    it('falls back to a single task when no pattern matches', async () => {
        const planner = makePlanner();
        const plan = await planner.plan('do something very obscure xyz123');
        expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
        expect(plan.metadata.confidence).toBeLessThanOrEqual(0.5);
    });

    it('matches known patterns and produces multi-step plans', async () => {
        const planner = makePlanner();
        const plan = await planner.plan('research the latest AI papers');
        expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('refine reduces confidence and adjusts tasks', async () => {
        const planner = makePlanner();
        const plan = await planner.plan('build dashboard');
        const feedback: PlanFeedback = {
            planId: plan.id,
            taskFeedback: plan.tasks.map((t) => ({
                taskId: t.id,
                status: 'needs_refinement' as const,
                feedback: 'break down further',
            })),
        };
        const refined = await planner.refine(plan, feedback);
        expect(refined.metadata.confidence).toBeLessThan(plan.metadata.confidence ?? 1);
    });

    it('validate returns valid for well-formed plans', async () => {
        const planner = makePlanner();
        const plan = await planner.plan('review code');
        const result = planner.validate(plan);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
});

describe('PlanValidator', () => {
    const validator = new PlanValidator();

    function makeTask(overrides: Partial<Task> & { id: string; name: string }): Task {
        return {
            description: overrides.name,
            dependencies: [],
            priority: TaskPriority.MEDIUM,
            metadata: { retryCount: 0, tags: [] },
            ...overrides,
        } as unknown as Task;
    }

    function makePlan(tasks: Task[]): Plan {
        return {
            id: 'plan-1',
            goal: 'test',
            tasks,
            createdAt: new Date(),
            metadata: { plannerType: 'test', estimatedTotalDurationMs: 0, confidence: 1 },
        };
    }

    it('accepts valid linear dependency chain', () => {
        const a = makeTask({ id: 'a', name: 'step 1', dependencies: [] });
        const b = makeTask({ id: 'b', name: 'step 2', dependencies: ['a'] });
        const c = makeTask({ id: 'c', name: 'step 3', dependencies: ['b'] });
        const result = validator.validate(makePlan([a, b, c]));
        expect(result.valid).toBe(true);
    });

    it('detects circular dependencies', () => {
        const a = makeTask({ id: 'a', name: 'a', dependencies: ['b'] });
        const b = makeTask({ id: 'b', name: 'b', dependencies: ['a'] });
        const result = validator.validate(makePlan([a, b]));
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.toLowerCase().includes('circular'))).toBe(true);
    });

    it('detects missing dependencies', () => {
        const a = makeTask({ id: 'a', name: 'a', dependencies: ['nonexistent'] });
        const result = validator.validate(makePlan([a]));
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.toLowerCase().includes('missing'))).toBe(true);
    });

    it('rejects empty task name', () => {
        const a = makeTask({ id: 'a', name: '' });
        const result = validator.validate(makePlan([a]));
        expect(result.valid).toBe(false);
    });

    it('rejects duplicate task ids', () => {
        const a = makeTask({ id: 'x', name: 'first' });
        const b = makeTask({ id: 'x', name: 'second' });
        const result = validator.validate(makePlan([a, b]));
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.toLowerCase().includes('duplicate'))).toBe(true);
    });

    it('validates task results', () => {
        const a = makeTask({ id: 'a', name: 'step' });
        const ok = validator.validateTaskResult(a, { status: TaskStatus.COMPLETED });
        expect(ok).toHaveLength(0);
        const bad = validator.validateTaskResult(a, { status: TaskStatus.FAILED });
        expect(bad.length).toBeGreaterThan(0);
    });

    it('rejects an empty plan', () => {
        const result = validator.validate(makePlan([]));
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.toLowerCase().includes('no tasks'))).toBe(true);
    });
});
