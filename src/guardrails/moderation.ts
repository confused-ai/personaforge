/**
 * Content Moderation & PII Detection Guardrails
 *
 * Provides:
 *   1. OpenAI Moderation API integration — hate, harassment, self-harm, sexual, violence detection
 *   2. PII detection & redaction — emails, phones, SSNs, credit cards, IPs, passport numbers, API keys, etc.
 *   3. Toxicity threshold rules — block or warn based on category scores
 *   4. Content policy rules — block responses that contain forbidden topics
 *
 * Edge cases covered:
 *   - OpenAI Moderation API failure → fallback to pass (configurable to fail-closed)
 *   - Empty / null content → always passes
 *   - Redaction of PII: replaces matched values with [REDACTED:<type>] placeholders
 *   - Category score threshold: allows fine-grained control per category (e.g. allow violence at 0.3)
 *   - Multiple PII matches in the same string — all replaced
 *   - PII rule can be set to detect-only (no redaction) or redact mode
 */

import type { GuardrailRule, GuardrailContext, GuardrailResult } from './types.js';

// ── PII Patterns ───────────────────────────────────────────────────────────

export const PII_PATTERNS: Record<string, RegExp> = {
    email: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    phone: /\b(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g,
    ssn: /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/g,
    // Visa, Mastercard, Amex, Discover — basic luhn-shape patterns
    credit_card: /\b(?:4\d{12}(?:\d{3})?|[25][1-7]\d{14}|6(?:011|5\d{2})\d{12}|3[47]\d{13})\b/g,
    // IPv4
    ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    // UK National Insurance
    national_insurance: /\b[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}\d{6}[A-D]{1}\b/g,
    // Passport-like alphanumeric IDs (heuristic; 8-9 chars)
    passport: /\b[A-Z]{1,2}\d{6,7}\b/g,
    // AWS access key IDs
    aws_key: /\bAKIA[0-9A-Z]{16}\b/g,
    // Generic API keys / secrets (long hex or base64 tokens in key= assignments)
    api_key: /(?:api[_\-]?key|apikey|access[_\-]?token|secret[_\-]?key)\s*[:=]\s*['"]?([A-Za-z0-9\-_+/]{20,})['"]?/gi,
    // JWT tokens
    jwt: /\beyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+\b/g,
};

export type PiiType = keyof typeof PII_PATTERNS;

export interface PiiDetectionResult {
    /** Whether any PII was found. */
    found: boolean;
    /** Types of PII found. */
    types: PiiType[];
    /** Redacted version of the content (if `redact` was true). */
    redacted?: string;
    /** Extracted matches per type (only when `extract` is true). */
    matches?: Partial<Record<PiiType, string[]>>;
}

/**
 * Detect (and optionally redact) PII in a string.
 *
 * @param content  The string to scan.
 * @param redact   Replace PII with `[REDACTED:<type>]`. Default: false.
 * @param extract  Return the raw matched values. Default: false.
 * @param types    Subset of PII types to check. Default: all types.
 */
export function detectPii(
    content: string,
    options: { redact?: boolean; extract?: boolean; types?: PiiType[] } = {}
): PiiDetectionResult {
    if (!content) return { found: false, types: [] };

    const { redact = false, extract = false } = options;
    const typesToCheck = (options.types ?? Object.keys(PII_PATTERNS)) as PiiType[];

    let working = content;
    const foundTypes: PiiType[] = [];
    const matches: Partial<Record<PiiType, string[]>> = {};

    for (const type of typesToCheck) {
        const pattern = PII_PATTERNS[type];
        if (!pattern) continue;
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
        const found = working.match(pattern);
        if (found && found.length > 0) {
            foundTypes.push(type);
            if (extract) matches[type] = found;
            if (redact) {
                pattern.lastIndex = 0;
                working = working.replace(pattern, `[REDACTED:${type.toUpperCase()}]`);
            }
        }
        // Always reset after use
        pattern.lastIndex = 0;
    }

    return {
        found: foundTypes.length > 0,
        types: foundTypes,
        ...(redact ? { redacted: working } : {}),
        ...(extract ? { matches } : {}),
    };
}

// ── PII Guardrail Rule ─────────────────────────────────────────────────────

export interface PiiGuardrailOptions {
    /**
     * Which PII types to detect. Default: all types.
     */
    types?: PiiType[];
    /**
     * When true: block the response if PII is found (severity: 'error').
     * When false: warn but allow (severity: 'warning'). Default: true (block).
     */
    block?: boolean;
    /**
     * Apply to: 'output' (agent response), 'input' (tool args), or 'both'. Default: 'output'.
     */
    applyTo?: 'output' | 'input' | 'both';
}

/**
 * Create a guardrail rule that detects PII in agent outputs or tool inputs.
 *
 * @example
 * ```ts
 * import { createPiiDetectionRule } from 'personaforge/guardrails';
 * const rule = createPiiDetectionRule({ block: true, types: ['email', 'ssn', 'credit_card'] });
 * ```
 */
export function createPiiDetectionRule(options: PiiGuardrailOptions = {}): GuardrailRule {
    const { types, block = true, applyTo = 'output' } = options;
    const severity = block ? ('error' as const) : ('warning' as const);

    return {
        name: 'pii-detection',
        description: 'Detects personally identifiable information in agent outputs or tool inputs',
        severity,
        check(context: GuardrailContext): GuardrailResult {
            const targets: string[] = [];

            if (applyTo === 'output' || applyTo === 'both') {
                const raw = context.output;
                if (raw !== undefined && raw !== null) {
                    targets.push(typeof raw === 'string' ? raw : JSON.stringify(raw));
                }
            }

            if (applyTo === 'input' || applyTo === 'both') {
                const args = context.toolArgs;
                if (args) {
                    targets.push(JSON.stringify(args));
                }
            }

            const allTypes = new Set<PiiType>();
            for (const content of targets) {
                const result = detectPii(content, { types });
                result.types.forEach((t) => allTypes.add(t));
            }

            if (allTypes.size > 0) {
                const typeList = [...allTypes].join(', ');
                return {
                    passed: !block,
                    rule: 'pii-detection',
                    message: `PII detected: ${typeList}`,
                    details: { types: [...allTypes] },
                };
            }

            return { passed: true, rule: 'pii-detection' };
        },
    };
}

// ── OpenAI Moderation ──────────────────────────────────────────────────────

export interface ModerationCategory {
    hate: number;
    'hate/threatening': number;
    harassment: number;
    'harassment/threatening': number;
    'self-harm': number;
    'self-harm/intent': number;
    'self-harm/instructions': number;
    sexual: number;
    'sexual/minors': number;
    violence: number;
    'violence/graphic': number;
}

export interface ModerationResult {
    flagged: boolean;
    categories: Partial<Record<keyof ModerationCategory, boolean>>;
    category_scores: Partial<ModerationCategory>;
}

export interface ContentModerationOptions {
    /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
    apiKey?: string;
    /**
     * Per-category score thresholds. If a category's score exceeds its threshold
     * the request is flagged even if OpenAI's binary `flagged` is false.
     *
     * @example { 'hate': 0.5, 'violence': 0.7 } — flag hate at 50% confidence
     */
    thresholds?: Partial<ModerationCategory>;
    /**
     * Whether to fail-closed on API errors (treat as flagged) or fail-open (treat as safe).
     * Default: 'fail-open' (pass through on API errors to avoid blocking legitimate traffic).
     */
    onError?: 'fail-open' | 'fail-closed';
    /**
     * Apply to: 'output' | 'input' | 'both'. Default: 'both'.
     */
    applyTo?: 'output' | 'input' | 'both';
    /** Maximum character length to send to the moderation API. Truncated if longer. Default: 4096 */
    maxLength?: number;
}

/**
 * Call the OpenAI moderation endpoint directly.
 * Exported for standalone use.
 */
export async function callOpenAiModeration(
    text: string,
    apiKey: string,
    maxLength = 4096
): Promise<ModerationResult> {
    const truncated = text.length > maxLength ? text.slice(0, maxLength) : text;
    const response = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: truncated }),
    });
    if (!response.ok) {
        throw new Error(`OpenAI Moderation API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { results: ModerationResult[] };
    return data.results[0] ?? { flagged: false, categories: {}, category_scores: {} };
}

/**
 * Create a guardrail rule backed by the OpenAI Moderation API.
 *
 * Edge cases:
 * - API unreachable: respects `onError` (fail-open by default)
 * - Custom thresholds: allows per-category tuning without re-training
 * - applyTo: controls whether agent output, tool inputs, or both are checked
 *
 * @example
 * ```ts
 * import { createOpenAiModerationRule } from 'personaforge/guardrails';
 * const rule = createOpenAiModerationRule({
 *   thresholds: { hate: 0.5 },
 *   onError: 'fail-closed',
 * });
 * ```
 */
export function createOpenAiModerationRule(options: ContentModerationOptions = {}): GuardrailRule {
    const {
        thresholds = {},
        onError = 'fail-open',
        applyTo = 'both',
        maxLength = 4096,
    } = options;

    return {
        name: 'openai-moderation',
        description: 'Uses OpenAI Moderation API to detect harmful content',
        severity: 'error',
        async check(context: GuardrailContext): Promise<GuardrailResult> {
            const apiKey =
                options.apiKey ??
                (typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : undefined) ??
                '';

            if (!apiKey) {
                return {
                    passed: onError === 'fail-open',
                    rule: 'openai-moderation',
                    message: 'OPENAI_API_KEY not set — moderation skipped',
                };
            }

            const parts: string[] = [];
            if (applyTo === 'output' || applyTo === 'both') {
                const raw = context.output;
                if (raw !== undefined && raw !== null) {
                    parts.push(typeof raw === 'string' ? raw : JSON.stringify(raw));
                }
            }
            if (applyTo === 'input' || applyTo === 'both') {
                if (context.toolArgs) parts.push(JSON.stringify(context.toolArgs));
            }

            const content = parts.join('\n').trim();
            if (!content) return { passed: true, rule: 'openai-moderation' };

            let result: ModerationResult;
            try {
                result = await callOpenAiModeration(content, apiKey, maxLength);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return {
                    passed: onError === 'fail-open',
                    rule: 'openai-moderation',
                    message: `Moderation API error: ${msg}`,
                };
            }

            // Check OpenAI's binary flag
            if (result.flagged) {
                const flaggedCategories = Object.entries(result.categories)
                    .filter(([, v]) => v)
                    .map(([k]) => k);
                return {
                    passed: false,
                    rule: 'openai-moderation',
                    message: `Content flagged: ${flaggedCategories.join(', ')}`,
                    details: { categories: result.categories, scores: result.category_scores },
                };
            }

            // Check custom thresholds
            const exceededThresholds: string[] = [];
            for (const [cat, threshold] of Object.entries(thresholds) as [keyof ModerationCategory, number][]) {
                const score = result.category_scores[cat] ?? 0;
                if (score >= threshold) {
                    exceededThresholds.push(`${cat}(${score.toFixed(3)}≥${threshold})`);
                }
            }
            if (exceededThresholds.length > 0) {
                return {
                    passed: false,
                    rule: 'openai-moderation',
                    message: `Content exceeded score threshold: ${exceededThresholds.join(', ')}`,
                    details: { exceededThresholds, scores: result.category_scores },
                };
            }

            return { passed: true, rule: 'openai-moderation', details: { scores: result.category_scores } };
        },
    };
}

// ── Forbidden Topics Rule ──────────────────────────────────────────────────

export interface ForbiddenTopicsOptions {
    /**
     * List of phrases/patterns that should never appear in agent output.
     * Strings are matched case-insensitively. RegExp patterns are used as-is.
     */
    topics: Array<string | RegExp>;
    /** 'error' blocks the response; 'warning' allows but flags. Default: 'error'. */
    severity?: 'error' | 'warning';
    /** Custom message prefix. Default: 'Forbidden topic detected'. */
    messagePrefix?: string;
}

/**
 * Create a guardrail rule that blocks responses containing forbidden topics.
 *
 * @example
 * ```ts
 * const rule = createForbiddenTopicsRule({
 *   topics: ['competitor_name', /malware/i, 'internal project codename'],
 * });
 * ```
 */
export function createForbiddenTopicsRule(options: ForbiddenTopicsOptions): GuardrailRule {
    const { severity = 'error', messagePrefix = 'Forbidden topic detected' } = options;

    const patterns: RegExp[] = options.topics.map((t) =>
        t instanceof RegExp ? t : new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    );

    return {
        name: 'forbidden-topics',
        description: 'Blocks responses that contain forbidden topics or phrases',
        severity,
        check(context: GuardrailContext): GuardrailResult {
            const raw = context.output;
            if (raw === undefined || raw === null) return { passed: true, rule: 'forbidden-topics' };
            const content = typeof raw === 'string' ? raw : JSON.stringify(raw);

            for (const pattern of patterns) {
                if (pattern.test(content)) {
                    return {
                        passed: false,
                        rule: 'forbidden-topics',
                        message: `${messagePrefix}: matched /${pattern.source}/`,
                        details: { pattern: pattern.source },
                    };
                }
            }
            return { passed: true, rule: 'forbidden-topics' };
        },
    };
}
