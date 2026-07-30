/**
 * Adapt arbitrary foreign tools (LangChain-like, Vercel AI SDK, custom) into
 * personaforge LightweightTools.
 */

import { z } from 'zod';
import { tool } from '../../tools/core/tool-helper.js';
import type { LightweightTool, ToolObjectSchemaLike, ToolSchemaLike } from '../../tools/core/tool-helper.js';
import { ToolCategory } from '../../tools/core/types.js';
import { jsonSchemaToZodObject } from './from-openai.js';

export interface ForeignTool {
    readonly name: string;
    readonly description?: string;
    /** Zod schema OR JSON Schema object OR omit for passthrough. */
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>> | Record<string, unknown>;
    readonly outputSchema?: ToolSchemaLike<unknown>;
    /** Common foreign execute signatures. */
    readonly execute?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
    readonly invoke?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
    readonly call?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
    readonly func?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

function resolveParameters(
    parameters: ForeignTool['parameters'],
): ToolObjectSchemaLike<Record<string, unknown>> {
    if (!parameters) {
        return z.object({}).passthrough() as ToolObjectSchemaLike<Record<string, unknown>>;
    }
    if (typeof (parameters as { safeParse?: unknown }).safeParse === 'function') {
        return parameters as ToolObjectSchemaLike<Record<string, unknown>>;
    }
    return jsonSchemaToZodObject(parameters as Record<string, unknown>);
}

function resolveExecute(foreign: ForeignTool): (args: Record<string, unknown>) => Promise<unknown> | unknown {
    const fn = foreign.execute ?? foreign.invoke ?? foreign.call ?? foreign.func;
    if (!fn) {
        throw new Error(`Foreign tool "${foreign.name}" has no execute/invoke/call/func method`);
    }
    return fn;
}

export function fromForeignTool(foreign: ForeignTool): LightweightTool {
    const execute = resolveExecute(foreign);
    return tool({
        name: foreign.name,
        description: foreign.description ?? `Foreign tool ${foreign.name}`,
        parameters: resolveParameters(foreign.parameters),
        ...(foreign.outputSchema !== undefined ? { outputSchema: foreign.outputSchema } : {}),
        category: ToolCategory.CUSTOM,
        tags: ['foreign-adapted'],
        execute: async (params) => execute(params as Record<string, unknown>),
    });
}

export function fromForeignTools(tools: readonly ForeignTool[]): LightweightTool[] {
    return tools.map(fromForeignTool);
}
