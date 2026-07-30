/**
 * Zod schema to JSON Schema converter
 * Re-exports the shared converter from validation; keeps toolToLLMDef here.
 */

import type { ZodType } from 'zod';
import type { LLMToolDefinition } from '../../core/index.js';
import type { Tool } from './types.js';
import { zodToJsonSchema } from '../../validation/zod-json-schema.js';

export { zodToJsonSchema };

/**
 * Convert a framework Tool to LLM tool definition.
 * Prefer `schemaToJsonSchema` from validation for Standard Schema libraries.
 */
export function toolToLLMDef(tool: Tool): LLMToolDefinition {
    const params = tool.parameters as ZodType & { toJSONSchema?: () => Record<string, unknown> };
    let jsonSchema: Record<string, unknown>;
    if (typeof params.toJSONSchema === 'function') {
        jsonSchema = { ...params.toJSONSchema() };
        delete jsonSchema['$schema'];
    } else {
        jsonSchema = zodToJsonSchema(params);
    }

    return {
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
    };
}
