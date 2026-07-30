/**
 * @personaforge/structured — unified native structured-output layer.
 *
 * Adds `structuredOutput` to GenerateOptions so agents can request
 * JSON-schema-validated output from the provider's native structured
 * output API (OpenAI response_format, Anthropic tool-forced, Gemini
 * responseSchema), falling back to prompt-injection + retry parse
 * when the provider lacks native support.
 *
 * ```ts
 * const result = await generateStructured(llm, messages, schema, { maxRetries: 3 });
 * // result.data is validated T
 * ```
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../contracts/interfaces.js';
import type { SchemaInput } from '../validation/index.js';
import { isStandardSchema, isSafeParseSchema, parse as parseSchema, schemaToJsonSchema } from '../validation/index.js';

// ── JSON Schema types ─────────────────────────────────────────────────────────

/** Minimal JSON Schema representation (subset sufficient for LLM APIs). */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  description?: string;
  [key: string]: unknown;
}

/** A schema for structured output — JSON Schema, Standard Schema, or Zod-like object. */
export interface StructuredSchema<T = unknown> {
  /** JSON Schema representation (if provided, used directly). */
  jsonSchema?: JsonSchema;
  /** Zod-like .parse() for validation. */
  parse?: (data: unknown) => T;
  /** Name hint for the schema (used in OpenAI response_format.name). */
  name?: string;
  /** Description hint. */
  description?: string;
}

/** Accept StructuredSchema wrapper OR any Standard Schema / safeParse schema. */
export type AnyStructuredSchema<T = unknown> = StructuredSchema<T> | SchemaInput<unknown, T>;

function asStructuredSchema<T>(schema: AnyStructuredSchema<T>): StructuredSchema<T> {
  if (schema && typeof schema === 'object' && ('jsonSchema' in schema || 'parse' in schema || 'name' in schema)) {
    const s = schema as StructuredSchema<T>;
    if (s.jsonSchema !== undefined || typeof s.parse === 'function') return s;
  }
  if (isStandardSchema(schema) || isSafeParseSchema(schema)) {
    let jsonSchema: JsonSchema;
    try {
      jsonSchema = schemaToJsonSchema(schema) as JsonSchema;
    } catch {
      // Valibot/ArkType without a JSON Schema adapter — validation still works via ~standard.
      jsonSchema = { type: 'object', additionalProperties: true };
    }
    return {
      jsonSchema,
      parse: (data: unknown) => parseSchema(schema, data) as T,
    };
  }
  return schema as StructuredSchema<T>;
}

export interface StructuredOutputOptions {
  maxRetries?: number;
}

export interface StructuredOutputResult<T> {
  data: T;
  raw: string;
  attempts: number;
  usage?: GenerateResult['usage'];
}

// ── Provider capability detection ─────────────────────────────────────────────

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'bedrock' | 'unknown';

export function detectProviderKind(provider: LLMProvider): ProviderKind {
  const ctor = provider.constructor.name.toLowerCase();
  if (ctor.includes('openai') || ctor.includes('openrouter')) return 'openai';
  if (ctor.includes('anthropic')) return 'anthropic';
  if (ctor.includes('google') || ctor.includes('gemini')) return 'gemini';
  if (ctor.includes('bedrock')) return 'bedrock';
  return 'unknown';
}

// ── generateStructured ────────────────────────────────────────────────────────

/**
 * Universal structured-output helper. Tries native API first; falls back to
 * prompt injection + parse retry.
 */
export async function generateStructured<T>(
  provider: LLMProvider,
  messages: Message[],
  schema: AnyStructuredSchema<T>,
  opts?: StructuredOutputOptions & GenerateOptions,
): Promise<StructuredOutputResult<T>> {
  const resolved = asStructuredSchema(schema);
  const maxRetries = opts?.maxRetries ?? 3;
  const jsonSchema = resolved.jsonSchema ?? inferJsonSchema(resolved);
  const kind = detectProviderKind(provider);

  // Attempt native structured output first (OpenAI / Gemini).
  if (kind === 'openai' || kind === 'gemini') {
    return nativeStructured(provider, messages, resolved, jsonSchema, opts, maxRetries);
  }

  // Anthropic: force a tool call that returns the schema.
  if (kind === 'anthropic') {
    return anthropicToolForce(provider, messages, resolved, jsonSchema, opts, maxRetries);
  }

  // Fallback: prompt injection + parse.
  return promptFallback(provider, messages, resolved, jsonSchema, opts, maxRetries);
}

// ── Native path (OpenAI response_format / Gemini responseSchema) ──────────────

async function nativeStructured<T>(
  provider: LLMProvider,
  messages: Message[],
  schema: StructuredSchema<T>,
  jsonSchema: JsonSchema,
  opts: GenerateOptions | undefined,
  maxRetries: number,
): Promise<StructuredOutputResult<T>> {
  // Extend options with response_format. The OpenAI/Gemini providers pass
  // unknown keys through to the underlying SDK, so this works even though
  // our GenerateOptions type doesn't have response_format officially.
  const extendedOpts: GenerateOptions & Record<string, unknown> = {
    ...opts,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schema.name ?? 'output',
        strict: true,
        schema: jsonSchema,
      },
    },
  };
  return attemptParse(provider, messages, schema, extendedOpts, maxRetries);
}

// ── Anthropic: tool-forced output ─────────────────────────────────────────────

async function anthropicToolForce<T>(
  provider: LLMProvider,
  messages: Message[],
  schema: StructuredSchema<T>,
  jsonSchema: JsonSchema,
  opts: GenerateOptions | undefined,
  maxRetries: number,
): Promise<StructuredOutputResult<T>> {
  const toolName = schema.name ?? 'structured_output';
  const forcedOpts: GenerateOptions = {
    ...opts,
    tools: [{
      name: toolName,
      description: schema.description ?? 'Return structured output matching the schema.',
      parameters: jsonSchema,
    }],
    toolChoice: { type: 'tool', name: toolName },
  };
  let attempts = 0;
  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    attempts++;
    try {
      const result = await provider.generateText(messages, forcedOpts);
      const tc = result.toolCalls?.[0];
      const raw = tc?.arguments ?? result.text;
      const parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) as unknown;
      const data = schema.parse ? schema.parse(parsed) : parsed as T;
      return { data, raw: typeof raw === 'string' ? raw : JSON.stringify(raw), attempts, usage: result.usage };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// ── Prompt fallback ───────────────────────────────────────────────────────────

async function promptFallback<T>(
  provider: LLMProvider,
  messages: Message[],
  schema: StructuredSchema<T>,
  jsonSchema: JsonSchema,
  opts: GenerateOptions | undefined,
  maxRetries: number,
): Promise<StructuredOutputResult<T>> {
  const schemaStr = JSON.stringify(jsonSchema, null, 2);
  const augmented: Message[] = [
    ...messages,
    { role: 'system' as const, content: `Respond with valid JSON matching this schema:\n${schemaStr}` },
  ];
  return attemptParse(provider, augmented, schema, opts, maxRetries);
}

// ── Shared parse-with-retry ───────────────────────────────────────────────────

async function attemptParse<T>(
  provider: LLMProvider,
  messages: Message[],
  schema: StructuredSchema<T>,
  opts: GenerateOptions | undefined,
  maxRetries: number,
): Promise<StructuredOutputResult<T>> {
  let attempts = 0;
  let lastErr: unknown;
  const msgs = [...messages];
  for (let i = 0; i <= maxRetries; i++) {
    attempts++;
    try {
      const result = await provider.generateText(msgs, opts);
      const raw = result.text;
      const jsonMatch = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(raw);
      const parsed = JSON.parse(jsonMatch?.[1] ?? raw) as unknown;
      const data = schema.parse ? schema.parse(parsed) : parsed as T;
      return { data, raw, attempts, usage: result.usage };
    } catch (err) {
      lastErr = err;
      if (i < maxRetries) {
        msgs.push({ role: 'assistant' as const, content: msgs[msgs.length - 1]?.content ?? '' });
        msgs.push({
          role: 'user' as const,
          content: `That output failed to parse: ${String(err)}. Please fix and respond with valid JSON only.`,
        });
      }
    }
  }
  throw lastErr;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Infer a minimal JSON Schema from a StructuredSchema that only has parse(). */
function inferJsonSchema<T>(schema: StructuredSchema<T>): JsonSchema {
  // Try Zod detection via _def (Zod v3/v4 internal).
  const z = schema as unknown as { _def?: unknown; toJSONSchema?: () => Record<string, unknown> };
  if (typeof z.toJSONSchema === 'function') {
    const out = { ...z.toJSONSchema() } as JsonSchema;
    delete (out as Record<string, unknown>)['$schema'];
    return out;
  }
  // ponytail: last resort — permissive object schema. Upgrade: wire zodToJsonSchema.
  return { type: 'object', additionalProperties: true } as JsonSchema;
}
