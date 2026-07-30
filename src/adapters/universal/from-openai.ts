/**
 * Adapt OpenAI-style function tools (JSON Schema parameters) into personaforge tools.
 * Lets you drop in tools from OpenAI Assistants, Chat Completions, or any
 * OpenAI-compatible stack without rewriting schemas in Zod.
 */

import { z } from 'zod';
import { tool } from '../../tools/core/tool-helper.js';
import type { LightweightTool, ToolObjectSchemaLike } from '../../tools/core/tool-helper.js';
import { ToolCategory } from '../../tools/core/types.js';

export interface OpenAIFunctionTool {
    readonly type?: 'function';
    readonly function: {
        readonly name: string;
        readonly description?: string;
        readonly parameters?: Record<string, unknown>;
        readonly strict?: boolean;
    };
}

export interface OpenAIToolAdapterOptions {
    readonly execute: (
        name: string,
        args: Record<string, unknown>,
    ) => Promise<unknown> | unknown;
    readonly timeoutMs?: number;
    readonly tags?: string[];
}

/**
 * Convert a JSON Schema object into a permissive Zod object.
 * Full JSON Schema → Zod conversion is lossy; we validate required keys exist
 * and accept additional properties so foreign tools keep working.
 */
export function jsonSchemaToZodObject(
    schema: Record<string, unknown> | undefined,
): ToolObjectSchemaLike<Record<string, unknown>> {
    if (!schema || typeof schema !== 'object') {
        return z.object({}).passthrough() as ToolObjectSchemaLike<Record<string, unknown>>;
    }

    const properties = (schema['properties'] ?? {}) as Record<string, unknown>;
    const required = new Set<string>(
        Array.isArray(schema['required']) ? (schema['required'] as string[]) : [],
    );

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, def] of Object.entries(properties)) {
        const prop = (def ?? {}) as Record<string, unknown>;
        let field: z.ZodTypeAny;
        switch (prop['type']) {
            case 'string':
                field = z.string();
                break;
            case 'number':
            case 'integer':
                field = z.number();
                break;
            case 'boolean':
                field = z.boolean();
                break;
            case 'array':
                field = z.array(z.unknown());
                break;
            case 'object':
                field = z.record(z.string(), z.unknown());
                break;
            default:
                field = z.unknown();
        }
        if (typeof prop['description'] === 'string') {
            field = field.describe(prop['description']);
        }
        shape[key] = required.has(key) ? field : field.optional();
    }

    return z.object(shape).passthrough() as ToolObjectSchemaLike<Record<string, unknown>>;
}

export function fromOpenAITool(
    def: OpenAIFunctionTool,
    options: OpenAIToolAdapterOptions,
): LightweightTool {
    const name = def.function.name;
    const description = def.function.description ?? `OpenAI function ${name}`;
    const parameters = jsonSchemaToZodObject(def.function.parameters);

    return tool({
        name,
        description,
        parameters,
        category: ToolCategory.CUSTOM,
        tags: ['openai-adapted', ...(options.tags ?? [])],
        timeoutMs: options.timeoutMs ?? 60_000,
        strict: def.function.strict ?? false,
        execute: async (params) => options.execute(name, params as Record<string, unknown>),
    });
}

export function fromOpenAITools(
    defs: readonly OpenAIFunctionTool[],
    options: OpenAIToolAdapterOptions,
): LightweightTool[] {
    return defs.map((d) => fromOpenAITool(d, options));
}
