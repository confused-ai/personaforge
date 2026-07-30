/**
 * Guardrails types and interfaces
 * 
 * Provides output validation, allowlists, and safety controls for agent outputs.
 */

import type { SchemaInput } from '../validation/index.js';

/**
 * Guardrail check result
 */
export interface GuardrailResult {
    readonly passed: boolean;
    readonly rule: string;
    readonly message?: string;
    readonly details?: unknown;
}

/**
 * Guardrail violation
 */
export interface GuardrailViolation {
    readonly rule: string;
    readonly message: string;
    readonly severity: 'error' | 'warning';
    readonly details?: unknown;
}

/**
 * Guardrail check context
 */
export interface GuardrailContext {
    readonly agentId: string;
    readonly sessionId?: string;
    readonly toolName?: string;
    readonly toolArgs?: Record<string, unknown>;
    readonly output?: unknown;
    readonly metadata?: Record<string, unknown>;
}

/**
 * Guardrail rule interface
 */
export interface GuardrailRule {
    readonly name: string;
    readonly description: string;
    readonly severity: 'error' | 'warning';
    check(context: GuardrailContext): GuardrailResult | Promise<GuardrailResult>;
}

/**
 * Output validation rule using Standard Schema
 */
export interface SchemaValidationRule<T = unknown> {
    readonly name: string;
    readonly schema: SchemaInput<unknown, T>;
    readonly description?: string;
}

/**
 * Allowlist configuration
 */
export interface AllowlistConfig {
    readonly allowedTools?: string[];
    readonly allowedHosts?: string[];
    readonly allowedPaths?: string[];
    readonly allowedOutputs?: string[];
    readonly blockedPatterns?: RegExp[];
}

/**
 * Guardrail configuration
 */
export interface GuardrailsConfig {
    readonly enabled?: boolean;
    readonly rules?: GuardrailRule[];
    readonly schemaValidations?: SchemaValidationRule[];
    readonly allowlist?: AllowlistConfig;
    readonly onViolation?: (violation: GuardrailViolation, context: GuardrailContext) => void | Promise<void>;
}

/**
 * Guardrail engine interface
 */
export interface GuardrailEngine {
    /**
     * Check if a tool call is allowed
     */
    checkToolCall(toolName: string, args: Record<string, unknown>, context: GuardrailContext): Promise<GuardrailResult[]>;

    /**
     * Validate output against schemas
     */
    validateOutput(output: unknown, context: GuardrailContext): Promise<GuardrailResult[]>;

    /**
     * Run all guardrail checks
     */
    checkAll(context: GuardrailContext): Promise<GuardrailResult[]>;

    /**
     * Get all violations from results
     */
    getViolations(results: GuardrailResult[]): GuardrailViolation[];
}

/**
 * Human-in-the-loop hook types
 */
export interface HumanInTheLoopHooks {
    /**
     * Called before executing a tool - can pause for approval
     * Return true to allow, false to block, or throw to abort
     */
    beforeToolCall?: (
        toolName: string,
        args: Record<string, unknown>,
        context: GuardrailContext
    ) => Promise<boolean> | boolean;

    /**
     * Called before finishing the run - can pause for review
     * Return true to allow finish, false to continue, or throw to abort
     */
    beforeFinish?: (
        output: unknown,
        context: GuardrailContext
    ) => Promise<boolean> | boolean;

    /**
     * Called on guardrail violation
     */
    onViolation?: (violation: GuardrailViolation, context: GuardrailContext) => void | Promise<void>;
}

/**
 * Approval request for human-in-the-loop
 */
export interface ApprovalRequest {
    readonly id: string;
    readonly type: 'tool_call' | 'finish';
    readonly context: GuardrailContext;
    readonly data: {
        toolName?: string;
        args?: Record<string, unknown>;
        output?: unknown;
    };
    readonly requestedAt: Date;
    readonly timeoutMs?: number;
}

/**
 * Approval response
 */
export interface ApprovalResponse {
    readonly approved: boolean;
    readonly reason?: string;
    readonly modifiedArgs?: Record<string, unknown>;
}
