/**
 * Structured-output agent wrapper
 * =================================
 * `createStructuredAgent<T>` wraps any `AgenticRunner`-compatible run function
 * and guarantees that the response is parsed and validated against a Standard Schema (Zod, Valibot, …).
 *
 * Retry policy:
 *   On parse/validation failure the model receives its own bad output back plus
 *   a correction prompt — up to `maxRetries` attempts (default 3).
 *
 * Usage:
 *   import { z } from 'zod';
 *   import { createStructuredAgent } from './index.js';
 *
 *   const ReviewSchema = z.object({
 *     sentiment: z.enum(['positive', 'neutral', 'negative']),
 *     score:     z.number().min(0).max(10),
 *     summary:   z.string().min(1),
 *   });
 *
 *   const agent = createStructuredAgent(ReviewSchema, {
 *     llm, tools, instructions: 'You are a product review analyser.',
 *   });
 *
 *   const { data, raw, attempts } = await agent.run({ prompt: 'Review: ...' });
 *   console.log(data.sentiment, data.score);
 */

import type { SchemaInput } from '../validation/index.js';
import { AgenticRunner }                from './runner.js';
import type { AgenticRunnerConfig }     from './types.js';
import type { AgenticRunConfig }        from './types.js';
import { validateStructuredOutput }     from './_structured-output.js';
import { schemaToJsonSchema }           from '../validation/index.js';

// ── Result type ───────────────────────────────────────────────────────────────

export interface StructuredAgentResult<T> {
    /** Validated, type-safe structured data */
    data: T;
    /** Raw text returned by the model on the successful attempt */
    raw: string;
    /** Number of LLM round-trips used (1 = first try, 2+ = retried) */
    attempts: number;
    /** Validation errors from failed attempts (empty on first-try success) */
    retryErrors: string[];
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface StructuredAgentConfig extends AgenticRunnerConfig {
    /** Max parse+validation retries before throwing. Default: 3 */
    maxRetries?: number;
    /** Default instructions injected into every run unless overridden per-run. */
    instructions?: string;
    /**
     * Whether to inject the JSON schema into the system prompt automatically.
     * Default: true — highly recommended unless your instructions already mention the schema.
     */
    injectSchemaPrompt?: boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a structured-output agent that always returns a value conforming to `schema`.
 *
 * @param schema - Zod schema describing the expected response shape
 * @param config - Standard AgenticRunnerConfig (llm, tools, instructions, …)
 */
export function createStructuredAgent<T>(
    schema: SchemaInput<unknown, T>,
    config: StructuredAgentConfig,
): {
    run(runConfig: AgenticRunConfig): Promise<StructuredAgentResult<T>>;
    schema: SchemaInput<unknown, T>;
} {
    const maxRetries   = config.maxRetries        ?? 3;
    const injectSchema = config.injectSchemaPrompt ?? true;

    // Build the schema description once
    const jsonSchema   = schemaToJsonSchema(schema);
    const schemaBlock  = `\n\n---\nRespond ONLY with a valid JSON object matching this exact schema (no markdown fences, no prose):\n${JSON.stringify(jsonSchema, null, 2)}\n---`;

    const runner = new AgenticRunner(config);

    return {
        schema,

        async run(runConfig: AgenticRunConfig): Promise<StructuredAgentResult<T>> {
            const retryErrors: string[] = [];
            let attempts = 0;

            // Augment instructions with schema on the first call
            const baseInstructions = injectSchema
                ? (runConfig.instructions ?? config.instructions ?? '') + schemaBlock
                : (runConfig.instructions ?? config.instructions ?? '');

            let currentConfig: AgenticRunConfig = { ...runConfig, instructions: baseInstructions };

            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
                attempts = attempt;
                const result = await runner.run(currentConfig);

                const validation = validateStructuredOutput<T>(result.text, {
                    schema,
                    maxRetries: 1,
                });

                if (validation.validated) {
                    return { data: validation.data, raw: result.text, attempts, retryErrors };
                }

                // Collect errors and build a correction prompt
                const errorSummary = validation.errors.join('; ');
                retryErrors.push(`Attempt ${attempt}: ${errorSummary}`);

                if (attempt > maxRetries) break;

                // Feed the bad output back with a correction instruction
                const correctionPrompt =
                    `Your previous response was invalid.\n` +
                    `Errors: ${errorSummary}\n\n` +
                    `Bad output:\n${result.text}\n\n` +
                    `Please try again and respond ONLY with a valid JSON object matching the schema above.`;

                currentConfig = {
                    ...runConfig,
                    instructions: baseInstructions,
                    prompt: correctionPrompt,
                    messages: result.messages,
                };
            }

            // All retries exhausted
            const allErrors = retryErrors.join('\n');
            throw new StructuredOutputError(
                `Failed to get valid structured output after ${attempts} attempt(s).\n${allErrors}`,
                retryErrors,
            );
        },
    };
}

// ── Error class ───────────────────────────────────────────────────────────────

export class StructuredOutputError extends Error {
    readonly retryErrors: string[];

    constructor(message: string, retryErrors: string[]) {
        super(message);
        this.name = 'StructuredOutputError';
        this.retryErrors = retryErrors;
    }
}

// Re-export helpers that callers commonly need alongside this module
export { validateStructuredOutput } from './_structured-output.js';
export type { StructuredOutputConfig, StructuredOutputResult } from './_structured-output.js';
