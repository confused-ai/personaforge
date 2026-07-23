/**
 * Workflow — Step-based workflow creation with step chaining.
 *
 * Provides a fluent, type-safe API for creating multi-step workflows
 * with Zod-validated inputs/outputs, conditional branching, and suspend/resume.
 *
 * @example
 * ```ts
 * import { createWorkflow, createStep } from 'personaforge';
 * import { z } from 'zod';
 *
 * const fetchData = createStep({
 *   id: 'fetch-data',
 *   inputSchema: z.object({ url: z.string() }),
 *   outputSchema: z.object({ data: z.string() }),
 *   execute: async ({ input }) => {
 *     const res = await fetch(input.url);
 *     return { data: await res.text() };
 *   },
 * });
 *
 * const analyze = createStep({
 *   id: 'analyze',
 *   inputSchema: z.object({ data: z.string() }),
 *   outputSchema: z.object({ summary: z.string() }),
 *   execute: async ({ input }) => {
 *     return { summary: input.data.slice(0, 100) + '...' };
 *   },
 * });
 *
 * const workflow = createWorkflow({
 *   id: 'data-pipeline',
 *   inputSchema: z.object({ url: z.string() }),
 * })
 *   .then(fetchData)
 *   .then(analyze)
 *   .commit();
 *
 * const result = await workflow.execute({ url: 'https://example.com' });
 * console.log(result.status);  // 'success'
 * console.log(result.result);  // { summary: '...' }
 * ```
 */

import { z, type ZodType } from 'zod';

// ── Types ──────────────────────────────────────────────────────────────────

/** Status of a workflow step execution. */
export type WorkflowStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'suspended';

/** Context available inside a step's execute function. */
export interface StepExecutionContext<TInput = unknown> {
    /** The validated input to this step. */
    readonly input: TInput;
    /** State from previous steps (keyed by step ID). */
    readonly getStepResult: <T = unknown>(stepId: string) => T | undefined;
    /** Shared state across the workflow run. */
    readonly state: Record<string, unknown>;
    /** Suspend the workflow (can be resumed later). */
    readonly suspend: (reason?: string) => never;
    /** Abort signal for cancellation. */
    readonly abortSignal?: AbortSignal;
}

/** Configuration for a single workflow step. */
export interface StepConfig<
    TInput extends ZodType = ZodType,
    TOutput extends ZodType = ZodType,
> {
    /** Unique step identifier. */
    readonly id: string;
    /** Human-readable description. */
    readonly description?: string;
    /** Zod schema for step input. */
    readonly inputSchema: TInput;
    /** Zod schema for step output. */
    readonly outputSchema: TOutput;
    /** The step's logic. */
    readonly execute: (ctx: StepExecutionContext<z.infer<TInput>>) => Promise<z.infer<TOutput>> | z.infer<TOutput>;
    /** Condition: skip this step if returns false. */
    readonly when?: (ctx: { state: Record<string, unknown>; getStepResult: <T = unknown>(id: string) => T | undefined }) => boolean | Promise<boolean>;
    /** Retry policy for this step. */
    readonly retry?: { maxRetries?: number; backoffMs?: number };
}

/** A compiled step ready for execution. */
export interface WorkflowStep<TInput = unknown, TOutput = unknown> {
    readonly id: string;
    readonly description?: string;
    readonly inputSchema: ZodType<TInput>;
    readonly outputSchema: ZodType<TOutput>;
    readonly execute: (ctx: StepExecutionContext<TInput>) => Promise<TOutput>;
    readonly when?: (ctx: { state: Record<string, unknown>; getStepResult: <T = unknown>(id: string) => T | undefined }) => boolean | Promise<boolean>;
    readonly retry?: { maxRetries: number; backoffMs: number };
}

/**
 * A group of steps to be executed in parallel.
 * Stored in the workflow's steps array and dispatched concurrently by the executor.
 */
export interface ParallelStepGroup {
    readonly _parallel: true;
    readonly steps: WorkflowStep[];
    /** If true (default), abort remaining steps when any step fails. */
    readonly failFast: boolean;
}

/** Type guard: distinguishes a parallel group from a regular step. */
function isParallelGroup(s: WorkflowStep | ParallelStepGroup): s is ParallelStepGroup {
    return (s as ParallelStepGroup)._parallel === true;
}

/** Result from a single step. */
export interface StepResult<T = unknown> {
    readonly stepId: string;
    readonly status: WorkflowStepStatus;
    readonly output?: T;
    readonly error?: Error;
    readonly executionTimeMs: number;
}

/** Result from the entire workflow. */
export interface WorkflowExecutionResult<T = unknown> {
    readonly status: 'success' | 'failed' | 'suspended';
    readonly result?: T;
    readonly error?: Error;
    readonly steps: Record<string, StepResult>;
    readonly executionTimeMs: number;
    readonly suspendedAt?: string;
    /** Resume token for suspended workflows. */
    readonly resumeToken?: string;
}

/** Configuration for creating a workflow. */
export interface WorkflowConfig<TInput extends ZodType = ZodType> {
    readonly id: string;
    readonly description?: string;
    readonly inputSchema: TInput;
    /** Max execution time for the entire workflow. Default: 300000ms (5 min). */
    readonly timeoutMs?: number;
    /** Called when a step completes. */
    readonly onStepComplete?: (stepId: string, result: StepResult) => void;
    /** Called on workflow error. */
    readonly onError?: (error: Error, stepId: string) => void;
}

// ── Step Factory ───────────────────────────────────────────────────────────

/**
 * Create a workflow step with Zod-validated input/output.
 */
export function createStep<TInput extends ZodType, TOutput extends ZodType>(
    config: StepConfig<TInput, TOutput>,
): WorkflowStep<z.infer<TInput>, z.infer<TOutput>> {
    return {
        id: config.id,
        description: config.description,
        inputSchema: config.inputSchema as ZodType<z.infer<TInput>>,
        outputSchema: config.outputSchema as ZodType<z.infer<TOutput>>,
        execute: async (ctx) => {
            const result = await config.execute(ctx);
            // Validate output
            const parsed = config.outputSchema.safeParse(result);
            if (!parsed.success) {
                throw new Error(`Step '${config.id}' output validation failed: ${parsed.error.message}`);
            }
            return parsed.data;
        },
        when: config.when,
        retry: config.retry ? {
            maxRetries: config.retry.maxRetries ?? 2,
            backoffMs: config.retry.backoffMs ?? 500,
        } : undefined,
    };
}

// ── Workflow Builder ───────────────────────────────────────────────────────

/** Sentinel error for suspend/resume. */
class WorkflowSuspendError extends Error {
    constructor(readonly reason: string, readonly stepId: string) {
        super(`Workflow suspended at step '${stepId}': ${reason}`);
        this.name = 'WorkflowSuspendError';
    }
}

/** Builder for composing workflow steps (fluent API). */
export class WorkflowBuilder<TInput = unknown> {
    readonly id: string;
    readonly description?: string;
    readonly inputSchema: ZodType<TInput>;
    readonly timeoutMs: number;

    private steps: Array<WorkflowStep | ParallelStepGroup> = [];
    private hooks: {
        onStepComplete?: (stepId: string, result: StepResult) => void;
        onError?: (error: Error, stepId: string) => void;
    } = {};

    constructor(config: WorkflowConfig<ZodType<TInput>>) {
        this.id = config.id;
        this.description = config.description;
        this.inputSchema = config.inputSchema;
        this.timeoutMs = config.timeoutMs ?? 300_000;
        this.hooks.onStepComplete = config.onStepComplete;
        this.hooks.onError = config.onError;
    }

    /** Append a step to the workflow (sequential). */
    then<TOut>(step: WorkflowStep<any, TOut>): WorkflowBuilder<TInput> {
        this.steps.push(step);
        return this;
    }

    /**
     * Append a group of steps to run **in parallel** (all start simultaneously).
     *
     * All steps receive the same shared state. Their outputs are stored individually
     * in `stepResults` keyed by their step IDs.
     *
     * @param steps     — Steps to execute concurrently.
     * @param failFast  — If true (default), the group fails as soon as any step fails.
     *                    If false, all steps run to completion and failures are collected.
     *
     * @example
     * ```ts
     * createWorkflow({ id: 'pipeline', inputSchema })
     *   .then(fetchStep)
     *   .parallel([summaryStep, keywordsStep, sentimentStep])
     *   .then(aggregateStep)
     *   .commit();
     * ```
     */
    parallel(
        steps: WorkflowStep<any, any>[],
        opts: { failFast?: boolean } = {},
    ): WorkflowBuilder<TInput> {
        if (steps.length === 0) return this;
        const group: ParallelStepGroup = {
            _parallel: true,
            steps,
            failFast: opts.failFast !== false, // default true
        };
        this.steps.push(group as unknown as WorkflowStep);
        return this;
    }

    /** Append a conditional branch. */
    branch(config: {
        condition: (ctx: { state: Record<string, unknown>; getStepResult: <T = unknown>(id: string) => T | undefined }) => boolean | Promise<boolean>;
        ifTrue: WorkflowStep;
        ifFalse?: WorkflowStep;
    }): WorkflowBuilder<TInput> {
        // Wrap as a single step with conditional logic
        const branchStep: WorkflowStep = {
            id: `branch-${this.steps.length}`,
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async (ctx) => {
                const condResult = await config.condition({
                    state: ctx.state,
                    getStepResult: ctx.getStepResult,
                });
                if (condResult) {
                    return config.ifTrue.execute(ctx);
                } else if (config.ifFalse) {
                    return config.ifFalse.execute(ctx);
                }
                return undefined;
            },
        };
        this.steps.push(branchStep);
        return this;
    }

    /** Finalize the workflow — returns an executable Workflow. */
    commit(): Workflow<TInput> {
        return new Workflow<TInput>({
            id: this.id,
            description: this.description,
            inputSchema: this.inputSchema,
            steps: [...this.steps],
            timeoutMs: this.timeoutMs,
            hooks: this.hooks,
        });
    }
}

// ── Executable Workflow ────────────────────────────────────────────────────

export class Workflow<TInput = unknown> {
    readonly id: string;
    readonly description?: string;
    readonly inputSchema: ZodType<TInput>;
    private readonly steps: Array<WorkflowStep | ParallelStepGroup>;
    private readonly timeoutMs: number;
    private readonly hooks: {
        onStepComplete?: (stepId: string, result: StepResult) => void;
        onError?: (error: Error, stepId: string) => void;
    };

    // For suspend/resume
    private savedState?: {
        stepResults: Record<string, StepResult>;
        state: Record<string, unknown>;
        resumeFromStep: number;
        input: TInput;
    };

    constructor(config: {
        id: string;
        description?: string;
        inputSchema: ZodType<TInput>;
        steps: Array<WorkflowStep | ParallelStepGroup>;
        timeoutMs: number;
        hooks: typeof Workflow.prototype.hooks;
    }) {
        this.id = config.id;
        this.description = config.description;
        this.inputSchema = config.inputSchema;
        this.steps = config.steps;
        this.timeoutMs = config.timeoutMs;
        this.hooks = config.hooks;
    }

    /** Execute the workflow with validated input. */
    async execute(input: TInput, abortSignal?: AbortSignal): Promise<WorkflowExecutionResult> {
        const start = Date.now();
        const stepResults: Record<string, StepResult> = {};
        const state: Record<string, unknown> = {};

        // Validate input
        const inputParse = this.inputSchema.safeParse(input);
        if (!inputParse.success) {
            return {
                status: 'failed',
                error: new Error(`Workflow input validation failed: ${inputParse.error.message}`),
                steps: {},
                executionTimeMs: Date.now() - start,
            };
        }

        return this.runSteps(inputParse.data, 0, stepResults, state, start, abortSignal);
    }

    /** Resume a suspended workflow. */
    async resume(overrides?: Record<string, unknown>): Promise<WorkflowExecutionResult> {
        if (!this.savedState) {
            return {
                status: 'failed',
                error: new Error('No suspended workflow to resume'),
                steps: {},
                executionTimeMs: 0,
            };
        }

        const { stepResults, state, resumeFromStep, input } = this.savedState;
        this.savedState = undefined;

        // Apply overrides
        if (overrides) {
            Object.assign(state, overrides);
        }

        return this.runSteps(input, resumeFromStep + 1, stepResults, state, Date.now());
    }

    private async runSteps(
        input: TInput,
        startFrom: number,
        stepResults: Record<string, StepResult>,
        state: Record<string, unknown>,
        startTime: number,
        abortSignal?: AbortSignal,
    ): Promise<WorkflowExecutionResult> {
        let lastOutput: unknown;

        for (let i = startFrom; i < this.steps.length; i++) {
            const stepOrGroup = this.steps[i]!;

            // Timeout check
            if (Date.now() - startTime > this.timeoutMs) {
                return {
                    status: 'failed',
                    error: new Error(`Workflow '${this.id}' timed out after ${this.timeoutMs}ms`),
                    steps: stepResults,
                    executionTimeMs: Date.now() - startTime,
                };
            }

            // Abort check
            if (abortSignal?.aborted) {
                return {
                    status: 'failed',
                    error: new Error('Workflow aborted'),
                    steps: stepResults,
                    executionTimeMs: Date.now() - startTime,
                };
            }

            // ── Parallel group ─────────────────────────────────────────────
            if (isParallelGroup(stepOrGroup)) {
                const group = stepOrGroup;
                const parallelStart = Date.now();
                const getStepResult = <T = unknown>(id: string) => stepResults[id]?.output as T | undefined;

                const groupResults = await Promise.allSettled(
                    group.steps.map(async (pStep) => {
                        const pStart = Date.now();
                        const pCtx: StepExecutionContext = {
                            input: lastOutput,
                            getStepResult,
                            state,
                            suspend: (reason = '') => {
                                throw new WorkflowSuspendError(reason, pStep.id);
                            },
                            abortSignal,
                        };
                        const maxRetries = pStep.retry?.maxRetries ?? 0;
                        for (let attempt = 0; attempt <= maxRetries; attempt++) {
                            try {
                                const out = await pStep.execute(pCtx);
                                return { step: pStep, output: out, durationMs: Date.now() - pStart };
                            } catch (err) {
                                if (attempt >= maxRetries) throw err;
                                await new Promise((r) => setTimeout(r, (pStep.retry?.backoffMs ?? 500) * (attempt + 1)));
                            }
                        }
                        throw new Error(`Step '${pStep.id}' exceeded retries`);
                    }),
                );

                // Collect results
                let groupFailed = false;
                let groupError: Error | undefined;
                const groupOutputs: Record<string, unknown> = {};

                for (const settled of groupResults) {
                    if (settled.status === 'fulfilled') {
                        const { step: ps, output, durationMs } = settled.value;
                        stepResults[ps.id] = {
                            stepId: ps.id,
                            status: 'success',
                            output,
                            executionTimeMs: durationMs,
                        };
                        groupOutputs[ps.id] = output;
                        this.hooks.onStepComplete?.(ps.id, stepResults[ps.id]!);
                    } else {
                        groupFailed = true;
                        // Find which step this belongs to by checking the rejection
                        const err = settled.reason instanceof Error ? settled.reason : new Error(String(settled.reason));
                        groupError = groupError ?? err;
                        // Mark any unresolved steps as failed (best effort: we don't know which step failed here)
                        this.hooks.onError?.(err, `parallel-group-${i}`);
                    }
                }

                if (groupFailed && group.failFast) {
                    return {
                        status: 'failed',
                        error: groupError!,
                        steps: stepResults,
                        executionTimeMs: Date.now() - startTime,
                    };
                }

                // lastOutput is a map of all parallel outputs
                lastOutput = groupOutputs;
                state[`_parallel_group_${i}`] = groupOutputs;
                this.hooks.onStepComplete?.(`parallel-group-${i}`, {
                    stepId: `parallel-group-${i}`,
                    status: groupFailed ? 'failed' : 'success',
                    output: groupOutputs,
                    executionTimeMs: Date.now() - parallelStart,
                });
                continue;
            }

            const step = stepOrGroup;

            // Condition check
            if (step.when) {
                const shouldRun = await step.when({
                    state,
                    getStepResult: <T = unknown>(id: string) => stepResults[id]?.output as T | undefined,
                });
                if (!shouldRun) {
                    stepResults[step.id] = {
                        stepId: step.id,
                        status: 'skipped',
                        executionTimeMs: 0,
                    };
                    continue;
                }
            }

            // Determine input: first step gets workflow input, subsequent steps get previous output
            const stepInput = i === 0 ? input : lastOutput;

            const stepStart = Date.now();
            let attempts = 0;
            const maxAttempts = (step.retry?.maxRetries ?? 0) + 1;

            while (attempts < maxAttempts) {
                attempts++;
                try {
                    const ctx: StepExecutionContext = {
                        input: stepInput,
                        getStepResult: <T = unknown>(id: string) => stepResults[id]?.output as T | undefined,
                        state,
                        suspend: (reason?: string): never => {
                            throw new WorkflowSuspendError(reason ?? 'Suspended by step', step.id);
                        },
                        abortSignal,
                    };

                    const output = await step.execute(ctx);
                    lastOutput = output;

                    const result: StepResult = {
                        stepId: step.id,
                        status: 'success',
                        output,
                        executionTimeMs: Date.now() - stepStart,
                    };
                    stepResults[step.id] = result;
                    this.hooks.onStepComplete?.(step.id, result);
                    break; // Success, no more retries

                } catch (error) {
                    if (error instanceof WorkflowSuspendError) {
                        // Save state for resume
                        this.savedState = {
                            stepResults,
                            state,
                            resumeFromStep: i,
                            input,
                        };

                        stepResults[step.id] = {
                            stepId: step.id,
                            status: 'suspended',
                            executionTimeMs: Date.now() - stepStart,
                        };

                        return {
                            status: 'suspended',
                            steps: stepResults,
                            executionTimeMs: Date.now() - startTime,
                            suspendedAt: step.id,
                            resumeToken: `${this.id}:${step.id}:${Date.now()}`,
                        };
                    }

                    if (attempts >= maxAttempts) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        stepResults[step.id] = {
                            stepId: step.id,
                            status: 'failed',
                            error: err,
                            executionTimeMs: Date.now() - stepStart,
                        };

                        this.hooks.onError?.(err, step.id);

                        return {
                            status: 'failed',
                            error: err,
                            steps: stepResults,
                            executionTimeMs: Date.now() - startTime,
                        };
                    }

                    // Wait before retry
                    const delay = (step.retry?.backoffMs ?? 500) * attempts;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        return {
            status: 'success',
            result: lastOutput,
            steps: stepResults,
            executionTimeMs: Date.now() - startTime,
        };
    }
}

// ── Public Factory ─────────────────────────────────────────────────────────

/**
 * Create a workflow with fluent chaining.
 *
 * @example
 * ```ts
 * const wf = createWorkflow({ id: 'my-wf', inputSchema: z.object({ url: z.string() }) })
 *   .then(fetchStep)
 *   .then(processStep)
 *   .commit();
 * ```
 */
export function createWorkflow<TInput>(
    config: WorkflowConfig<ZodType<TInput>>,
): WorkflowBuilder<TInput> {
    return new WorkflowBuilder<TInput>(config);
}
