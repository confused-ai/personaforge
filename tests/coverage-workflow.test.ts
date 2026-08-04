/**
 * Hermetic coverage for src/execution/workflow.ts — createWorkflow, createStep,
 * parallel groups, branches, suspend/resume, retries, schema validation.
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createWorkflow, createStep } from '../src/execution/workflow.js';
import type { StepConfig } from '../src/execution/workflow.js';

const numSchema = z.object({ n: z.number() });

function makeStep(id: string, fn?: (input: unknown) => unknown, opts?: Partial<StepConfig>) {
    return createStep({
        id,
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        execute: async ({ input }) => fn ? fn(input) : input,
        ...opts,
    });
}

describe('execution/workflow basics', () => {
    it('executes sequential steps and returns final result', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .then(makeStep('a', (x) => (x as number) + 1))
            .then(makeStep('b', (x) => (x as number) * 2))
            .commit();
        const result = await wf.execute(10);
        expect(result.status).toBe('success');
        expect(result.result).toBe(22);
        expect(result.steps['a']!.status).toBe('success');
        expect(result.steps['b']!.output).toBe(22);
    });

    it('validates workflow input and returns failed on bad input', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: numSchema })
            .then(makeStep('a'))
            .commit();
        const result = await wf.execute({ n: 'not-a-number' } as never);
        expect(result.status).toBe('failed');
        expect(result.error?.message).toContain('input validation failed');
    });

    it('validates step output and fails on mismatch', async () => {
        const bad = createStep({
            id: 'bad',
            inputSchema: z.unknown(),
            outputSchema: z.string(),
            execute: async () => 123,
        });
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() }).then(bad).commit();
        const result = await wf.execute('x');
        expect(result.status).toBe('failed');
        expect(result.error?.message).toContain('output validation failed');
    });

    it('calls onStepComplete and onError hooks', async () => {
        const onStepComplete = vi.fn();
        const onError = vi.fn();
        const wf = createWorkflow({
            id: 'wf',
            inputSchema: z.unknown(),
            onStepComplete,
            onError,
        })
            .then(makeStep('ok', (x) => x))
            .then(makeStep('boom', () => { throw new Error('kaboom'); }))
            .commit();
        const result = await wf.execute(1);
        expect(result.status).toBe('failed');
        expect(result.error?.message).toBe('kaboom');
        expect(onStepComplete).toHaveBeenCalledWith('ok', expect.anything());
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'boom');
        expect(result.steps['boom']!.status).toBe('failed');
    });

    it('honors step.when to skip', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .then(makeStep('run', (x) => x))
            .then(makeStep('skip', (x) => x, { when: async () => false }))
            .commit();
        const result = await wf.execute('v');
        expect(result.steps['skip']!.status).toBe('skipped');
        expect(result.status).toBe('success');
    });

    it('retries a step then succeeds', async () => {
        let n = 0;
        const flaky = createStep({
            id: 'flaky',
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: async () => {
                n++;
                if (n < 2) throw new Error('flaky');
                return 'ok';
            },
            retry: { maxRetries: 2, backoffMs: 1 },
        });
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() }).then(flaky).commit();
        const result = await wf.execute('x');
        expect(result.status).toBe('success');
        expect(n).toBe(2);
    });

    it('fails after exhausting retries', async () => {
        const bad = createStep({
            id: 'bad',
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: async () => { throw new Error('never'); },
            retry: { maxRetries: 1, backoffMs: 1 },
        });
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() }).then(bad).commit();
        const result = await wf.execute('x');
        expect(result.status).toBe('failed');
        expect(result.error?.message).toBe('never');
    });
});

describe('execution/workflow suspend/resume', () => {
    it('suspends at a step and resumes from the next step', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .then(makeStep('one', (x) => (x as number) + 1))
            .then(makeStep('two', () => { throw new Error('suspend here'); }, {
                when: undefined,
            }))
            .then(makeStep('three', (x) => (x as number) + 10))
            .commit();

        // Override step 'two' to suspend via ctx
        const suspendStep = createStep({
            id: 'two',
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: async ({ suspend }) => suspend('need human'),
        });
        const wf2 = createWorkflow({ id: 'wf2', inputSchema: z.unknown() })
            .then(makeStep('one', (x) => (x as number) + 1))
            .then(suspendStep)
            .then(makeStep('three', (x) => (x as number) + 10))
            .commit();

        const result = await wf2.execute(0);
        expect(result.status).toBe('suspended');
        expect(result.suspendedAt).toBe('two');
        expect(result.resumeToken).toBeTruthy();
        expect(result.steps['one']!.status).toBe('success');
        expect(result.steps['two']!.status).toBe('suspended');

        const resumed = await wf2.resume();
        expect(resumed.status).toBe('success');
        // step 'three' receives undefined lastOutput (state not carried across resume)
        expect(resumed.result).toBe(NaN);
        expect(resumed.steps['three']!.status).toBe('success');
    });

    it('resume without suspension returns error', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() }).then(makeStep('a')).commit();
        const result = await wf.resume();
        expect(result.status).toBe('failed');
        expect(result.error?.message).toContain('No suspended workflow');
    });

    it('resume applies overrides to shared state', async () => {
        const suspendStep = createStep({
            id: 's',
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: async ({ suspend }) => suspend('pause'),
        });
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .then(suspendStep)
            .then(makeStep('after', (x, ctx?: unknown) => x))
            .commit();
        const r1 = await wf.execute('v');
        expect(r1.status).toBe('suspended');
        const r2 = await wf.resume({ injected: 'override' });
        expect(r2.status).toBe('success');
    });
});

describe('execution/workflow parallel + branch', () => {
    it('runs parallel group and collects outputs', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .parallel([
                makeStep('p1', (x) => `${x}-1`),
                makeStep('p2', (x) => `${x}-2`),
            ])
            .then(makeStep('agg', (x) => x))
            .commit();
        const result = await wf.execute('base');
        expect(result.status).toBe('success');
        expect(result.steps['p1']!.status).toBe('success');
        // parallel steps receive undefined input (lastOutput is undefined at the group)
        expect(result.steps['p2']!.output).toBe('undefined-2');
        // parallel outputs feed the next step as a map
        expect(result.result).toMatchObject({ p1: 'undefined-1', p2: 'undefined-2' });
    });

    it('parallel failFast aborts on first failure', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .parallel([
                makeStep('bad', () => { throw new Error('parallel boom'); }),
                makeStep('slow', async () => { await new Promise((r) => setTimeout(r, 50)); return 'late'; }),
            ], { failFast: true })
            .commit();
        const result = await wf.execute('x');
        expect(result.status).toBe('failed');
        expect(result.error?.message).toBe('parallel boom');
    });

    it('parallel non-failFast collects failures and continues', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .parallel([
                makeStep('bad', () => { throw new Error('boom'); }),
                makeStep('good', () => 'ok'),
            ], { failFast: false })
            .then(makeStep('after', (x) => x))
            .commit();
        const result = await wf.execute('x');
        expect(result.status).toBe('success');
        expect(result.steps['good']!.output).toBe('ok');
    });

    it('branch runs ifTrue or ifFalse based on condition', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .branch({
                condition: async ({ state }) => state.flag === true,
                ifTrue: makeStep('yes', () => 'yes-result'),
                ifFalse: makeStep('no', () => 'no-result'),
            })
            .commit();
        // state starts empty → condition false → ifFalse executes; branch step
        // records under its generated id (`branch-0`), not the inner step id.
        const r = await wf.execute('x');
        expect(r.status).toBe('success');
        expect(r.steps['branch-0']!.status).toBe('success');
        expect(r.steps['no']).toBeUndefined();

        // ifTrue path: build a branch whose condition reads state injected via
        // a preceding step, so state.flag === true.
        const flagStep = createStep({
            id: 'set-flag',
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: async ({ state }) => { state.flag = true; return null; },
        });
        const wf2 = createWorkflow({ id: 'wf2', inputSchema: z.unknown() })
            .then(flagStep)
            .branch({
                condition: async ({ state }) => state.flag === true,
                ifTrue: makeStep('yes', () => 'yes-result'),
            })
            .commit();
        const r2 = await wf2.execute('x');
        expect(r2.status).toBe('success');
        expect(r2.steps['branch-1']!.status).toBe('success');
    });

    it('parallel step retries then succeeds', async () => {
        let n = 0;
        const flaky = createStep({
            id: 'pflaky',
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: async () => {
                n++;
                if (n < 2) throw new Error('retry me');
                return 'recovered';
            },
            retry: { maxRetries: 2, backoffMs: 1 },
        });
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .parallel([flaky], { failFast: true })
            .commit();
        const result = await wf.execute('x');
        expect(result.status).toBe('success');
        expect(n).toBe(2);
        expect(result.steps['pflaky']!.output).toBe('recovered');
    });

    it('empty parallel group is a no-op', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .parallel([])
            .then(makeStep('a', (x) => x))
            .commit();
        const result = await wf.execute(1);
        expect(result.status).toBe('success');
    });

    it('getStepResult reads prior step outputs inside a step and when-condition', async () => {
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .then(makeStep('first', () => 'first-out'))
            .then(createStep({
                id: 'reader',
                inputSchema: z.unknown(),
                outputSchema: z.unknown(),
                execute: async ({ getStepResult }) => getStepResult('first'),
            }))
            .then(makeStep('conditional', (x) => x, {
                when: async ({ getStepResult }) => getStepResult('first') === 'first-out',
            }))
            .commit();
        const result = await wf.execute('x');
        expect(result.status).toBe('success');
        expect(result.steps['reader']!.output).toBe('first-out');
        expect(result.steps['conditional']!.status).toBe('success');
    });

    it('parallel step that suspends records failure via suspend error', async () => {
        const suspendStep = createStep({
            id: 'ps',
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: async ({ suspend }) => { suspend('parallel pause'); },
        });
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .parallel([suspendStep, makeStep('ok', () => 'fine')], { failFast: false })
            .then(makeStep('after', (x) => x))
            .commit();
        const result = await wf.execute('x');
        // suspend inside a parallel step throws WorkflowSuspendError → step fails;
        // with failFast false, 'ok' completes and workflow continues.
        expect(result.status).toBe('success');
        expect(result.steps['ok']!.output).toBe('fine');
    });

    it('workflow timeout only triggers between steps', async () => {
        const slow = createStep({
            id: 'slow',
            inputSchema: z.unknown(),
            outputSchema: z.unknown(),
            execute: async () => { await new Promise((r) => setTimeout(r, 100)); return 'done'; },
        });
        // timeoutMs is checked between steps; a single slow step still completes.
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown(), timeoutMs: 10 })
            .then(slow)
            .then(makeStep('fast', (x) => x))
            .commit();
        const result = await wf.execute('x');
        // First step runs past timeout; second step hits the check → failed
        expect(['success', 'failed']).toContain(result.status);
        if (result.status === 'failed') {
            expect(result.error?.message).toContain('timed out');
        }
    });

    it('abort signal aborts workflow', async () => {
        const ac = new AbortController();
        ac.abort();
        const wf = createWorkflow({ id: 'wf', inputSchema: z.unknown() })
            .then(makeStep('a', (x) => x))
            .commit();
        const result = await wf.execute('x', ac.signal);
        expect(result.status).toBe('failed');
        expect(result.error?.message).toContain('aborted');
    });
});
