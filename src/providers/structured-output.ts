/**
 * Structured Output Support
 *
 * Enables LLM responses to be validated and typed against Standard Schema
 * (Zod, Valibot, ArkType, …). Converts schemas to JSON Schema for LLM prompts,
 * then parses and validates the response.
 */

import type { SchemaInput } from '../validation/index.js';
import { safeValidate, schemaToJsonSchema } from '../validation/index.js';
import type { StreamDelta } from './types.js';

/**
 * Configuration for extracting structured output from LLM response
 */
export interface StructuredOutputConfig<T = unknown> {
    /**
     * Schema to validate and parse the response (Standard Schema)
     */
    schema: SchemaInput<unknown, T>;

    /**
     * Description of what to extract (used in system prompt)
     */
    description?: string;

    /**
     * Whether to return full response or extract and validate only
     */
    strict?: boolean;

    /**
     * Maximum retries for validation errors
     */
    maxRetries?: number;
}

/**
 * Result of structured output extraction
 */
export interface StructuredOutputResult<T = unknown> {
    /**
     * Parsed and validated data
     */
    data: T;

    /**
     * Original text from LLM
     */
    rawText: string;

    /**
     * Whether this was validated against the schema
     */
    validated: boolean;

    /**
     * Validation errors if any (empty if validated = true)
     */
    errors: string[];
}

/**
 * Extract JSON from LLM response text
 * Handles both standalone JSON and JSON within markdown code blocks
 */
export function extractJson(text: string): unknown {
    let jsonStr = text.trim();

    // Try markdown code block first
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
    }

    // Try to find JSON object or array
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
        jsonStr = jsonMatch[0];
    }

    try {
        return JSON.parse(jsonStr);
    } catch (error) {
        throw new Error(`Failed to parse JSON from response: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Concatenate text deltas from a provider stream (ignores tool-call chunks).
 */
export async function collectStreamText(stream: AsyncIterable<StreamDelta>): Promise<string> {
    let text = '';
    for await (const delta of stream) {
        if (delta.type === 'text') {
            text += delta.text;
        }
    }
    return text;
}

/**
 * After streaming completes, parse and validate JSON against a schema.
 */
export async function collectStreamThenValidate<T>(
    stream: AsyncIterable<StreamDelta>,
    config: StructuredOutputConfig<T>,
): Promise<StructuredOutputResult<T>> {
    const rawText = await collectStreamText(stream);
    return validateStructuredOutput(rawText, config);
}

export function validateStructuredOutput<T>(
    text: string,
    config: StructuredOutputConfig<T>,
): StructuredOutputResult<T> {
    const errors: string[] = [];

    try {
        const json = extractJson(text);
        const result = safeValidate(config.schema, json);

        if (result.success) {
            return {
                data: result.data as T,
                rawText: text,
                validated: true,
                errors: [],
            };
        } else {
            errors.push(
                ...result.issues.map((issue) => {
                    const path = issue.path
                        ?.map((segment) =>
                            typeof segment === 'object' && segment !== null && 'key' in segment
                                ? String(segment.key)
                                : String(segment),
                        )
                        .join('.');
                    return path ? `${path}: ${issue.message}` : issue.message;
                }),
            );

            return {
                data: json as T,
                rawText: text,
                validated: false,
                errors,
            };
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to extract and parse JSON: ${message}`);

        return {
            data: {} as T,
            rawText: text,
            validated: false,
            errors,
        };
    }
}

/**
 * Build a system prompt instruction for structured output
 */
export function buildStructuredOutputPrompt(config: StructuredOutputConfig): string {
    const schema = schemaToJsonSchema(config.schema);
    const description = config.description || 'Provide your response in the following JSON format';

    return `${description}:

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Respond ONLY with valid JSON matching this schema. Do not include any text before or after the JSON.`;
}

/**
 * Example schemas for common use cases
 */
export const CommonSchemas = {
    /**
     * Simple text extraction (e.g., sentiment, classification)
     */
    SimpleClassification: (labels: string[]) => ({
        description: 'Classification result',
        schema: {
            type: 'object',
            properties: {
                category: { type: 'string', enum: labels },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                explanation: { type: 'string' },
            },
            required: ['category', 'confidence'],
        },
    }),

    /**
     * Entity extraction (e.g., names, dates, locations)
     */
    EntityExtraction: (entityTypes: string[]) => ({
        description: 'Extracted entities from text',
        schema: {
            type: 'object',
            properties: {
                entities: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: entityTypes },
                            value: { type: 'string' },
                            confidence: { type: 'number', minimum: 0, maximum: 1 },
                        },
                        required: ['type', 'value'],
                    },
                },
            },
            required: ['entities'],
        },
    }),

    /**
     * Structured summary (e.g., key points, insights)
     */
    StructuredSummary: () => ({
        description: 'Structured summary of content',
        schema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                keyPoints: {
                    type: 'array',
                    items: { type: 'string' },
                },
                summary: { type: 'string' },
                sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
            },
            required: ['title', 'summary'],
        },
    }),

    /**
     * Reasoning chain (e.g., chain of thought)
     */
    ReasoningChain: () => ({
        description: 'Step-by-step reasoning',
        schema: {
            type: 'object',
            properties: {
                question: { type: 'string' },
                steps: {
                    type: 'array',
                    items: { type: 'string' },
                },
                conclusion: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['steps', 'conclusion'],
        },
    }),
};
