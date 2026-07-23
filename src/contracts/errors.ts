/**
 * Canonical error types for personaforge.
 *
 * All framework-thrown errors should be subclasses of `PersonaForgeError` so callers
 * can pattern-match on `error.code`, decide retryability, and forward structured
 * context to observability backends.
 *
 * @module
 */

export const ERROR_CODES = {
  // Budget
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  // Circuit breaker
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  // LLM
  LLM_RATE_LIMITED: 'LLM_RATE_LIMITED',
  LLM_CONTEXT_OVERFLOW: 'LLM_CONTEXT_OVERFLOW',
  LLM_PROVIDER_ERROR: 'LLM_PROVIDER_ERROR',
  // Tools
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  TOOL_VALIDATION_FAILED: 'TOOL_VALIDATION_FAILED',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  // Session
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  // Graph
  GRAPH_CYCLE_DETECTED: 'GRAPH_CYCLE_DETECTED',
  NODE_EXECUTION_FAILED: 'NODE_EXECUTION_FAILED',
  EXECUTION_TIMEOUT: 'EXECUTION_TIMEOUT',
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOOL_NOT_AUTHORIZED: 'TOOL_NOT_AUTHORIZED',
  // Guardrails
  GUARDRAIL_VIOLATED: 'GUARDRAIL_VIOLATED',
  // General
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface PersonaForgeErrorOptions {
  code: ErrorCode;
  message: string;
  retryable?: boolean;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export interface SerializedPersonaForgeError {
  name: string;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  context: Record<string, unknown>;
  timestamp: string;
}

/**
 * Base error class for all personaforge exceptions.
 *
 * Always carries a structured `code`, `retryable` flag, and freeform
 * `context` bag so observability backends can index and alert on error types
 * without parsing message strings.
 */
export class PersonaForgeError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;
  readonly timestamp: string;

  constructor(opts: PersonaForgeErrorOptions) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'PersonaForgeError';
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.context = opts.context ?? {};
    this.timestamp = new Date().toISOString();
  }

  toJSON(): SerializedPersonaForgeError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp,
    };
  }
}

// --- Typed sub-classes for `instanceof` checks ----------------------------

export class BudgetExceededError extends PersonaForgeError {
  constructor(opts: { limitUsd: number; spentUsd: number; scope: string }) {
    super({
      code: ERROR_CODES.BUDGET_EXCEEDED,
      message: `Budget exceeded: spent $${opts.spentUsd.toFixed(4)} of $${String(opts.limitUsd)} (${opts.scope})`,
      retryable: false,
      context: { ...opts },
    });
    this.name = 'BudgetExceededError';
  }
}

export class CircuitOpenError extends PersonaForgeError {
  constructor(service: string, resetAfterMs: number) {
    super({
      code: ERROR_CODES.CIRCUIT_OPEN,
      message: `Circuit breaker open for '${service}'. Resets in ${String(resetAfterMs)}ms.`,
      retryable: true,
      context: { service, resetAfterMs },
    });
    this.name = 'CircuitOpenError';
  }
}

export class GuardrailViolatedError extends PersonaForgeError {
  constructor(rule: string, detail: string) {
    super({
      code: ERROR_CODES.GUARDRAIL_VIOLATED,
      message: `Guardrail '${rule}' violated: ${detail}`,
      retryable: false,
      context: { rule, detail },
    });
    this.name = 'GuardrailViolatedError';
  }
}

export class ToolTimeoutError extends PersonaForgeError {
  constructor(toolName: string, timeoutMs: number) {
    super({
      code: ERROR_CODES.TOOL_TIMEOUT,
      message: `Tool '${toolName}' timed out after ${String(timeoutMs)}ms`,
      retryable: true,
      context: { toolName, timeoutMs },
    });
    this.name = 'ToolTimeoutError';
  }
}

export class ToolValidationError extends PersonaForgeError {
  constructor(toolName: string, detail: string, context: Record<string, unknown> = {}) {
    super({
      code: ERROR_CODES.TOOL_VALIDATION_FAILED,
      message: `Tool '${toolName}' validation failed: ${detail}`,
      retryable: false,
      context: { toolName, detail, ...context },
    });
    this.name = 'ToolValidationError';
  }
}

export class ExecutionTimeoutError extends PersonaForgeError {
  constructor(timeoutMs: number, scope: string) {
    super({
      code: ERROR_CODES.EXECUTION_TIMEOUT,
      message: `${scope} exceeded ${String(timeoutMs)}ms wall-clock limit`,
      retryable: false,
      context: { timeoutMs, scope },
    });
    this.name = 'ExecutionTimeoutError';
  }
}

export class ValidationError extends PersonaForgeError {
  constructor(detail: string, context: Record<string, unknown> = {}) {
    super({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: `Validation failed: ${detail}`,
      retryable: false,
      context,
    });
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends PersonaForgeError {
  constructor(detail = 'Authentication required') {
    super({
      code: ERROR_CODES.UNAUTHORIZED,
      message: detail,
      retryable: false,
    });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends PersonaForgeError {
  constructor(detail: string, requiredRole?: string) {
    super({
      code: ERROR_CODES.FORBIDDEN,
      message: detail,
      retryable: false,
      context: requiredRole === undefined ? {} : { requiredRole },
    });
    this.name = 'ForbiddenError';
  }
}

export class ToolNotAuthorizedError extends PersonaForgeError {
  constructor(toolName: string, tenantId?: string) {
    super({
      code: ERROR_CODES.TOOL_NOT_AUTHORIZED,
      message: `Tool '${toolName}' is not in the allowed-tools list for this tenant/run.`,
      retryable: false,
      context: tenantId !== undefined ? { toolName, tenantId } : { toolName },
    });
    this.name = 'ToolNotAuthorizedError';
  }
}

// --- Type guards ----------------------------------------------------------

/** Type guard — returns `true` when `e` is any `PersonaForgeError` subclass. */
export function isPersonaForgeError(e: unknown): e is PersonaForgeError {
  return e instanceof PersonaForgeError;
}

export function isRetryable(e: unknown): boolean {
  return isPersonaForgeError(e) && e.retryable;
}
