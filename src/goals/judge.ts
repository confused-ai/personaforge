/**
 * Goal + task-completion judges — LLM-as-judge scoring for the agentic loop.
 *
 * A judge receives the agent's current output and returns a pass/fail verdict
 * (plus a reason used as feedback). Judges back the durable Goals feature and
 * supervisor `isTaskComplete` scoring.
 */

import type { LLMProvider, Message } from '../core/index.js';
import { createLlmProviderFromModelString } from '../providers/from-model.js';
import type { SchemaInput } from '../validation/index.js';
import { safeValidate } from '../validation/index.js';

export interface JudgeVerdict {
    readonly passed: boolean;
    readonly reason?: string;
    readonly score?: number;
}

/** A judge scores text output (0 = fail, 1 = pass, or 0/1-like). */
export interface TaskJudge {
    readonly id?: string;
    readonly name?: string;
    evaluate(text: string): Promise<JudgeVerdict>;
}

export interface GoalJudgeOptions {
    llm: LLMProvider;
    /** System prompt for the judge. */
    prompt?: string;
    /** Base model label for tracing. */
    modelLabel?: string;
    /** Whether the judge output must be valid JSON. Default true. */
    jsonOutput?: boolean;
}

const DEFAULT_JUDGE_PROMPT =
    'You are an impartial task-completeness judge. ' +
    'Read the agent output below and decide whether it fully satisfies the stated objective. ' +
    'Respond ONLY with JSON: {"passed": true|false, "reason": "<short reason>"}.';

/**
 * LLM-as-judge scorer. The failure reason is used as loop feedback so the
 * agent can iterate toward completion.
 */
export function createLlmJudge(opts: GoalJudgeOptions): TaskJudge {
    const prompt = opts.prompt ?? DEFAULT_JUDGE_PROMPT;
    return {
        id: 'llm-judge',
        name: 'LLM Judge',
        async evaluate(text: string): Promise<JudgeVerdict> {
            const messages: Message[] = [
                { role: 'system', content: prompt },
                {
                    role: 'user',
                    content:
                        opts.jsonOutput === false
                            ? text
                            : `Objective satisfied?\n\n${text.slice(0, 60_000)}\n\nRespond with JSON only.`,
                },
            ];
            const result = await opts.llm.generateText(messages, {
                temperature: 0,
                maxTokens: 512,
                toolChoice: 'none',
            });
            return parseVerdict(result.text ?? '');
        },
    };
}

export function parseVerdict(raw: string): JudgeVerdict {
    const block = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const candidate = block?.[1] ?? raw;
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]) as { passed?: unknown; reason?: unknown; score?: unknown };
            if (typeof parsed.passed === 'boolean') {
                return {
                    passed: parsed.passed,
                    reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
                    score: typeof parsed.score === 'number' ? parsed.score : parsed.passed ? 1 : 0,
                };
            }
        } catch {
            /* fall through */
        }
    }
    const yes = /\b(yes|true|complete|satisfied|pass)\b/i.test(candidate);
    const no = /\b(no|false|incomplete|not satisfied|fail)\b/i.test(candidate);
    return { passed: yes && !no, reason: candidate.slice(0, 300) };
}

/** Build a judge from a `provider/model` string (resolves env-keyed provider). */
export function goalJudgeFromModelString(model: string): TaskJudge | undefined {
    const llm = createLlmProviderFromModelString(model);
    if (!llm) return undefined;
    return createLlmJudge({ llm, modelLabel: model });
}

/** A judge that is always satisfied (only useful with a custom `evaluate`). */
export function createStaticJudge(isComplete: (text: string) => boolean | Promise<boolean>): TaskJudge {
    return {
        id: 'static-judge',
        async evaluate(text: string): Promise<JudgeVerdict> {
            const passed = await isComplete(text);
            return { passed, reason: passed ? undefined : 'Output is not yet complete per the configured check.' };
        },
    };
}

// ── Rubric scorer (LLM-as-judge checklist) ───────────────────────────────────

export interface RubricCriterion {
    description: string;
    required?: boolean;
}

export interface RubricScorerOptions {
    judge: TaskJudge;
    criteria: RubricCriterion[];
    /** Require every criterion to pass. Default true. */
    requireAll?: boolean;
}

/**
 * Checklist scorer: after each iteration a grader reviews the output against a
 * rubric and iterates until every criterion passes or maxSteps is reached.
 *
 * The heuristic pass signal is deterministic and hermetic: a criterion counts as
 * satisfied when the output text mentions its description (case-insensitive).
 * With `requireAll: true` every criterion must pass. With `requireAll: false`
 * the scorer passes once *any* criterion has been satisfied, and always defers
 * to the LLM judge verdict otherwise — it never passes on iteration count alone.
 */
export function createRubricScorer(opts: RubricScorerOptions): TaskJudge {
    const criteria = opts.criteria;
    return {
        id: 'rubric-scorer',
        name: 'Rubric Scorer',
        async evaluate(text: string): Promise<JudgeVerdict> {
            const pending = criteria.filter((c) => !text.toLowerCase().includes(c.description.toLowerCase()));
            const heuristicPassed = opts.requireAll === false ? pending.length < criteria.length : pending.length === 0;
            const reason = heuristicPassed
                ? 'All rubric criteria satisfied.'
                : `Not yet complete. Still missing: ${pending.map((p) => p.description).join('; ')}`;
            const llmVerdict = await opts.judge.evaluate(text).catch(() => undefined);
            if (llmVerdict?.passed) return llmVerdict;
            return heuristicPassed ? { passed: true, reason, score: 1 } : { passed: false, reason, score: 0 };
        },
    };
}

// ── Schema-validated structured scorer ───────────────────────────────────────

export function createSchemaScorer(schema: SchemaInput): TaskJudge {
    return {
        id: 'schema-scorer',
        async evaluate(text: string): Promise<JudgeVerdict> {
            const block = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            const candidate = block?.[1] ?? text;
            // Parse JSON so object schemas validate against an object, not a
            // string. Fall back to the raw text for string-validating schemas.
            let input: unknown = candidate;
            try {
                input = JSON.parse(candidate);
            } catch {
                /* not JSON — validate the raw text */
            }
            const result = safeValidate(schema, input);
            return result.success
                ? { passed: true, reason: 'Output conforms to the schema.', score: 1 }
                : { passed: false, reason: `Output does not conform to schema: ${result.issues.map((i) => i.message).join('; ')}` };
        },
    };
}
