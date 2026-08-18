/**
 * Reflexion Engine
 * ================
 * Implements the Reflexion pattern (Actor → Evaluator → Self-Reflection Critique → Retry Loop).
 * Based on Shinn et al. (2023) "Reflexion: Language Agents with Verbal Reinforcement Learning".
 *
 * Algorithm:
 *   1. Actor generates a solution candidate given goal and prior self-critiques.
 *   2. Evaluator scores candidate (passed/failed + rationale).
 *   3. If candidate passes, return solution immediately.
 *   4. If candidate fails, Reflector generates a verbal critique pinpointing mistake and upgrade path.
 *   5. Repeat up to maxAttempts.
 */

export interface ReflexionConfig {
    /** LLM callable — generates solution candidates, evaluations, and critiques. */
    generate: (messages: Array<{ role: string; content: string }>) => Promise<string>;
    /**
     * Optional evaluator function. Returns whether solution passed and feedback.
     * When omitted, uses LLM evaluator prompt.
     */
    evaluate?: (response: string, goal: string) => Promise<{ passed: boolean; score?: number; feedback?: string }>;
    /** Max retry attempts before returning best candidate. Default: 3 */
    maxAttempts?: number;
    /** System prompt for candidate generation */
    actorPrompt?: string;
    /** System prompt for candidate evaluation */
    evaluatorPrompt?: string;
    /** System prompt for self-reflection critique generation */
    reflectPrompt?: string;
}

export interface ReflexionStep {
    attempt: number;
    response: string;
    passed: boolean;
    score: number;
    feedback: string;
    critique: string;
}

export interface ReflexionResult {
    /** Final best solution produced across attempts */
    solution: string;
    /** Whether the final solution passed evaluation */
    passed: boolean;
    /** Final score (0.0 - 1.0) */
    score: number;
    /** Total attempts executed */
    totalAttempts: number;
    /** Complete trace of attempts, evaluations, and critiques */
    attempts: ReflexionStep[];
}

const DEFAULT_ACTOR_PROMPT = `You are a meticulous problem-solving agent.
Given a goal and previous feedback/critiques, provide a detailed, accurate solution.`;

const DEFAULT_EVALUATOR_PROMPT = `You are an evaluator checking solution correctness.
Respond ONLY with JSON:
{ "passed": true|false, "score": <0.0-1.0>, "feedback": "<detailed rationale>" }`;

const DEFAULT_REFLECT_PROMPT = `You are a self-reflection critic.
Analyze why the previous solution failed and provide concise, actionable guidance for the next attempt.`;

export class ReflexionEngine {
    private readonly _generate: ReflexionConfig['generate'];
    private readonly _evaluate?: ReflexionConfig['evaluate'];
    private readonly _maxAttempts: number;
    private readonly _actorPrompt: string;
    private readonly _evaluatorPrompt: string;
    private readonly _reflectPrompt: string;

    constructor(config: ReflexionConfig) {
        this._generate        = config.generate;
        this._evaluate        = config.evaluate;
        this._maxAttempts     = config.maxAttempts     ?? 3;
        this._actorPrompt     = config.actorPrompt     ?? DEFAULT_ACTOR_PROMPT;
        this._evaluatorPrompt = config.evaluatorPrompt ?? DEFAULT_EVALUATOR_PROMPT;
        this._reflectPrompt   = config.reflectPrompt   ?? DEFAULT_REFLECT_PROMPT;
    }

    async solve(goal: string, context?: string): Promise<ReflexionResult> {
        const attempts: ReflexionStep[] = [];
        let bestStep: ReflexionStep | null = null;

        for (let attempt = 1; attempt <= this._maxAttempts; attempt++) {
            // 1. Build actor prompt including history of prior failures & critiques
            const critiquesHistory = attempts
                .map((a) => `[Attempt ${a.attempt} Failed]\nResponse: ${a.response}\nFeedback: ${a.feedback}\nCritique: ${a.critique}`)
                .join('\n\n');

            const actorUserMsg = [
                `Goal: ${goal}`,
                context ? `Context: ${context}` : '',
                critiquesHistory ? `Prior Failure Analysis & Self-Critiques:\n${critiquesHistory}` : '',
                `Provide solution attempt ${attempt}:`,
            ].filter(Boolean).join('\n\n');

            const response = await this._generate([
                { role: 'system', content: this._actorPrompt },
                { role: 'user',   content: actorUserMsg },
            ]).catch((err) => `Attempt ${attempt} error: ${String(err)}`);

            // 2. Evaluate candidate
            let evalResult: { passed: boolean; score?: number; feedback?: string };
            if (this._evaluate) {
                evalResult = await this._evaluate(response, goal).catch(() => ({
                    passed: false,
                    score: 0,
                    feedback: 'Evaluator function failed',
                }));
            } else {
                const evalUserMsg = `Goal: ${goal}\n\nCandidate Solution:\n${response}`;
                const rawEval = await this._generate([
                    { role: 'system', content: this._evaluatorPrompt },
                    { role: 'user',   content: evalUserMsg },
                ]).catch(() => '');

                evalResult = this._parseEvaluation(rawEval);
            }

            const passed = evalResult.passed;
            const score  = evalResult.score ?? (passed ? 1 : 0);
            const feedback = evalResult.feedback ?? (passed ? 'Solution verified' : 'Solution incomplete or incorrect');

            // 3. Early return if passed
            if (passed) {
                const step: ReflexionStep = {
                    attempt,
                    response,
                    passed: true,
                    score,
                    feedback,
                    critique: 'None required (passed evaluation)',
                };
                attempts.push(step);
                return {
                    solution: response,
                    passed: true,
                    score,
                    totalAttempts: attempt,
                    attempts,
                };
            }

            // 4. Generate critique for failed attempt
            const reflectUserMsg = `Goal: ${goal}\nFailed Solution (Attempt ${attempt}):\n${response}\nFeedback: ${feedback}\nProvide self-critique:`;
            const critique = await this._generate([
                { role: 'system', content: this._reflectPrompt },
                { role: 'user',   content: reflectUserMsg },
            ]).catch(() => 'Identify error and adjust approach.');

            const step: ReflexionStep = {
                attempt,
                response,
                passed: false,
                score,
                feedback,
                critique,
            };
            attempts.push(step);

            if (!bestStep || step.score > bestStep.score) {
                bestStep = step;
            }
        }

        const finalStep = bestStep ?? attempts[attempts.length - 1]!;
        return {
            solution: finalStep.response,
            passed: false,
            score: finalStep.score,
            totalAttempts: attempts.length,
            attempts,
        };
    }

    private _parseEvaluation(raw: string): { passed: boolean; score: number; feedback: string } {
        try {
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]) as { passed?: boolean; score?: number; feedback?: string };
                return {
                    passed: Boolean(parsed.passed),
                    score: typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : (parsed.passed ? 1 : 0),
                    feedback: typeof parsed.feedback === 'string' ? parsed.feedback : 'Parsed JSON verdict',
                };
            }
        } catch {
            /* fall back */
        }
        const passed = /\b(passed|true|correct|success)\b/i.test(raw) && !/\b(failed|false|incorrect)\b/i.test(raw);
        return {
            passed,
            score: passed ? 1 : 0,
            feedback: raw.slice(0, 200) || 'Fallback verdict',
        };
    }
}
