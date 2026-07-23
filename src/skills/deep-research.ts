/**
 * @confused-ai/skills — createDeepAgent (deep-research recipe).
 *
 * Orchestrates planner + sub-agents + compression for long-horizon research:
 *   1. Planner decomposes the question into sub-questions.
 *   2. Each sub-question is dispatched to a researcher sub-agent (parallel).
 *   3. Findings are compressed and merged.
 *   4. A synthesizer produces the final answer with citations.
 *
 * Ships as a single opinionated factory; the user provides a model string
 * (or LLMProvider) and optional tools, and gets back a run() function.
 *
 * ```ts
 * const deep = createDeepAgent({ model: 'gpt-4o', tools: [webSearch, wikipedia] });
 * const result = await deep.run('What are the long-term economic effects of UBI?');
 * console.log(result.answer);  // multi-paragraph synthesis
 * console.log(result.steps);   // planning + per-sub-question results
 * ```
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeepAgentConfig {
  /** LLM used for planning, research, and synthesis. */
  generate: (prompt: string) => Promise<string>;
  /** Optional tools (e.g. web search) available to the researcher sub-agent. */
  tools?: Array<{ name: string; description: string; execute: (input: unknown) => Promise<unknown> }>;
  /** Max parallel sub-questions. Default 5. */
  maxParallel?: number;
  /** Max sub-questions to generate. Default 5. */
  maxQuestions?: number;
  /** Max tokens per sub-answer before compression. Default 2000. */
  subAnswerMaxChars?: number;
}

export interface DeepResearchResult {
  answer: string;
  steps: DeepStep[];
  subQuestions: string[];
  rawSubAnswers: Array<{ question: string; answer: string }>;
}

export interface DeepStep {
  phase: 'plan' | 'research' | 'synthesize';
  detail: string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createDeepAgent(config: DeepAgentConfig): { run: (question: string) => Promise<DeepResearchResult> } {
  const { generate, tools = [], maxQuestions = 5, maxParallel = 5, subAnswerMaxChars = 2000 } = config;

  return {
    async run(question: string): Promise<DeepResearchResult> {
      const steps: DeepStep[] = [];

      // ── 1. Plan ─────────────────────────────────────────────────────────
      const planPrompt = [
        'You are a research planner. Break the following question into focused sub-questions',
        `that, when answered together, will produce a comprehensive answer.`,
        `Return exactly one sub-question per line. No numbering, no extra text.`,
        `Limit to ${String(maxQuestions)} sub-questions.`,
        `\nQuestion: ${question}`,
      ].join('\n');
      const planRaw = await generate(planPrompt);
      const subQuestions = planRaw.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, maxQuestions);
      steps.push({ phase: 'plan', detail: `Decomposed into ${String(subQuestions.length)} sub-questions` });

      // ── 2. Research (parallel) ──────────────────────────────────────────
      const rawSubAnswers: Array<{ question: string; answer: string }> = [];
      const batches: string[][] = [];
      for (let i = 0; i < subQuestions.length; i += maxParallel) {
        batches.push(subQuestions.slice(i, i + maxParallel));
      }

      for (const batch of batches) {
        const answers = await Promise.all(batch.map(async (sq) => {
          let toolContext = '';
          // Call each tool and collect results.
          for (const t of tools) {
            try {
              const result = await t.execute({ query: sq });
              toolContext += `\n[${t.name}]: ${JSON.stringify(result).slice(0, 1000)}`;
            } catch { /* tool optional */ }
          }
          const researchPrompt = [
            'Answer the following research question thoroughly and concisely.',
            toolContext ? `\nTool results:${toolContext}` : '',
            `\nQuestion: ${sq}`,
          ].join('');
          const answer = await generate(researchPrompt);
          return { question: sq, answer: answer.slice(0, subAnswerMaxChars) };
        }));
        rawSubAnswers.push(...answers);
        steps.push({ phase: 'research', detail: `Researched ${String(answers.length)} sub-questions` });
      }

      // ── 3. Synthesize ───────────────────────────────────────────────────
      const findings = rawSubAnswers.map((r) => `Q: ${r.question}\nA: ${r.answer}`).join('\n\n');
      const synthesizePrompt = [
        'You are a research synthesizer. Given the following sub-question findings,',
        'produce a comprehensive, well-structured answer to the original question.',
        'Include inline citations referencing which sub-question each insight came from.',
        `\nOriginal question: ${question}`,
        `\nFindings:\n${findings}`,
      ].join('\n');
      const answer = await generate(synthesizePrompt);
      steps.push({ phase: 'synthesize', detail: 'Produced final synthesis' });

      return { answer, steps, subQuestions, rawSubAnswers };
    },
  };
}
