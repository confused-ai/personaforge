/**
 * `pipelineAsTool()` — wrap a compose()/pipe() agent pipeline as a tool.
 *
 * Distinct from `workflowAsTool()` (SDK workflows with `.execute()`) and
 * `agentAsTool()` (single agents with `.run()`). Pipelines expose `.run(prompt)`
 * and return `AgenticRunResult`-shaped outputs.
 */

import { z } from 'zod';
import { ToolCategory } from './types.js';
import type { ToolObjectSchemaLike, SimpleToolContext, LightweightTool, ToolSchemaLike } from './tool-helper.js';
import { tool } from './tool-helper.js';

export interface RunnablePipeline {
    run(
        prompt: string,
        options?: { sessionId?: string; onChunk?: (text: string) => void },
    ): Promise<unknown>;
}

export interface PipelineAsToolOptions<TInput = unknown, TOutput = unknown> {
    readonly name: string;
    readonly description: string;
    readonly pipeline: RunnablePipeline;
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    readonly outputSchema?: ToolSchemaLike<TOutput>;
    readonly category?: ToolCategory;
    readonly tags?: string[];
    readonly timeoutMs?: number;
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    readonly beforeExecute?: (params: TInput, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    readonly afterExecute?: (output: TOutput, params: TInput, ctx: SimpleToolContext) => Promise<void> | void;
    readonly onError?: (error: Error, params: TInput, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
    readonly mapInput?: (params: TInput) => string | Promise<string>;
    readonly transformOutput?: (output: TOutput, params: TInput, ctx: SimpleToolContext) => TOutput | Promise<TOutput>;
}

const DEFAULT_PARAMETERS = z.object({
    prompt: z.string().describe('The prompt to send to the pipeline'),
}) as ToolObjectSchemaLike<{ prompt: string }>;

export function pipelineAsTool<TInput = unknown, TOutput = unknown>(
    config: PipelineAsToolOptions<TInput, TOutput>,
): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
    const {
        name,
        description,
        pipeline,
        parameters = DEFAULT_PARAMETERS,
        outputSchema,
        category = ToolCategory.WORKFLOW,
        tags = ['pipeline-tool'],
        timeoutMs = 180_000,
        needsApproval = false,
        beforeExecute,
        afterExecute,
        onError,
        mapInput,
        transformOutput,
    } = config;

    const execute = async (params: Record<string, unknown>, ctx: SimpleToolContext): Promise<TOutput> => {
        const prompt = mapInput
            ? await mapInput(params as TInput)
            : typeof (params as { prompt?: unknown }).prompt === 'string'
              ? (params as { prompt: string }).prompt
              : JSON.stringify(params);

        let output = (await pipeline.run(prompt, {
            sessionId: ctx.sessionId !== 'unknown' ? ctx.sessionId : undefined,
        })) as TOutput;

        if (transformOutput) {
            output = await transformOutput(output, params as TInput, ctx);
        }

        return output;
    };

    return tool({
        name,
        description,
        parameters,
        ...(outputSchema !== undefined ? { outputSchema } : {}),
        execute,
        needsApproval,
        category,
        tags,
        timeoutMs,
        ...(beforeExecute !== undefined
            ? { beforeExecute: beforeExecute as PipelineAsToolOptions['beforeExecute'] }
            : {}),
        ...(afterExecute !== undefined
            ? { afterExecute: afterExecute as PipelineAsToolOptions['afterExecute'] }
            : {}),
        ...(onError !== undefined
            ? { onError: onError as PipelineAsToolOptions['onError'] }
            : {}),
    } as import('./tool-helper.js').ToolHelperConfig<ToolObjectSchemaLike<Record<string, unknown>>, TOutput>);
}
