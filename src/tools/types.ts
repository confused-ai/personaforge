/**
 * @personaforge/tools — core types and defineTool factory.
 *
 * SOLID:
 *   SRP  — this file owns only the Tool contract and its factory.
 *   OCP  — tools are extended by creating new files, not by modifying this.
 *   DIP  — callers depend on the Tool interface, not any concrete class.
 *
 * The Tool interface is the single authority used by:
 *   - @personaforge/core  (MapToolRegistry, AgentRunner)
 *   - @personaforge/tools (httpClient, fileSystem, shell, browserTool)
 */

import { z }          from 'zod';

// ── Tool interface (matches @personaforge/core Tool — co-defined to avoid circular dep) ──

export interface Tool {
  /** Unique name — used as the key in the tool registry (O(1) lookup). */
  readonly name: string;
  /** Human-readable description passed to the LLM in the system prompt. */
  readonly description: string;
  /** JSON Schema object — used for LLM function-calling. */
  readonly parameters: Record<string, unknown>;
  /** Execute the tool. Input is already validated before this is called. */
  execute(input: Record<string, unknown>): Promise<unknown>;
}

/** Type-safe input inferred from a Zod schema. */
export type ToolInput<S extends z.ZodType> = z.infer<S>;

// ── defineTool factory ─────────────────────────────────────────────────────────

interface ToolDefinition<S extends z.ZodType> {
  name:        string;
  description: string;
  parameters:  S;
  execute(input: ToolInput<S>): Promise<unknown>;
}

/**
 * defineTool — create a validated, type-safe Tool.
 *
 * Wraps the execute function with Zod schema validation so:
 *  - Invalid LLM-generated inputs are caught and reported cleanly.
 *  - The execute function receives typed, validated data.
 *
 * @example
 * ```ts
 * export const myTool = defineTool({
 *   name:        'my_tool',
 *   description: 'Does something useful.',
 *   parameters:  z.object({ query: z.string() }),
 *   execute: async ({ query }) => { return fetch(query).then(r => r.json()); },
 * });
 * ```
 */
/**
 * Create a minimal runtime `Tool` from a plain definition object.
 *
 * @deprecated Prefer `tool()` from `@personaforge/tools` which adds Zod
 * validation, category tags, timeout, and approval gating in a single call.
 * `defineTool()` will be removed in v2.0.
 *
 * ```ts
 * import { tool } from './index.js';
 * const myTool = tool({ name: '...', description: '...', parameters: z.object({...}), execute: async (p) => p });
 * ```
 */
export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): Tool {
  const jsonSchema = zodToJsonSchema(def.parameters);

  return {
    name:        def.name,
    description: def.description,
    parameters:  jsonSchema,

    async execute(rawInput: Record<string, unknown>): Promise<unknown> {
      const parsed = def.parameters.safeParse(rawInput);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        throw new TypeError(
          `[tool:${def.name}] Invalid input:\n${issues}`,
        );
      }
      return def.execute(parsed.data as ToolInput<S>);
    },
  };
}

// ── Minimal Zod → JSON Schema converter ───────────────────────────────────────
// O(n) where n = number of schema keys. No external deps.

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape   = schema.shape as Record<string, z.ZodType>;
    const required: string[] = [];
    const properties: Record<string, unknown> = {};

    for (const [key, field] of Object.entries(shape)) {
      properties[key] = zodFieldToJsonSchema(field);
      if (!(field instanceof z.ZodOptional) && !(field instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return { type: 'object', properties, ...(required.length > 0 && { required }) };
  }
  return zodFieldToJsonSchema(schema);
}

function zodFieldToJsonSchema(field: z.ZodType): Record<string, unknown> {
  if (field instanceof z.ZodOptional) return zodFieldToJsonSchema(field.unwrap() as z.ZodType);
  if (field instanceof z.ZodDefault)  return zodFieldToJsonSchema(field._def.innerType as z.ZodType);
  if (field instanceof z.ZodString)   return { type: 'string' };
  if (field instanceof z.ZodNumber)   return { type: 'number' };
  if (field instanceof z.ZodBoolean)  return { type: 'boolean' };
  if (field instanceof z.ZodEnum)     return { type: 'string', enum: field.options as unknown[] };
  if (field instanceof z.ZodArray)    return { type: 'array',  items: zodFieldToJsonSchema(field.element as z.ZodType) };
  if (field instanceof z.ZodObject)   return zodToJsonSchema(field);
  if (field instanceof z.ZodRecord)   return { type: 'object', additionalProperties: zodFieldToJsonSchema(field._def.valueType as z.ZodType) };
  return {};
}
