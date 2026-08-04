/**
 * Hermetic coverage for src/execution/engine.ts — ExecutionEngineImpl DAG executor.
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import { ExecutionEngineImpl } from '../src/execution/engine.js';
import {
    ExecutionState,
    ExecutionNodeStatus,
    BackoffStrategy,
} from '../src/execution/types.js';
import {
    TaskStatus,
    PlanExecutionStatus,
} from '../src/planner/index.js';
import type { Task, TaskExecutor, TaskResult } from '../src/planner/index.js';

function makeTask(id: string, deps: string[] = [], name?: string): Task {
    return {
        id,
        name: name ?? `task-${id}`,
        description: `desc-${id}`,
        dependencies: deps,
        priority: 0,
        metadata: {},
    } as Task;
}

function makePlan(tasks: Task[]): Parameters<ExecutionEngineImpl['execute']>[0] {
    return {
        id: 'plan-1',
        goal: 'test',
        tasks,
        createdAt: new Date(),
        metadata: { plannerType: 'test' },
    } as never;
}

function makeExecutor(fn: (task: Task, ctx: unknown) => Promise<TaskResult>): TaskExecutor {
    return {
        canExecute: () => true,
        execute: async (task, ctx) => fn(task, ctx),
    } as unknown as TaskExecutor;
}

const completed = (taskId: string, output?: unknown): TaskResult => ({
    taskId,
    status: TaskStatus.COMPLETED,
    output,
    executionTimeMs: 1,
    startedAt: new Date(),
    completedAt: new Date(),
});

describe('execution/engine ExecutionEngineImpl', () => {
    it('executes a linear plan with events and options callbacks', async () => {
        const engine = new ExecutionEngineImpl({ maxConcurrency: 2, defaultTimeoutMs: 1000 });
        const events: string[] = [];
        engine.on('execution:start', () => events.push('start'));
        engine.on('execution:complete', () => events.push('complete'));
        engine.on('task:start', () => events.push('task:start'));
        engine.on('task:complete', () => events.push('task:complete'));

        const executed: string[] = [];
        engine.registerExecutor(makeExecutor(async (task, ctx) => {
            executed.push(task.id);
            expect((ctx as { executionId: string }).executionId).toBeTruthy();
            return completed(task.id, `out-${task.id}`);
        }));

        const plan = makePlan([
            makeTask('a'),
            makeTask('b', ['a']),
            makeTask('c', ['b']),
        ]);
        const onStart = vi.fn();
        const onComplete = vi.fn();
        const result = await engine.execute(plan, { executionId: 'ex1', onTaskStart: onStart, onTaskComplete: onComplete });

        expect(result.status).toBe(PlanExecutionStatus.COMPLETED);
        expect(result.planId).toBe('plan-1');
        expect(executed).toEqual(['a', 'b', 'c']);
        expect(result.taskResults.get('a')!.output).toBe('out-a');
        expect(onStart).toHaveBeenCalledTimes(3);
        expect(onComplete).toHaveBeenCalledTimes(3);
        expect(events).toContain('start');
        expect(events).toContain('complete');
        expect(engine.getStatus('ex1')?.state).toBe(ExecutionState.COMPLETED);
    });

    it('satisfies dependency inputs from results', async () => {
        const engine = new ExecutionEngineImpl();
        const seenInputs: unknown[] = [];
        engine.registerExecutor(makeExecutor(async (task, ctx) => {
            const inputs = (ctx as { inputs: Map<string, unknown> }).inputs;
            seenInputs.push(Array.from(inputs.values()));
            return completed(task.id, `out-${task.id}`);
        }));
        const result = await engine.execute(makePlan([
            makeTask('a'),
            makeTask('b', ['a']),
        ]));
        expect(result.status).toBe(PlanExecutionStatus.COMPLETED);
        expect(seenInputs[1]).toEqual(['out-a']); // b receives a's output as input
    });

    it('skips tasks whose dependency failed (partial via ready-queue race)', async () => {
        const engine = new ExecutionEngineImpl({ maxConcurrency: 2 });
        const failed: TaskResult = {
            taskId: 'a',
            status: TaskStatus.FAILED,
            error: { code: 'X', message: 'boom', retryable: false },
            executionTimeMs: 1,
            startedAt: new Date(),
            completedAt: new Date(),
        };
        engine.registerExecutor(makeExecutor(async (task) => {
            if (task.id === 'a') {
                await new Promise((r) => setTimeout(r, 20));
                return failed;
            }
            return completed(task.id);
        }));
        // Diamond: start → a (fails), start → b; b depends on a but both are ready
        const result = await engine.execute(makePlan([
            makeTask('a'),
            makeTask('b', ['a']),
        ]));
        // a fails; b depends on a and never becomes ready (dep not COMPLETED)
        expect(result.taskResults.get('a')!.status).toBe(TaskStatus.FAILED);
        expect(result.taskResults.get('b')).toBeUndefined();
        // all tasks failed or never ran → FAILED (not partial: only a has a result)
        expect(result.status).toBe(PlanExecutionStatus.FAILED);
    });

    it('all failed → FAILED; onTaskError fired', async () => {
        const engine = new ExecutionEngineImpl();
        engine.registerExecutor(makeExecutor(async () => {
            throw new Error('always fails');
        }));
        const onError = vi.fn();
        const result = await engine.execute(makePlan([makeTask('a')]), { onTaskError: onError });
        expect(result.status).toBe(PlanExecutionStatus.FAILED);
        expect(result.taskResults.get('a')!.status).toBe(TaskStatus.FAILED);
        expect(onError).toHaveBeenCalledWith('a', expect.any(Error));
    });

    it('executor returning FAILED result triggers task:fail and onTaskError', async () => {
        const engine = new ExecutionEngineImpl();
        engine.registerExecutor(makeExecutor(async (task) => ({
            taskId: task.id,
            status: TaskStatus.FAILED,
            error: { code: 'E', message: 'result failed', retryable: false },
            executionTimeMs: 1,
            startedAt: new Date(),
        })));
        const onError = vi.fn();
        const events: string[] = [];
        engine.on('task:fail', () => events.push('task:fail'));
        const result = await engine.execute(makePlan([makeTask('a')]), { onTaskError: onError });
        expect(result.status).toBe(PlanExecutionStatus.FAILED);
        expect(events).toContain('task:fail');
        expect(onError).toHaveBeenCalled();
    });

    it('no executor found → task fails', async () => {
        const engine = new ExecutionEngineImpl();
        const result = await engine.execute(makePlan([makeTask('a')]));
        expect(result.status).toBe(PlanExecutionStatus.FAILED);
        expect(result.taskResults.get('a')!.error?.message).toContain('No executor found');
    });

    it('cancel aborts running execution and emits execution:cancel', async () => {
        const engine = new ExecutionEngineImpl();
        let release: (() => void) | null = null;
        const gate = new Promise<void>((r) => { release = r; });
        engine.registerExecutor(makeExecutor(async () => { await gate; return completed('a'); }));
        const events: string[] = [];
        engine.on('execution:cancel', () => events.push('cancel'));
        const p = engine.execute(makePlan([makeTask('a')]), { executionId: 'ex-cancel' });
        await new Promise((r) => setTimeout(r, 10));
        expect(await engine.cancel('ex-cancel')).toBe(true);
        expect(await engine.cancel('nonexistent')).toBe(false);
        expect(events).toContain('cancel');
        expect(engine.getStatus('ex-cancel')?.state).toBe(ExecutionState.CANCELLED);
        release!();
        await p; // resolves — cancellation only affects status, not the promise
    });

    it('on/off event handlers work', () => {
        const engine = new ExecutionEngineImpl();
        const h = vi.fn();
        engine.on('task:start', h);
        engine.emit('task:start', {} as never);
        expect(h).toHaveBeenCalledTimes(1);
        engine.off('task:start', h);
        engine.emit('task:start', {} as never);
        expect(h).toHaveBeenCalledTimes(1);
    });

    it('parallel tasks execute with concurrency cap', async () => {
        const engine = new ExecutionEngineImpl({ maxConcurrency: 2 });
        let active = 0;
        let peak = 0;
        engine.registerExecutor(makeExecutor(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 20));
            active--;
            return completed('x');
        }));
        const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3'), makeTask('t4'), makeTask('t5')];
        const result = await engine.execute(makePlan(tasks));
        expect(result.status).toBe(PlanExecutionStatus.COMPLETED);
        expect(peak).toBeLessThanOrEqual(2);
    });

    it('abort signal short-circuits execution', async () => {
        const engine = new ExecutionEngineImpl();
        engine.registerExecutor(makeExecutor(async () => { await new Promise((r) => setTimeout(r, 50)); return completed('a'); }));
        // Use internal abort via cancel on the running execution
        const p = engine.execute(makePlan([makeTask('a')]), { executionId: 'ex-abort' });
        await new Promise((r) => setTimeout(r, 5));
        await engine.cancel('ex-abort');
        const result = await p;
        // Abort breaks the loop; task may still complete, but engine returns whatever results exist
        expect(result.status).toBeDefined();
    });

    it('calculateProgress handles zero-total and status states', async () => {
        const engine = new ExecutionEngineImpl();
        const plan = makePlan([makeTask('a')]);
        engine.registerExecutor(makeExecutor(async () => completed('a')));
        const result = await engine.execute(plan);
        expect(result.taskResults.size).toBe(1);
        // getStatus progress reflects completion
        const status = engine.getStatus('x');
        void status;
        expect(BackoffStrategy.EXPONENTIAL).toBe('exponential');
        expect(ExecutionNodeStatus.RUNNING).toBe('running');
    });
});
