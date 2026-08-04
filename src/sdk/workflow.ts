import type { DefinedAgent } from './defined-agent.js';
import type { WorkflowResult } from './types.js';
import { newId } from '../contracts/index.js';
import { workflowAsTool } from '../tools/core/workflow-as-tool.js';
import type { WorkflowAsToolOptions } from '../tools/core/workflow-as-tool.js';
import type { LightweightTool, ToolObjectSchemaLike } from '../tools/core/tool-helper.js';

/**
 * Create a multi-step workflow builder (task / parallel / sequential / suspend).
 */
export function createWorkflow(): WorkflowBuilder {
    return new WorkflowBuilder();
}

export interface WorkflowStep {
    type: 'task' | 'parallel' | 'sequential' | 'suspend';
    name?: string;
    agent?: DefinedAgent<unknown, unknown>;
    dependencies?: string[];
    /** Human-facing prompt for a `suspend` step (human-in-the-loop). */
    message?: string;
}

/**
 * A workflow that paused at a `.suspend()` step waiting for human input.
 * Plain JSON — persist it anywhere and {@link Workflow.resume} later.
 */
export interface WorkflowSuspension {
    status: 'suspended';
    /** Opaque token correlating this pause with its resume. */
    token: string;
    /** Index of the suspend step to resume at. */
    stepIndex: number;
    /** Name of the awaited input (the suspend step's `name`). */
    awaiting: string;
    /** Optional human-facing message describing what input is needed. */
    message?: string;
    /** Results accumulated before the pause. */
    results: Record<string, unknown>;
    /** Inputs already supplied to earlier suspend steps. */
    inputs: Record<string, unknown>;
    /** The original execution context, preserved across the pause. */
    context: Record<string, unknown>;
}

/** A workflow that ran to completion. */
export interface WorkflowCompletion extends WorkflowResult {
    status: 'completed';
}

/** Result of executing or resuming a workflow. */
export type WorkflowExecuteResult = WorkflowCompletion | WorkflowSuspension;

/** Internal resume state threaded back into `execute`. */
interface ResumeState {
    startIndex: number;
    results: Record<string, unknown>;
    inputs: Record<string, unknown>;
    context: Record<string, unknown>;
}

/** Type guard: did the workflow pause for human input? */
export function isSuspended(r: WorkflowExecuteResult): r is WorkflowSuspension {
    return r.status === 'suspended';
}

/**
 * Chains `DefinedAgent` steps with optional parallel groups.
 */
export class WorkflowBuilder {
    private steps: WorkflowStep[] = [];

    task(name: string, agent: DefinedAgent<unknown, unknown>): this {
        this.steps.push({ type: 'task', name, agent });
        return this;
    }

    parallel(): this {
        this.steps.push({ type: 'parallel' });
        return this;
    }

    sequential(): this {
        this.steps.push({ type: 'sequential' });
        return this;
    }

    /**
     * Pause the workflow here until a human supplies input named `name`.
     * `execute()` returns a {@link WorkflowSuspension}; call {@link Workflow.resume}
     * with the value to continue. The value becomes `results[name]`.
     */
    suspend(name: string, message?: string): this {
        this.steps.push({ type: 'suspend', name, message });
        return this;
    }

    dependsOn(...taskNames: string[]): this {
        const lastStep = this.steps[this.steps.length - 1];
        if (lastStep && lastStep.type === 'task') {
            lastStep.dependencies = taskNames;
        }
        return this;
    }

    build(): Workflow {
        return new Workflow(this.steps);
    }

    async execute(context?: Record<string, unknown>): Promise<WorkflowExecuteResult> {
        const workflow = this.build();
        return workflow.execute(context);
    }

    /**
     * Expose this workflow as a tool so an agent can trigger it via
     * function calling (workflow-as-tool).
     */
    asTool<TOutput = unknown>(
        options: Omit<WorkflowAsToolOptions<unknown, TOutput>, 'workflow'>,
    ): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
        return workflowAsTool({
            ...options,
            workflow: this,
        });
    }
}

/**
 * Immutable workflow: execute with shared context and accumulated results.
 */
export class Workflow {
    private steps: WorkflowStep[];

    constructor(steps: WorkflowStep[]) {
        this.steps = steps;
    }

    async execute(context?: Record<string, unknown>, resume?: ResumeState): Promise<WorkflowExecuteResult> {
        const results: Record<string, unknown> = { ...(resume?.results ?? {}) };
        const inputs: Record<string, unknown> = { ...(resume?.inputs ?? {}) };
        const mergedContext = resume?.context ?? context ?? {};
        const startIndex = resume?.startIndex ?? 0;
        let mode: 'sequential' | 'parallel' = 'sequential';
        let parallelBatch: Array<{ name: string; agent: DefinedAgent<unknown, unknown> }> = [];

        const flushParallel = async (): Promise<void> => {
            if (parallelBatch.length === 0) return;
            const batch = parallelBatch;
            parallelBatch = [];
            const batchResults = await Promise.all(
                batch.map(async (task) => {
                    const result = await task.agent.run({
                        input: mergedContext,
                        context: { ...mergedContext, results },
                    });
                    return [task.name, result] as const;
                })
            );
            for (const [name, value] of batchResults) {
                results[name] = value;
            }
        };

        for (let i = startIndex; i < this.steps.length; i++) {
            const step = this.steps[i]!;
            if (step.type === 'parallel') {
                mode = 'parallel';
                continue;
            }
            if (step.type === 'sequential') {
                await flushParallel();
                mode = 'sequential';
                continue;
            }
            if (step.type === 'suspend' && step.name) {
                // Pending parallel work must settle before a human gate.
                await flushParallel();
                mode = 'sequential';
                if (step.name in inputs) {
                    // Resumed: the supplied value becomes this step's result.
                    results[step.name] = inputs[step.name];
                    continue;
                }
                // First reach — pause and hand control back to the caller.
                return {
                    status: 'suspended',
                    token: newId('wf'),
                    stepIndex: i,
                    awaiting: step.name,
                    ...(step.message !== undefined && { message: step.message }),
                    results,
                    inputs,
                    context: mergedContext,
                };
            }
            if (step.type === 'task' && step.agent && step.name) {
                if (mode === 'parallel') {
                    parallelBatch.push({ name: step.name, agent: step.agent });
                } else {
                    const result = await step.agent.run({
                        input: mergedContext,
                        context: { ...mergedContext, results },
                    });
                    results[step.name] = result;
                }
            }
        }
        await flushParallel();

        return { status: 'completed', results };
    }

    /**
     * Expose this workflow as a tool so an agent can trigger it via
     * function calling (workflow-as-tool).
     */
    asTool<TOutput = unknown>(
        options: Omit<WorkflowAsToolOptions<unknown, TOutput>, 'workflow'>,
    ): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
        return workflowAsTool({
            ...options,
            workflow: this,
        });
    }

    /**
     * Resume a workflow paused by a `.suspend()` step. The `value` is recorded as
     * `results[suspension.awaiting]` and execution continues from the pause point.
     * Must be called on the same Workflow (same steps) that produced the suspension.
     */
    async resume(suspension: WorkflowSuspension, value: unknown): Promise<WorkflowExecuteResult> {
        return this.execute(undefined, {
            startIndex: suspension.stepIndex,
            results: suspension.results,
            inputs: { ...suspension.inputs, [suspension.awaiting]: value },
            context: suspension.context,
        });
    }
}
