/**
 * `workflowAsTool()` — wrap any workflow as a callable tool.
 *
 * This is the primary mechanism for **workflow-as-tool** delegation: an agent
 * can trigger a multi-step workflow through the standard tool-calling interface.
 * The workflow's input/output are translated into the tool's parameter/output
 * schemas.
 *
 * @example
 * ```ts
 * import { workflowAsTool } from 'personaforge/tool';
 * import { createWorkflow } from 'personaforge/sdk';
 * import { agent } from 'personaforge';
 * import { z } from 'zod';
 *
 * const wf = createWorkflow()
 *   .task('research', researchAgent)
 *   .task('write', writerAgent)
 *   .build();
 *
 * const wfTool = workflowAsTool({
 *   name: 'runContentPipeline',
 *   description: 'Research and write a blog post',
 *   workflow: wf,
 *   parameters: z.object({ topic: z.string() }),
 * });
 *
 * const coordinator = agent({
 *   instructions: 'You run content pipelines.',
 *   tools: [wfTool],
 * });
 * ```
 *
 * @remarks
 * - Invokes `workflow.execute(input)` with validated tool params.
 * - Suspended (HITL) workflows return suspension details so callers can resume.
 * - Output is validated against `outputSchema` when provided (completed runs only).
 * - Hooks (`beforeExecute`, `afterExecute`, `onError`) run via the standard tool lifecycle.
 */

import { ToolCategory } from './types.js';
import type { ToolObjectSchemaLike, SimpleToolContext, LightweightTool, ToolSchemaLike } from './tool-helper.js';
import { tool } from './tool-helper.js';
import { z } from 'zod';
import { safeValidate } from '../../validation/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal duck-type for any workflow that has an `execute` method.
 */
export interface RunnableWorkflow {
    execute(input?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Result shape from workflow execution (matches SDK WorkflowExecuteResult).
 */
export interface WorkflowToolResult {
    readonly status: 'completed' | 'suspended';
    readonly results?: Record<string, unknown>;
    readonly token?: string;
    readonly awaiting?: string;
    readonly message?: string;
    readonly context?: Record<string, unknown>;
}

/**
 * Configuration for `workflowAsTool()`.
 */
export interface WorkflowAsToolOptions<TInput = unknown, TOutput = unknown> {
    /** Tool name (used as function ID by the LLM). */
    readonly name: string;
    /** Human-readable description for the LLM. */
    readonly description: string;
    /** The workflow to wrap. Must have an `execute(input?)` method. */
    readonly workflow: RunnableWorkflow;
    /** Zod schema for tool parameters. */
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    /** Zod schema for tool output validation. Applied to the final `results` object. */
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    /** Category for organization. */
    readonly category?: ToolCategory;
    /** Tags for discoverability. */
    readonly tags?: string[];
    /** Maximum execution time in ms. Default: 300_000 (5 min). */
    readonly timeoutMs?: number;
    /** Require human approval before execution. */
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    /** Called before the workflow runs. Return false to cancel. */
    readonly beforeExecute?: (params: TInput, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    /** Called after the workflow completes. */
    readonly afterExecute?: (output: TOutput, params: TInput, ctx: SimpleToolContext) => Promise<void> | void;
    /** Handle errors during workflow execution. Return a fallback value or re-throw. */
    readonly onError?: (error: Error, params: TInput, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
    /** Transform the workflow's output before returning to the caller. */
    readonly transformOutput?: (output: TOutput, params: TInput, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
}

// ── Implementation ──────────────────────────────────────────────────────────

/**
 * Wrap a workflow as a tool so agents can trigger it via function calling.
 */
export function workflowAsTool<TInput = unknown, TOutput = unknown>(
    config: WorkflowAsToolOptions<TInput, TOutput>,
): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
    const {
        name,
        description,
        workflow,
        parameters: explicitParameters,
        outputSchema,
        category = ToolCategory.WORKFLOW,
        tags = ['workflow-tool'],
        timeoutMs = 300_000,
        needsApproval = false,
        beforeExecute,
        afterExecute,
        onError,
        transformOutput,
    } = config;

    const parameters =
        explicitParameters ??
        (z.object({
            input: z.record(z.string(), z.unknown()).describe('Workflow input context'),
        }) as ToolObjectSchemaLike<Record<string, unknown>>);

    const execute = async (params: Record<string, unknown>, ctx: SimpleToolContext): Promise<TOutput> => {
        const validatedParams = params as TInput;

        const rawResult = await workflow.execute(validatedParams as Record<string, unknown>);
        const result = rawResult as WorkflowToolResult;

        // Suspended workflows (HITL) — return suspension details without outputSchema validation
        if (result && typeof result === 'object' && result.status === 'suspended') {
            return {
                status: 'suspended',
                token: result.token,
                awaiting: result.awaiting,
                message: result.message,
                context: result.context,
            } as unknown as TOutput;
        }

        // Completed — extract results (or raw value if not a status envelope)
        let finalOutput = (
            result && typeof result === 'object' && 'results' in result
                ? (result.results ?? {})
                : rawResult
        ) as TOutput;

        if (outputSchema) {
            const outputResult = safeValidate(outputSchema, finalOutput);
            if (!outputResult.success) {
                throw new Error(
                    `Workflow tool "${name}" output validation failed: ${outputResult.error.message}`,
                );
            }
            finalOutput = outputResult.data as TOutput;
        }

        if (transformOutput) {
            finalOutput = await transformOutput(finalOutput, validatedParams, ctx);
        }

        return finalOutput;
    };

    return tool({
        name,
        description,
        parameters,
        execute,
        needsApproval,
        category,
        tags,
        timeoutMs,
        ...(beforeExecute !== undefined
            ? { beforeExecute: beforeExecute as WorkflowAsToolOptions['beforeExecute'] }
            : {}),
        ...(afterExecute !== undefined
            ? { afterExecute: afterExecute as WorkflowAsToolOptions['afterExecute'] }
            : {}),
        ...(onError !== undefined
            ? { onError: onError as WorkflowAsToolOptions['onError'] }
            : {}),
    } as import('./tool-helper.js').ToolHelperConfig<ToolObjectSchemaLike<Record<string, unknown>>, TOutput>);
}
