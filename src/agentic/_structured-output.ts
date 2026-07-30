/**
 * Structured Output Support (vendored from src/providers/structured-output.ts)
 */
import type { SchemaInput } from '../validation/index.js';
import { safeValidate, schemaToJsonSchema } from '../validation/index.js';
import type { StreamDelta } from '../core/index.js';

export interface StructuredOutputConfig<T = unknown> {
    schema: SchemaInput<unknown, T>;
    description?: string;
    strict?: boolean;
    maxRetries?: number;
}

export interface StructuredOutputResult<T = unknown> {
    data: T;
    rawText: string;
    validated: boolean;
    errors: string[];
}

export function extractJson(text: string): unknown {
    let jsonStr = text.trim();

    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
    }

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

export async function collectStreamText(stream: AsyncIterable<StreamDelta>): Promise<string> {
    let text = '';
    for await (const delta of stream) {
        if (delta.type === 'text') {
            text += delta.text;
        }
    }
    return text;
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

export function buildStructuredOutputPrompt(config: StructuredOutputConfig): string {
    const schema = schemaToJsonSchema(config.schema);
    const description = config.description || 'Provide your response in the following JSON format';

    return `${description}:

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Respond ONLY with valid JSON matching this schema. Do not include any text before or after the JSON.`;
}
