/**
 * @personaforge/guardrails — Production guardrails for AI agents.
 *
 * Capabilities:
 *   - Input/output validation with Zod schemas
 *   - PII detection and redaction (email, phone, SSN, credit card, JWT, AWS keys, etc.)
 *   - Prompt injection detection (pattern + heuristic + LLM-based)
 *   - Content moderation (OpenAI Moderation API + custom rules)
 *   - Allowlists for tools, hosts, and output patterns
 *   - Human-in-the-loop hooks (beforeToolCall, beforeFinish, onViolation)
 *
 * @example
 * ```ts
 * import { GuardrailValidator, createPiiDetectionRule, createPromptInjectionRule } from './index.js';
 *
 * const guardrails = new GuardrailValidator({
 *   rules: [
 *     createPromptInjectionRule({ threshold: 0.7 }),
 *     createPiiDetectionRule({ redact: true }),
 *   ],
 * });
 *
 * runner.setGuardrails(guardrails);
 * ```
 */

// ── Types ──────────────────────────────────────────────────────────────────
export * from './types.js';

// ── Core engine ────────────────────────────────────────────────────────────
export {
    GuardrailValidator,
    createContentRule,
    createToolAllowlistRule,
    createMaxLengthRule,
} from './validator.js';

// ── Allowlists ─────────────────────────────────────────────────────────────
export {
    createAllowlistRule,
    createSensitiveDataRule,
    createUrlValidationRule,
    SENSITIVE_DATA_PATTERNS,
} from './allowlist.js';

// ── PII + Content Moderation ───────────────────────────────────────────────
export {
    detectPii,
    createPiiDetectionRule,
    createOpenAiModerationRule,
    createForbiddenTopicsRule,
    callOpenAiModeration,
    PII_PATTERNS,
} from './moderation.js';
export type {
    PiiDetectionResult,
    PiiType,
    PiiGuardrailOptions,
    ModerationResult,
    ModerationCategory,
    ContentModerationOptions,
    ForbiddenTopicsOptions,
} from './moderation.js';

// ── Prompt Injection Detection ─────────────────────────────────────────────
export {
    detectPromptInjection,
    createPromptInjectionRule,
    createLlmInjectionClassifier,
} from './injection.js';
export type {
    InjectionSignal,
    PromptInjectionDetectionResult,
    PromptInjectionGuardrailOptions,
    LlmInjectionClassifierOptions,
} from './injection.js';
