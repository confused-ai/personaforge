/**
 * Guardrail validator implementation
 */

import { parse } from '../validation/index.js';
import {
    GuardrailEngine,
    GuardrailRule,
    GuardrailResult,
    GuardrailViolation,
    GuardrailContext,
    GuardrailsConfig,
    SchemaValidationRule,
} from './types.js';

/**
 * Default guardrail engine implementation
 */
export class GuardrailValidator implements GuardrailEngine {
    private rules: GuardrailRule[];
    private schemaValidations: SchemaValidationRule[];
    private onViolation?: (violation: GuardrailViolation, context: GuardrailContext) => void | Promise<void>;

    constructor(config: GuardrailsConfig = {}) {
        this.rules = config.rules ?? [];
        this.schemaValidations = config.schemaValidations ?? [];
        this.onViolation = config.onViolation;
    }

    /**
     * Add a rule to the validator
     */
    addRule(rule: GuardrailRule): void {
        this.rules.push(rule);
    }

    /**
     * Add a schema validation
     */
    addSchemaValidation<T>(validation: SchemaValidationRule<T>): void {
        this.schemaValidations.push(validation);
    }

    /**
     * Check if a tool call is allowed
     */
    async checkToolCall(
        toolName: string,
        args: Record<string, unknown>,
        context: GuardrailContext
    ): Promise<GuardrailResult[]> {
        const ctx: GuardrailContext = {
            ...context,
            toolName,
            toolArgs: args,
        };

        const results: GuardrailResult[] = [];
        for (const rule of this.rules) {
            try {
                const result = await rule.check(ctx);
                results.push(result);
                if (!result.passed && this.onViolation) {
                    await this.onViolation(
                        {
                            rule: rule.name,
                            message: result.message ?? 'Guardrail check failed',
                            severity: rule.severity,
                            details: result.details,
                        },
                        ctx
                    );
                }
            } catch (error) {
                results.push({
                    passed: false,
                    rule: rule.name,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return results;
    }

    /**
     * Validate output against schemas
     */
    async validateOutput(output: unknown, context: GuardrailContext): Promise<GuardrailResult[]> {
        const results: GuardrailResult[] = [];

        for (const validation of this.schemaValidations) {
            try {
                parse(validation.schema, output, `guardrail "${validation.name}" failed`);
                results.push({
                    passed: true,
                    rule: validation.name,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                results.push({
                    passed: false,
                    rule: validation.name,
                    message: `Schema validation failed: ${message}`,
                    details: error,
                });

                if (this.onViolation) {
                    await this.onViolation(
                        {
                            rule: validation.name,
                            message,
                            severity: 'error',
                            details: error,
                        },
                        { ...context, output }
                    );
                }
            }
        }

        return results;
    }

    /**
     * Run all guardrail checks
     */
    async checkAll(context: GuardrailContext): Promise<GuardrailResult[]> {
        const results: GuardrailResult[] = [];

        // Check tool call if present
        if (context.toolName) {
            const toolResults = await this.checkToolCall(
                context.toolName,
                context.toolArgs ?? {},
                context
            );
            results.push(...toolResults);
        }

        // Validate output if present
        if (context.output !== undefined) {
            const outputResults = await this.validateOutput(context.output, context);
            results.push(...outputResults);
        }

        // Run general rules
        for (const rule of this.rules) {
            try {
                const result = await rule.check(context);
                results.push(result);
                if (!result.passed && this.onViolation) {
                    await this.onViolation(
                        {
                            rule: rule.name,
                            message: result.message ?? 'Guardrail check failed',
                            severity: rule.severity,
                            details: result.details,
                        },
                        context
                    );
                }
            } catch (error) {
                results.push({
                    passed: false,
                    rule: rule.name,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return results;
    }

    /**
     * Get all violations from results
     */
    getViolations(results: GuardrailResult[]): GuardrailViolation[] {
        return results
            .filter(r => !r.passed)
            .map(r => ({
                rule: r.rule,
                message: r.message ?? 'Guardrail check failed',
                severity: 'error',
                details: r.details,
            }));
    }
}

/**
 * Create a regex-based content guardrail rule
 */
export function createContentRule(
    name: string,
    description: string,
    pattern: RegExp,
    severity: 'error' | 'warning' = 'error'
): GuardrailRule {
    return {
        name,
        description,
        severity,
        check(context: GuardrailContext): GuardrailResult {
            const raw = context.output;
            const content =
                typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : JSON.stringify(raw);

            const matches = pattern.test(content);
            return {
                passed: !matches,
                rule: name,
                message: matches ? `Content matched forbidden pattern: ${pattern}` : undefined,
            };
        },
    };
}

/**
 * Create a tool allowlist rule
 */
export function createToolAllowlistRule(allowedTools: string[]): GuardrailRule {
    return {
        name: 'tool_allowlist',
        description: `Only allow tools: ${allowedTools.join(', ')}`,
        severity: 'error',
        check(context: GuardrailContext): GuardrailResult {
            if (!context.toolName) {
                return { passed: true, rule: 'tool_allowlist' };
            }

            const allowed = allowedTools.includes(context.toolName);
            return {
                passed: allowed,
                rule: 'tool_allowlist',
                message: allowed ? undefined : `Tool '${context.toolName}' is not in the allowlist`,
            };
        },
    };
}

/**
 * Create a maximum length rule
 */
export function createMaxLengthRule(
    name: string,
    maxLength: number,
    severity: 'error' | 'warning' = 'error'
): GuardrailRule {
    return {
        name,
        description: `Maximum length: ${maxLength}`,
        severity,
        check(context: GuardrailContext): GuardrailResult {
            const raw = context.output;
            const content =
                typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : JSON.stringify(raw);

            const withinLimit = content.length <= maxLength;
            return {
                passed: withinLimit,
                rule: name,
                message: withinLimit ? undefined : `Output exceeds maximum length of ${maxLength}`,
            };
        },
    };
}
