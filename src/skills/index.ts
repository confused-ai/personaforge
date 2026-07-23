/**
 * @confused-ai/skills — Reference skills for the confused-ai framework.
 *
 * Each skill is a self-contained capability bundle (instructions + tools)
 * that can be attached to any agent via the `skills` option.
 *
 * @example
 * ```ts
 * import { webResearchSkill, codeReviewerSkill } from './index.js';
 * import { agent } from 'confused-ai';
 *
 * const bot = agent({
 *   name: 'MyAgent',
 *   skills: [webResearchSkill, codeReviewerSkill],
 * });
 * ```
 */

export { webResearchSkill } from './web-research.js';
export { pdfSummarizerSkill } from './pdf-summarizer.js';
export { codeReviewerSkill } from './code-reviewer.js';

// ── Deep research recipe ──────────────────────────────────────────────────────
export { createDeepAgent } from './deep-research.js';
export type { DeepAgentConfig, DeepResearchResult, DeepStep } from './deep-research.js';
